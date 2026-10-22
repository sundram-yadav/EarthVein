"""EarthVein API. Three roles: customer, control (control panel) and admin."""
import logging
import re
import threading
import uuid
from datetime import timedelta
from pathlib import Path

from flask import Flask, g, jsonify, request, send_from_directory
from flask_cors import CORS
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix

import config
from services import auth, catalog, engine, seed, world
from services.auth import require
from services.vehicles import build_vehicle, nearest_city, public as vehicle_public

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
STATIC = Path(__file__).resolve().parent / "static"      # the built frontend, served from the same origin
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 200_000
if config.PRODUCTION:
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)   # real client IP behind Render's proxy
if config.FRONTEND_ORIGIN:
    origins = "*" if config.FRONTEND_ORIGIN == "*" else [o.strip() for o in config.FRONTEND_ORIGIN.split(",")]
    CORS(app, origins=origins, allow_headers=["Content-Type", "Authorization"])
store = world.store
BOOKING_LOCK = threading.Lock()   # one booking decision at a time, so two requests cannot take the last bay
seed.seed()
if config.PRODUCTION and store.mode != "mongodb":
    app.logger.warning("Running in production with local JSON storage. Data is lost whenever the instance restarts. Set MONGO_URI.")

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


CSP = ("default-src 'self'; script-src 'self' https://accounts.google.com; "
       "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com; "
       "font-src https://fonts.gstatic.com; img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org https://*.googleusercontent.com; "
       "connect-src 'self' https://router.project-osrm.org https://accounts.google.com; frame-src https://accounts.google.com; "
       "frame-ancestors 'none'; base-uri 'self'; form-action 'self'")


@app.after_request
def headers(resp):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    resp.headers["Permissions-Policy"] = "geolocation=(self), camera=(), microphone=()"
    if config.PRODUCTION:
        resp.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    if request.path.startswith("/api/"):
        if request.path not in ("/api/health", "/api/meta", "/api/catalog"):
            resp.headers["Cache-Control"] = "no-store"
    else:
        resp.headers["Content-Security-Policy"] = CSP
        resp.headers["X-Frame-Options"] = "DENY"
        if request.path.startswith("/assets/"):
            resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif resp.mimetype == "text/html":
            resp.headers["Cache-Control"] = "no-cache"
    return resp


def err(msg, code=400):
    return jsonify({"error": msg}), code


def audit(action, target="", details="", old=None, new=None, actor=None):
    u = actor or getattr(g, "user", None)
    store.put("audit_log", {
        "id": uuid.uuid4().hex, "timestamp": engine.iso(world.now()), "action": action,
        "actor_id": u["id"] if u else None, "actor": u["name"] if u else "anonymous", "role": u["role"] if u else None,
        "target": target, "details": details, "old": old, "new": new, "ip": request.remote_addr})


def body():
    return request.get_json(silent=True) or {}


# ------------------------------------------------------------------ public
@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "storage": store.mode, "durable": store.mode == "mongodb", "time": engine.iso(world.now())})


@app.get("/api/meta")
def meta():
    m = world.models.metrics.get("meta", {})
    return jsonify({"storage": store.mode, "google_client_id": config.GOOGLE_CLIENT_ID or None,
                    "cities": list(config.CITY_CENTRES), "city_centres": config.CITY_CENTRES,
                    "peak_windows": config.PEAK_WINDOWS, "reserve_pct": config.RESERVE_PCT,
                    "model_trained_at": m.get("trained_at"), "rush": bool(world.setting("rush", False))})


@app.get("/api/catalog")
def get_catalog():
    c = catalog.catalog()
    return jsonify({"note": c["note"], "classes": catalog.CLASS_LABELS, "models": c["models"], "generic": catalog.GENERIC,
                    "connectors": ["CCS2", "Type 2 AC", "LECCS"]})


# ------------------------------------------------------------------ auth
def _session(user):
    store.put("users", {**user, "last_login": engine.iso(world.now())})
    return {"token": auth.make_token(user), "user": auth.public_user(user, "self")}


@app.post("/api/auth/signup")
def signup():
    if not auth.rate_ok("signup", request.remote_addr, config.SIGNUPS_PER_HOUR_PER_IP, 3600):
        return err("Too many accounts created from this network. Try again later.", 429)
    d = body()
    name, email, pw = str(d.get("name", "")).strip(), str(d.get("email", "")).strip().lower(), str(d.get("password", ""))
    if len(name) < 2:
        return err("Enter your name.")
    if not EMAIL_RE.match(email):
        return err("Enter a valid email address.")
    problem = auth.password_problem(pw)
    if problem:
        return err(problem)
    if store.one("users", email=email):
        return err("An account with this email already exists.", 409)
    phone = re.sub(r"\D", "", str(d.get("phone", "")))[-10:] or None
    user = {"id": "U-" + uuid.uuid4().hex[:8].upper(), "name": name[:60], "email": email, "role": "customer",
            "pw_hash": auth.hash_pw(pw), "provider": "password", "active": True, "phone": phone,
            "created_at": engine.iso(world.now()), "last_login": None}
    store.put("users", user)
    audit("Account created", user["id"], f"Customer sign-up for {email}.", actor=user)
    return jsonify(_session(user)), 201


@app.post("/api/auth/login")
def login():
    d = body()
    email, pw, portal = str(d.get("email", "")).strip().lower(), str(d.get("password", "")), d.get("portal", "customer")
    if auth.locked(email):
        return err("Too many failed attempts. Try again in a few minutes.", 429)
    user = store.one("users", email=email)
    if not user or not auth.check_pw(user, pw):
        auth.note_failure(email)
        audit("Sign-in failed", email, "Wrong email or password.", actor=user)
        return err("Email or password is not correct.", 401)
    if not user.get("active", True):
        return err("This account has been disabled. Contact an administrator.", 403)
    if user["role"] != portal:
        label = {"customer": "Customer", "control": "Control panel", "admin": "Admin"}[user["role"]]
        return err(f"This account belongs to the {label} portal. Choose that tab to sign in.", 403)
    auth.clear_failures(email)
    audit("Signed in", user["id"], f"{user['role']} portal.", actor=user)
    return jsonify(_session(user))


@app.post("/api/auth/google")
def google_login():
    if not config.GOOGLE_CLIENT_ID:
        return err("Google sign-in is not configured on this server.", 503)
    try:
        from google.auth.transport import requests as grequests
        from google.oauth2 import id_token
        info = id_token.verify_oauth2_token(body().get("credential", ""), grequests.Request(), config.GOOGLE_CLIENT_ID)
    except Exception:
        return err("Google could not verify this sign-in. Try again.", 401)
    if not info.get("email_verified"):
        return err("Your Google email is not verified.", 403)
    email = info["email"].lower()
    user = store.one("users", email=email)
    if user and user["role"] != "customer":
        return err("Staff accounts must sign in with email and password.", 403)
    if not user:
        user = {"id": "U-" + uuid.uuid4().hex[:8].upper(), "name": info.get("name", email.split("@")[0])[:60], "email": email,
                "role": "customer", "pw_hash": None, "provider": "google", "active": True, "phone": None,
                "created_at": engine.iso(world.now()), "last_login": None}
        store.put("users", user)
        audit("Account created", user["id"], "Customer sign-up with Google.", actor=user)
    audit("Signed in", user["id"], "Google sign-in.", actor=user)
    return jsonify(_session(user))


@app.get("/api/auth/me")
@require()
def me():
    return jsonify({"user": auth.public_user(g.user, "self")})


@app.post("/api/auth/logout")
@require()
def logout():
    audit("Signed out", g.user["id"], "")
    return jsonify({"ok": True})


@app.post("/api/auth/change-password")
@require()
def change_password():
    d = body()
    u = g.user
    if not u.get("pw_hash"):
        return err("This account signs in with Google, so it has no password to change.", 409)
    if not auth.check_pw(u, str(d.get("current", ""))):
        return err("Your current password is not correct.", 403)
    problem = auth.password_problem(str(d.get("new", "")), staff=u["role"] != "customer")
    if problem:
        return err(problem)
    u = {**u, "pw_hash": auth.hash_pw(d["new"]), "token_version": u.get("token_version", 0) + 1}
    store.put("users", u)
    audit("Password changed", u["id"], "Owner changed their password. Other sessions were signed out.")
    return jsonify({"token": auth.make_token(u)})


# ------------------------------------------------------------------ shared station data (no personal data)
@app.get("/api/stations")
@require()
def stations():
    return jsonify(engine.all_station_views())


@app.get("/api/stations/<sid>/forecast")
@require()
def station_forecast(sid):
    st = world.station(sid)
    if not st:
        return err("Station not found.", 404)
    return jsonify({"station_id": sid, "forecast": engine.forecast_station(st, world.now())})


@app.get("/api/forecast/city")
@require()
def city_forecast():
    city = request.args.get("city", "delhi")
    if city not in config.CITY_CENTRES:
        return err("Unknown city.")
    return jsonify({"city": city, "forecast": engine.forecast_city(city, world.now())})


# ------------------------------------------------------------------ customer workspace (always scoped to the signed-in user)
def own_vehicle(vid):
    v = store.get("vehicles", vid)
    return v if v and v["owner_id"] == g.user["id"] else None


def own_booking(bid):
    b = store.get("bookings", bid)
    return b if b and b["owner_id"] == g.user["id"] else None


def raise_ticket(v, category, subject, details, priority="high"):
    if any(t["vehicle_id"] == v["id"] and t["status"] != "resolved" and t["source"] == "system" for t in store.all("tickets")):
        return
    owner = store.get("users", v["owner_id"]) or {}
    store.put("tickets", {"id": "TK-" + uuid.uuid4().hex[:6].upper(), "created_at": engine.iso(world.now()), "source": "system",
                          "category": category, "priority": priority, "subject": subject, "details": details,
                          "station_id": None, "vehicle_id": v["id"], "plate": v["plate"], "owner_id": v["owner_id"],
                          "owner_name": owner.get("name"), "status": "open", "assignee": None, "notes": [], "replies": []})


CUSTOMER = ("customer", "admin")


@app.get("/api/me/vehicles")
@require(*CUSTOMER)
def my_vehicles():
    return jsonify([vehicle_public(v) for v in store.find("vehicles", owner_id=g.user["id"])])


@app.post("/api/me/vehicles")
@require(*CUSTOMER)
def add_vehicle():
    if store.count("vehicles", owner_id=g.user["id"]) >= config.MAX_VEHICLES_PER_USER:
        return err(f"You can register up to {config.MAX_VEHICLES_PER_USER} vehicles.", 409)
    try:
        v = build_vehicle(g.user["id"], body(), engine.iso(world.now()))
    except ValueError as e:
        return err(str(e))
    if store.one("vehicles", plate=v["plate"]):
        return err("This registration number is already registered on EarthVein.", 409)
    store.put("vehicles", v)
    audit("Vehicle registered", v["id"], f"{v['plate']} ({v['make']} {v['model']}).")
    return jsonify(vehicle_public(v)), 201


@app.patch("/api/me/vehicles/<vid>")
@require(*CUSTOMER)
def edit_vehicle(vid):
    v = own_vehicle(vid)
    if not v:
        return err("Vehicle not found.", 404)
    d = body()
    try:
        for key, lo, hi in (("soc", 0, 100), ("soh", 40, 100), ("load_kg", 0, 20000)):
            if key in d:
                val = float(d[key])
                if not lo <= val <= hi:
                    return err(f"{key} must be between {lo} and {hi}.")
                v[key] = val
    except (TypeError, ValueError):
        return err("Enter numbers only.")
    if "name" in d and str(d["name"]).strip():
        v["name"] = str(d["name"]).strip()[:40]
    store.put("vehicles", v)
    return jsonify(vehicle_public(v))


@app.delete("/api/me/vehicles/<vid>")
@require(*CUSTOMER)
def remove_vehicle(vid):
    v = own_vehicle(vid)
    if not v:
        return err("Vehicle not found.", 404)
    for b in store.find("bookings", vehicle_id=vid):
        if b["status"] in engine.ACTIVE:
            b["status"] = "cancelled"
            store.put("bookings", b)
    store.delete("vehicles", vid)
    audit("Vehicle removed", vid, v["plate"])
    return jsonify({"ok": True})


@app.get("/api/me/vehicles/<vid>/battery")
@require(*CUSTOMER)
def battery(vid):
    v = own_vehicle(vid)
    if not v:
        return err("Vehicle not found.", 404)
    return jsonify(engine.battery_report(v, world.now()))


@app.post("/api/me/vehicles/<vid>/telemetry")
@require(*CUSTOMER)
def telemetry(vid):
    v = own_vehicle(vid)
    if not v:
        return err("Vehicle not found.", 404)
    if not auth.rate_ok("telemetry", g.user["id"], 120, 60):
        return err("Location updates are coming too fast.", 429)
    d = body()
    try:
        lat, lng = float(d["lat"]), float(d["lng"])
        soc = float(d["soc"]) if d.get("soc") is not None else None
    except (KeyError, TypeError, ValueError):
        return err("lat and lng are required numbers.")
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return err("Coordinates are out of range.")
    engine.apply_telemetry(v, lat, lng, soc, bool(d.get("reposition")))
    v["city"] = nearest_city(v["lat"], v["lng"])
    store.put("vehicles", v)
    rep = engine.battery_report(v, world.now())
    if rep["level"] == "critical":
        raise_ticket(v, "battery", f"Critical battery on {v['plate']}",
                     f"Charge is {rep['soc']}%. {rep['message']}")
    return jsonify({"vehicle": vehicle_public(v), "battery": rep})


def _plan_args():
    a = request.args
    try:
        return dict(target=float(a["target"]) if a.get("target") else None, need_km=float(a.get("need_km") or 0),
                    pref=a.get("pref", "balanced"), horizon_h=min(24, max(2, int(a.get("horizon") or 12))))
    except ValueError:
        return None


@app.get("/api/me/vehicles/<vid>/plan")
@require(*CUSTOMER)
def vehicle_plan(vid):
    """Auto-route: best station and slot for this vehicle. Nothing is booked."""
    v = own_vehicle(vid)
    if not v:
        return err("Vehicle not found.", 404)
    if not auth.rate_ok("plan", g.user["id"], 40, 60):
        return err("Slow down a little, then try again in a minute.", 429)
    args = _plan_args()
    if args is None:
        return err("Check the numbers you entered.")
    result = engine.plan(v, world.now(), station_only=request.args.get("station_id") or None, **args)
    if result.get("reachable") is False and not result.get("outside_coverage") and "connector" not in result["message"]:
        raise_ticket(v, "battery", f"No reachable station for {v['plate']}", result["message"])
    return jsonify(result)


@app.get("/api/me/nearby")
@require(*CUSTOMER)
def nearby():
    """Stations around a point, with figures computed for the caller's own vehicle only."""
    v = own_vehicle(request.args.get("vehicle_id", ""))
    if not v:
        return err("Choose one of your vehicles.", 404)
    try:
        lat, lng = float(request.args.get("lat", v["lat"])), float(request.args.get("lng", v["lng"]))
    except ValueError:
        return err("lat and lng must be numbers.")
    usable, cons = engine.vehicle_numbers(v)
    out = []
    for s in engine.all_station_views():
        d = engine.road_km(lat, lng, s["lat"], s["lng"])
        arrive = v["soc"] - d * cons / (usable * 1000) * 100
        out.append({**s, "distance_km": round(d, 1), "soc_on_arrival": round(arrive, 1),
                    "reachable": arrive >= config.RESERVE_PCT, "compatible": v["connector"] in s["connectors"]})
    out.sort(key=lambda x: x["distance_km"])
    shown = out[:12]
    wanted = request.args.get("include")
    if wanted and not any(s["id"] == wanted for s in shown):
        shown += [s for s in out if s["id"] == wanted]
    return jsonify(shown)


@app.get("/api/me/bookings")
@require(*CUSTOMER)
def my_bookings():
    now = world.now()
    rows = [engine.booking_public(b, now) for b in store.find("bookings", owner_id=g.user["id"])]
    rows.sort(key=lambda b: b["slot_start"], reverse=True)
    return jsonify(rows)


@app.post("/api/me/bookings")
@require(*CUSTOMER)
def book():
    d = body()
    v = own_vehicle(d.get("vehicle_id", ""))
    if not v:
        return err("Choose one of your vehicles.", 404)
    try:
        args = dict(target=float(d["charge_to"]) if d.get("charge_to") else None, need_km=float(d.get("need_km") or 0),
                    pref=d.get("pref", "balanced"), horizon_h=12)
    except ValueError:
        return err("Check the numbers you entered.")
    with BOOKING_LOCK:
        return _book_locked(v, d, args)


def _book_locked(v, d, args):
    now = world.now()
    pl = engine.plan(v, now, station_only=d.get("station_id"), **args)
    opts = pl.get("options", [])
    if d.get("slot_start"):
        opt = next((o for o in opts if o["slot_start"] == d["slot_start"]), None)
        if not opt:
            return err("That slot is no longer available. Pick another one.", 409)
    elif opts:
        opt = opts[0]
    else:
        return err(pl.get("message", "No slot could be found."), 409)
    mine = [x for x in engine.active_bookings() if x["vehicle_id"] == v["id"] and engine.parse(x["slot_end"]) > now]
    if len(mine) >= config.MAX_ACTIVE_BOOKINGS_PER_VEHICLE:
        return err(f"This vehicle already has {len(mine)} upcoming bookings. Cancel one first.", 409)
    s0, e0 = engine.parse(opt["slot_start"]), engine.parse(opt["slot_end"])
    if any(engine.parse(x["slot_start"]) < e0 and engine.parse(x["slot_end"]) > s0 for x in mine):
        return err("This vehicle already has a booking that overlaps that time.", 409)
    b = engine.create_booking(v, opt, pl, now=now, source="manual" if d.get("slot_start") else "auto", actor=g.user["id"])
    audit("Slot booked", b["id"], f"{v['plate']} at {b['station_name']}, {b['slot_start'][11:16]}.", new=b["station_id"])
    return jsonify(b), 201


@app.post("/api/me/bookings/<bid>/cancel")
@require(*CUSTOMER)
def cancel(bid):
    b = own_booking(bid)
    if not b:
        return err("Booking not found.", 404)
    if b["status"] not in engine.ACTIVE or engine.parse(b["slot_end"]) < world.now():
        return err("Only upcoming bookings can be cancelled.", 409)
    b["status"] = "cancelled"
    store.put("bookings", b)
    audit("Booking cancelled", bid, b["station_name"], old="confirmed", new="cancelled")
    return jsonify(b)


@app.post("/api/me/bookings/<bid>/complete")
@require(*CUSTOMER)
def complete(bid):
    """The owner confirms the vehicle was charged; stored charge is set to the booking target."""
    b = own_booking(bid)
    if not b:
        return err("Booking not found.", 404)
    if b["status"] not in engine.ACTIVE:
        return err("This booking is not active.", 409)
    if engine.parse(b["slot_start"]) > world.now() + timedelta(minutes=15):
        return err("Charging has not started yet.", 409)
    v = store.get("vehicles", b["vehicle_id"])
    if v:
        v["soc"] = max(v["soc"], b["charge_to"])
        store.put("vehicles", v)
    b["status"] = "completed"
    store.put("bookings", b)
    audit("Charge confirmed", bid, f"{b['plate']} charged to {b['charge_to']:.0f}%.")
    return jsonify(b)


@app.get("/api/me/impact")
@require(*CUSTOMER)
def my_impact():
    vs = store.find("vehicles", owner_id=g.user["id"])
    now = world.now()
    bs = [engine.booking_public(b, now) for b in store.find("bookings", owner_id=g.user["id"])]
    return jsonify(engine.impact(vs, bs))


@app.get("/api/me/export")
@require(*CUSTOMER)
def export_me():
    audit("Data exported", g.user["id"], "Owner downloaded their data.")
    return jsonify({"profile": auth.public_user(g.user, "self"), "vehicles": store.find("vehicles", owner_id=g.user["id"]),
                    "bookings": store.find("bookings", owner_id=g.user["id"])})


@app.delete("/api/me")
@require("customer")
def delete_me():
    uid = g.user["id"]
    store.delete_where("bookings", owner_id=uid)
    store.delete_where("vehicles", owner_id=uid)
    store.delete("users", uid)
    audit("Account deleted", uid, "Customer deleted their account and all linked records.", actor=g.user)
    return jsonify({"ok": True})


# ------------------------------------------------------------------ help and support (customer side)
def ticket_for_customer(t):
    """What the owner sees: no internal notes and no staff names."""
    out = {k: t.get(k) for k in ("id", "created_at", "category", "subject", "details", "plate", "status")}
    out["replies"] = t.get("replies", [])
    return out


@app.get("/api/me/support")
@require("customer")
def my_tickets():
    return jsonify([ticket_for_customer(t) for t in store.recent("tickets", "created_at", 100, owner_id=g.user["id"])])


@app.post("/api/me/support")
@require("customer")
def my_ticket_create():
    if not auth.rate_ok("support", g.user["id"], 10, 3600):
        return err("You have sent several requests recently. Please wait before sending another.", 429)
    d = body()
    subject, details = str(d.get("subject", "")).strip(), str(d.get("details", "")).strip()
    if len(subject) < 4:
        return err("Add a short subject, at least 4 characters.")
    if len(details) < 10:
        return err("Describe the problem in a sentence or two so the support team can help.")
    plate = None
    if d.get("vehicle_id"):
        v = own_vehicle(d["vehicle_id"])
        if not v:
            return err("Choose one of your own vehicles.", 404)
        plate = v["plate"]
    category = d.get("category") if d.get("category") in ("battery", "station", "booking", "account", "other") else "other"
    t = {"id": "TK-" + uuid.uuid4().hex[:6].upper(), "created_at": engine.iso(world.now()), "source": "customer",
         "category": category, "priority": "high" if category == "battery" else "normal", "subject": subject[:120],
         "details": details[:1000], "station_id": None, "vehicle_id": d.get("vehicle_id") or None, "plate": plate,
         "owner_id": g.user["id"], "owner_name": g.user["name"], "status": "open", "assignee": None, "notes": [], "replies": []}
    store.put("tickets", t)
    audit("Support request created", t["id"], subject[:120])
    return jsonify(ticket_for_customer(t)), 201


@app.post("/api/me/support/<tid>/reply")
@require("customer")
def my_ticket_reply(tid):
    t = store.get("tickets", tid)
    if not t or t.get("owner_id") != g.user["id"]:
        return err("Request not found.", 404)
    text = str(body().get("text", "")).strip()
    if not text:
        return err("Write a message first.")
    t.setdefault("replies", []).append({"from": "you", "by": "You", "text": text[:800], "time": engine.iso(world.now())})
    if t["status"] == "resolved":
        t["status"] = "open"
    store.put("tickets", t)
    return jsonify(ticket_for_customer(t))


# ------------------------------------------------------------------ control panel and admin
STAFF = ("control", "admin")


def owner_name(uid):
    u = store.get("users", uid)
    return u["name"] if u else "Deleted user"


@app.get("/api/staff/overview")
@require(*STAFF)
def overview():
    now = world.now()
    vs, bs = store.all("vehicles"), [engine.booking_public(b, now) for b in store.all("bookings")]
    views = engine.all_station_views(now)
    today = now.date().isoformat()
    return jsonify({
        "customers": store.count("users", role="customer"), "vehicles": len(vs),
        "low_battery": sum(1 for v in vs if v["soc"] <= 20),
        "bookings_today": sum(1 for b in bs if b["slot_start"][:10] == today and b["status"] != "cancelled"),
        "upcoming": sum(1 for b in bs if b["status"] in engine.ACTIVE),
        "open_tickets": sum(1 for t in store.all("tickets") if t["status"] != "resolved"),
        "network_utilization": round(sum(s["occupied"] for s in views) / max(1, sum(s["bays"] for s in views)) * 100, 1),
        "high_pressure": [s["name"] for s in views if s["pressure"] == "High"],
        "rush": bool(world.setting("rush", False)),
        "by_class": {k: sum(1 for v in vs if v["vclass"] == k) for k in catalog.CLASS_LABELS},
    })


@app.get("/api/staff/vehicles")
@require(*STAFF)
def staff_vehicles():
    full = g.user["role"] == "admin"
    out = []
    for v in store.all("vehicles"):
        o = store.get("users", v["owner_id"]) or {"name": "Deleted user", "email": "-", "id": ""}
        row = {k: v[k] for k in ("id", "plate", "name", "vclass", "make", "model", "variant", "battery_kwh", "soh", "soc",
                                  "connector", "city", "last_seen", "odometer_km", "year")}
        row["owner"] = o["name"]
        row["owner_email"] = o["email"] if full else auth.mask_email(o["email"])
        row["lat"], row["lng"] = round(v["lat"], 3), round(v["lng"], 3)   # about 100 m, enough for zone-level records
        out.append(row)
    return jsonify(out)


@app.get("/api/staff/vehicles/<vid>")
@require(*STAFF)
def staff_vehicle(vid):
    v = store.get("vehicles", vid)
    if not v:
        return err("Vehicle not found.", 404)
    audit("Vehicle record opened", vid, f"{v['plate']} viewed by {g.user['role']}.")
    now = world.now()
    bs = [engine.booking_public(b, now) for b in store.find("bookings", vehicle_id=vid)]
    bs.sort(key=lambda b: b["slot_start"], reverse=True)
    o = store.get("users", v["owner_id"]) or {}
    detail = {k: v[k] for k in v if k not in ("owner_id", "lat", "lng")}
    detail.update(owner=o.get("name"), lat=round(v["lat"], 3), lng=round(v["lng"], 3), bookings=bs[:20])
    return jsonify(detail)


@app.get("/api/staff/bookings")
@require(*STAFF)
def staff_bookings():
    now = world.now()
    rows = [engine.booking_public(b, now) for b in store.recent("bookings", "slot_start", 400)]
    names = {}
    for b in rows:
        b["owner"] = names.setdefault(b["owner_id"], owner_name(b["owner_id"]))
        b.pop("owner_id", None)
    return jsonify(rows)


@app.post("/api/staff/override")
@require(*STAFF)
def override():
    with BOOKING_LOCK:
        return _override_locked()


def _override_locked():
    d = body()
    b = store.get("bookings", d.get("booking_id", ""))
    st = world.station(d.get("station_id", ""))
    reason = str(d.get("reason", "")).strip()
    if not b or not st:
        return err("Pick an existing booking and station.", 404)
    if len(reason) < 5:
        return err("A reason of at least 5 characters is required for every override.")
    if b["status"] not in engine.ACTIVE:
        return err("Only upcoming bookings can be changed.", 409)
    v = store.get("vehicles", b["vehicle_id"])
    if st["status"] != "online" or (v and v["connector"] not in st["connectors"]):
        return err("That station is offline or does not support this vehicle's connector.", 409)
    start = engine.parse(d["slot_start"]) if d.get("slot_start") else engine.parse(b["slot_start"])
    end = start + (engine.parse(b["slot_end"]) - engine.parse(b["slot_start"]))
    now = world.now()
    ratio, _ = engine.predict([(st, start)], now)
    others = [x for x in engine.active_bookings() if x["id"] != b["id"]]
    if st["bays"] - int(round(float(ratio[0]) * st["bays"])) - engine.overlapping(others, st["id"], start, end) < 1:
        return err("No bay is free at that station and time.", 409)
    old = b["station_name"]
    flags = []
    if v and v["vclass"] in config.HEAVY_CLASSES and (engine.in_peak(start) or engine.in_peak(end)):
        flags.append("heavy freight placed in a peak window")
    b.update(station_id=st["id"], station_name=st["name"], slot_start=engine.iso(start), slot_end=engine.iso(end),
             status="operator-overridden", override_reason=reason, override_by=g.user["name"],
             original_station=b.get("original_station") or old)
    if v:
        b["distance_km"] = round(engine.road_km(v["lat"], v["lng"], st["lat"], st["lng"]), 1)
        b["fee"] = engine.fee_for(st, b["kwh"], start)
    store.put("bookings", b)
    audit("Operator override", b["id"], f"{b['plate']} moved from {old} to {st['name']}. Reason: {reason}" + (f" Flag: {'; '.join(flags)}." if flags else ""),
          old=old, new=st["name"])
    return jsonify({"booking": b, "flags": flags})


@app.get("/api/staff/tickets")
@require(*STAFF)
def tickets():
    return jsonify(store.recent("tickets", "created_at", 300))


@app.post("/api/staff/tickets")
@require(*STAFF)
def new_ticket():
    d = body()
    subject = str(d.get("subject", "")).strip()
    if len(subject) < 4:
        return err("Add a short subject.")
    plate = None
    if d.get("vehicle_id"):
        v = store.get("vehicles", d["vehicle_id"])
        if not v:
            return err("Vehicle not found.", 404)
        plate = v["plate"]
    t = {"id": "TK-" + uuid.uuid4().hex[:6].upper(), "created_at": engine.iso(world.now()), "source": "staff",
         "category": d.get("category", "other"), "priority": d.get("priority", "normal"), "subject": subject[:120],
         "details": str(d.get("details", ""))[:1000], "station_id": d.get("station_id") or None,
         "vehicle_id": d.get("vehicle_id") or None, "plate": plate, "status": "open", "assignee": None, "notes": []}
    store.put("tickets", t)
    audit("Ticket created", t["id"], subject)
    return jsonify(t), 201


@app.patch("/api/staff/tickets/<tid>")
@require(*STAFF)
def update_ticket(tid):
    t = store.get("tickets", tid)
    if not t:
        return err("Ticket not found.", 404)
    d = body()
    old = t["status"]
    if d.get("status") in ("open", "in_progress", "resolved"):
        t["status"] = d["status"]
        if d["status"] != "open" and not t.get("assignee"):
            t["assignee"] = g.user["name"]
    if str(d.get("reply", "")).strip():
        if not t.get("owner_id"):
            return err("This ticket is not linked to a customer, so there is nobody to reply to.", 409)
        t.setdefault("replies", []).append({"from": "support", "by": "EarthVein support", "text": str(d["reply"]).strip()[:800], "time": engine.iso(world.now())})
        if not t.get("assignee"):
            t["assignee"] = g.user["name"]
    if str(d.get("note", "")).strip():
        t["notes"].append({"time": engine.iso(world.now()), "by": g.user["name"], "text": str(d["note"]).strip()[:500]})
    store.put("tickets", t)
    audit("Ticket updated", tid, t["subject"], old=old, new=t["status"])
    return jsonify(t)


@app.get("/api/staff/impact")
@require(*STAFF)
def staff_impact():
    now = world.now()
    vs = store.all("vehicles")
    bs = [engine.booking_public(b, now) for b in store.all("bookings")]
    out = engine.impact(vs, bs)
    out["balance_improvement_pct"] = engine.balance_improvement(bs)
    views = engine.all_station_views(now)
    out["network_utilization_pct"] = round(sum(s["occupied"] for s in views) / max(1, sum(s["bays"] for s in views)) * 100, 1)
    out["measured_offline"] = world.models.metrics.get("policy_evaluation", {})
    return jsonify(out)


@app.post("/api/staff/scenario")
@require(*STAFF)
def scenario():
    on = bool(body().get("rush"))
    world.set_setting("rush", on)
    audit("Rush-hour scenario " + ("enabled" if on else "disabled"), "scenario", "Replayed demand scaled by 1.35." if on else "Back to replayed demand.")
    return jsonify({"rush": on})


@app.post("/api/staff/stations/<sid>/status")
@require(*STAFF)
def station_status(sid):
    st = world.station(sid)
    status = body().get("status")
    if not st or status not in ("online", "maintenance"):
        return err("Station or status not valid.", 400)
    old = st["status"]
    store.put("stations", {**st, "status": status})
    world.invalidate_stations()
    audit("Station status changed", sid, st["name"], old=old, new=status)
    return jsonify({"id": sid, "status": status})


@app.get("/api/admin/audit")
@require("admin")
def audit_log():
    rows = store.recent("audit_log", "timestamp", 2000)
    q = request.args.get("q", "").lower()
    if q:
        rows = [r for r in rows if q in f"{r['action']} {r['actor']} {r['target']} {r['details']}".lower()]
    return jsonify(rows[:300])


@app.get("/api/admin/users")
@require("admin")
def users():
    out = []
    for u in store.all("users"):
        row = auth.public_user(u)
        row["vehicles"] = store.count("vehicles", owner_id=u["id"])
        out.append(row)
    return jsonify(out)


@app.post("/api/admin/users")
@require("admin")
def create_staff():
    d = body()
    email, name, pw = str(d.get("email", "")).strip().lower(), str(d.get("name", "")).strip(), str(d.get("password", ""))
    role = d.get("role")
    if role not in ("control", "admin") or not EMAIL_RE.match(email) or len(name) < 2 or len(pw) < 10:
        return err("Name, valid email, role (control or admin) and a password of 10+ characters are required.")
    if store.one("users", email=email):
        return err("An account with this email already exists.", 409)
    u = {"id": "U-" + uuid.uuid4().hex[:8].upper(), "name": name, "email": email, "role": role, "pw_hash": auth.hash_pw(pw),
         "provider": "password", "active": True, "phone": None, "created_at": engine.iso(world.now()), "last_login": None}
    store.put("users", u)
    audit("Staff account created", u["id"], f"{role}: {email}")
    return jsonify(auth.public_user(u)), 201


@app.patch("/api/admin/users/<uid>")
@require("admin")
def toggle_user(uid):
    u = store.get("users", uid)
    if not u:
        return err("User not found.", 404)
    if uid == g.user["id"]:
        return err("You cannot disable your own account.", 409)
    u["active"] = bool(body().get("active", True))
    store.put("users", u)
    audit("Account " + ("enabled" if u["active"] else "disabled"), uid, u["email"])
    return jsonify(auth.public_user(u))


@app.post("/api/admin/users/<uid>/reset-password")
@require("admin")
def reset_password(uid):
    u = store.get("users", uid)
    pw = str(body().get("password", ""))
    if not u:
        return err("User not found.", 404)
    if u.get("provider") == "google":
        return err("This account signs in with Google and has no password.", 409)
    problem = auth.password_problem(pw, staff=True)
    if problem:
        return err(problem)
    store.put("users", {**u, "pw_hash": auth.hash_pw(pw), "token_version": u.get("token_version", 0) + 1})
    audit("Password reset", uid, f"Admin set a new password for {u['email']}. Their sessions were signed out.")
    return jsonify({"ok": True})


@app.get("/api/admin/model")
@require("admin")
def model_info():
    return jsonify({**world.models.metrics, "training": _train_state})


_train_state = {"running": False, "error": None}


@app.post("/api/admin/model/retrain")
@require("admin")
def retrain():
    if _train_state["running"]:
        return err("Training is already running.", 409)

    def job():
        _train_state.update(running=True, error=None)
        try:
            world.models.retrain()
        except Exception as exc:   # surfaced in the admin page
            _train_state["error"] = str(exc)
        finally:
            _train_state["running"] = False

    threading.Thread(target=job, daemon=True).start()
    audit("Model retraining started", "models", "Admin started a retrain from the bundled dataset.")
    return jsonify({"started": True}), 202


@app.errorhandler(HTTPException)
def http_error(e):
    return err(e.description if request.path.startswith("/api/") else e.name, e.code)


@app.errorhandler(Exception)
def server_error(e):
    app.logger.exception("Unhandled error on %s %s", request.method, request.path)
    return err("Unexpected server error. Please try again.", 500)


@app.get("/", defaults={"path": ""})
@app.get("/<path:path>")
def frontend(path):
    """Serve the built frontend. Unknown paths fall back to index.html."""
    if path.startswith("api/"):
        return err("Route not found.", 404)
    if not (STATIC / "index.html").exists():
        return jsonify({"name": "EarthVein API", "status": "online", "storage": store.mode,
                        "note": "Frontend is not built into backend/static. Run it with npm run dev."})
    if path and (STATIC / path).is_file():
        return send_from_directory(STATIC, path)
    return send_from_directory(STATIC, "index.html")


if __name__ == "__main__":
    import os
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)), debug=os.getenv("FLASK_DEBUG", "false").lower() == "true")
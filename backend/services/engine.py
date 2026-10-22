"""
Allocation engine: station state, forecasts, battery maths, slot planning,
booking creation and impact figures. Pure functions over documents; the HTTP
layer lives in app.py.
"""
import math
import uuid
from datetime import datetime, timedelta

import numpy as np

import config
from ml.features import build, erlang_wait
from services import world

ACTIVE = ("confirmed", "operator-overridden")
PAYLOAD_REF = {"2W": 150, "3W": 500, "car": 400, "lcv": 1000, "truck": 8000}


# ---------------------------------------------------------------- geometry
def haversine_km(lat1, lng1, lat2, lng2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(min(1.0, a)))


def road_km(lat1, lng1, lat2, lng2):
    return haversine_km(lat1, lng1, lat2, lng2) * config.ROAD_FACTOR


def iso(dt):
    return dt.isoformat(timespec="seconds")


def parse(s):
    d = datetime.fromisoformat(s)
    return d if d.tzinfo else d.replace(tzinfo=config.IST)


def in_peak(dt):
    return any(a <= dt.hour < b for a, b in config.PEAK_WINDOWS)


def ceil_to(dt, minutes):
    base = dt.replace(second=0, microsecond=0)
    extra = (minutes - (base.hour * 60 + base.minute) % minutes) % minutes
    out = base + timedelta(minutes=extra)
    return out if out >= dt else out + timedelta(minutes=minutes)


# ---------------------------------------------------------------- station state
def station_ratio(st, dt):
    return min(1.0, world.replay.zone_ratio(st["zone_col"], dt) * st["popularity"] * world.demand_scale())


def active_bookings():
    rows = []
    for st in ACTIVE:
        rows += world.store.find("bookings", status=st)
    return rows


def overlapping(bookings, station_id, start, end, skip_id=None):
    n = 0
    for b in bookings:
        if b["station_id"] != station_id or b["id"] == skip_id:
            continue
        if parse(b["slot_start"]) < end and parse(b["slot_end"]) > start:
            n += 1
    return n


def station_view(st, now, bookings):
    ambient = station_ratio(st, now)
    booked = overlapping(bookings, st["id"], now, now + timedelta(minutes=1))
    occupied = min(st["bays"], int(round(ambient * st["bays"])) + booked)
    if st["status"] != "online":
        occupied = st["bays"]
    util = occupied / st["bays"]
    wait = float(erlang_wait(st["bays"], util))
    pressure = "High" if util >= 0.8 else "Moderate" if util >= 0.5 else "Low"
    return {**{k: st[k] for k in ("id", "name", "city", "locality", "lat", "lng", "power_type", "connectors",
                                   "max_kw", "bays", "tariff_inr_kwh", "heavy_ok", "status")},
            "occupied": occupied, "free_bays": st["bays"] - occupied, "utilization": round(util, 3),
            "queue_min": round(wait, 1), "pressure": pressure, "booked_now": booked}


def all_station_views(now=None):
    now = now or world.now()
    bk = active_bookings()
    return [station_view(s, now, bk) for s in world.stations()]


# ---------------------------------------------------------------- model calls
def _features(st, now, target):
    h = min(24.0, max(0.0, (target - now).total_seconds() / 3600.0))
    r_now = station_ratio(st, now)
    r_prev = station_ratio(st, now - timedelta(hours=1))
    lag24 = station_ratio(st, target - timedelta(hours=24))
    lag168 = station_ratio(st, target - timedelta(hours=168))
    hour = target.hour + target.minute / 60.0
    return [h, r_now, r_now - r_prev, lag24, lag168, hour, target.weekday(), st["zone_piles"], st["popularity"], st["bays"]]


def predict(pairs, now):
    """pairs: list of (station, target datetime). Returns (ratio array, walk-in wait minutes array)."""
    if not pairs:
        return np.array([]), np.array([])
    rows = np.array([_features(s, now, t) for s, t in pairs], dtype=np.float64)
    X = build(*rows.T)
    return world.models.ratio(X), world.models.wait(X)


def forecast_station(st, now, hours=24):
    targets = [now + timedelta(hours=k) for k in range(1, hours + 1)]
    ratio, wait = predict([(st, t) for t in targets], now)
    cut = max(0.6, float(np.quantile(ratio, 0.8)))
    return [{"time": iso(t), "hour": t.strftime("%H:00"), "utilization": round(float(r), 3),
             "walkin_wait_min": round(float(w), 1), "peak": bool(r >= cut)}
            for t, r, w in zip(targets, ratio, wait)]


def forecast_city(city, now, hours=24):
    sts = [s for s in world.stations() if s["city"] == city]
    per = [forecast_station(s, now, hours) for s in sts]
    out = []
    for i in range(hours):
        avg = float(np.mean([p[i]["utilization"] for p in per]))
        out.append({"time": per[0][i]["time"], "hour": per[0][i]["hour"], "utilization": round(avg, 3)})
    cut = max(0.35, float(np.quantile([o["utilization"] for o in out], 0.75)))
    for o in out:
        o["peak"] = o["utilization"] >= cut
    return out


# ---------------------------------------------------------------- vehicle and battery
def vehicle_numbers(v):
    usable = v["battery_kwh"] * v.get("soh", 100) / 100.0
    ref = PAYLOAD_REF.get(v["vclass"], 400)
    cons = v["consumption_wh_km"] * (1 + 0.15 * min(1.0, v.get("load_kg", 0) / ref))
    return usable, cons


def battery_report(v, now):
    usable, cons = vehicle_numbers(v)
    soc = v["soc"]
    range_km = soc / 100 * usable * 1000 / cons
    safe_km = max(0.0, (soc - config.RESERVE_PCT) / 100 * usable * 1000 / cons)
    level = "critical" if soc <= 10 else "low" if soc <= 20 else "warning" if soc <= 30 else "ok"
    bk = active_bookings()
    near = []
    for s in world.stations():
        if v["connector"] not in s["connectors"]:
            continue
        d = road_km(v["lat"], v["lng"], s["lat"], s["lng"])
        arrive = soc - d * cons / (usable * 1000) * 100
        view = station_view(s, now, bk)
        near.append({"station_id": s["id"], "name": s["name"], "city": s["city"], "lat": s["lat"], "lng": s["lng"],
                     "distance_km": round(d, 1), "soc_on_arrival": round(arrive, 1),
                     "reachable": arrive >= config.RESERVE_PCT, "free_bays": view["free_bays"], "bays": s["bays"],
                     "queue_min": view["queue_min"], "status": s["status"], "power_type": s["power_type"],
                     "max_kw": s["max_kw"]})
    near.sort(key=lambda x: x["distance_km"])
    near = near[:5]
    reach = [n for n in near if n["reachable"] and n["status"] == "online"]
    if level == "ok":
        message = f"Battery is healthy. About {range_km:.0f} km of range."
    elif reach:
        message = (f"Battery at {soc:.0f}%. You can travel about {safe_km:.0f} km before reaching the {config.RESERVE_PCT}% reserve. "
                   f"Nearest reachable station: {reach[0]['name']}, {reach[0]['distance_km']} km away.")
    else:
        message = f"Battery at {soc:.0f}% and no compatible station is reachable. Stop and call for assistance."
    return {"vehicle_id": v["id"], "soc": round(soc, 1), "level": level, "range_km": round(range_km, 1),
            "safe_range_km": round(safe_km, 1), "usable_kwh": round(usable, 2), "consumption_wh_km": round(cons, 1),
            "reserve_pct": config.RESERVE_PCT, "message": message, "nearest": near,
            "basis": "Estimated from the stored charge level, battery health and Wh/km. Not a reading from the vehicle's BMS."}


def apply_telemetry(v, lat, lng, soc=None, reposition=False, now=None):
    """Move the vehicle and update charge. Without a measured soc the drain is estimated from distance."""
    now = now or world.now()
    moved = haversine_km(v["lat"], v["lng"], lat, lng) * 1.0
    usable, cons = vehicle_numbers(v)
    if soc is not None:
        v["soc"] = float(max(0, min(100, soc)))
    elif not reposition and moved < 30:
        v["soc"] = max(0.0, v["soc"] - moved * cons / (usable * 1000) * 100)
    if not reposition and moved < 30:
        v["odometer_km"] = round(v.get("odometer_km", 0.0) + moved, 3)
        v["energy_kwh"] = round(v.get("energy_kwh", 0.0) + moved * cons / 1000, 4)
    v["lat"], v["lng"] = float(lat), float(lng)
    v["last_seen"] = iso(now)
    return v


# ---------------------------------------------------------------- planning
PREF = {"fastest": dict(money=0.0, delay=1.0), "balanced": dict(money=0.12, delay=0.6), "cheapest": dict(money=0.5, delay=0.3)}


def charge_minutes(v, soc_from, target, power_kw):
    usable, _ = vehicle_numbers(v)
    p = max(0.5, min(power_kw, v["max_kw"]))
    main = max(0.0, min(target, 80) - soc_from) / 100 * usable
    top = max(0.0, target - max(soc_from, 80)) / 100 * usable
    mins = (main / (p * config.CHARGE_EFFICIENCY) + top / (0.4 * p * config.CHARGE_EFFICIENCY)) * 60
    kwh = (target - soc_from) / 100 * usable / config.CHARGE_EFFICIENCY
    return mins, kwh


def fee_for(st, kwh, start):
    mult = config.tod_multiplier(start.hour)
    total = kwh * st["tariff_inr_kwh"] * mult
    return {"energy_kwh": round(kwh, 2), "tariff_inr_kwh": st["tariff_inr_kwh"], "time_of_day_multiplier": mult,
            "total_inr": round(total, 2), "note": "Estimated charging fee, excluding taxes."}


def speed_kmph(v, dt):
    s = config.SPEED_KMPH.get(v["vclass"], 25)
    return s * (config.PEAK_SPEED_FACTOR if in_peak(dt) else 1.0)


def plan(v, now, *, target=None, need_km=0.0, pref="balanced", horizon_h=12, origin=None, skip_booking=None, station_only=None):
    """Return ranked station and slot options for one vehicle.

    Each option is a reservation: a station, a start time and a fee. The chosen
    option minimises travel + wait for the slot + charging time, plus a share of
    the predicted walk-in queue and a money term, subject to: the vehicle can
    reach the station with the reserve left, the connector fits, a bay is free
    at that time, and heavy freight stays out of the peak windows."""
    lat, lng = origin or (v["lat"], v["lng"])
    usable, cons = vehicle_numbers(v)
    soc = float(v["soc"])
    heavy = v["vclass"] in config.HEAVY_CLASSES
    w = PREF.get(pref, PREF["balanced"])

    notes = []
    need_km = max(0.0, min(2000.0, need_km))
    if need_km:
        need_pct = need_km * cons / (usable * 1000) * 100 + config.RESERVE_PCT
        need_target = min(100, int(math.ceil(need_pct / 5.0) * 5))
        if target is None or target < need_target:
            if target is not None:
                notes.append(f"Charge target raised from {target:.0f}% to {need_target}% to cover {need_km:.0f} km.")
            target = need_target
    target = float(target if target is not None else 80)
    target = max(20.0, min(100.0, target))
    if target <= soc + 2:
        return {"options": [], "target": target, "notes": notes, "message": f"Battery is already at {soc:.0f}%, which meets the {target:.0f}% target."}

    urgent = soc <= 25
    bk = [b for b in active_bookings() if b["id"] != skip_booking]
    cands = []
    for s in world.stations():
        if s["status"] != "online" or v["connector"] not in s["connectors"]:
            continue
        d = road_km(lat, lng, s["lat"], s["lng"])
        arrive = soc - d * cons / (usable * 1000) * 100
        if arrive < config.RESERVE_PCT:
            continue
        travel = d / speed_kmph(v, now) * 60
        cands.append((s, d, travel, arrive))
    if not cands:
        compat = [s for s in world.stations() if s["status"] == "online" and v["connector"] in s["connectors"]]
        if not compat:
            return {"options": [], "target": target, "notes": notes, "reachable": False, "outside_coverage": False,
                    "message": f"No online station supports the {v['connector']} connector right now."}
        near = min(compat, key=lambda s: road_km(lat, lng, s["lat"], s["lng"]))
        nd = road_km(lat, lng, near["lat"], near["lng"])
        if nd > config.COVERAGE_KM:
            return {"options": [], "target": target, "notes": notes, "reachable": False, "outside_coverage": True,
                    "message": f"EarthVein stations are currently in Delhi NCR and Bengaluru. The nearest compatible one is about {nd:.0f} km from this vehicle."}
        return {"options": [], "target": target, "notes": notes, "reachable": False, "outside_coverage": False,
                "message": "No compatible online station is reachable with the current charge. Stop where you are safely and request assistance."}

    if station_only and not any(c[0]["id"] == station_only for c in cands):
        return {"options": [], "target": target, "notes": notes, "reachable": False,
                "message": "That station is not reachable with the current charge, is offline, or does not support your connector. Pick another station or charge at one that is reachable."}

    slots = []     # (station, d, travel, arrive, start, eta)
    for s, d, travel, arrive in cands:
        if station_only and s["id"] != station_only:
            continue
        eta = now + timedelta(minutes=travel)
        first = ceil_to(eta, 15) if urgent else ceil_to(eta, config.SLOT_MINUTES)
        end_limit = eta + timedelta(hours=1 if urgent else horizon_h)
        t = first
        while t <= end_limit:
            slots.append((s, d, travel, arrive, t, eta))
            t += timedelta(minutes=15 if urgent else config.SLOT_MINUTES)
    ratio, wait = predict([(x[0], x[4]) for x in slots], now)

    best = {}
    every = []
    skipped_peak = 0
    for (s, d, travel, arrive, start, eta), r, wq in zip(slots, ratio, wait):
        mins, kwh = charge_minutes(v, arrive, target, s["max_kw"])
        end = start + timedelta(minutes=math.ceil((mins + 5) / 5) * 5)
        if heavy and not urgent and (in_peak(start) or in_peak(end - timedelta(minutes=1))):
            skipped_peak += 1
            continue
        free = s["bays"] - int(round(float(r) * s["bays"])) - overlapping(bk, s["id"], start, end)
        if free < 1:
            continue
        delay = (start - eta).total_seconds() / 60
        fee = fee_for(s, kwh, start)
        penalty = 6.0 if (s["heavy_ok"] and not heavy) else 0.0
        score = travel + w["delay"] * delay + mins + config.BOOKED_WAIT_FACTOR * float(wq) + w["money"] * fee["total_inr"] + penalty
        cur = best.get(s["id"])
        if station_only or cur is None or score < cur["score"]:
            opt = {
                "station_id": s["id"], "station_name": s["name"], "city": s["city"], "locality": s["locality"],
                "lat": s["lat"], "lng": s["lng"], "power_type": s["power_type"], "max_kw": s["max_kw"],
                "distance_km": round(d, 1), "travel_min": round(travel), "eta": iso(eta),
                "slot_start": iso(start), "slot_end": iso(end), "wait_for_slot_min": round(delay),
                "walkin_wait_min": round(float(wq), 1), "soc_arrival": round(arrive, 1), "target": target,
                "kwh": round(kwh, 2), "power_kw": min(s["max_kw"], v["max_kw"]), "charge_min": round(mins),
                "fee": fee, "free_bays_at_slot": int(free), "predicted_utilization": round(float(r), 2), "score": round(score, 1),
            }
            if station_only:
                every.append(opt)
            else:
                best[s["id"]] = opt
    options = sorted(every if station_only else best.values(), key=lambda o: o["score"])[:8 if station_only else 6]
    if not options:
        msg = "No free slot was found in the next hours."
        if heavy and skipped_peak and not urgent:
            msg += " Heavy freight is kept out of peak windows; try a longer horizon."
        return {"options": [], "target": target, "notes": notes, "message": msg}
    cheapest = min(options, key=lambda o: o["fee"]["total_inr"])
    earliest = min(options, key=lambda o: o["slot_start"])
    for i, o in enumerate(options):
        o["tags"] = (["Recommended"] if i == 0 else []) + (["Lowest fee"] if o is cheapest else []) + (["Earliest slot"] if o is earliest else [])
        o["reason"] = _reason(o, v, heavy, urgent)
    # baseline for impact: nearest reachable station, walk-in with no reservation
    s0, d0, tr0, ar0 = min(cands, key=lambda c: c[1])
    _, wq0 = predict([(s0, now + timedelta(minutes=tr0))], now)
    baseline = {"station_id": s0["id"], "station_name": s0["name"], "distance_km": round(d0, 1),
                "travel_min": round(tr0, 1), "walkin_wait_min": round(float(wq0[0]), 1)}
    return {"options": options, "target": target, "notes": notes, "urgent": urgent, "baseline": baseline,
            "peak_windows": [f"{a:02d}:00-{b:02d}:00" for a, b in config.PEAK_WINDOWS]}


def _reason(o, v, heavy, urgent):
    bits = [f"{o['distance_km']} km away ({o['travel_min']} min), arrive with about {o['soc_arrival']:.0f}%"]
    if urgent:
        bits.append("battery is low, so the earliest reachable slot is preferred")
    elif heavy:
        bits.append("slot is outside the peak windows kept clear for light delivery")
    bits.append(f"expected walk-in queue then is {o['walkin_wait_min']:.0f} min, a reserved bay avoids most of it")
    return "; ".join(bits) + "."


# ---------------------------------------------------------------- bookings
def create_booking(v, option, plan_result, *, now, source, actor, note=None):
    base = plan_result.get("baseline") or {}
    resid = round(config.BOOKED_WAIT_FACTOR * option["walkin_wait_min"], 1)
    b = {
        "id": "BK-" + uuid.uuid4().hex[:7].upper(), "owner_id": v["owner_id"], "vehicle_id": v["id"], "plate": v["plate"],
        "station_id": option["station_id"], "station_name": option["station_name"], "city": option["city"],
        "slot_start": option["slot_start"], "slot_end": option["slot_end"], "eta": option["eta"],
        "distance_km": option["distance_km"], "travel_min": option["travel_min"], "soc_now": round(v["soc"], 1),
        "soc_arrival": option["soc_arrival"], "charge_to": option["target"], "kwh": option["kwh"],
        "charge_min": option["charge_min"], "fee": option["fee"], "residual_wait_min": resid,
        "baseline_station_id": base.get("station_id"), "baseline_distance_km": base.get("distance_km"),
        "baseline_travel_min": base.get("travel_min"), "baseline_wait_min": base.get("walkin_wait_min"),
        "reason": option["reason"], "status": "confirmed", "source": source, "created_by": actor,
        "created_at": iso(now), "note": note,
    }
    world.store.put("bookings", b)
    return b


def booking_public(b, now=None):
    """Booking as shown to its owner. Completed state is derived from the clock."""
    now = now or world.now()
    out = dict(b)
    if out["status"] in ACTIVE and parse(out["slot_end"]) < now:
        out["status"] = "completed"
    return out


# ---------------------------------------------------------------- impact
def impact(vehicles, bookings):
    km = sum(v.get("odometer_km", 0.0) for v in vehicles)
    kwh = sum(v.get("energy_kwh", 0.0) for v in vehicles)
    litres = ice_co2 = 0.0
    by_class = {}
    for v in vehicles:
        kmpl, fuel = config.ICE_EQUIVALENT[v["vclass"]]
        l = v.get("odometer_km", 0.0) / kmpl
        litres += l
        ice_co2 += l * (config.PETROL_KG_PER_L if fuel == "petrol" else config.DIESEL_KG_PER_L)
        by_class[v["vclass"]] = by_class.get(v["vclass"], 0.0) + v.get("odometer_km", 0.0)
    ev_co2 = kwh * config.GRID_KG_PER_KWH
    done = [b for b in bookings if b["status"] != "cancelled"]
    saved_min = sum((b.get("baseline_wait_min") or 0) + (b.get("baseline_travel_min") or 0) - b["residual_wait_min"] - b["travel_min"] for b in done)
    redirected = sum(1 for b in done if b.get("baseline_station_id") and b["baseline_station_id"] != b["station_id"])
    offpeak = sum(1 for b in done if not in_peak(parse(b["slot_start"])))
    return {
        "tracked_km": round(km, 1), "ev_energy_kwh": round(kwh, 1), "fuel_saved_l": round(litres, 1),
        "co2_ice_kg": round(ice_co2, 1), "co2_ev_kg": round(ev_co2, 1), "co2_saved_kg": round(ice_co2 - ev_co2, 1),
        "bookings": len(done), "avg_delay_min": round(float(np.mean([b["residual_wait_min"] for b in done])) if done else 0.0, 1),
        "time_saved_min": round(saved_min, 1), "redirected_sessions": redirected,
        "redirected_pct": round(redirected / len(done) * 100, 1) if done else 0.0,
        "offpeak_sessions": offpeak, "fees_inr": round(sum(b["fee"]["total_inr"] for b in done), 2),
        "km_by_class": {k: round(x, 1) for k, x in by_class.items()},
        "method": {
            "co2": f"Fuel avoided = tracked km / km-per-litre of the equivalent petrol or diesel vehicle, minus grid emissions of the electricity used at {config.GRID_KG_PER_KWH} kg CO2 per kWh.",
            "delay": "Average residual wait is the expected queue left after a reserved slot. Time saved compares travel plus walk-in queue at the nearest station with the booked plan.",
        },
    }


def balance_improvement(bookings):
    """How much more evenly bookings spread across stations than if everyone had gone to the nearest one."""
    done = [b for b in bookings if b["status"] != "cancelled" and b.get("baseline_station_id")]
    if len(done) < 5:
        return 0.0
    ids = [s["id"] for s in world.stations()]
    chosen = np.array([sum(1 for b in done if b["station_id"] == i) for i in ids], dtype=float)
    base = np.array([sum(1 for b in done if b["baseline_station_id"] == i) for i in ids], dtype=float)
    if base.std() == 0:
        return 0.0
    return round(float((base.std() - chosen.std()) / base.std() * 100), 1)
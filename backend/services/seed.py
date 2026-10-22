"""First-start data: stations, staff accounts and, if SEED_DEMO is true, a few
demo customers with vehicles and booking history. Everything here is simulated."""
import random
import secrets
import uuid
from datetime import timedelta

import config
from services import auth, engine, world
from services.stations_data import station_docs
from services.vehicles import build_vehicle

# name, email, city, business, [(model id or None, class, plate, nickname)]
CUSTOMERS = [
    ("Ananya Rao", "ananya.rao@demo.earthvein.in", "bengaluru", [
        ("M01", "2W", "KA03EV4412", "Ather - Indiranagar run"), ("M04", "2W", "KA03EV4413", "Chetak - spare"),
        ("M02", "2W", "KA03EV4418", "Ola S1 - HSR"), ("M06", "3W", "KA51EV2207", "Treo Zor cargo"),
        ("M18", "lcv", "KA51EV3101", "Ace EV - morning loop"), ("M19", "lcv", "KA51EV3102", "Ace EV 1000 - evening")]),
    ("Vikram Chauhan", "vikram.chauhan@demo.earthvein.in", "delhi", [
        ("M20", "truck", "DL1LEV6021", "Azadpur to Okhla 3.5 t"), ("M21", "truck", "DL1LEV6022", "Kundli line 7.5 t"),
        ("M18", "lcv", "DL1LEV6030", "Ace EV - Karol Bagh"), ("M19", "lcv", "DL1LEV6031", "Ace EV 1000 - Noida"),
        ("M07", "3W", "DL1REV7744", "Euler HiLoad")]),
    ("Meera Iyer", "meera.iyer@demo.earthvein.in", "bengaluru", [
        ("M12", "car", "KA05MN9021", "Nexon EV"), ("M13", "car", "KA05MN9188", "Comet - city runs")]),
    ("Rohan Bhatt", "rohan.bhatt@demo.earthvein.in", "delhi", [
        ("M19", "lcv", "DL1LEV8801", "Cold chain van 1"), ("M19", "lcv", "DL1LEV8802", "Cold chain van 2"),
        ("M20", "truck", "DL1LEV8810", "Cold chain 3.5 t"), ("M06", "3W", "DL1REV8820", "Treo Zor - dairy")]),
    ("Farhan Qureshi", "farhan.qureshi@demo.earthvein.in", "delhi", [
        ("M14", "car", "DL3CEV1105", "ZS EV"), ("M11", "car", "DL3CEV1190", "Punch EV"), ("M05", "2W", "DL3SEV2230", "Vida V1")]),
    ("Sneha Kulkarni", "sneha.kulkarni@demo.earthvein.in", "bengaluru", [
        ("M03", "2W", "KA01EV5501", "iQube 1"), ("M03", "2W", "KA01EV5502", "iQube 2"), ("M01", "2W", "KA01EV5503", "Ather 1"),
        ("M01", "2W", "KA01EV5504", "Ather 2"), ("M08", "3W", "KA01EV5510", "Maxima cargo"), ("M06", "3W", "KA01EV5511", "Treo Zor"),
        ("M18", "lcv", "KA01EV5520", "Ace EV parcel van"), ("M10", "car", "KA01EV5530", "Tiago EV")]),
]


def _user(name, email, role, pw, provider="password"):
    return {"id": "U-" + uuid.uuid4().hex[:8].upper(), "name": name, "email": email.lower(), "role": role,
            "pw_hash": auth.hash_pw(pw), "provider": provider, "active": True, "phone": None,
            "created_at": engine.iso(world.now()), "last_login": None}


def seed():
    store = world.store
    if not store.all("stations"):
        for s in station_docs(world.replay):
            store.put("stations", s)
        world.invalidate_stations()
    for role, name, email, pw in (("admin", "EarthVein Admin", config.ADMIN_EMAIL, config.ADMIN_PASSWORD),
                                  ("control", "Control Desk", config.CONTROL_EMAIL, config.CONTROL_PASSWORD)):
        if store.one("users", role=role):
            continue
        if not pw:   # production without a configured password: generate one and show it once in the log
            pw = secrets.token_urlsafe(12)
            print(f"[seed] Created {role} account {email} with generated password: {pw}  (change it after signing in)")
        store.put("users", _user(name, email, role, pw))
    if config.SEED_DEMO and not store.one("users", role="customer"):
        _demo()


def _demo():
    store = world.store
    rng = random.Random(42)
    now = world.now()
    sts = world.stations()
    cat_vehicles = []
    for name, email, city, fleet in CUSTOMERS:
        u = _user(name, email, "customer", config.DEMO_PASSWORD)
        store.put("users", u)
        near = [s for s in sts if s["city"] == city]
        for model_id, vclass, plate, nick in fleet:
            s = rng.choice(near)
            soc = rng.choice([14, 18, 22, 31, 38, 47, 55, 63, 72, 81, 90])
            v = build_vehicle(u["id"], {
                "model_id": model_id, "vclass": vclass, "plate": plate, "name": nick, "soc": soc, "soh": rng.randint(88, 99),
                "year": rng.choice([2022, 2023, 2024, 2025]), "lat": round(s["lat"] + rng.uniform(-0.03, 0.03), 5),
                "lng": round(s["lng"] + rng.uniform(-0.03, 0.03), 5),
                "load_kg": {"2W": 12, "3W": 250, "car": 0, "lcv": 450, "truck": 2200}[vclass]}, engine.iso(now))
            km = rng.uniform(180, 1900)
            v["odometer_km"] = round(km, 1)
            v["energy_kwh"] = round(km * engine.vehicle_numbers(v)[1] / 1000, 2)
            store.put("vehicles", v)
            cat_vehicles.append(v)
    # booking history over the last two weeks, planned with the real allocator
    made = 0
    for _ in range(80):
        v = dict(rng.choice(cat_vehicles))
        when = now - timedelta(days=rng.uniform(0.2, 14), hours=rng.uniform(0, 6))
        v["soc"] = rng.uniform(14, 48)
        pl = engine.plan(v, when, target=rng.choice([70, 80, 90, 100]), pref=rng.choice(["balanced", "balanced", "cheapest", "fastest"]))
        if pl.get("options"):
            engine.create_booking(v, pl["options"][0], pl, now=when, source="auto", actor=v["owner_id"])
            made += 1
        if made >= 55:
            break
    # a few upcoming bookings for vehicles that are genuinely low
    for v in cat_vehicles:
        if v["soc"] <= 31 and rng.random() < 0.8:
            pl = engine.plan(v, now, target=80)
            if pl.get("options"):
                engine.create_booking(v, pl["options"][0], pl, now=now, source="auto", actor=v["owner_id"])
    store.put("tickets", {
        "id": "TK-" + uuid.uuid4().hex[:6].upper(), "created_at": engine.iso(now - timedelta(hours=5)), "source": "staff",
        "category": "station", "priority": "high", "subject": "Charger gun stuck at Okhla Phase 2 Freight Yard",
        "details": "Driver reported bay 4 connector will not release. Bay marked out of use on the floor; engineer requested.",
        "station_id": "DEL-11", "vehicle_id": None, "plate": None, "status": "in_progress", "assignee": "Control Desk", "notes": []})
    store.put("tickets", {
        "id": "TK-" + uuid.uuid4().hex[:6].upper(), "created_at": engine.iso(now - timedelta(days=1)), "source": "staff",
        "category": "booking", "priority": "normal", "subject": "Customer asked to move a booking to a later slot",
        "details": "Asked on a call. Check the override rules before moving heavy freight into peak hours.",
        "station_id": None, "vehicle_id": None, "plate": None, "status": "open", "assignee": None, "notes": []})

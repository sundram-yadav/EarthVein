"""Access control, privacy and the main customer flow."""
from tests.conftest import login


def test_portal_must_match_role(client):
    r = client.post("/api/auth/login", json={"email": "control@earthvein.in", "password": "Control@12345", "portal": "customer"})
    assert r.status_code == 403
    r = client.post("/api/auth/login", json={"email": "ananya.rao@demo.earthvein.in", "password": "wrong", "portal": "customer"})
    assert r.status_code == 401


def test_requests_without_token_are_rejected(client):
    for path in ("/api/stations", "/api/me/vehicles", "/api/staff/vehicles", "/api/admin/audit"):
        assert client.get(path).status_code == 401


def test_customer_sees_only_own_vehicles(client, ananya, vikram):
    mine = client.get("/api/me/vehicles", headers=ananya).get_json()
    theirs = client.get("/api/me/vehicles", headers=vikram).get_json()
    assert mine and theirs
    assert not {v["id"] for v in mine} & {v["id"] for v in theirs}
    assert all("owner_id" not in v for v in mine)


def test_customer_cannot_touch_another_customers_vehicle(client, ananya, vikram):
    other = client.get("/api/me/vehicles", headers=vikram).get_json()[0]["id"]
    assert client.get(f"/api/me/vehicles/{other}/battery", headers=ananya).status_code == 404
    assert client.get(f"/api/me/vehicles/{other}/plan", headers=ananya).status_code == 404
    assert client.post(f"/api/me/vehicles/{other}/telemetry", headers=ananya, json={"lat": 12.9, "lng": 77.6}).status_code == 404
    assert client.patch(f"/api/me/vehicles/{other}", headers=ananya, json={"soc": 5}).status_code == 404
    assert client.delete(f"/api/me/vehicles/{other}", headers=ananya).status_code == 404
    assert client.post("/api/me/bookings", headers=ananya, json={"vehicle_id": other}).status_code == 404


def test_customer_bookings_are_own_only(client, ananya):
    mine = {v["id"] for v in client.get("/api/me/vehicles", headers=ananya).get_json()}
    for b in client.get("/api/me/bookings", headers=ananya).get_json():
        assert b["vehicle_id"] in mine


def test_role_walls(client, ananya, control, admin):
    assert client.get("/api/staff/vehicles", headers=ananya).status_code == 403
    assert client.get("/api/staff/tickets", headers=ananya).status_code == 403
    assert client.get("/api/admin/audit", headers=ananya).status_code == 403
    assert client.get("/api/staff/vehicles", headers=control).status_code == 200
    assert client.get("/api/admin/audit", headers=control).status_code == 403
    assert client.get("/api/admin/users", headers=control).status_code == 403
    assert client.get("/api/admin/audit", headers=admin).status_code == 200
    assert client.get("/api/staff/vehicles", headers=admin).status_code == 200
    assert client.get("/api/me/vehicles", headers=control).status_code == 403


def test_control_sees_masked_owner_contact_admin_sees_full(client, control, admin):
    c = client.get("/api/staff/vehicles", headers=control).get_json()[0]
    a = client.get("/api/staff/vehicles", headers=admin).get_json()[0]
    assert "***" in c["owner_email"] and "***" not in a["owner_email"]


def test_signup_register_book_cancel(client):
    r = client.post("/api/auth/signup", json={"name": "Test Rider", "email": "rider@example.com", "password": "Strong123"})
    assert r.status_code == 201
    h = {"Authorization": "Bearer " + r.get_json()["token"]}
    assert client.post("/api/auth/signup", json={"name": "x", "email": "bad", "password": "short"}).status_code == 400
    v = client.post("/api/me/vehicles", headers=h, json={"vclass": "car", "model_id": "M12", "plate": "dl 3c ev 7788", "soc": 22,
                                                          "lat": 28.6315, "lng": 77.2167}).get_json()
    assert v["plate"] == "DL3CEV7788" and v["battery_kwh"] == 40.5 and v["connector"] == "CCS2"
    dup = client.post("/api/me/vehicles", headers=h, json={"vclass": "car", "model_id": "M12", "plate": "DL3CEV7788"})
    assert dup.status_code == 409
    assert client.post("/api/me/vehicles", headers=h, json={"vclass": "car", "plate": "NOTAPLATE"}).status_code == 400
    plan = client.get(f"/api/me/vehicles/{v['id']}/plan?target=80", headers=h).get_json()
    assert plan["options"] and plan["options"][0]["soc_arrival"] >= 8
    b = client.post("/api/me/bookings", headers=h, json={"vehicle_id": v["id"], "charge_to": 80}).get_json()
    assert b["status"] == "confirmed" and b["fee"]["total_inr"] > 0
    assert client.post(f"/api/me/bookings/{b['id']}/cancel", headers=h).status_code == 200
    # another customer cannot cancel it
    other = login(client, "ananya.rao@demo.earthvein.in", "Demo@1234", "customer")
    assert client.post(f"/api/me/bookings/{b['id']}/cancel", headers=other).status_code == 404


def test_telemetry_drains_battery_and_flags_low_charge(client):
    r = client.post("/api/auth/signup", json={"name": "Drive Test", "email": "drive@example.com", "password": "Strong123"})
    h = {"Authorization": "Bearer " + r.get_json()["token"]}
    v = client.post("/api/me/vehicles", headers=h, json={"vclass": "2W", "model_id": "M01", "plate": "KA01EV0001", "soc": 12,
                                                          "lat": 12.97, "lng": 77.59}).get_json()
    t = client.post(f"/api/me/vehicles/{v['id']}/telemetry", headers=h, json={"lat": 12.98, "lng": 77.59}).get_json()
    assert t["vehicle"]["soc"] < 12 and t["battery"]["level"] in ("low", "critical")
    assert t["vehicle"]["odometer_km"] > 0


def test_override_needs_reason_and_is_audited(client, control, admin):
    rows = client.get("/api/staff/bookings", headers=control).get_json()
    b = next(x for x in rows if x["status"] == "confirmed")
    stations = client.get("/api/stations", headers=control).get_json()
    target = next(s for s in stations if s["id"] != b["station_id"] and s["status"] == "online" and s["free_bays"] > 2)
    veh = next(v for v in client.get("/api/staff/vehicles", headers=control).get_json() if v["plate"] == b["plate"])
    res = client.post("/api/staff/override", headers=control, json={"booking_id": b["id"], "station_id": target["id"]})
    assert res.status_code == 400
    res = client.post("/api/staff/override", headers=control, json={"booking_id": b["id"], "station_id": target["id"], "reason": "Station maintenance"})
    assert res.status_code in (200, 409)       # 409 if the connector does not fit or no bay is free
    log = client.get("/api/admin/audit?q=override", headers=admin).get_json()
    if res.status_code == 200:
        assert any(r["action"] == "Operator override" for r in log)


def test_customer_can_export_and_delete_own_data(client):
    r = client.post("/api/auth/signup", json={"name": "Gone Soon", "email": "gone@example.com", "password": "Strong123"})
    h = {"Authorization": "Bearer " + r.get_json()["token"]}
    client.post("/api/me/vehicles", headers=h, json={"vclass": "2W", "plate": "KA01EV0099", "soc": 50})
    assert client.get("/api/me/export", headers=h).get_json()["vehicles"]
    assert client.delete("/api/me", headers=h).status_code == 200
    assert client.get("/api/auth/me", headers=h).status_code == 401


def test_heavy_freight_stays_out_of_peak(client, vikram):
    from datetime import timedelta
    from services import engine, world
    trucks = [v for v in client.get("/api/me/vehicles", headers=vikram).get_json() if v["vclass"] == "truck"]
    v = dict(world.store.get("vehicles", trucks[0]["id"]), soc=40)
    now = world.now().replace(hour=7, minute=30)
    pl = engine.plan(v, now, target=80)
    assert pl["options"]
    for o in pl["options"]:
        assert not engine.in_peak(engine.parse(o["slot_start"]))
        assert not engine.in_peak(engine.parse(o["slot_end"]) - timedelta(minutes=1))


def test_forecast_and_stations_have_no_personal_fields(client, ananya):
    st = client.get("/api/stations", headers=ananya).get_json()
    assert len(st) == 28 and not any("owner" in s or "plate" in s for s in st)
    f = client.get(f"/api/stations/{st[0]['id']}/forecast", headers=ananya).get_json()["forecast"]
    assert len(f) == 24 and all(0 <= x["utilization"] <= 1 for x in f)

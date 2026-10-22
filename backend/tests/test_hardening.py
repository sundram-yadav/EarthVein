"""Bugs found while using the app as a customer, kept as regression tests."""
import uuid

from tests.conftest import login


def new_customer(client, tag=None):
    tag = tag or uuid.uuid4().hex[:8]
    r = client.post("/api/auth/signup", json={"name": "Test " + tag, "email": f"{tag}@example.com", "password": "Strong123"})
    assert r.status_code == 201, r.get_json()
    return {"Authorization": "Bearer " + r.get_json()["token"]}, f"{tag}@example.com"


def plate():
    return "DL3CEV" + str(uuid.uuid4().int % 9000 + 1000)


def test_same_vehicle_cannot_be_double_booked(client):
    h, _ = new_customer(client)
    v = client.post("/api/me/vehicles", headers=h, json={"vclass": "car", "model_id": "M12", "plate": plate(), "soc": 22, "lat": 28.6315, "lng": 77.2167}).get_json()
    assert client.post("/api/me/bookings", headers=h, json={"vehicle_id": v["id"], "charge_to": 80}).status_code == 201
    again = client.post("/api/me/bookings", headers=h, json={"vehicle_id": v["id"], "charge_to": 80})
    assert again.status_code == 409


def test_vehicle_outside_service_area_gets_clear_message_and_no_ticket(client, control):
    h, _ = new_customer(client)
    p = "MH12EV" + str(uuid.uuid4().int % 9000 + 1000)
    v = client.post("/api/me/vehicles", headers=h, json={"vclass": "car", "model_id": "M12", "plate": p, "soc": 25, "lat": 19.076, "lng": 72.8777}).get_json()
    pl = client.get(f"/api/me/vehicles/{v['id']}/plan?target=80", headers=h).get_json()
    assert pl["options"] == [] and "Delhi NCR and Bengaluru" in pl["message"]
    assert not any(p == (t.get("plate") or "") for t in client.get("/api/staff/tickets", headers=control).get_json())


def test_vehicle_city_follows_its_position(client):
    h, _ = new_customer(client)
    v = client.post("/api/me/vehicles", headers=h, json={"vclass": "2W", "model_id": "M01", "plate": plate(), "soc": 60, "lat": 28.63, "lng": 77.21}).get_json()
    t = client.post(f"/api/me/vehicles/{v['id']}/telemetry", headers=h, json={"lat": 12.97, "lng": 77.59, "reposition": True}).get_json()
    assert t["vehicle"]["city"] == "bengaluru"


def test_change_password_signs_out_other_sessions(client):
    h, email = new_customer(client)
    assert client.post("/api/auth/change-password", headers=h, json={"current": "wrong", "new": "Better1234"}).status_code == 403
    assert client.post("/api/auth/change-password", headers=h, json={"current": "Strong123", "new": "short"}).status_code == 400
    r = client.post("/api/auth/change-password", headers=h, json={"current": "Strong123", "new": "Better1234"})
    assert r.status_code == 200
    assert client.get("/api/auth/me", headers=h).status_code == 401            # old token is dead
    fresh = {"Authorization": "Bearer " + r.get_json()["token"]}
    assert client.get("/api/auth/me", headers=fresh).status_code == 200
    login(client, email, "Better1234", "customer")


def test_admin_can_reset_a_password_and_it_is_audited(client, admin):
    _, email = new_customer(client)
    users = client.get("/api/admin/users", headers=admin).get_json()
    uid = next(u["id"] for u in users if u["email"] == email)
    assert client.post(f"/api/admin/users/{uid}/reset-password", headers=admin, json={"password": "short"}).status_code == 400
    assert client.post(f"/api/admin/users/{uid}/reset-password", headers=admin, json={"password": "Temporary12345"}).status_code == 200
    login(client, email, "Temporary12345", "customer")
    assert any(r["action"] == "Password reset" for r in client.get("/api/admin/audit?q=reset", headers=admin).get_json())


def test_unknown_api_route_is_json_and_spa_fallback_is_not_used_for_api(client):
    r = client.get("/api/nope")
    assert r.status_code == 404 and r.get_json()["error"]


def test_security_headers_present(client):
    r = client.get("/api/health")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert client.get("/api/me/vehicles").headers.get("Cache-Control") == "no-store"


def test_cannot_cancel_a_past_booking(client, ananya):
    past = next(b for b in client.get("/api/me/bookings", headers=ananya).get_json() if b["status"] == "completed")
    assert client.post(f"/api/me/bookings/{past['id']}/cancel", headers=ananya).status_code == 409


def test_simultaneous_bookings_cannot_both_win(client):
    import concurrent.futures as cf
    h, _ = new_customer(client)
    v = client.post("/api/me/vehicles", headers=h, json={"vclass": "car", "model_id": "M12", "plate": plate(), "soc": 20, "lat": 28.5491, "lng": 77.2518}).get_json()
    def go(_):
        return client.post("/api/me/bookings", headers=h, json={"vehicle_id": v["id"], "charge_to": 80}).status_code
    with cf.ThreadPoolExecutor(4) as ex:
        codes = list(ex.map(go, range(4)))
    assert codes.count(201) == 1, codes


def test_customer_support_is_private_and_staff_can_reply(client, control):
    a, _ = new_customer(client)
    b, _ = new_customer(client)
    t = client.post("/api/me/support", headers=a, json={"category": "booking", "subject": "Slot moved without notice", "details": "My booking time changed and I was not told."})
    assert t.status_code == 201
    tid = t.get_json()["id"]
    assert client.post("/api/me/support", headers=a, json={"subject": "x", "details": "short"}).status_code == 400
    assert [x["id"] for x in client.get("/api/me/support", headers=a).get_json()] == [tid]
    assert client.get("/api/me/support", headers=b).get_json() == []                       # another customer sees nothing
    assert client.post(f"/api/me/support/{tid}/reply", headers=b, json={"text": "hi"}).status_code == 404
    assert client.post("/api/me/support", headers={"Authorization": control["Authorization"]}, json={}).status_code == 403
    r = client.patch(f"/api/staff/tickets/{tid}", headers=control, json={"reply": "We have fixed it.", "note": "internal only", "status": "resolved"})
    assert r.status_code == 200
    mine = client.get("/api/me/support", headers=a).get_json()[0]
    assert mine["status"] == "resolved" and mine["replies"][0]["text"] == "We have fixed it."
    assert "notes" not in mine and "assignee" not in mine                                   # internal fields stay internal


def test_unreachable_specific_station_gets_a_clear_message(client):
    h, _ = new_customer(client)
    v = client.post("/api/me/vehicles", headers=h, json={"vclass": "car", "model_id": "M12", "plate": plate(), "soc": 12, "lat": 28.6315, "lng": 77.2167}).get_json()
    pl = client.get(f"/api/me/vehicles/{v['id']}/plan?target=80&station_id=BLR-01", headers=h).get_json()
    assert pl["options"] == [] and "not reachable" in pl["message"]
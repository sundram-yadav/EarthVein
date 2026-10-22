import re
import uuid

import config
from services import catalog

PLATE_RE = re.compile(r"^([A-Z]{2}\d{1,2}[A-Z]{1,3}\d{1,4}|\d{2}BH\d{4}[A-Z]{1,2})$")
CLASSES = tuple(catalog.CLASS_LABELS)


def normalise_plate(raw):
    return re.sub(r"[\s\-]", "", str(raw or "").upper())


def nearest_city(lat, lng):
    from services.engine import haversine_km
    return min(config.CITY_CENTRES, key=lambda c: haversine_km(lat, lng, *config.CITY_CENTRES[c]))


def _num(data, key, lo, hi, default=None):
    raw = data.get(key, default)
    try:
        val = float(raw)
    except (TypeError, ValueError):
        raise ValueError(f"{key.replace('_', ' ').capitalize()} must be a number.")
    if not lo <= val <= hi:
        raise ValueError(f"{key.replace('_', ' ').capitalize()} must be between {lo} and {hi}.")
    return val


def build_vehicle(owner_id, data, now_iso):
    """Validate form data and return a vehicle document. Raises ValueError with a readable message."""
    vclass = data.get("vclass")
    if vclass not in CLASSES:
        raise ValueError("Choose a vehicle type.")
    entry = catalog.find(data.get("model_id")) if data.get("model_id") else None
    base = catalog.GENERIC[vclass] if entry is None else entry
    plate = normalise_plate(data.get("plate"))
    if not PLATE_RE.match(plate):
        raise ValueError("Enter a valid registration number, for example KA01EV4412 or 22BH1234AB.")
    lat = _num(data, "lat", -90, 90, config.CITY_CENTRES["delhi"][0])
    lng = _num(data, "lng", -180, 180, config.CITY_CENTRES["delhi"][1])
    v = {
        "id": "VH-" + uuid.uuid4().hex[:7].upper(), "owner_id": owner_id, "plate": plate,
        "name": str(data.get("name") or "").strip()[:40] or f"{data.get('make') or base.get('make', 'EV')} {data.get('model') or base.get('model', '')}".strip(),
        "vclass": vclass, "model_id": entry["id"] if entry else None,
        "make": str(data.get("make") or (entry or {}).get("make") or "Other").strip()[:40],
        "model": str(data.get("model") or (entry or {}).get("model") or "Not listed").strip()[:40],
        "variant": str(data.get("variant") or (entry or {}).get("variant") or "").strip()[:40],
        "year": int(_num(data, "year", 2010, 2035, 2024)),
        "battery_kwh": _num(data, "battery_kwh", 0.5, 400, base["battery_kwh"]),
        "range_km": _num(data, "range_km", 10, 1000, base["range_km"]),
        "consumption_wh_km": _num(data, "consumption_wh_km", 10, 2000, base["consumption_wh_km"]),
        "connector": data.get("connector") or base["connector"],
        "max_kw": _num(data, "max_kw", 0.5, 400, base["max_kw"]),
        "soh": _num(data, "soh", 40, 100, 96),
        "soc": _num(data, "soc", 0, 100, 60),
        "load_kg": _num(data, "load_kg", 0, 20000, 0),
        "lat": lat, "lng": lng, "city": nearest_city(lat, lng),
        "odometer_km": 0.0, "energy_kwh": 0.0, "last_seen": now_iso, "created_at": now_iso,
    }
    if v["connector"] not in ("CCS2", "Type 2 AC", "LECCS"):
        raise ValueError("Connector must be CCS2, Type 2 AC or LECCS.")
    return v


def public(v):
    """Vehicle as the owner sees it."""
    return {k: v[k] for k in v if k != "owner_id"}

import json
from pathlib import Path

_PATH = Path(__file__).resolve().parent.parent / "data" / "ev_catalog.json"
_cache = None

CLASS_LABELS = {"2W": "Two-wheeler", "3W": "Three-wheeler", "car": "Passenger car", "lcv": "Light commercial van", "truck": "Truck"}
# used when the owner picks "model not listed"
GENERIC = {
    "2W": dict(battery_kwh=3.0, range_km=110, consumption_wh_km=32, connector="LECCS", max_kw=1.5),
    "3W": dict(battery_kwh=8.0, range_km=110, consumption_wh_km=70, connector="LECCS", max_kw=3.3),
    "car": dict(battery_kwh=30.0, range_km=300, consumption_wh_km=125, connector="CCS2", max_kw=40),
    "lcv": dict(battery_kwh=21.0, range_km=150, consumption_wh_km=165, connector="CCS2", max_kw=25),
    "truck": dict(battery_kwh=120.0, range_km=150, consumption_wh_km=620, connector="CCS2", max_kw=120),
}


def catalog():
    global _cache
    if _cache is None:
        _cache = json.loads(_PATH.read_text(encoding="utf-8"))
    return _cache


def find(model_id):
    return next((m for m in catalog()["models"] if m["id"] == model_id), None)

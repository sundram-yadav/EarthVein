"""Shared singletons: storage, the replayed demand data and the trained models."""
import time
from datetime import datetime

import config
from ml.registry import Models
from ml.replay import Replay
from services.store import Store

store = Store()
replay = Replay()
models = Models()

_cache = {"t": 0.0, "rows": None}
_rush = {"t": 0.0, "v": 1.0}


def now():
    return datetime.now(config.IST)


def stations(force=False):
    if force or _cache["rows"] is None or time.time() - _cache["t"] > 20:
        _cache["rows"] = sorted(store.all("stations"), key=lambda s: s["id"])
        _cache["t"] = time.time()
    return _cache["rows"]


def invalidate_stations():
    _cache["rows"] = None


def station(station_id):
    return next((s for s in stations() if s["id"] == station_id), None)


def setting(key, default=None):
    row = store.get("settings", key)
    return row["value"] if row else default


def set_setting(key, value):
    store.put("settings", {"id": key, "value": value})
    _rush["t"] = 0.0


def demand_scale():
    """Multiplier applied to replayed demand. 1.35 while the rush-hour scenario is on."""
    if time.time() - _rush["t"] > 5:
        _rush["v"] = 1.35 if setting("rush", False) else 1.0
        _rush["t"] = time.time()
    return _rush["v"]

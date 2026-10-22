"""
Optional: load real charging stations from OpenChargeMap into MongoDB or the
local store, replacing the simulated ones.

    OCM_API_KEY=xxxx python -m scripts.import_ocm --lat 28.6139 --lng 77.2090 --radius 25

Get a free key at https://openchargemap.org/site/develop/api . This script was
written against the public API documentation and has not been run against the
live service from the build environment, so check the first import by hand.
Imported stations get demand from the replayed dataset like the simulated ones.
"""
import argparse
import os
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from services import world                      # noqa: E402
from services.stations_data import TYPE_SPEC     # noqa: E402

CONNECTOR_MAP = {"CCS": "CCS2", "Type 2": "Type 2 AC", "LECCS": "LECCS"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lng", type=float, required=True)
    ap.add_argument("--radius", type=float, default=20)
    ap.add_argument("--city", default="delhi")
    ap.add_argument("--max", type=int, default=40)
    args = ap.parse_args()
    key = os.getenv("OCM_API_KEY")
    if not key:
        sys.exit("Set OCM_API_KEY first.")
    r = requests.get("https://api.openchargemap.io/v3/poi", timeout=30, params={
        "key": key, "countrycode": "IN", "latitude": args.lat, "longitude": args.lng, "distance": args.radius,
        "distanceunit": "KM", "maxresults": args.max, "compact": "true", "verbose": "false"})
    r.raise_for_status()
    zones = world.replay.pick_zones({"quiet": 4, "mid": 8, "busy": 6, "hot": 4})
    pool = [z for band in ("mid", "busy", "quiet", "hot") for z in zones[band]]
    n = 0
    for poi in r.json():
        info = poi.get("AddressInfo") or {}
        conns = poi.get("Connections") or []
        kw = max([c.get("PowerKW") or 0 for c in conns] + [3.3])
        names = {CONNECTOR_MAP.get((c.get("ConnectionType") or {}).get("Title", "").split(" ")[0]) for c in conns} - {None}
        typ = "Fast" if kw >= 40 else "Mixed" if kw >= 15 else "Light"
        zc = pool[n % len(pool)]
        world.store.put("stations", {
            "id": f"OCM-{poi['ID']}", "city": args.city, "name": (info.get("Title") or "Charging point")[:60],
            "locality": (info.get("Town") or "")[:40], "lat": info["Latitude"], "lng": info["Longitude"], "power_type": typ,
            "connectors": sorted(names) or TYPE_SPEC[typ]["connectors"], "max_kw": float(kw), "bays": int(poi.get("NumberOfPoints") or 4),
            "tariff_inr_kwh": TYPE_SPEC[typ]["tariff"], "heavy_ok": False, "status": "online", "band": "mid", "popularity": 1.0,
            "zone_col": int(zc), "zone_id": int(world.replay.zone_ids[zc]), "zone_piles": float(world.replay.zone_piles[zc])})
        n += 1
    print(f"Imported {n} stations.")


if __name__ == "__main__":
    main()

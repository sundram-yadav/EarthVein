"""
Simulated charging stations placed at real localities in Bengaluru and Delhi NCR.
The coordinates are of the localities, not of real operators' chargers. Use
scripts/import_ocm.py to load real stations from OpenChargeMap instead.

band decides which real UrbanEV zone's demand pattern a station replays:
quiet / mid / busy / hot (see ml/replay.py).
"""

# (id, city, name, locality, lat, lng, type, bays, band)
RAW = [
    ("BLR-01", "bengaluru", "Indiranagar Fast Hub", "Indiranagar", 12.9784, 77.6408, "Fast", 10, "hot"),
    ("BLR-02", "bengaluru", "MG Road Mixed Point", "MG Road", 12.9756, 77.6066, "Mixed", 8, "hot"),
    ("BLR-03", "bengaluru", "Koramangala Fast Hub", "Koramangala", 12.9352, 77.6245, "Fast", 10, "busy"),
    ("BLR-04", "bengaluru", "Whitefield Freight Yard", "Whitefield", 12.9698, 77.7500, "Heavy", 12, "mid"),
    ("BLR-05", "bengaluru", "HSR Layout Light Point", "HSR Layout", 12.9116, 77.6389, "Light", 6, "busy"),
    ("BLR-06", "bengaluru", "Yeshwanthpur Mixed Hub", "Yeshwanthpur", 13.0285, 77.5400, "Mixed", 10, "mid"),
    ("BLR-07", "bengaluru", "Jayanagar Light Point", "Jayanagar", 12.9250, 77.5838, "Light", 6, "quiet"),
    ("BLR-08", "bengaluru", "Hebbal Freight Yard", "Hebbal", 13.0358, 77.5970, "Heavy", 12, "hot"),
    ("BLR-09", "bengaluru", "Marathahalli Mixed Hub", "Marathahalli", 12.9591, 77.6974, "Mixed", 9, "mid"),
    ("BLR-10", "bengaluru", "Electronic City Freight Yard", "Electronic City", 12.8452, 77.6602, "Heavy", 12, "quiet"),
    ("BLR-11", "bengaluru", "Malleshwaram Light Point", "Malleshwaram", 13.0035, 77.5700, "Light", 6, "quiet"),
    ("BLR-12", "bengaluru", "Banashankari Mixed Hub", "Banashankari", 12.9255, 77.5468, "Mixed", 8, "busy"),
    ("BLR-13", "bengaluru", "Bellandur Fast Hub", "Bellandur", 12.9304, 77.6784, "Fast", 10, "mid"),
    ("BLR-14", "bengaluru", "Peenya Freight Yard", "Peenya", 13.0280, 77.5197, "Heavy", 12, "mid"),
    ("DEL-01", "delhi", "Connaught Place Fast Hub", "Connaught Place", 28.6315, 77.2167, "Fast", 10, "hot"),
    ("DEL-02", "delhi", "Nehru Place Mixed Hub", "Nehru Place", 28.5491, 77.2518, "Mixed", 10, "busy"),
    ("DEL-03", "delhi", "Dwarka Sector 21 Fast Hub", "Dwarka", 28.5527, 77.0588, "Fast", 10, "mid"),
    ("DEL-04", "delhi", "Rohini Sector 10 Mixed Hub", "Rohini", 28.7160, 77.1180, "Mixed", 8, "mid"),
    ("DEL-05", "delhi", "Noida Sector 62 Fast Hub", "Noida", 28.6270, 77.3650, "Fast", 12, "busy"),
    ("DEL-06", "delhi", "Cyber City Fast Hub", "Gurugram", 28.4950, 77.0890, "Fast", 12, "hot"),
    ("DEL-07", "delhi", "Saket Light Point", "Saket", 28.5245, 77.2066, "Light", 6, "quiet"),
    ("DEL-08", "delhi", "Lajpat Nagar Light Point", "Lajpat Nagar", 28.5677, 77.2437, "Light", 6, "busy"),
    ("DEL-09", "delhi", "Karol Bagh Mixed Hub", "Karol Bagh", 28.6519, 77.1909, "Mixed", 8, "mid"),
    ("DEL-10", "delhi", "Azadpur Freight Yard", "Azadpur Mandi", 28.7075, 77.1700, "Heavy", 12, "hot"),
    ("DEL-11", "delhi", "Okhla Phase 2 Freight Yard", "Okhla", 28.5300, 77.2750, "Heavy", 12, "busy"),
    ("DEL-12", "delhi", "Vasant Kunj Mixed Hub", "Vasant Kunj", 28.5190, 77.1580, "Mixed", 8, "quiet"),
    ("DEL-13", "delhi", "Mayur Vihar Light Point", "Mayur Vihar", 28.6060, 77.2950, "Light", 6, "mid"),
    ("DEL-14", "delhi", "Anand Vihar Freight Yard", "Anand Vihar", 28.6469, 77.3160, "Heavy", 12, "quiet"),
]

TYPE_SPEC = {
    "Light": dict(connectors=["LECCS", "Type 2 AC"], max_kw=7.4, tariff=14.0, heavy_ok=False),
    "Mixed": dict(connectors=["CCS2", "Type 2 AC", "LECCS"], max_kw=30.0, tariff=17.0, heavy_ok=False),
    "Fast": dict(connectors=["CCS2", "Type 2 AC", "LECCS"], max_kw=60.0, tariff=21.0, heavy_ok=False),
    "Heavy": dict(connectors=["CCS2"], max_kw=150.0, tariff=19.0, heavy_ok=True),
}
POPULARITY = {"quiet": 0.85, "mid": 1.0, "busy": 1.15, "hot": 1.35}


def station_docs(replay):
    """Build station documents, mapping each one to a real zone of the dataset."""
    counts = {}
    for row in RAW:
        counts[row[8]] = counts.get(row[8], 0) + 1
    zones = replay.pick_zones(counts)
    used = {b: 0 for b in counts}
    docs = []
    for sid, city, name, locality, lat, lng, typ, bays, band in RAW:
        zcol = zones[band][used[band]]
        used[band] += 1
        spec = TYPE_SPEC[typ]
        docs.append(dict(
            id=sid, city=city, name=name, locality=locality, lat=lat, lng=lng, power_type=typ,
            connectors=spec["connectors"], max_kw=spec["max_kw"], bays=bays, tariff_inr_kwh=spec["tariff"],
            heavy_ok=spec["heavy_ok"], status="online", band=band, popularity=POPULARITY[band],
            zone_col=int(zcol), zone_id=int(replay.zone_ids[zcol]), zone_piles=float(replay.zone_piles[zcol]),
        ))
    return docs

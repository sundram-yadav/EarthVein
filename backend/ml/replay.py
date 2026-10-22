"""
Replay of real charger occupancy data.

The UrbanEV dataset has hourly occupied-pile counts for 275 zones, from
2022-09-01 to 2023-02-28. We do not have a live feed from real chargers, so the
app replays this data as a stand-in for telemetry. Each of our stations is
mapped to one real zone, and "now" is mapped onto the dataset by weekday and
hour, so a Tuesday 6 pm in the app shows a Tuesday 6 pm from the dataset.

The replay is cyclic: 25 whole weeks (Monday to Sunday) starting on the first
Monday in the file. Each calendar week of the year picks a different dataset
week, so the numbers keep changing from week to week.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

DATA_DIR = Path(__file__).resolve().parent / "data"

# 2000-01-03 was a Monday. Hours counted from this moment line up with the
# dataset's weekday and hour once we add CYCLE_START.
REF_MONDAY = datetime(2000, 1, 3, tzinfo=timezone(timedelta(hours=5, minutes=30)))
CYCLE_START = 96          # 2022-09-05 00:00, first Monday in the file
CYCLE_LEN = 25 * 168      # whole weeks that fit after CYCLE_START


class Replay:
    def __init__(self, data_dir=DATA_DIR):
        occ = pd.read_csv(Path(data_dir) / "occupancy.csv", parse_dates=["time"]).set_index("time")
        occ.columns = occ.columns.astype(int)
        inf = pd.read_csv(Path(data_dir) / "inf.csv")
        piles = inf.groupby("TAZID")["charge_count"].sum()
        zones = [z for z in occ.columns if z in piles.index]
        self.zone_ids = np.array(zones)
        self.zone_piles = piles.loc[zones].to_numpy(dtype=float)
        ratio = occ[zones].to_numpy(dtype=float) / self.zone_piles
        self.R = np.clip(ratio, 0.0, 1.0).astype(np.float32)          # shape (T, Z)
        self.times = occ.index
        self.hour = self.times.hour.to_numpy()
        self.dow = self.times.dayofweek.to_numpy()
        self.T = self.R.shape[0]
        self.zone_mean = self.R.mean(axis=0)

    # position inside the dataset for a real timestamp (float, in hours)
    def pos(self, dt):
        hours = (dt - REF_MONDAY).total_seconds() / 3600.0
        return CYCLE_START + (hours % CYCLE_LEN)

    def _wrap(self, i):
        return CYCLE_START + ((i - CYCLE_START) % CYCLE_LEN)

    def zone_ratio(self, zone_col, dt):
        """Occupancy ratio (0..1) of one zone at a real timestamp, linearly interpolated."""
        p = self.pos(dt)
        i = int(p)
        f = p - i
        a = self.R[i, zone_col]
        b = self.R[self._wrap(i + 1), zone_col]
        return float(a * (1 - f) + b * f)

    def pick_zones(self, n_per_band):
        """Deterministically pick zone columns by how busy they are.
        n_per_band maps a band name to how many zones to take from it."""
        order = np.argsort(self.zone_mean)
        order = [int(z) for z in order if self.zone_piles[z] >= 20]
        n = len(order)
        bands = {"quiet": (0.05, 0.30), "mid": (0.35, 0.65), "busy": (0.65, 0.88), "hot": (0.90, 1.0)}
        out = {}
        for band, count in n_per_band.items():
            lo, hi = bands[band]
            pool = order[int(lo * n): max(int(lo * n) + 1, int(hi * n))]
            step = max(1, len(pool) // max(1, count))
            out[band] = [pool[(k * step) % len(pool)] for k in range(count)]
        return out

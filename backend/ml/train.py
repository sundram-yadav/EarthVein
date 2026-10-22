"""
Train the two models behind EarthVein's allocation.

  demand_model  predicts a station's occupancy ratio h hours from now
  wait_model    predicts the queue wait (minutes) a vehicle would face on arrival

Both are gradient boosting regressors trained on the UrbanEV dataset
(ml/data/*.csv). Weather was tried as an input and dropped: it did not improve
held-out error. Run from the backend folder:

    python -m ml.train
    python -m ml.train --samples 900000 --data path/to/your/csvs

To retrain on your own charger history, produce two CSVs with the same layout
as occupancy.csv and inf.csv in ml/data (hourly occupied-pile counts per zone,
and station metadata with TAZID and charge_count) and pass --data.

Evaluation uses a time split: models are fitted on the first 80 percent of the
timeline and scored on the last 20 percent, which they never saw.
"""
import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import sklearn
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, r2_score

from ml.features import build, erlang_wait, demand_baseline, wait_baseline, predict_ratio, predict_wait
from ml.replay import Replay, DATA_DIR

MODEL_DIR = Path(__file__).resolve().parent / "models"


def draw_samples(rp, rng, n, t_lo, t_hi):
    """Random (time, zone, horizon, station-profile) rows with features and true targets."""
    Z = rp.R.shape[1]
    t = rng.integers(t_lo, t_hi - 25, n)
    z = rng.integers(0, Z, n)
    h = rng.integers(0, 25, n)
    pop = rng.uniform(0.8, 1.5, n)
    bays = rng.integers(6, 13, n)
    a = t + h

    def S(idx):
        return np.clip(rp.R[idx, z] * pop, 0.0, 1.0)

    r_now, r_prev = S(t), S(t - 1)
    X = build(h, r_now, r_now - r_prev, S(a - 24), S(a - 168), rp.hour[a], rp.dow[a],
              rp.zone_piles[z], pop, bays)
    ratio_a = S(a)
    wait_a = erlang_wait(bays, ratio_a)
    return X, ratio_a, wait_a, dict(h=h, r_now=r_now, bays=bays, lag24=S(a - 24), lag168=S(a - 168))


def fit(X, y, seed):
    m = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.08, max_leaf_nodes=63, min_samples_leaf=60,
                                      early_stopping=True, validation_fraction=0.1, n_iter_no_change=15,
                                      random_state=seed)
    return m.fit(X, y)


def evaluate_models(demand, wait, Xte, ratio_te, wait_te, aux):
    out = {}
    pred = predict_ratio(demand, Xte)
    buckets = {"1-3 h ahead": (1, 3), "4-12 h ahead": (4, 12), "13-24 h ahead": (13, 24)}
    dem = {"overall": {"model_mae": float(mean_absolute_error(ratio_te, pred)),
                       "persistence_mae": float(mean_absolute_error(ratio_te, aux["r_now"])),
                       "same_hour_yesterday_mae": float(mean_absolute_error(ratio_te, aux["lag24"])),
                       "same_hour_last_week_mae": float(mean_absolute_error(ratio_te, aux["lag168"])),
                       "r2": float(r2_score(ratio_te, pred))}}
    for name, (lo, hi) in buckets.items():
        m = (aux["h"] >= lo) & (aux["h"] <= hi)
        dem[name] = {"model_mae": float(mean_absolute_error(ratio_te[m], pred[m])),
                     "persistence_mae": float(mean_absolute_error(ratio_te[m], aux["r_now"][m])),
                     "same_hour_last_week_mae": float(mean_absolute_error(ratio_te[m], aux["lag168"][m]))}
    out["demand_model"] = dem
    wp = predict_wait(wait, Xte)
    naive = erlang_wait(aux["bays"], aux["r_now"])
    out["wait_model"] = {"model_mae_min": float(mean_absolute_error(wait_te, wp)),
                         "naive_mae_min": float(mean_absolute_error(wait_te, naive)),
                         "r2": float(r2_score(wait_te, wp)),
                         "share_of_rows_with_wait_over_5_min": float((wait_te > 5).mean())}
    return out


def evaluate_policies(rp, wait_model, t_lo, t_hi, n=6000, seed=11):
    """Offline comparison of three station choice rules on the unseen period.
    Realised wait is computed from the real occupancy at the vehicle's arrival hour."""
    from services.stations_data import station_docs
    rng = np.random.default_rng(seed)
    sts = station_docs(rp)
    res = {k: dict(wait=[], turn=[], picks=[]) for k in ("nearest", "least_loaded_now", "earthvein_model")}
    for _ in range(n):
        city = "delhi" if rng.random() < 0.5 else "bengaluru"
        cand = [s for s in sts if s["city"] == city]
        lats = np.array([s["lat"] for s in cand]); lngs = np.array([s["lng"] for s in cand])
        lat = rng.uniform(lats.min() - 0.02, lats.max() + 0.02); lng = rng.uniform(lngs.min() - 0.02, lngs.max() + 0.02)
        dkm = 1.3 * 111.0 * np.sqrt((lats - lat) ** 2 + ((lngs - lng) * np.cos(np.radians(lat))) ** 2)
        travel = dkm / 26.0 * 60.0
        t = int(rng.integers(t_lo, t_hi - 25))
        arr = t + np.rint(travel / 60.0).astype(int)
        zc = np.array([s["zone_col"] for s in cand]); pop = np.array([s["popularity"] for s in cand])
        bays = np.array([s["bays"] for s in cand]); piles = np.array([s["zone_piles"] for s in cand])
        S = lambda idx: np.clip(rp.R[idx, zc] * pop, 0, 1)
        r_now = S(np.full(len(cand), t))
        X = build(travel / 60.0, r_now, r_now - S(np.full(len(cand), t - 1)), S(arr - 24), S(arr - 168),
                  rp.hour[arr], rp.dow[arr], piles, pop, bays)
        pred_wait = predict_wait(wait_model, X)
        real_wait = erlang_wait(bays, S(arr))
        picks = {"nearest": int(np.argmin(travel)),
                 "least_loaded_now": int(np.lexsort((travel, r_now))[0]),
                 "earthvein_model": int(np.argmin(travel + pred_wait))}
        for k, i in picks.items():
            res[k]["wait"].append(real_wait[i]); res[k]["turn"].append(travel[i] + real_wait[i]); res[k]["picks"].append(cand[i]["id"])
    out = {}
    for k, v in res.items():
        w = np.array(v["wait"]); tt = np.array(v["turn"])
        _, cnt = np.unique(v["picks"], return_counts=True)
        out[k] = {"mean_wait_min": float(w.mean()), "p90_wait_min": float(np.quantile(w, 0.9)),
                  "share_wait_over_10_min": float((w > 10).mean()), "mean_travel_plus_wait_min": float(tt.mean()),
                  "stations_used": int(len(cnt)), "assignment_cv": float(cnt.std() / cnt.mean())}
    base = out["nearest"]
    out["improvement_vs_nearest"] = {
        "mean_wait_reduction_pct": float((1 - out["earthvein_model"]["mean_wait_min"] / max(1e-9, base["mean_wait_min"])) * 100),
        "travel_plus_wait_reduction_pct": float((1 - out["earthvein_model"]["mean_travel_plus_wait_min"] / base["mean_travel_plus_wait_min"]) * 100)}
    out["requests"] = n
    return out


def train(samples=700_000, data_dir=DATA_DIR, seed=7, quiet=False):
    log = (lambda *a: None) if quiet else print
    t0 = time.time()
    rp = Replay(data_dir)
    split = int(rp.T * 0.8)
    rng = np.random.default_rng(seed)
    log(f"dataset: {rp.T} hours x {rp.R.shape[1]} zones, mean occupancy {rp.R.mean():.3f}")
    Xtr, rtr, wtr, _ = draw_samples(rp, rng, samples, 168, split)
    Xte, rte, wte, aux = draw_samples(rp, rng, samples // 4, split, rp.T)
    log(f"train rows {len(Xtr)}, test rows {len(Xte)}")
    demand = fit(Xtr, rtr - demand_baseline(Xtr), seed)
    wait = fit(Xtr, wtr - wait_baseline(Xtr), seed + 1)
    metrics = evaluate_models(demand, wait, Xte, rte, wte, aux)
    log("policy evaluation on the held-out period ...")
    metrics["policy_evaluation"] = evaluate_policies(rp, wait, split, rp.T)
    metrics["meta"] = {
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sklearn_version": sklearn.__version__, "train_rows": int(len(Xtr)), "test_rows": int(len(Xte)),
        "dataset": "UrbanEV (IntelligentSystemsLab/UrbanEV on GitHub), hourly occupancy of 275 zones, 2022-09-01 to 2023-02-28",
        "dataset_zones": int(rp.R.shape[1]), "dataset_hours": int(rp.T),
        "mean_occupancy_in_data": float(rp.R.mean()), "train_seconds": round(time.time() - t0, 1),
        "assumptions": {"mean_bay_hold_minutes": 40, "queue_model": "M/M/c (Erlang C)"},
    }
    MODEL_DIR.mkdir(exist_ok=True)
    joblib.dump({"demand": demand, "wait": wait, "sklearn": sklearn.__version__, "residual": True}, MODEL_DIR / "models.joblib")
    (MODEL_DIR / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    log(f"saved to {MODEL_DIR} in {time.time() - t0:.0f}s")
    return metrics


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", type=int, default=700_000)
    ap.add_argument("--data", default=str(DATA_DIR))
    args = ap.parse_args()
    m = train(args.samples, args.data)
    print(json.dumps({k: m[k] for k in ("demand_model", "wait_model", "policy_evaluation")}, indent=2))

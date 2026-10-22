"""Feature construction and queueing maths shared by training and the live app."""
import numpy as np

FEATURES = [
    "h", "r_now", "trend", "lag24", "lag168", "hour_sin", "hour_cos", "dow", "weekend",
    "log_piles", "popularity", "bays",
]
SERVICE_MIN = 40.0      # assumed mean time a vehicle holds a bay (minutes)
MAX_WAIT = 120.0


def build(h, r_now, trend, lag24, lag168, hour, dow, piles, pop, bays):
    """All arguments are scalars or equal length numpy arrays. Returns (n, len(FEATURES))."""
    h, r_now, trend, lag24, lag168, hour, dow, piles, pop, bays = np.broadcast_arrays(
        *[np.asarray(a, dtype=np.float64) for a in (h, r_now, trend, lag24, lag168, hour, dow, piles, pop, bays)]
    )
    ang = 2 * np.pi * hour / 24.0
    cols = [h, r_now, trend, lag24, lag168, np.sin(ang), np.cos(ang), dow, (dow >= 5).astype(float),
            np.log(piles), pop, bays]
    return np.column_stack(cols).astype(np.float32)


def erlang_wait(bays, rho, service=SERVICE_MIN):
    """Mean queueing delay (minutes) of an M/M/c system with c bays and utilisation rho.
    Uses the Erlang-B recursion, which is stable for the small c we deal with."""
    bays = np.asarray(bays, dtype=int)
    rho = np.clip(np.asarray(rho, dtype=np.float64), 0.0, 0.985)
    bays, rho = np.broadcast_arrays(bays, rho)
    out = np.zeros(rho.shape, dtype=np.float64)
    for c in np.unique(bays):
        m = bays == c
        a = c * rho[m]
        b = np.ones_like(a)
        for k in range(1, c + 1):
            b = a * b / (k + a * b)
        p_wait = b / (1.0 - rho[m] * (1.0 - b))
        out[m] = p_wait * service / (c * (1.0 - rho[m]))
    return np.minimum(out, MAX_WAIT)


# The models learn a correction on top of a simple baseline (current occupancy for
# demand, the queue formula applied to current occupancy for waiting time).
# This keeps short-horizon forecasts at least as good as "assume nothing changes".
I_RNOW, I_BAYS = FEATURES.index("r_now"), FEATURES.index("bays")


def demand_baseline(X):
    return X[:, I_RNOW].astype(np.float64)


def wait_baseline(X):
    return erlang_wait(X[:, I_BAYS].astype(int), X[:, I_RNOW])


def predict_ratio(model, X):
    return np.clip(demand_baseline(X) + model.predict(X), 0.0, 1.0)


def predict_wait(model, X):
    return np.clip(wait_baseline(X) + model.predict(X), 0.0, MAX_WAIT)

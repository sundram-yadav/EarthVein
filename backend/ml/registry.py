"""Loads the trained models. If the saved file is missing or was made with an
incompatible scikit-learn version, it retrains on startup (about a minute)."""
import json
import joblib
import sklearn

from ml.features import predict_ratio, predict_wait
from ml.train import MODEL_DIR, train


class Models:
    def __init__(self):
        self.bundle = None
        self.metrics = {}
        self.load()

    def load(self):
        path = MODEL_DIR / "models.joblib"
        try:
            self.bundle = joblib.load(path)
            if self.bundle.get("sklearn") != sklearn.__version__:
                raise RuntimeError(f"saved with scikit-learn {self.bundle.get('sklearn')}, installed {sklearn.__version__}")
        except Exception as exc:
            print(f"[ml] could not load saved models ({exc}); training now")
            train(quiet=True)
            self.bundle = joblib.load(path)
        mp = MODEL_DIR / "metrics.json"
        self.metrics = json.loads(mp.read_text(encoding="utf-8")) if mp.exists() else {}

    def ratio(self, X):
        return predict_ratio(self.bundle["demand"], X)

    def wait(self, X):
        return predict_wait(self.bundle["wait"], X)

    def retrain(self):
        train(quiet=True)
        self.load()
        return self.metrics

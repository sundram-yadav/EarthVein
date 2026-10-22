"""
Storage adapter. Uses MongoDB when MONGO_URI is set, otherwise a JSON file per
collection under backend/data/ so the project also runs with zero setup.
Every document has a string field "id".
"""
import json
import threading
from pathlib import Path

import config

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "local"
COLLECTIONS = ("users", "stations", "vehicles", "bookings", "audit_log", "tickets", "settings")
_LOCK = threading.RLock()


class Store:
    def __init__(self):
        self.db = None
        self.mode = "local-json"
        if config.MONGO_URI:
            try:
                from pymongo import MongoClient
                client = MongoClient(config.MONGO_URI, serverSelectionTimeoutMS=4000)
                client.admin.command("ping")
                self.db = client[config.MONGO_DB]
                self.mode = "mongodb"
            except Exception as exc:   # fall back instead of crashing the demo
                print(f"[store] MongoDB not reachable, using local JSON files: {exc}")
        if self.mode == "mongodb":
            for name in COLLECTIONS:
                self.db[name].create_index("id", unique=True)
            self.db["users"].create_index("email", unique=True)
            self.db["vehicles"].create_index("owner_id")
            self.db["bookings"].create_index([("station_id", 1), ("slot_start", 1)])
        else:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            self._mem = {}
            for name in COLLECTIONS:
                p = DATA_DIR / f"{name}.json"
                self._mem[name] = json.loads(p.read_text(encoding="utf-8")) if p.exists() else []

    # ---- helpers for the JSON backend ----
    def _flush(self, name):
        (DATA_DIR / f"{name}.json").write_text(json.dumps(self._mem[name], indent=1), encoding="utf-8")

    @staticmethod
    def _match(doc, flt):
        return all(doc.get(k) == v for k, v in flt.items())

    # ---- public api ----
    def find(self, name, **flt):
        if self.mode == "mongodb":
            return [{k: v for k, v in d.items() if k != "_id"} for d in self.db[name].find(flt)]
        with _LOCK:
            return [dict(d) for d in self._mem[name] if self._match(d, flt)]

    def all(self, name):
        return self.find(name)

    def recent(self, name, key, limit=300, **flt):
        """Newest first by `key`, at most `limit` rows."""
        if self.mode == "mongodb":
            cur = self.db[name].find(flt).sort(key, -1).limit(limit)
            return [{k: v for k, v in d.items() if k != "_id"} for d in cur]
        return sorted(self.find(name, **flt), key=lambda d: d.get(key) or "", reverse=True)[:limit]

    def get(self, name, doc_id):
        rows = self.find(name, id=doc_id)
        return rows[0] if rows else None

    def one(self, name, **flt):
        rows = self.find(name, **flt)
        return rows[0] if rows else None

    def count(self, name, **flt):
        if self.mode == "mongodb":
            return self.db[name].count_documents(flt)
        return len(self.find(name, **flt))

    def put(self, name, doc):
        """Insert or replace by id."""
        if self.mode == "mongodb":
            self.db[name].replace_one({"id": doc["id"]}, doc, upsert=True)
            return doc
        with _LOCK:
            rows = self._mem[name]
            for i, d in enumerate(rows):
                if d.get("id") == doc["id"]:
                    rows[i] = dict(doc)
                    break
            else:
                rows.append(dict(doc))
            self._flush(name)
        return doc

    def delete(self, name, doc_id):
        if self.mode == "mongodb":
            self.db[name].delete_one({"id": doc_id})
            return
        with _LOCK:
            self._mem[name] = [d for d in self._mem[name] if d.get("id") != doc_id]
            self._flush(name)

    def delete_where(self, name, **flt):
        for d in self.find(name, **flt):
            self.delete(name, d["id"])

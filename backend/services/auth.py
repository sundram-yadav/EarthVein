import time
from functools import wraps

from flask import g, jsonify, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

import config
from services import world

_ser = URLSafeTimedSerializer(config.SECRET_KEY, salt="earthvein-auth")
_fails = {}   # (email, ip) -> [count, locked_until]
MAX_FAILS, LOCK_SECONDS = 5, 300


def hash_pw(pw):
    return generate_password_hash(pw)


def check_pw(user, pw):
    return bool(user.get("pw_hash")) and check_password_hash(user["pw_hash"], pw)


def make_token(user):
    return _ser.dumps({"uid": user["id"], "role": user["role"], "tv": user.get("token_version", 0)})


def locked(email):
    key = (email, request.remote_addr)
    rec = _fails.get(key)
    return bool(rec and rec[1] > time.time())


def note_failure(email):
    key = (email, request.remote_addr)
    rec = _fails.setdefault(key, [0, 0])
    rec[0] += 1
    if rec[0] >= MAX_FAILS:
        rec[1] = time.time() + LOCK_SECONDS
        rec[0] = 0


def clear_failures(email):
    _fails.pop((email, request.remote_addr), None)


def _load_user():
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    try:
        data = _ser.loads(header[7:], max_age=config.TOKEN_HOURS * 3600)
    except (BadSignature, SignatureExpired):
        return None
    user = world.store.get("users", data["uid"])
    if not user or not user.get("active", True) or user["role"] != data["role"] or user.get("token_version", 0) != data.get("tv", 0):
        return None
    return user


def require(*roles):
    """Endpoint guard. Always checks the role stored in the database, not just the token."""
    def deco(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            user = _load_user()
            if not user:
                return jsonify({"error": "Please sign in again."}), 401
            if roles and user["role"] not in roles:
                return jsonify({"error": "Your account does not have access to this."}), 403
            g.user = user
            return fn(*a, **kw)
        return wrapper
    return deco


def public_user(u, viewer_role="admin"):
    out = {"id": u["id"], "name": u["name"], "role": u["role"], "created_at": u.get("created_at"),
           "provider": u.get("provider", "password"), "active": u.get("active", True), "last_login": u.get("last_login")}
    email, phone = u["email"], u.get("phone")
    if viewer_role == "self" or viewer_role == "admin":
        out["email"], out["phone"] = email, phone
    else:
        out["email"] = mask_email(email)
        out["phone"] = ("******" + phone[-3:]) if phone else None
    return out


def mask_email(e):
    name, _, dom = e.partition("@")
    return (name[:1] + "***@" + dom) if dom else "***"


_hits = {}


def rate_ok(bucket, key, limit, window):
    """Sliding-window limiter kept in memory (fine for one worker). Returns False when over the limit."""
    now = time.time()
    k = (bucket, key)
    q = [t for t in _hits.get(k, []) if t > now - window]
    if len(q) >= limit:
        _hits[k] = q
        return False
    q.append(now)
    _hits[k] = q
    if len(_hits) > 5000:   # keep memory bounded
        for kk in [kk for kk, v in _hits.items() if not v or v[-1] < now - window]:
            _hits.pop(kk, None)
    return True


def password_problem(pw, staff=False):
    import re
    need = 10 if staff else 8
    if len(pw) < need or not re.search(r"[A-Za-z]", pw) or not re.search(r"\d", pw):
        return f"Password needs at least {need} characters with letters and a number."
    return None

import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import os   # noqa: E402

os.environ["SIGNUPS_PER_HOUR_PER_IP"] = "1000"   # tests create many accounts from one address

if os.getenv("EV_TEST_MONGOMOCK"):
    import mongomock
    import pymongo
    pymongo.MongoClient = mongomock.MongoClient
    os.environ["MONGO_URI"] = "mongodb://mock"

from services import store as store_module   # noqa: E402

store_module.DATA_DIR = Path(tempfile.mkdtemp(prefix="earthvein-test-"))

import app as app_module   # noqa: E402


@pytest.fixture(scope="session")
def client():
    app_module.app.config["TESTING"] = True
    return app_module.app.test_client()


def login(client, email, password, portal):
    r = client.post("/api/auth/login", json={"email": email, "password": password, "portal": portal})
    assert r.status_code == 200, r.get_json()
    return {"Authorization": "Bearer " + r.get_json()["token"]}


@pytest.fixture(scope="session")
def ananya(client):
    return login(client, "ananya.rao@demo.earthvein.in", "Demo@1234", "customer")


@pytest.fixture(scope="session")
def vikram(client):
    return login(client, "vikram.chauhan@demo.earthvein.in", "Demo@1234", "customer")


@pytest.fixture(scope="session")
def control(client):
    return login(client, "control@earthvein.in", "Control@12345", "control")


@pytest.fixture(scope="session")
def admin(client):
    return login(client, "admin@earthvein.in", "Admin@12345", "admin")
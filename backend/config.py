import os
import secrets
from datetime import timezone, timedelta
from dotenv import load_dotenv

load_dotenv()

# Render sets RENDER=true. APP_ENV=production does the same elsewhere.
PRODUCTION = bool(os.getenv("RENDER")) or os.getenv("APP_ENV", "").lower() == "production"

IST = timezone(timedelta(hours=5, minutes=30))

SECRET_KEY = os.getenv("SECRET_KEY", "").strip()
if not SECRET_KEY:
    if PRODUCTION:
        print("[config] SECRET_KEY is not set. Using a random key for this run, so everyone is signed out on each restart. Set SECRET_KEY.")
    SECRET_KEY = secrets.token_urlsafe(48) if PRODUCTION else "dev-only-change-this-secret"
MONGO_URI = os.getenv("MONGO_URI", "").strip()
MONGO_DB = os.getenv("MONGO_DB", "earthvein")
# Empty in production means same-origin only (the backend serves the frontend itself).
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "" if PRODUCTION else "*")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()
OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "").strip()
TOKEN_HOURS = int(os.getenv("TOKEN_HOURS", "12"))

# Staff accounts are created on first start. Change these before deploying.
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@earthvein.in")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
CONTROL_EMAIL = os.getenv("CONTROL_EMAIL", "control@earthvein.in")
CONTROL_PASSWORD = os.getenv("CONTROL_PASSWORD", "")
if not PRODUCTION:
    ADMIN_PASSWORD = ADMIN_PASSWORD or "Admin@12345"
    CONTROL_PASSWORD = CONTROL_PASSWORD or "Control@12345"
# Demo customers share a public password, so they are off by default in production.
SEED_DEMO = os.getenv("SEED_DEMO", "false" if PRODUCTION else "true").lower() == "true"
SIGNUPS_PER_HOUR_PER_IP = int(os.getenv("SIGNUPS_PER_HOUR_PER_IP", "10"))
MAX_VEHICLES_PER_USER = 50
MAX_ACTIVE_BOOKINGS_PER_VEHICLE = 3
COVERAGE_KM = 80           # a vehicle farther than this from every station is outside the service area
DEMO_PASSWORD = "Demo@1234"

# ---- allocation and policy assumptions (all editable) ----
RESERVE_PCT = 8            # battery a vehicle should still have when it reaches a station
ROAD_FACTOR = 1.3          # straight-line distance to approximate road distance
SPEED_KMPH = {"2W": 26, "3W": 22, "car": 28, "lcv": 24, "truck": 20}
PEAK_SPEED_FACTOR = 0.7    # city speed drop in peak windows
PEAK_WINDOWS = [(8, 11), (17, 21)]   # heavy freight is kept out of these hours
HEAVY_CLASSES = {"truck"}
CHARGE_EFFICIENCY = 0.92
BOOKED_WAIT_FACTOR = 0.25  # share of the walk-in queue that still affects a reserved slot
SLOT_MINUTES = 30
CITY_CENTRES = {"delhi": (28.6139, 77.2090), "bengaluru": (12.9716, 77.5946)}

# tariff multipliers by local hour (assumption, typical of time-of-day pricing)
def tod_multiplier(hour):
    if 18 <= hour < 22:
        return 1.20
    if hour >= 23 or hour < 6:
        return 0.85
    return 1.0

# ---- impact factors ----
GRID_KG_PER_KWH = 0.71     # approximate India grid average
PETROL_KG_PER_L = 2.31
DIESEL_KG_PER_L = 2.68
ICE_EQUIVALENT = {         # (km per litre, fuel) of the vehicle an EV of this class replaces
    "2W": (45, "petrol"), "3W": (30, "petrol"), "car": (15, "petrol"),
    "lcv": (14, "diesel"), "truck": (6, "diesel"),
}
# EarthVein

EarthVein is a web platform that spreads delivery traffic and EV charging demand across a city, so the
roads and chargers that already exist carry more before anyone has to build new ones. Vehicle owners
register their EVs, the system picks a station and a time slot for each charge, and a control room can
watch the network and step in when the suggestion is wrong.

This is the Round 2 prototype for the Sustainability and Smart Cities track. It was called VeinFlow in
the Round 1 submission. The name is EarthVein everywhere now.

## What is in the prototype

- Three separate sign-ins: Customer, Control panel and Admin. Customers can also sign in with Google.
- Vehicle registration with a catalogue of Indian EV models. Picking a model fills in battery size,
  claimed range, real-world Wh/km, connector and maximum charging power. Models that are not listed
  can be entered by hand.
- Live map with the customer's own vehicles, device GPS and nearby stations, and a one-click auto-route
  to the best station with the road route drawn on the map.
- Slot booking that depends on battery percentage, distance to the station, time of day and how busy
  each station is expected to be. It shows the estimated charging fee for each option.
- Battery monitor with remaining range, the distance you can still drive before the reserve, alerts at
  30, 20 and 10 percent, and the nearest chargers you can reach.
- Impact report: fuel saved, CO2 reduced, average delay and time saved by booking.
- Control panel: registry of all vehicles, all bookings with operator override, support desk, city map
  and network impact.
- Admin: everything above plus the audit log, user management and the model page.
- Two trained models (see the Model section) that drive the allocation.

## Who can see what

| | Customer | Control panel | Admin |
|---|---|---|---|
| Own vehicles, routes, bookings, battery, impact | yes | no | yes (as a customer) |
| Other customers' vehicles and bookings | never | registry and booking records | registry and booking records |
| Customer email and phone | own only | masked | full |
| Vehicle position | own, exact | about 100 m accuracy, no trail | about 100 m accuracy, no trail |
| Help and support desk | not shown | yes | yes |
| Operator override of a booking | no | yes, reason required | yes, reason required |
| Audit log | no | no | yes |
| User management, model page | no | no | yes |

How privacy is enforced:

- Every customer endpoint is under `/api/me/` and filters by the signed-in user's id on the server.
  Asking for somebody else's vehicle or booking returns 404, the same as a record that does not exist.
- Roles are checked against the database on every request, not only against the token.
- Station data shared with all users contains only aggregate load (occupied bays, queue estimate), never
  which vehicle is where.
- The control panel sees masked contact details. Opening a vehicle record is written to the audit log.
- Passwords are hashed. Five wrong passwords lock that email and IP for five minutes.
- A customer can download their data (`GET /api/me/export`) and delete their account with all linked
  records (`DELETE /api/me`).
- `backend/tests/test_api.py` checks the cross-customer and cross-role cases.

Support is deliberately only in the control panel and the admin view. The system raises tickets there
on its own when a battery goes critical or no station can be reached.

## Running it locally

You need Python 3.10 or newer and Node 18 or newer.

Backend (Python 3.11 or newer; 3.12 is what Render uses):

    cd backend
    python -m venv .venv
    source .venv/bin/activate          # Windows: .venv\Scripts\activate
    pip install -r requirements-dev.txt     # use requirements.txt if you do not need the tests
    cp .env.example .env               # Windows: copy .env.example .env
    python app.py

The API runs on http://localhost:5000. On the first start it creates the stations, the staff accounts
and demo customers. With no `MONGO_URI` set it stores data in JSON files under `backend/data/local/`,
so the project runs with nothing else installed.

Frontend, in a second terminal (only needed for development; the backend already serves a built copy at
http://localhost:5000 once `backend/static/` exists):

    cd frontend
    npm install
    cp .env.example .env               # Windows: copy .env.example .env
    npm run dev

Open http://localhost:5173.

### Demo accounts

| Portal | Email | Password |
|---|---|---|
| Customer | ananya.rao@demo.earthvein.in | Demo@1234 |
| Customer | vikram.chauhan@demo.earthvein.in | Demo@1234 |
| Control panel | control@earthvein.in | Control@12345 |
| Admin | admin@earthvein.in | Admin@12345 |

Other demo customers: meera.iyer, rohan.bhatt, farhan.qureshi and sneha.kulkarni, all at
`@demo.earthvein.in` with the same password. Ananya and Sneha run Bengaluru fleets, Vikram, Rohan and
Farhan run Delhi NCR fleets. Vikram and Rohan own trucks, which is the quickest way to see heavy freight
being kept out of peak hours. Change the staff passwords in `.env` before deploying anywhere public, and
set `SEED_DEMO=false` to skip the demo customers.

### MongoDB Atlas

1. Create a free M0 cluster, add a database user and allow your IP (or 0.0.0.0/0 while testing).
2. Copy the connection string into `MONGO_URI` in `backend/.env`.
3. Restart the backend. `GET /api/health` should report `"storage": "mongodb"`.

If Atlas is unreachable the backend falls back to the local JSON files and prints a warning, so a bad
network does not take the demo down.

### Google sign-in

1. In Google Cloud Console create an OAuth client ID of type Web application.
2. Add `http://localhost:5173` (and your Vercel URL later) as an authorised JavaScript origin.
3. Put the client ID in `GOOGLE_CLIENT_ID` in `backend/.env`. The login page reads it from the API,
   so the frontend does not need it. `VITE_GOOGLE_CLIENT_ID` in the frontend `.env` is not used by the
   current code and can be left empty.

Google accounts are always customer accounts. Staff must use email and password.

## The model

The model is not a rule table. Two gradient boosting regressors (scikit-learn `HistGradientBoostingRegressor`)
are trained in `backend/ml/train.py`.

**Demand model.** Predicts a station's occupancy ratio up to 24 hours ahead from current occupancy, the last
hour's trend, the same hour yesterday and last week, hour and weekday, station size and a popularity factor.
It learns a correction on top of "nothing changes".

**Wait model.** Predicts the queue a vehicle would meet if it arrived at a station at a given time.

**How they are used.** For a vehicle, the allocator lists every compatible, reachable station and every free
slot in the next 12 hours (2 hours when the battery is low). It scores each one as travel time, plus waiting
for the slot, plus charging time, plus a share of the predicted walk-in queue, plus a fee term that depends on
the customer's priority (balanced, fastest or lowest fee). Heavy freight is not offered slots that touch
08:00-11:00 or 17:00-21:00 unless the battery is low. Light vehicles are lightly discouraged from freight yards.
The best slot per station is shown and the best overall is marked Recommended.

### Training data

The training data is the UrbanEV dataset: hourly occupied-pile counts for 275 zones of Shenzhen from
2022-09-01 to 2023-02-28, with station metadata. It is open source and public domain (CC0 1.0).

- GitHub: https://github.com/IntelligentSystemsLab/UrbanEV (files `data/occupancy.csv` and `data/inf.csv`)
- Paper: Li, Qu, Tan, You, Zhu and Fan, "UrbanEV: An open benchmark dataset for urban electric vehicle
  charging demand prediction", Scientific Data, 2025, doi:10.1038/s41597-025-04874-4
- Dryad copy: doi:10.5061/dryad.np5hqc04z

The two CSV files are bundled in `backend/ml/data/` so training works offline. Mean utilization in the data
is about 27 percent, which lines up with the roughly 25 percent utilization quoted in our problem statement.

Another public dataset we looked at but did not use is ACN-Data (Caltech campus charging sessions, mirrored
at https://github.com/tongxin-li/ACN-Data-Static). It is workplace charging in the US with its own usage
terms, so check those before adding it.

### Training it yourself

    cd backend
    python -m ml.train                      # about 40 seconds
    python -m ml.train --samples 900000     # more rows
    python -m ml.train --data path/to/csvs  # your own data in the same layout as ml/data

This writes `ml/models/models.joblib` and `ml/models/metrics.json`. A trained copy ships with the project.
If the installed scikit-learn version differs from the one the file was saved with, the backend retrains
once at startup. The admin Model page also has a Retrain button.

### Results on data the models never saw

Models are fitted on the first 80 percent of the timeline and scored on the last 20 percent.

Demand forecast, mean absolute error as a share of station occupancy (lower is better):

| Horizon | Model | Assume nothing changes |
|---|---|---|
| 1-3 hours | 3.7% | 3.5% |
| 4-12 hours | 5.6% | 8.4% |
| 13-24 hours | 6.3% | 8.3% |

For the next one to three hours the current occupancy is a slightly better guess than the model. The model
helps beyond that, which is what slot booking needs. R2 over all horizons is 0.83.

Wait prediction: mean absolute error 1.62 minutes, against 1.67 for applying the queue formula to current
occupancy. Only about 5 percent of rows have a wait over 5 minutes, so the gain is small in absolute terms.

Station choice, 6000 random requests across both cities on the unseen period:

| Policy | Mean wait | Travel plus wait |
|---|---|---|
| Nearest station | 2.64 min | 15.6 min |
| Least loaded right now | 0.10 min | 41.1 min |
| EarthVein model | 0.21 min | 13.5 min |

The model cuts waiting by about 92 percent against always going to the nearest station and travel plus wait
by about 14 percent. Least loaded wins on waiting only by sending vehicles very far, so travel plus wait is the
fair column.

### What this does and does not show

Please read this before quoting the numbers anywhere.

- The data is from Shenzhen. We know of no open charger-occupancy dataset for Indian cities. Demand patterns
  there are different, so treat the numbers as proof that the pipeline works, and retrain on local data
  before drawing conclusions about a real Indian city.
- There is no live feed from real chargers. The app replays the dataset as telemetry: each station is mapped
  to one real zone, and "now" is matched to the dataset by weekday and hour. Occupancy is therefore noisy and
  realistic, but it is a replay. The "Simulate rush hour" button multiplies it by 1.35.
- The waiting time label is not measured. It is computed with a standard M/M/c queueing formula from the real
  occupancy, assuming a vehicle holds a bay for 40 minutes on average. That assumption is in `ml/features.py`.
- The policy test does not let vehicles affect each other's queues, which flatters every policy.
- Weather was tried as an input and dropped because it did not improve error on held-out data.
- The stations are simulated at real localities in Delhi NCR and Bengaluru. Coordinates are of the localities,
  not of actual operators' chargers. `backend/scripts/import_ocm.py` can load real stations from OpenChargeMap
  with a free API key. It was written against the API documentation and has not been run against the live
  service from our build environment, so check the first import by hand.
- The EV catalogue holds approximate, rounded figures for suggestions and auto-fill. Verify against the
  manufacturer's sheet. Real-world Wh/km values are our estimates, not claimed figures.
- Battery level is an estimate from stored charge, battery health and Wh/km, or from the phone's GPS
  movement. It is not read from the vehicle's BMS. A production version would take it from the vehicle.

## Impact figures

- Fuel saved is tracked distance divided by km per litre of the petrol or diesel vehicle an EV of that class
  replaces (45 for two-wheelers, 30 for three-wheelers, 15 for cars, 14 for vans, 6 for trucks).
- CO2 reduced is that fuel's tailpipe CO2 minus the grid emissions of the electricity used, at 0.71 kg per kWh.
- Average delay is the expected queue left after a reserved slot, taken as a quarter of the predicted walk-in
  queue.
- Time saved compares travel plus walk-in queue at the nearest station with the booked plan.
- Utilization balance compares how evenly bookings spread over stations with how they would spread if every
  vehicle went to its nearest station.

All the factors are in `backend/config.py`. Seeded vehicles come with a driving history so the demo shows
numbers. A new account starts at zero and grows as you drive and book.

## Live GPS and the demo drive

On the Live map page, Use live GPS reads the phone or laptop location (the browser asks for permission),
moves the selected vehicle there and keeps updating it. Browsers only allow GPS on https or localhost.
If you are in a city other than Delhi or Bengaluru, the map still shows the demo stations in those cities.

On the Battery monitor page, Start demo drive moves the vehicle along the road to the nearest station and
drains the battery on the way, which is the easiest way to show the low-battery alert in a demo.
Road geometry comes from the public OSRM demo server. If it is slow or unreachable the route falls back to
a straight line. The public server is fine for a demo and not meant for production traffic.

## Map behaviour

The earlier prototype jumped back to the start view every few seconds. There were two causes: the map
re-fitted its bounds whenever data refreshed, and marker icons were rebuilt on every render, which makes
Leaflet replace the marker and close popups. Now the camera moves only on the first load or when you press a
button that asks for it, icons are cached, and a refresh that returns identical data changes no state.

## Project layout

    backend/
      app.py                 API routes and role guards
      config.py              all tunable assumptions
      services/
        engine.py            station state, forecasts, planning, bookings, impact
        auth.py, store.py    tokens and roles, MongoDB or JSON storage
        seed.py, stations_data.py, vehicles.py, catalog.py, world.py
      ml/
        train.py, features.py, replay.py, registry.py
        data/                UrbanEV CSV files and their source notes
        models/              trained models and metrics.json
      static/                the built frontend, served by the backend
      data/ev_catalog.json   EV model catalogue
      scripts/import_ocm.py  optional real station import
      tests/                 pytest suite
    render.yaml              Render blueprint
    frontend/
      src/Login.jsx          animated three-portal sign-in
      src/pages/             Customer.jsx, Staff.jsx, Admin.jsx
      src/components/        map, shell, shared UI

## API summary

Public: `GET /api/health`, `GET /api/meta`, `GET /api/catalog`, `POST /api/auth/signup`,
`POST /api/auth/login`, `POST /api/auth/google`.

Any signed-in user: `GET /api/stations`, `GET /api/stations/<id>/forecast`, `GET /api/forecast/city`.

Customer and admin (own data only): `/api/me/vehicles`, `/api/me/vehicles/<id>/battery`,
`/api/me/vehicles/<id>/telemetry`, `/api/me/vehicles/<id>/plan`, `/api/me/nearby`, `/api/me/bookings`,
`/api/me/impact`, `/api/me/export`.

Control panel and admin: `/api/staff/overview`, `/vehicles`, `/bookings`, `/override`, `/tickets`, `/impact`,
`/scenario`, `/stations/<id>/status`.

Admin only: `/api/admin/audit`, `/api/admin/users`, `/api/admin/model`, `/api/admin/model/retrain`.

## Tests

    cd backend
    pip install -r requirements-dev.txt
    python -m pytest tests -q
    EV_TEST_MONGOMOCK=1 python -m pytest tests -q    # same tests through the MongoDB code path

The suite covers sign-in portals, tokens, one customer trying to reach another's data, role walls, masked
contact details, the signup to booking flow, battery drain from telemetry, overrides and the audit log,
heavy freight staying out of peak hours, data export and deletion, double and simultaneous bookings,
service-area messages, password change and reset, and security headers. The second command runs everything
against an in-memory MongoDB double, since the real Atlas connection cannot be tested offline.

## Deploying on Render

The backend serves the built frontend, so one Render web service is the whole app. There is no second
deployment, no CORS setup and no API URL to configure. The built frontend is already in `backend/static/`.

### 1. MongoDB Atlas

1. Create a free M0 cluster and a database user.
2. Network Access: add `0.0.0.0/0`. Render's free instances have no fixed IP. The database user's password
   is what protects the cluster, so make it long.
3. Copy the connection string (`mongodb+srv://...`). This is `MONGO_URI`.

Do not skip this. Without `MONGO_URI` the app falls back to JSON files on Render's disk, which is wiped on
every restart and deploy. `GET /api/health` shows `"durable": false` when that is the case.

### 2. Push the repository to GitHub

Push the whole project folder (the folder that contains `backend/`, `frontend/` and `render.yaml`).

### 3. Create the service

Render dashboard, New, Blueprint, choose the repository. Render reads `render.yaml` and asks for the values
marked `sync: false`:

| Variable | What to put |
|---|---|
| `MONGO_URI` | the Atlas connection string |
| `ADMIN_PASSWORD` | a strong password, 10 or more characters, for admin@earthvein.in |
| `CONTROL_PASSWORD` | the same for control@earthvein.in |
| `GOOGLE_CLIENT_ID` | optional, see the Google section above |

`SECRET_KEY` is generated by Render. `SEED_DEMO=true` creates the demo customers; see below.

To do it without the blueprint: New, Web Service, root directory `backend`, build command
`pip install -r requirements.txt`, start command
`gunicorn app:app --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 120`, health check path `/api/health`,
and add the variables above plus `PYTHON_VERSION=3.12.3`.

### 4. First start

- The first deploy takes a few minutes while the Python packages install.
- If you did not set `ADMIN_PASSWORD` or `CONTROL_PASSWORD`, the app generates them and prints them once in the
  Render log ("Created admin account ... with generated password"). Sign in and change them from My account.
- Open the service URL. Sign in at the Admin tab and check Users and access.
- For Google sign-in, add the Render URL to the authorised JavaScript origins of your OAuth client.

### 5. About the free plan

- The service sleeps after about 15 minutes without traffic. The first request afterwards can take 30 to 60
  seconds. The login page tells the user the server is waking up. Open the link yourself a minute before a demo
  or judging. A free uptime pinger on `/api/health` every 10 minutes also keeps it awake.
- 512 MB of memory is enough. The running app uses roughly 200 MB.
- Keep exactly one worker. Login lockouts, rate limits and a short station cache live in memory, and the
  booking lock only works inside one process.

### Changing the frontend later

The frontend is served from `backend/static/`. After editing anything in `frontend/src`:

    cd frontend
    npm install
    npm run build:deploy        # builds straight into ../backend/static

Commit the updated `backend/static/` and push. For local development use `npm run dev` as before.

### Demo customers in production

`SEED_DEMO=true` creates six demo customers with the public password `Demo@1234`, a fleet of 28 vehicles and some
booking history. That is useful for judges and for the video. Before real users arrive, set `SEED_DEMO=false`
and delete the demo accounts from Users and access (disable them) or drop the database and start clean.

## Production checklist

- MongoDB Atlas connected, `/api/health` shows `"storage": "mongodb"` and `"durable": true`.
- Staff passwords set by you, not the defaults. In production the defaults are refused.
- `SECRET_KEY` set (Render generates it). Changing it signs everybody out.
- `SEED_DEMO` decided on purpose.
- Google client ID set, if you want Google sign-in, with your Render URL as an authorised origin.

What the app already does for you in production: it trusts the proxy headers so lockouts use the real client IP,
sends HSTS, a content security policy, frame and referrer protections, serves hashed assets with long cache
lifetimes, limits request size, rate limits sign-up, planning and location updates, and returns JSON errors
without stack traces (details go to the log).

## Bugs found by using it as a customer, and fixed

These all came up while clicking through the app as a new user and are covered by tests in
`backend/tests/test_hardening.py`.

- The same vehicle could be booked twice for the same time, and two simultaneous requests could take the last bay.
  Bookings now run under a lock, overlapping bookings are refused, and a vehicle can hold at most three upcoming ones.
- A vehicle placed outside Delhi NCR and Bengaluru (for example Mumbai) was labelled Bengaluru, got a vague
  "request assistance" message and generated a support ticket. It now gets a clear coverage message and no ticket.
- A vehicle's city did not follow it when it moved to another city.
- An operator-overridden booking in the past could still be cancelled.
- The login lockout would have keyed on Render's proxy address instead of the user's. Fixed with proxy headers.
- Dates were converted to the browser's timezone while times were shown in IST, so a booking could show the wrong day.
- After login the first render crashed for a user with vehicles because the selected vehicle was not set yet.
- There was no way to change a password, and no admin reset. Both exist now, and changing a password signs out the
  other sessions.
- There was no place to update the charge level shown for a vehicle. The Battery monitor page has one.
- The map had no legend, a new account landed on an empty page instead of the add-vehicle form, the mobile top bar
  was cramped, and a rendering error would have left a blank page. All handled.
- Default staff passwords and open CORS would have shipped to production. Both are now closed by default.

## Suggested demo for the video

1. Sign in as Vikram (Customer). Show the dashboard, then Slot booking for a truck: the slot lands outside
   the peak windows and the reason is written next to it.
2. Switch to a low-battery vehicle, open Battery monitor, start the demo drive and show the alert and the
   nearest chargers.
3. Open Live map and use Auto-route. Zoom in and wait: the map no longer resets.
4. Log out, sign in to the Control panel. Show the registry (masked emails), turn on the rush-hour scenario,
   and override a booking with a reason.
5. Log in as Admin, open the audit log to show the override and the record views, then the Model page for the
   held-out results.
6. Close with the Impact page.

## Known limits

- Single backend worker, no background job queue. Retraining runs in a thread and needs about 300 MB while it runs.
- Sessions are stateless tokens that last 12 hours. Logging out removes the token from the browser, and changing a
  password invalidates all older tokens. There is no email, so there is no self-service forgot-password. An admin
  resets it from Users and access.
- The audit log lives in the same database and is not tamper-proof. Export it if you need an external record.
- No email or SMS alerts. Alerts appear in the app and as browser notifications.
- Payments are not implemented. Fees are estimates excluding taxes.
- Charging sessions are not read from real chargers, so "Mark charged" is a manual confirmation.
- Dates and times are shown in IST.

## Data sources and credits

- UrbanEV charging occupancy dataset, CC0 1.0, see above.
- Map tiles from OpenStreetMap contributors and CARTO. Routes from the OSRM project demo server.
- Libraries: Flask, scikit-learn, pandas, React, Vite, Tailwind CSS, Leaflet, react-leaflet, Recharts,
  Framer Motion, Lucide.

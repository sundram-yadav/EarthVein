import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, LifeBuoy, Send, BatteryCharging, CalendarClock, Fuel, Gauge, Leaf, LocateFixed, Navigation, Play, Plus, Route, Square, Trash2, Zap, Clock } from 'lucide-react';
import { api, roadRoute } from '../api';
import { useLoad } from '../hooks';
import MapView, { Legend } from '../components/MapView';
import { length, pointAlong } from '../components/geo';
import { Badge, CLASS_NAME, Empty, Field, Glass, Modal, PageHead, Ring, Skeleton, Stat, fmt, hhmm, inr, levelTone, stamp } from '../components/ui';

const tick = { fontSize: 11, fill: '#98a6c0' };
const tip = { background: 'rgba(14,23,48,.95)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 12, fontSize: 12, color: '#e9eef8' };

function VehiclePicker({ vehicles, vehId, setVehId }) {
  if (!vehicles.length) return null;
  return (
    <select className="select !w-auto min-w-[230px]" value={vehId || ''} onChange={(e) => setVehId(e.target.value)} aria-label="Vehicle">
      {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate} - {v.name}</option>)}
    </select>
  );
}
function NoVehicle({ go }) {
  return <Glass className="mt-4"><Empty title="Add your first vehicle" text="Battery size, connector and range are filled in from the model you choose, so charging suggestions fit your vehicle." action={<button className="btn btn-primary" onClick={() => go('vehicles', { add: true })}><Plus size={15} /> Add a vehicle</button>} /></Glass>;
}

/* ------------------------------------------------------------------ dashboard */
export function Dashboard({ ctx }) {
  const { vehicles, vehId, setVehId, go } = ctx;
  const v = vehicles.find((x) => x.id === vehId);
  const bat = useLoad(() => (vehId ? api(`/api/me/vehicles/${vehId}/battery`) : Promise.resolve(null)), [vehId, v?.soc], 10000);
  const books = useLoad(() => api('/api/me/bookings'), [], 15000);
  const imp = useLoad(() => api('/api/me/impact'), [], 30000);
  const fc = useLoad(() => (v ? api(`/api/forecast/city?city=${v.city}`) : Promise.resolve(null)), [v?.city]);
  const next = (books.data || []).filter((b) => b.status === 'confirmed' || b.status === 'operator-overridden').sort((a, b) => a.slot_start.localeCompare(b.slot_start))[0];
  if (!vehicles.length) return <><PageHead title="Dashboard" sub="Your vehicles, battery and charging plan in one place." /><NoVehicle go={go} /></>;
  const b = bat.data;
  return (
    <>
      <PageHead title={`Hello, ${ctx.user.name.split(' ')[0]}`} sub="Charge level, next booking and the load on chargers around you." actions={<VehiclePicker vehicles={vehicles} vehId={vehId} setVehId={setVehId} />} />
      <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
        <Glass edge stripe className="p-6">
          {!b ? <Skeleton h={220} /> : (
            <div className="flex flex-wrap items-center gap-6">
              <Ring value={b.soc} level={b.level} size={200}>
                <div className="big-num text-6xl">{Math.round(b.soc)}<span className="text-2xl">%</span></div>
                <div className="text-xs text-[var(--muted)]">{v.plate}</div>
              </Ring>
              <div className="min-w-[220px] flex-1">
                <div className="flex items-center gap-2"><Badge tone={levelTone(b.level)}>{b.level === 'ok' ? 'Healthy' : b.level === 'warning' ? 'Charge soon' : b.level === 'low' ? 'Low battery' : 'Critical'}</Badge><span className="text-xs text-[var(--muted)]">{v.make} {v.model}</span></div>
                <div className="mt-3 flex gap-8">
                  <div><div className="big-num text-4xl">{fmt(b.range_km, 0)}</div><div className="text-xs text-[var(--muted)]">km range</div></div>
                  <div><div className="big-num text-4xl">{fmt(b.safe_range_km, 0)}</div><div className="text-xs text-[var(--muted)]">km to reserve</div></div>
                </div>
                <p className="mt-3 text-sm text-[var(--muted)]">{b.message}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button className="btn btn-primary" onClick={() => go('slots')}><CalendarClock size={15} /> Book a slot</button>
                  <button className="btn" onClick={() => go('map')}><Navigation size={15} /> Route to best station</button>
                </div>
              </div>
            </div>
          )}
        </Glass>
        <div className="grid gap-4">
          <Glass tint="blue" className="p-5">
            <div className="text-xs font-medium text-[var(--muted)]">Next booking</div>
            {next ? (
              <div className="mt-2">
                <div className="font-display text-2xl font-semibold">{next.station_name}</div>
                <div className="mt-1 text-sm text-[var(--muted)]">{next.plate} - {stamp(next.slot_start)} to {hhmm(next.slot_end)} - {next.distance_km} km away</div>
                <div className="mt-3 flex gap-2"><Badge tone="green">Arrive with {fmt(next.soc_arrival, 0)}%</Badge><Badge tone="orange">{inr(next.fee.total_inr)} estimated</Badge></div>
              </div>
            ) : <p className="mt-2 text-sm text-[var(--muted)]">No upcoming booking. Use Slot booking to reserve a bay.</p>}
          </Glass>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="CO2 avoided" value={fmt(imp.data?.co2_saved_kg, 0)} unit="kg" tone="green" icon={Leaf} />
            <Stat label="Fuel avoided" value={fmt(imp.data?.fuel_saved_l, 0)} unit="L" tone="orange" icon={Fuel} />
          </div>
        </div>
      </div>
      <Glass className="mt-4 p-5">
        <div className="mb-3 flex items-end justify-between">
          <div><h3 className="text-lg font-semibold">Charger demand in {v.city === 'delhi' ? 'Delhi NCR' : 'Bengaluru'}, next 24 hours</h3><p className="text-xs text-[var(--muted)]">Forecast by the trained demand model. Higher means busier stations.</p></div>
          <Badge tone="blue">Model forecast</Badge>
        </div>
        <div className="h-[220px]">
          {!fc.data ? <Skeleton h={220} /> : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={fc.data.forecast.map((x) => ({ ...x, pct: Math.round(x.utilization * 100) }))} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f28a33" stopOpacity=".55" /><stop offset="100%" stopColor="#f28a33" stopOpacity="0" /></linearGradient></defs>
                <CartesianGrid stroke="rgba(255,255,255,.08)" vertical={false} />
                <XAxis dataKey="hour" tick={tick} tickLine={false} axisLine={false} interval={2} />
                <YAxis tick={tick} tickLine={false} axisLine={false} unit="%" />
                <Tooltip contentStyle={tip} formatter={(x) => [`${x}%`, 'Predicted utilization']} />
                <Area dataKey="pct" stroke="#f28a33" strokeWidth={2.5} fill="url(#g1)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Glass>
    </>
  );
}

/* ------------------------------------------------------------------ vehicles */
const EMPTY = { vclass: 'car', model_id: '', name: '', plate: '', year: 2024, battery_kwh: '', range_km: '', consumption_wh_km: '', connector: 'CCS2', max_kw: '', soh: 96, soc: 60, load_kg: 0, lat: '', lng: '' };

function AddVehicle({ onClose, onDone, centres }) {
  const cat = useLoad(() => api('/api/catalog', { auth: false }), []);
  const [f, setF] = useState(EMPTY);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const c = cat.data;
  const models = useMemo(() => (c ? c.models.filter((m) => m.vclass === f.vclass) : []), [c, f.vclass]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const pickClass = (vclass) => { const g = c.generic[vclass]; setF({ ...f, vclass, model_id: '', battery_kwh: g.battery_kwh, range_km: g.range_km, consumption_wh_km: g.consumption_wh_km, connector: g.connector, max_kw: g.max_kw }); };
  const pickModel = (id) => {
    if (!id) return pickClass(f.vclass);
    const m = c.models.find((x) => x.id === id);
    setF({ ...f, model_id: id, battery_kwh: m.battery_kwh, range_km: m.range_km, consumption_wh_km: m.consumption_wh_km, connector: m.connector, max_kw: m.max_kw });
  };
  useEffect(() => { if (c && f.battery_kwh === '') pickClass(f.vclass); /* eslint-disable-next-line */ }, [c]);
  const here = () => navigator.geolocation?.getCurrentPosition((p) => setF((x) => ({ ...x, lat: p.coords.latitude.toFixed(5), lng: p.coords.longitude.toFixed(5) })), () => setErr('Location permission was denied. Choose a city instead.'));
  const city = (name) => setF({ ...f, lat: centres[name][0], lng: centres[name][1] });
  const sel = c?.models.find((m) => m.id === f.model_id);
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const body = { ...f, make: sel?.make, model: sel?.model, variant: sel?.variant };
      if (f.lat === '') { body.lat = centres.delhi[0]; body.lng = centres.delhi[1]; }
      await api('/api/me/vehicles', { method: 'POST', body });
      onDone();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const tips = { '2W': 'Light points and any LECCS charger work well. Slow AC charging overnight is cheapest.', '3W': 'Mixed hubs with LECCS work. Cargo three-wheelers are scheduled around peak hours.', car: 'CCS2 fast hubs suit you. We avoid freight yards so trucks keep their bays.', lcv: 'CCS2 hubs and freight yards both work. Off-peak slots are cheaper.', truck: 'Only freight yards with CCS2 high power are offered, and slots stay outside peak hours.' };
  return (
    <Modal title="Add a vehicle" onClose={onClose} wide>
      {!c ? <Skeleton h={200} /> : (
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Vehicle type"><select className="select" value={f.vclass} onChange={(e) => pickClass(e.target.value)}>{Object.entries(c.classes).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Make and model" hint="Choosing a model fills in battery, range and connector."><select className="select" value={f.model_id} onChange={(e) => pickModel(e.target.value)}><option value="">Not listed (use class defaults)</option>{models.map((m) => <option key={m.id} value={m.id}>{m.make} {m.model} {m.variant}</option>)}</select></Field>
            <Field label="Registration number" hint="For example KA01EV4412"><input className="input" required value={f.plate} onChange={set('plate')} placeholder="DL3CEV1234" /></Field>
            <Field label="Nickname"><input className="input" value={f.name} onChange={set('name')} placeholder="Morning delivery van" /></Field>
            <Field label="Battery capacity (kWh)"><input className="input" type="number" step="0.1" required value={f.battery_kwh} onChange={set('battery_kwh')} /></Field>
            <Field label="Claimed range (km)"><input className="input" type="number" required value={f.range_km} onChange={set('range_km')} /></Field>
            <Field label="Real-world use (Wh/km)" hint="Used to estimate how far you can go."><input className="input" type="number" required value={f.consumption_wh_km} onChange={set('consumption_wh_km')} /></Field>
            <Field label="Connector"><select className="select" value={f.connector} onChange={set('connector')}>{c.connectors.map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Max charging power (kW)"><input className="input" type="number" step="0.1" required value={f.max_kw} onChange={set('max_kw')} /></Field>
            <Field label="Battery health (%)"><input className="input" type="number" min="40" max="100" value={f.soh} onChange={set('soh')} /></Field>
            <Field label="Current charge (%)"><input className="input" type="number" min="0" max="100" value={f.soc} onChange={set('soc')} /></Field>
            <Field label="Typical load (kg)"><input className="input" type="number" min="0" value={f.load_kg} onChange={set('load_kg')} /></Field>
          </div>
          <div className="glass tint-blue p-3 text-sm"><b>Suggestion:</b> {tips[f.vclass]}{sel && <> {sel.make} {sel.model} accepts up to {sel.max_kw} kW on {sel.connector}.</>}</div>
          <Field label="Where is the vehicle now?" hint={f.lat ? `Saved as ${f.lat}, ${f.lng}` : 'Optional. You can update it later from the map.'}>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-sm" onClick={here}><LocateFixed size={14} /> Use my GPS</button>
              <button type="button" className="btn btn-sm" onClick={() => city('delhi')}>Delhi NCR</button>
              <button type="button" className="btn btn-sm" onClick={() => city('bengaluru')}>Bengaluru</button>
            </div>
          </Field>
          {c.note && <p className="text-[11px] text-[var(--muted)]">{c.note}</p>}
          {err && <div className="rounded-xl border border-[rgba(229,100,90,.5)] bg-[rgba(229,100,90,.12)] px-3 py-2 text-sm text-[#ffb4ad]" role="alert">{err}</div>}
          <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}><Plus size={15} /> Save vehicle</button></div>
        </form>
      )}
    </Modal>
  );
}

export function Vehicles({ ctx }) {
  const { vehicles, reload, notify, meta } = ctx;
  const [adding, setAdding] = useState(!!ctx.autoAdd);
  useEffect(() => { if (ctx.autoAdd) ctx.clearAutoAdd(); /* eslint-disable-next-line */ }, []);
  const remove = async (v) => {
    if (!window.confirm(`Remove ${v.plate}? Its upcoming bookings will be cancelled.`)) return;
    try { await api(`/api/me/vehicles/${v.id}`, { method: 'DELETE' }); notify('Vehicle removed.'); reload(); } catch (e) { notify(e.message, 'error'); }
  };
  return (
    <>
      <PageHead title="My vehicles" sub="Only you can see these vehicles, their location and their bookings." actions={<button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={15} /> Add vehicle</button>} />
      {!vehicles.length ? <Glass><Empty title="No vehicles yet" text="Add a vehicle to get charging slots, routes and battery alerts." /></Glass> : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {vehicles.map((v) => (
            <Glass key={v.id} stripe tint={v.vclass === 'truck' || v.vclass === 'lcv' ? 'orange' : v.vclass === 'car' ? 'blue' : 'green'} className="p-5">
              <div className="flex items-start justify-between">
                <div><div className="num text-xs text-[var(--muted)]">{v.plate}</div><h3 className="mt-0.5 text-xl font-semibold">{v.name}</h3><div className="text-sm text-[var(--muted)]">{v.make} {v.model} {v.variant}</div></div>
                <Badge tone={levelTone(v.soc <= 10 ? 'critical' : v.soc <= 20 ? 'low' : v.soc <= 30 ? 'warning' : 'ok')}>{Math.round(v.soc)}%</Badge>
              </div>
              <div className="bar-track mt-4"><div className="bar-fill" style={{ width: `${v.soc}%`, background: v.soc <= 20 ? 'var(--red)' : v.soc <= 30 ? 'var(--orange)' : 'var(--green)' }} /></div>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <div><dt className="text-[var(--muted)]">Battery</dt><dd className="num mt-0.5 text-sm">{fmt(v.battery_kwh)} kWh</dd></div>
                <div><dt className="text-[var(--muted)]">Connector</dt><dd className="num mt-0.5 text-sm">{v.connector}</dd></div>
                <div><dt className="text-[var(--muted)]">Max power</dt><dd className="num mt-0.5 text-sm">{fmt(v.max_kw)} kW</dd></div>
                <div><dt className="text-[var(--muted)]">Health</dt><dd className="num mt-0.5 text-sm">{fmt(v.soh, 0)}%</dd></div>
                <div><dt className="text-[var(--muted)]">Use</dt><dd className="num mt-0.5 text-sm">{fmt(v.consumption_wh_km, 0)} Wh/km</dd></div>
                <div><dt className="text-[var(--muted)]">Type</dt><dd className="mt-0.5 text-sm">{CLASS_NAME[v.vclass]}</dd></div>
              </dl>
              <div className="mt-4 flex justify-end"><button className="btn btn-sm btn-danger" onClick={() => remove(v)}><Trash2 size={13} /> Remove</button></div>
            </Glass>
          ))}
        </div>
      )}
      {adding && <AddVehicle centres={meta.city_centres} onClose={() => setAdding(false)} onDone={() => { setAdding(false); notify('Vehicle saved.'); reload(); }} />}
    </>
  );
}

/* ------------------------------------------------------------------ live map and auto-route */
export function MapPage({ ctx }) {
  const { vehicles, vehId, setVehId, go, notify, reload } = ctx;
  const v = vehicles.find((x) => x.id === vehId);
  const [me, setMe] = useState(null);
  const [watch, setWatch] = useState(false);
  const [route, setRoute] = useState(null);
  const [focus, setFocus] = useState(null);
  const [busy, setBusy] = useState(false);
  const watchId = useRef(null);
  const lastPost = useRef(0);
  const origin = me || (v ? [v.lat, v.lng] : null);
  const [want] = useState(ctx.nav?.route || '');
  const near = useLoad(() => (v ? api(`/api/me/nearby?vehicle_id=${v.id}&lat=${origin[0]}&lng=${origin[1]}${want ? `&include=${want}` : ''}`) : Promise.resolve([])), [v?.id, origin?.[0]?.toFixed(3), origin?.[1]?.toFixed(3)], 12000);

  useEffect(() => () => { if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current); }, []);
  useEffect(() => { setRoute(null); }, [vehId]);

  const startWatch = () => {
    if (!navigator.geolocation) return notify('This browser has no GPS support.', 'error');
    setWatch(true);
    let first = true;
    watchId.current = navigator.geolocation.watchPosition((p) => {
      const pos = [p.coords.latitude, p.coords.longitude];
      setMe(pos);
      if (first) { setFocus({ key: 'me-' + Date.now(), center: pos, zoom: 14 }); }
      if (v && Date.now() - lastPost.current > 6000) {
        lastPost.current = Date.now();
        api(`/api/me/vehicles/${v.id}/telemetry`, { method: 'POST', body: { lat: pos[0], lng: pos[1], reposition: first } }).then(reload).catch(() => {});
      }
      first = false;
    }, () => { setWatch(false); notify('Location permission was denied or unavailable.', 'error'); }, { enableHighAccuracy: true, maximumAge: 5000 });
  };
  const stopWatch = () => { if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current); watchId.current = null; setWatch(false); };

  const autoRoute = async () => {
    setBusy(true);
    try {
      const pl = await api(`/api/me/vehicles/${v.id}/plan?target=80`);
      if (!pl.options.length) { notify(pl.message || 'No station found.', 'error'); return; }
      const o = pl.options[0];
      const r = await roadRoute(origin, [o.lat, o.lng]);
      setRoute({ ...r, option: o, baseline: pl.baseline });
      setFocus({ key: 'route-' + Date.now(), bounds: r.points });
    } catch (e) { notify(e.message, 'error'); } finally { setBusy(false); }
  };

  // Route to any station the customer picks, not only the recommended one.
  const routeTo = async (st) => {
    setBusy(true);
    try {
      const r = await roadRoute(origin, [st.lat, st.lng]);
      setRoute({ ...r, manual: true, station: st });
      setFocus({ key: 'route-' + Date.now(), bounds: r.points });
    } catch (e) { notify(e.message, 'error'); } finally { setBusy(false); }
  };
  const wanted = useRef(false);
  useEffect(() => {
    if (!want || wanted.current || !near.data) return;
    const st = near.data.find((x) => x.id === want);
    wanted.current = true;
    if (st) routeTo(st);
    ctx.clearNav();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near.data]);

  if (!vehicles.length) return <><PageHead title="Live map and route" /><NoVehicle go={go} /></>;
  const mine = vehicles.map((x) => (x.id === v?.id && me ? { ...x, lat: x.lat, lng: x.lng } : x));
  const o = route?.option;
  return (
    <>
      <PageHead title="Live map and route" sub="Only your own vehicles and routes appear here. Station loads are shared, personal data is not." actions={<>
        <VehiclePicker vehicles={vehicles} vehId={vehId} setVehId={setVehId} />
        {watch ? <button className="btn btn-danger" onClick={stopWatch}><Square size={14} /> Stop GPS</button> : <button className="btn" onClick={startWatch}><LocateFixed size={15} /> Use live GPS</button>}
        <button className="btn btn-primary" onClick={autoRoute} disabled={busy}><Navigation size={15} /> {busy ? 'Planning' : 'Auto-route to best station'}</button>
      </>} />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Glass edge className="overflow-hidden p-2">
          <MapView stations={near.data || []} vehicles={mine} selectedVehicle={vehId} me={me} route={route?.points} focus={focus} height={600} onRoute={routeTo} />
          <Legend />
        </Glass>
        <div className="grid content-start gap-4">
          {o && (
            <Glass tint="orange" edge className="p-5">
              <div className="flex items-center justify-between"><Badge tone="orange">Auto-route</Badge><span className="text-xs text-[var(--muted)]">{route.road ? 'Road route (OSRM)' : 'Straight line, road route unavailable'}</span></div>
              <h3 className="mt-2 text-xl font-semibold">{o.station_name}</h3>
              <p className="mt-1 text-sm text-[var(--muted)]">{o.reason}</p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="glass p-2"><div className="num text-lg">{fmt(route.km ?? o.distance_km)}</div><div className="text-[11px] text-[var(--muted)]">km</div></div>
                <div className="glass p-2"><div className="num text-lg">{fmt(route.min ?? o.travel_min, 0)}</div><div className="text-[11px] text-[var(--muted)]">min</div></div>
                <div className="glass p-2"><div className="num text-lg">{fmt(o.soc_arrival, 0)}%</div><div className="text-[11px] text-[var(--muted)]">on arrival</div></div>
              </div>
              <p className="mt-3 text-xs text-[var(--muted)]">{route.baseline?.station_name === o.station_name ? 'This is also the nearest station.' : `Nearest is ${route.baseline?.station_name}, but it is busier or less suitable at that time.`}</p>
              <button className="btn btn-primary mt-3 w-full" onClick={() => go('slots', { station: o.station_id })}><CalendarClock size={15} /> Reserve a slot here</button>
              <p className="mt-2 text-[11px] text-[var(--muted)]">Want a different station? Press Route on any station below, or tap a station on the map.</p>
            </Glass>
          )}
          {route?.manual && (() => {
            const st = route.station;
            const ok = st.reachable && st.compatible;
            return (
              <Glass tint="blue" edge className="p-5">
                <div className="flex items-center justify-between"><Badge tone="blue">Your choice</Badge><span className="text-xs text-[var(--muted)]">{route.road ? 'Road route (OSRM)' : 'Straight line, road route unavailable'}</span></div>
                <h3 className="mt-2 text-xl font-semibold">{st.name}</h3>
                <p className="mt-1 text-sm text-[var(--muted)]">{st.power_type} up to {st.max_kw} kW, {st.free_bays} of {st.bays} bays free now, {st.queue_min} min queue.</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="glass p-2"><div className="num text-lg">{fmt(route.km ?? st.distance_km)}</div><div className="text-[11px] text-[var(--muted)]">km</div></div>
                  <div className="glass p-2"><div className="num text-lg">{route.min != null ? fmt(route.min, 0) : '-'}</div><div className="text-[11px] text-[var(--muted)]">min</div></div>
                  <div className="glass p-2"><div className="num text-lg">{fmt(st.soc_on_arrival, 0)}%</div><div className="text-[11px] text-[var(--muted)]">on arrival</div></div>
                </div>
                {!ok && <p className="mt-3 text-xs text-[#ffb4ad]">{!st.compatible ? 'This station does not have your connector.' : 'You may not reach this station with the current charge.'}</p>}
                <div className="mt-3 grid gap-2">
                  <button className="btn btn-primary" disabled={!ok} onClick={() => go('slots', { station: st.id })}><CalendarClock size={15} /> Reserve a slot here</button>
                  <button className="btn" onClick={autoRoute} disabled={busy}><Navigation size={15} /> Back to the recommended station</button>
                </div>
              </Glass>
            );
          })()}
          <Glass className="p-4">
            <h3 className="mb-2 font-semibold">Nearby stations for {v?.plate}</h3>
            {!near.data ? <Skeleton h={160} /> : (
              <ul className="grid gap-2">
                {near.data.slice(0, 6).map((s) => (
                  <li key={s.id} className="glass flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0"><div className="truncate text-sm font-semibold">{s.name}</div>
                      <div className="text-xs text-[var(--muted)]">{s.distance_km} km - arrive with {s.soc_on_arrival}% - {s.free_bays} of {s.bays} bays free</div></div>
                    <div className="flex flex-col items-end gap-1"><Badge tone={s.reachable && s.compatible ? 'green' : 'red'}>{!s.compatible ? 'Wrong connector' : s.reachable ? 'Reachable' : 'Too far'}</Badge><span className="text-[11px] text-[var(--muted)]">{s.queue_min} min queue</span><button className="btn btn-sm" onClick={() => routeTo(s)} disabled={busy}><Route size={12} /> Route</button></div>
                  </li>
                ))}
              </ul>
            )}
          </Glass>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ slot booking */
export function Slots({ ctx }) {
  const { vehicles, vehId, setVehId, go, notify, reload } = ctx;
  const v = vehicles.find((x) => x.id === vehId);
  const [form, setForm] = useState({ target: 80, need_km: 0, pref: 'balanced' });
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [station, setStation] = useState(ctx.nav?.station || '');
  const books = useLoad(() => api('/api/me/bookings'), [], 15000);
  const stations = useLoad(() => (v ? api(`/api/me/nearby?vehicle_id=${v.id}`) : Promise.resolve([])), [v?.id]);
  useEffect(() => { setRes(null); }, [vehId]);
  const find = async (e) => {
    e?.preventDefault(); setBusy(true);
    try { setRes(await api(`/api/me/vehicles/${v.id}/plan?target=${form.target}&need_km=${form.need_km || 0}&pref=${form.pref}${station ? `&station_id=${station}` : ''}`)); }
    catch (x) { notify(x.message, 'error'); } finally { setBusy(false); }
  };
  useEffect(() => { if (ctx.nav?.station && v) { find(); ctx.clearNav(); } /* eslint-disable-next-line */ }, [v?.id]);
  const book = async (o) => {
    try {
      await api('/api/me/bookings', { method: 'POST', body: { vehicle_id: v.id, station_id: o.station_id, slot_start: o.slot_start, charge_to: form.target, need_km: form.need_km, pref: form.pref } });
      notify(`Booked ${o.station_name} at ${hhmm(o.slot_start)}.`); setRes(null); books.reload(); reload();
    } catch (x) { notify(x.message, 'error'); find(); }
  };
  const act = async (b, what) => {
    try { await api(`/api/me/bookings/${b.id}/${what}`, { method: 'POST' }); notify(what === 'cancel' ? 'Booking cancelled.' : 'Charge recorded.'); books.reload(); reload(); }
    catch (x) { notify(x.message, 'error'); }
  };
  if (!vehicles.length) return <><PageHead title="Slot booking" /><NoVehicle go={go} /></>;
  return (
    <>
      <PageHead title="Slot booking" sub="Slots depend on your charge level, the distance to each station, the time of day and how busy each station will be." actions={<VehiclePicker vehicles={vehicles} vehId={vehId} setVehId={setVehId} />} />
      <Glass edge className="p-5">
        <form onSubmit={find} className="grid items-end gap-4 md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
          <Field label={`Charge to ${form.target}%`} hint={`Now at ${Math.round(v.soc)}%`}><input type="range" min="30" max="100" step="5" value={form.target} onChange={(e) => setForm({ ...form, target: Number(e.target.value) })} className="w-full accent-[var(--orange)]" /></Field>
          <Field label="Distance you need to drive after (km)" hint="Optional. Raises the target if needed."><input className="input" type="number" min="0" value={form.need_km} onChange={(e) => setForm({ ...form, need_km: e.target.value })} /></Field>
          <Field label="Station" hint="Leave on best match, or choose where you want to go.">
            <select className="select" value={station} onChange={(e) => { setStation(e.target.value); setRes(null); }}>
              <option value="">Best match (recommended)</option>
              {(stations.data || []).filter((x) => x.compatible && x.status === 'online').map((x) => <option key={x.id} value={x.id} disabled={!x.reachable}>{x.name} - {x.distance_km} km{x.reachable ? '' : ' (too far)'}</option>)}
            </select>
          </Field>
          <Field label="Priority"><select className="select" value={form.pref} onChange={(e) => setForm({ ...form, pref: e.target.value })}><option value="balanced">Balanced</option><option value="fastest">Fastest</option><option value="cheapest">Lowest fee</option></select></Field>
          <button className="btn btn-primary" disabled={busy}><Zap size={15} /> {busy ? 'Searching' : 'Find slots'}</button>
        </form>
        {v.vclass === 'truck' && <p className="mt-3 text-xs text-[var(--orange)]">Heavy freight is kept out of the 08:00 to 11:00 and 17:00 to 21:00 windows unless the battery is low.</p>}
      </Glass>
      {res && (
        <Glass className="mt-4 overflow-hidden">
          <div className="p-4 pb-2"><h3 className="text-lg font-semibold">{station ? `Slots at ${(stations.data || []).find((x) => x.id === station)?.name || 'this station'}` : 'Suggested slots'}</h3>
            {res.notes?.map((n) => <p key={n} className="text-xs text-[var(--orange)]">{n}</p>)}
            {!res.options.length && <p className="mt-2 text-sm text-[var(--muted)]">{res.message}</p>}</div>
          {res.options.length > 0 && (
            <div className="overflow-x-auto"><table className="t">
              <thead><tr><th>Station</th><th>Slot</th><th>Travel</th><th>Arrive with</th><th>Charge time</th><th>Fee</th><th /></tr></thead>
              <tbody>{res.options.map((o) => (
                <tr key={o.station_id + o.slot_start}>
                  <td><div className="font-semibold">{o.station_name}</div><div className="mt-1 flex flex-wrap gap-1">{o.tags.map((t) => <Badge key={t} tone={t === 'Recommended' ? 'orange' : t === 'Lowest fee' ? 'green' : 'blue'}>{t}</Badge>)}</div><div className="mt-1 max-w-[340px] text-[11px] text-[var(--muted)]">{o.reason}</div></td>
                  <td className="num">{hhmm(o.slot_start)} to {hhmm(o.slot_end)}</td>
                  <td className="num">{o.distance_km} km, {o.travel_min} min</td>
                  <td className="num">{fmt(o.soc_arrival, 0)}%</td>
                  <td className="num">{o.charge_min} min at {fmt(o.power_kw, 0)} kW</td>
                  <td className="num">{inr(o.fee.total_inr)}<div className="text-[11px] text-[var(--muted)]">{fmt(o.kwh)} kWh x {inr(o.fee.tariff_inr_kwh)}{o.fee.time_of_day_multiplier !== 1 ? ` x ${o.fee.time_of_day_multiplier}` : ''}</div></td>
                  <td className="whitespace-nowrap"><button className="btn btn-sm mr-1" onClick={() => go('map', { route: o.station_id })}><Route size={12} /> Route</button><button className="btn btn-sm btn-primary" onClick={() => book(o)}>Book</button></td>
                </tr>))}</tbody></table></div>
          )}
          <p className="px-4 py-3 text-[11px] text-[var(--muted)]">Fees are estimates excluding taxes. Time-of-day multipliers are an assumption and can be changed in the backend config.</p>
        </Glass>
      )}
      <Glass className="mt-4 overflow-hidden">
        <div className="p-4 pb-2"><h3 className="text-lg font-semibold">My bookings</h3></div>
        {!books.data ? <div className="p-4"><Skeleton h={100} /></div> : !books.data.length ? <Empty title="No bookings yet" text="Find a slot above to reserve your first bay." /> : (
          <div className="overflow-x-auto"><table className="t"><thead><tr><th>Booking</th><th>Vehicle</th><th>Station</th><th>Slot</th><th>Fee</th><th>Status</th><th /></tr></thead>
            <tbody>{books.data.map((b) => (
              <tr key={b.id}><td className="num">{b.id}</td><td className="num">{b.plate}</td><td>{b.station_name}</td><td className="num">{stamp(b.slot_start)} to {hhmm(b.slot_end)}</td><td className="num">{inr(b.fee.total_inr)}</td>
                <td><Badge tone={b.status === 'confirmed' ? 'green' : b.status === 'operator-overridden' ? 'orange' : b.status === 'cancelled' ? 'red' : 'blue'}>{b.status === 'operator-overridden' ? 'Changed by operator' : b.status}</Badge></td>
                <td className="whitespace-nowrap">{(b.status === 'confirmed' || b.status === 'operator-overridden') && <><button className="btn btn-sm mr-1" onClick={() => act(b, 'complete')}>Mark charged</button><button className="btn btn-sm btn-danger" onClick={() => act(b, 'cancel')}>Cancel</button></>}</td></tr>))}</tbody></table></div>
        )}
      </Glass>
    </>
  );
}

/* ------------------------------------------------------------------ live battery monitor */
export function Battery({ ctx }) {
  const { vehicles, vehId, setVehId, go, notify, reload } = ctx;
  const v = vehicles.find((x) => x.id === vehId);
  const bat = useLoad(() => (vehId ? api(`/api/me/vehicles/${vehId}/battery`) : Promise.resolve(null)), [vehId], 5000);
  const [driving, setDriving] = useState(false);
  const [trail, setTrail] = useState(null);
  const [pos, setPos] = useState(null);
  const timer = useRef(null);
  const vref = useRef(v); vref.current = v;
  useEffect(() => () => clearInterval(timer.current), []);
  useEffect(() => { stop(); setTrail(null); setPos(null); /* eslint-disable-next-line */ }, [vehId]);

  const stop = () => { clearInterval(timer.current); setDriving(false); };
  const startDrive = async () => {
    const target = (bat.data?.nearest || []).find((n) => n.reachable && n.status === 'online') || bat.data?.nearest?.[0];
    if (!target) return notify('No station to drive to.', 'error');
    const r = await roadRoute([v.lat, v.lng], [target.lat, target.lng]);
    setTrail(r.points);
    const total = length(r.points);
    let done = 0;
    setDriving(true);
    // Demo drive: each tick covers 0.5 km. Real use would send GPS fixes from the phone instead.
    timer.current = setInterval(async () => {
      done += 0.5;
      const { pos: p, done: end } = pointAlong(r.points, Math.min(done, total));
      setPos(p);
      try { await api(`/api/me/vehicles/${vref.current.id}/telemetry`, { method: 'POST', body: { lat: p[0], lng: p[1] } }); reload(); bat.reload(); } catch { stop(); }
      if (end || done >= total) { stop(); notify(`Reached ${target.name}.`); }
    }, 1500);
  };
  const b = bat.data;
  const [level, setLevel] = useState('');
  const saveLevel = async (e) => {
    e.preventDefault();
    try { await api(`/api/me/vehicles/${v.id}`, { method: 'PATCH', body: { soc: Number(level) } }); setLevel(''); notify('Charge level updated.'); reload(); bat.reload(); } catch (x) { notify(x.message, 'error'); }
  };
  if (!vehicles.length) return <><PageHead title="Battery monitor" /><NoVehicle go={go} /></>;
  return (
    <>
      <PageHead title="Battery monitor" sub="Charge level, range and the nearest power points, refreshed every few seconds. Estimates come from stored charge, health and Wh/km, not from the vehicle's BMS." actions={<VehiclePicker vehicles={vehicles} vehId={vehId} setVehId={setVehId} />} />
      {b && ['low', 'critical'].includes(b.level) && (
        <Glass className="mb-4 flex items-start gap-3 p-4" style={{ borderColor: 'rgba(229,100,90,.7)', background: 'rgba(229,100,90,.14)' }} role="alert">
          <AlertTriangle className="mt-0.5 shrink-0 text-[#ffb4ad]" size={20} />
          <div><b>{b.level === 'critical' ? 'Critical battery.' : 'Low battery.'}</b> <span className="text-sm">{b.message}</span></div>
        </Glass>
      )}
      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <Glass edge stripe className="grid content-start justify-items-center p-6">
          {!b ? <Skeleton h={260} /> : (
            <>
              <Ring value={b.soc} level={b.level} size={230}>
                <div className="big-num text-7xl">{Math.round(b.soc)}<span className="text-3xl">%</span></div>
                <div className="mt-1 text-xs text-[var(--muted)]">{v.make} {v.model}</div>
              </Ring>
              <div className="mt-5 grid w-full grid-cols-2 gap-3 text-center">
                <div className="glass p-3"><div className="big-num text-4xl">{fmt(b.range_km, 0)}</div><div className="text-xs text-[var(--muted)]">km total range</div></div>
                <div className="glass tint-orange p-3"><div className="big-num text-4xl">{fmt(b.safe_range_km, 0)}</div><div className="text-xs text-[var(--muted)]">km before {b.reserve_pct}% reserve</div></div>
              </div>
              <p className="mt-4 text-sm text-[var(--muted)]">{b.message}</p>
              <div className="mt-4 flex w-full gap-2">
                {driving ? <button className="btn btn-danger flex-1" onClick={stop}><Square size={14} /> Stop demo drive</button> : <button className="btn btn-primary flex-1" onClick={startDrive}><Play size={14} /> Start demo drive</button>}
                <button className="btn flex-1" onClick={() => go('slots')}><CalendarClock size={14} /> Book</button>
              </div>
              <form onSubmit={saveLevel} className="mt-3 flex w-full gap-2"><input className="input" type="number" min="0" max="100" required placeholder="Charge shown on your dashboard (%)" value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Charge level" /><button className="btn">Update</button></form>
              <p className="mt-2 text-[11px] text-[var(--muted)]">The demo drive moves the vehicle along the road to the nearest station and drains the battery as it goes.</p>
            </>
          )}
        </Glass>
        <div className="grid gap-4">
          <Glass className="overflow-hidden p-2"><MapView stations={(b?.nearest || []).map((n) => ({ id: n.station_id, name: n.name, lat: n.lat, lng: n.lng, power_type: n.power_type, status: n.status, utilization: 1 - n.free_bays / n.bays, occupied: n.bays - n.free_bays, bays: n.bays, queue_min: n.queue_min, max_kw: n.max_kw, tariff_inr_kwh: '-', distance_km: n.distance_km, soc_on_arrival: n.soc_on_arrival }))} vehicles={[{ ...v, lat: pos ? pos[0] : v.lat, lng: pos ? pos[1] : v.lng }]} selectedVehicle={v.id} route={trail} routeColor="#35b982" focus={b ? { key: 'bat-' + vehId, center: [v.lat, v.lng], zoom: 13 } : null} height={330} /></Glass>
          <Glass className="overflow-hidden">
            <div className="p-4 pb-2"><h3 className="text-lg font-semibold">Nearest power points</h3></div>
            {!b ? <div className="p-4"><Skeleton h={120} /></div> : (
              <div className="overflow-x-auto"><table className="t"><thead><tr><th>Station</th><th>Distance</th><th>Arrive with</th><th>Free bays</th><th>Queue</th><th>Status</th></tr></thead>
                <tbody>{b.nearest.map((n) => (<tr key={n.station_id}><td><b>{n.name}</b><div className="text-[11px] text-[var(--muted)]">{n.power_type}, up to {n.max_kw} kW</div></td><td className="num">{n.distance_km} km</td><td className="num">{n.soc_on_arrival}%</td><td className="num">{n.free_bays}/{n.bays}</td><td className="num">{n.queue_min} min</td><td><Badge tone={n.reachable ? 'green' : 'red'}>{n.reachable ? 'Reachable' : 'Out of range'}</Badge></td></tr>))}</tbody></table></div>
            )}
          </Glass>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ personal impact */
export function Impact({ ctx }) {
  const imp = useLoad(() => api('/api/me/impact'), [], 20000);
  const d = imp.data;
  if (!d) return <><PageHead title="My impact" /><Skeleton h={260} /></>;
  const compare = [{ name: 'Petrol or diesel equivalent', kg: d.co2_ice_kg }, { name: 'Your EVs on grid power', kg: d.co2_ev_kg }];
  const byClass = Object.entries(d.km_by_class).map(([k, x]) => ({ name: CLASS_NAME[k], km: x }));
  return (
    <>
      <PageHead title="My impact" sub="Figures for your own vehicles and bookings only. They grow as you drive and charge." actions={<button className="btn" onClick={() => window.print()}>Print report</button>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Fuel saved" value={fmt(d.fuel_saved_l, 0)} unit="litres" tone="orange" icon={Fuel} note={`over ${fmt(d.tracked_km, 0)} km tracked`} />
        <Stat label="CO2 reduced" value={fmt(d.co2_saved_kg, 0)} unit="kg" tone="green" icon={Leaf} note="against equivalent fuel vehicles" />
        <Stat label="Average delay" value={fmt(d.avg_delay_min)} unit="min" tone="blue" icon={Clock} note="expected queue left after booking" />
        <Stat label="Time saved by smart slots" value={fmt(d.time_saved_min, 0)} unit="min" tone="orange" icon={Gauge} note={`${d.redirected_sessions} of ${d.bookings} sessions redirected`} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Glass className="p-5"><h3 className="mb-3 text-lg font-semibold">CO2 comparison (kg)</h3><div className="h-[240px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={compare} margin={{ left: -10 }}><CartesianGrid stroke="rgba(255,255,255,.08)" vertical={false} /><XAxis dataKey="name" tick={tick} tickLine={false} axisLine={false} /><YAxis tick={tick} tickLine={false} axisLine={false} /><Tooltip contentStyle={tip} /><Bar dataKey="kg" radius={[8, 8, 0, 0]} maxBarSize={80} fill="#35b982" /></BarChart></ResponsiveContainer></div></Glass>
        <Glass className="p-5"><h3 className="mb-3 text-lg font-semibold">Distance by vehicle type (km)</h3><div className="h-[240px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={byClass} margin={{ left: -10 }}><CartesianGrid stroke="rgba(255,255,255,.08)" vertical={false} /><XAxis dataKey="name" tick={tick} tickLine={false} axisLine={false} /><YAxis tick={tick} tickLine={false} axisLine={false} /><Tooltip contentStyle={tip} /><Bar dataKey="km" radius={[8, 8, 0, 0]} maxBarSize={80} fill="#3f7cf0" /></BarChart></ResponsiveContainer></div></Glass>
      </div>
      <Glass tint="blue" className="mt-4 p-5 text-sm"><h3 className="mb-2 font-semibold">How these numbers are worked out</h3><p>{d.method.co2}</p><p className="mt-2">{d.method.delay}</p><p className="mt-2 text-[var(--muted)]">Charging so far: {fmt(d.ev_energy_kwh, 0)} kWh used, {d.offpeak_sessions} sessions outside peak hours, {inr(d.fees_inr)} in estimated fees.</p></Glass>
    </>
  );
}


/* ------------------------------------------------------------------ help and support (customer side) */
export function CustomerSupport({ ctx }) {
  const { vehicles, notify } = ctx;
  const tk = useLoad(() => api('/api/me/support'), [], 15000);
  const [f, setF] = useState({ category: 'other', subject: '', details: '', vehicle_id: '' });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState('');
  const send = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api('/api/me/support', { method: 'POST', body: f }); setF({ category: 'other', subject: '', details: '', vehicle_id: '' }); notify('Request sent. The support team will reply here.'); tk.reload(); }
    catch (x) { notify(x.message, 'error'); } finally { setBusy(false); }
  };
  const reply = async (t) => {
    try { const r = await api(`/api/me/support/${t.id}/reply`, { method: 'POST', body: { text: msg } }); setMsg(''); setOpen(r.id); tk.reload(); }
    catch (x) { notify(x.message, 'error'); }
  };
  const tone = (s) => (s === 'resolved' ? 'green' : s === 'in_progress' ? 'orange' : 'blue');
  return (
    <>
      <PageHead title="Help and support" sub="Tell us about a problem with a booking, a station, your battery estimate or your account. Only you and the support team can see your requests." />
      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <Glass edge className="p-5">
          <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold"><LifeBuoy size={18} /> New request</h3>
          <form onSubmit={send} className="grid gap-3">
            <Field label="What is it about?"><select className="select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{[['battery', 'Battery or range'], ['station', 'A charging station'], ['booking', 'A booking'], ['account', 'My account'], ['other', 'Something else']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            {vehicles.length > 0 && <Field label="Vehicle (optional)"><select className="select" value={f.vehicle_id} onChange={(e) => setF({ ...f, vehicle_id: e.target.value })}><option value="">Not about one vehicle</option>{vehicles.map((x) => <option key={x.id} value={x.id}>{x.plate} - {x.name}</option>)}</select></Field>}
            <Field label="Subject"><input className="input" required minLength="4" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
            <Field label="Describe the problem" hint="A sentence or two is enough."><textarea className="input" rows="4" required minLength="10" value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} /></Field>
            <button className="btn btn-primary" disabled={busy}><Send size={15} /> Send request</button>
          </form>
          <p className="mt-3 text-[11px] text-[var(--muted)]">If your battery is critical, the system also alerts the support team on its own.</p>
        </Glass>
        <Glass className="overflow-hidden">
          <div className="p-4 pb-2"><h3 className="text-lg font-semibold">My requests</h3></div>
          {!tk.data ? <div className="p-4"><Skeleton h={120} /></div> : !tk.data.length ? <Empty title="No requests yet" text="Requests you send, and the replies you get, appear here." /> : (
            <ul className="grid gap-3 p-4 pt-1">
              {tk.data.map((t) => (
                <li key={t.id} className="glass p-4">
                  <button className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen(open === t.id ? null : t.id)}>
                    <div><div className="font-semibold">{t.subject}</div><div className="text-xs text-[var(--muted)]">{t.id} - {stamp(t.created_at)}{t.plate ? ` - ${t.plate}` : ''}</div></div>
                    <Badge tone={tone(t.status)}>{t.status.replace('_', ' ')}</Badge>
                  </button>
                  {open === t.id && (
                    <div className="mt-3 grid gap-2 text-sm">
                      <p className="text-[var(--muted)]">{t.details}</p>
                      {t.replies.map((r, i) => (
                        <div key={i} className={`glass p-3 ${r.from === 'support' ? 'tint-green' : ''}`}><div>{r.text}</div><div className="mt-1 text-[11px] text-[var(--muted)]">{r.by}, {stamp(r.time)}</div></div>
                      ))}
                      <div className="flex gap-2"><input className="input" placeholder="Write a message" value={msg} onChange={(e) => setMsg(e.target.value)} /><button className="btn" disabled={!msg.trim()} onClick={() => reply(t)}>Send</button></div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Glass>
      </div>
    </>
  );
}
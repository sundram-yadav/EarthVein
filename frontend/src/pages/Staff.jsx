import React, { useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, BatteryWarning, CalendarClock, Car, Flame, LifeBuoy, Plus, Search, Users, Wrench } from 'lucide-react';
import { api } from '../api';
import { useLoad } from '../hooks';
import MapView, { Legend } from '../components/MapView';
import { Badge, CLASS_NAME, Empty, Field, Glass, Modal, PageHead, Skeleton, Stat, fmt, hhmm, inr, pressureTone, stamp } from '../components/ui';

const tick = { fontSize: 11, fill: '#98a6c0' };
const tip = { background: 'rgba(14,23,48,.95)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 12, fontSize: 12, color: '#e9eef8' };
const bookingTone = (s) => (s === 'confirmed' ? 'green' : s === 'operator-overridden' ? 'orange' : s === 'cancelled' ? 'red' : 'blue');

export function Ops({ ctx }) {
  const { notify, meta, refreshMeta } = ctx;
  const ov = useLoad(() => api('/api/staff/overview'), [], 10000);
  const st = useLoad(() => api('/api/stations'), [], 10000);
  const [city, setCity] = useState('delhi');
  const fc = useLoad(() => api(`/api/forecast/city?city=${city}`), [city]);
  const d = ov.data;
  const toggleRush = async () => { try { await api('/api/staff/scenario', { method: 'POST', body: { rush: !d.rush } }); ov.reload(); st.reload(); refreshMeta(); notify(d.rush ? 'Rush-hour scenario switched off.' : 'Rush-hour scenario on: replayed demand is 35 percent higher.'); } catch (e) { notify(e.message, 'error'); } };
  const setStatus = async (s) => { try { await api(`/api/staff/stations/${s.id}/status`, { method: 'POST', body: { status: s.status === 'online' ? 'maintenance' : 'online' } }); st.reload(); ov.reload(); } catch (e) { notify(e.message, 'error'); } };
  return (
    <>
      <PageHead title="Operations overview" sub="Network state, registered fleet and the support queue." actions={d && <button className={`btn ${d.rush ? 'btn-danger' : ''}`} onClick={toggleRush}><Flame size={15} /> {d.rush ? 'Switch off rush hour' : 'Simulate rush hour'}</button>} />
      {!d ? <Skeleton h={160} /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Registered vehicles" value={d.vehicles} tone="blue" icon={Car} note={`${d.customers} customers`} />
          <Stat label="Network utilization" value={fmt(d.network_utilization, 0)} unit="%" tone="green" icon={Activity} note={d.high_pressure.length ? `High: ${d.high_pressure.slice(0, 2).join(', ')}` : 'No station under high pressure'} />
          <Stat label="Upcoming bookings" value={d.upcoming} tone="orange" icon={CalendarClock} note={`${d.bookings_today} today`} />
          <Stat label="Open support tickets" value={d.open_tickets} tone="orange" icon={LifeBuoy} note={`${d.low_battery} vehicles at 20% or lower`} />
        </div>
      )}
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Glass className="overflow-hidden">
          <div className="p-4 pb-2"><h3 className="text-lg font-semibold">Stations</h3><p className="text-xs text-[var(--muted)]">Occupancy follows replayed real charger data. Switch a station to maintenance to take it out of allocation.</p></div>
          {!st.data ? <div className="p-4"><Skeleton h={200} /></div> : (
            <div className="max-h-[420px] overflow-auto"><table className="t"><thead><tr><th>Station</th><th>Type</th><th>Bays</th><th>Queue</th><th>Pressure</th><th /></tr></thead>
              <tbody>{st.data.map((s) => (<tr key={s.id}><td><b>{s.name}</b><div className="text-[11px] text-[var(--muted)]">{s.city === 'delhi' ? 'Delhi NCR' : 'Bengaluru'}</div></td><td>{s.power_type}</td>
                <td><div className="bar-track w-24"><div className="bar-fill" style={{ width: `${s.utilization * 100}%`, background: s.utilization >= 0.8 ? 'var(--red)' : s.utilization >= 0.5 ? 'var(--orange)' : 'var(--green)' }} /></div><span className="num text-[11px] text-[var(--muted)]">{s.occupied}/{s.bays}</span></td>
                <td className="num">{s.queue_min} min</td><td>{s.status === 'online' ? <Badge tone={pressureTone(s.pressure)}>{s.pressure}</Badge> : <Badge tone="red">Maintenance</Badge>}</td>
                <td><button className="btn btn-sm" onClick={() => setStatus(s)}><Wrench size={12} /> {s.status === 'online' ? 'Maintenance' : 'Bring online'}</button></td></tr>))}</tbody></table></div>
          )}
        </Glass>
        <Glass className="p-5">
          <div className="flex items-start justify-between"><div><h3 className="text-lg font-semibold">24 hour demand forecast</h3><p className="text-xs text-[var(--muted)]">Average predicted utilization across the city's stations.</p></div>
            <select className="select !w-auto" value={city} onChange={(e) => setCity(e.target.value)}><option value="delhi">Delhi NCR</option><option value="bengaluru">Bengaluru</option></select></div>
          <div className="mt-3 h-[300px]">{!fc.data ? <Skeleton h={300} /> : (
            <ResponsiveContainer width="100%" height="100%"><AreaChart data={fc.data.forecast.map((x) => ({ ...x, pct: Math.round(x.utilization * 100) }))} margin={{ left: -18, top: 8 }}>
              <defs><linearGradient id="g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3f7cf0" stopOpacity=".6" /><stop offset="100%" stopColor="#3f7cf0" stopOpacity="0" /></linearGradient></defs>
              <CartesianGrid stroke="rgba(255,255,255,.08)" vertical={false} /><XAxis dataKey="hour" tick={tick} tickLine={false} axisLine={false} interval={2} /><YAxis tick={tick} tickLine={false} axisLine={false} unit="%" /><Tooltip contentStyle={tip} formatter={(x) => [`${x}%`, 'Utilization']} /><Area dataKey="pct" stroke="#3f7cf0" strokeWidth={2.5} fill="url(#g2)" /></AreaChart></ResponsiveContainer>)}</div>
        </Glass>
      </div>
    </>
  );
}

export function Registry({ ctx }) {
  const vs = useLoad(() => api('/api/staff/vehicles'), [], 20000);
  const [q, setQ] = useState('');
  const [cls, setCls] = useState('all');
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const rows = (vs.data || []).filter((v) => (cls === 'all' || v.vclass === cls) && `${v.plate} ${v.owner} ${v.make} ${v.model}`.toLowerCase().includes(q.toLowerCase()));
  const show = async (v) => { setOpen(v); setDetail(null); try { setDetail(await api(`/api/staff/vehicles/${v.id}`)); } catch { setDetail({ error: true }); } };
  return (
    <>
      <PageHead title="Vehicle registry" sub="Every registered vehicle. Opening a record is written to the audit log. Position is shown at about 100 m accuracy and contact details are masked for the control panel." />
      <Glass className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" /><input className="input !pl-9" placeholder="Search plate, owner, model" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select className="select !w-auto" value={cls} onChange={(e) => setCls(e.target.value)}><option value="all">All types</option>{Object.entries(CLASS_NAME).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <span className="text-xs text-[var(--muted)]">{rows.length} of {vs.data?.length || 0} vehicles</span>
        </div>
        {!vs.data ? <div className="p-4"><Skeleton h={200} /></div> : (
          <div className="max-h-[640px] overflow-auto"><table className="t"><thead><tr><th>Vehicle</th><th>Owner</th><th>Type</th><th>Battery</th><th>Charge</th><th>City</th><th>Last seen</th></tr></thead>
            <tbody>{rows.map((v) => (<tr key={v.id} className="cursor-pointer" onClick={() => show(v)}><td><b className="num">{v.plate}</b><div className="text-[11px] text-[var(--muted)]">{v.make} {v.model}</div></td><td>{v.owner}<div className="text-[11px] text-[var(--muted)]">{v.owner_email}</div></td><td>{CLASS_NAME[v.vclass]}</td><td className="num">{fmt(v.battery_kwh)} kWh, {fmt(v.soh, 0)}%</td>
              <td><Badge tone={v.soc <= 20 ? 'red' : v.soc <= 30 ? 'orange' : 'green'}>{Math.round(v.soc)}%</Badge></td><td>{v.city === 'delhi' ? 'Delhi NCR' : 'Bengaluru'}</td><td className="num text-xs">{stamp(v.last_seen)}</td></tr>))}</tbody></table></div>
        )}
      </Glass>
      {open && (
        <Modal title={`${open.plate} - ${open.owner}`} onClose={() => setOpen(null)} wide>
          {!detail ? <Skeleton h={160} /> : detail.error ? <p>Could not load this record.</p> : (
            <>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{[['Model', `${detail.make} ${detail.model}`], ['Connector', detail.connector], ['Max power', `${detail.max_kw} kW`], ['Health', `${fmt(detail.soh, 0)}%`], ['Charge', `${Math.round(detail.soc)}%`], ['Wh/km', detail.consumption_wh_km], ['Tracked km', fmt(detail.odometer_km, 0)], ['Position', `${detail.lat}, ${detail.lng}`]].map(([k, x]) => <div key={k}><dt className="text-xs text-[var(--muted)]">{k}</dt><dd className="num mt-0.5">{x}</dd></div>)}</dl>
              <h4 className="mb-2 mt-5 font-semibold">Booking history</h4>
              {!detail.bookings.length ? <p className="text-sm text-[var(--muted)]">No bookings.</p> : <table className="t"><thead><tr><th>Booking</th><th>Station</th><th>Slot</th><th>Status</th></tr></thead><tbody>{detail.bookings.map((b) => <tr key={b.id}><td className="num">{b.id}</td><td>{b.station_name}</td><td className="num">{stamp(b.slot_start)}</td><td><Badge tone={bookingTone(b.status)}>{b.status}</Badge></td></tr>)}</tbody></table>}
            </>
          )}
        </Modal>
      )}
    </>
  );
}

export function AllBookings({ ctx }) {
  const { notify } = ctx;
  const bk = useLoad(() => api('/api/staff/bookings'), [], 15000);
  const stations = useLoad(() => api('/api/stations'), [], 20000);
  const [q, setQ] = useState('');
  const [ov, setOv] = useState(null);
  const [f, setF] = useState({ station_id: '', reason: '' });
  const [err, setErr] = useState('');
  const rows = (bk.data || []).filter((b) => `${b.id} ${b.plate} ${b.owner} ${b.station_name}`.toLowerCase().includes(q.toLowerCase()));
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try { const r = await api('/api/staff/override', { method: 'POST', body: { booking_id: ov.id, ...f } }); notify(r.flags?.length ? `Override saved. Flag: ${r.flags.join(', ')}.` : 'Override saved and logged.'); setOv(null); bk.reload(); } catch (x) { setErr(x.message); }
  };
  return (
    <>
      <PageHead title="Slot bookings" sub="Every booking across registered vehicles. AI proposes, a person can override. A reason is required and the change is logged." />
      <Glass className="overflow-hidden">
        <div className="flex items-center gap-3 p-4"><div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" /><input className="input !pl-9" placeholder="Search booking, plate, owner" value={q} onChange={(e) => setQ(e.target.value)} /></div><span className="text-xs text-[var(--muted)]">{rows.length} bookings</span></div>
        {!bk.data ? <div className="p-4"><Skeleton h={200} /></div> : (
          <div className="max-h-[660px] overflow-auto"><table className="t"><thead><tr><th>Booking</th><th>Vehicle</th><th>Owner</th><th>Station</th><th>Slot</th><th>Fee</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((b) => (<tr key={b.id}><td className="num">{b.id}</td><td className="num">{b.plate}</td><td>{b.owner}</td><td>{b.station_name}{b.original_station && <div className="text-[11px] text-[var(--orange)]">was {b.original_station}</div>}</td><td className="num">{stamp(b.slot_start)} to {hhmm(b.slot_end)}</td><td className="num">{inr(b.fee.total_inr)}</td><td><Badge tone={bookingTone(b.status)}>{b.status}</Badge></td>
              <td>{(b.status === 'confirmed' || b.status === 'operator-overridden') && <button className="btn btn-sm" onClick={() => { setOv(b); setF({ station_id: '', reason: '' }); setErr(''); }}>Override</button>}</td></tr>))}</tbody></table></div>
        )}
      </Glass>
      {ov && (
        <Modal title={`Override ${ov.id}`} onClose={() => setOv(null)}>
          <p className="mb-3 text-sm text-[var(--muted)]">{ov.plate} is booked at {ov.station_name}, {stamp(ov.slot_start)}. The AI reason: {ov.reason}</p>
          <form onSubmit={submit} className="grid gap-3">
            <Field label="Move to station"><select className="select" required value={f.station_id} onChange={(e) => setF({ ...f, station_id: e.target.value })}><option value="">Choose a station</option>{(stations.data || []).filter((s) => s.id !== ov.station_id && s.status === 'online').map((s) => <option key={s.id} value={s.id}>{s.name} - {s.free_bays} bays free now</option>)}</select></Field>
            <Field label="Reason (required)" hint="Shown in the audit log."><textarea className="input" rows="3" required minLength="5" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
            {err && <div className="rounded-xl border border-[rgba(229,100,90,.5)] bg-[rgba(229,100,90,.12)] px-3 py-2 text-sm text-[#ffb4ad]" role="alert">{err}</div>}
            <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={() => setOv(null)}>Cancel</button><button className="btn btn-primary">Save override</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function CityMap({ ctx }) {
  const st = useLoad(() => api('/api/stations'), [], 12000);
  const [sel, setSel] = useState(null);
  return (
    <>
      <PageHead title="City network map" sub="Station load only. Individual vehicles are not plotted here." />
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Glass edge className="overflow-hidden p-2"><MapView stations={st.data || []} height={620} onStation={setSel} /><Legend /></Glass>
        <Glass className="p-4"><h3 className="font-semibold">Busiest stations</h3>
          {!st.data ? <Skeleton h={200} /> : <ul className="mt-3 grid gap-2">{[...st.data].sort((a, b) => b.utilization - a.utilization).slice(0, 8).map((s) => (<li key={s.id} className="glass p-3"><div className="flex items-center justify-between"><b className="text-sm">{s.name}</b><Badge tone={pressureTone(s.pressure)}>{Math.round(s.utilization * 100)}%</Badge></div><div className="bar-track mt-2"><div className="bar-fill" style={{ width: `${s.utilization * 100}%`, background: s.utilization >= 0.8 ? 'var(--red)' : s.utilization >= 0.5 ? 'var(--orange)' : 'var(--green)' }} /></div></li>))}</ul>}
          {sel && <p className="mt-3 text-xs text-[var(--muted)]">Selected: {sel.name}</p>}
        </Glass>
      </div>
    </>
  );
}

export function Support({ ctx }) {
  const { notify } = ctx;
  const tk = useLoad(() => api('/api/staff/tickets'), [], 15000);
  const [filter, setFilter] = useState('active');
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(null);
  const [note, setNote] = useState('');
  const [replyText, setReplyText] = useState('');
  const [f, setF] = useState({ subject: '', category: 'other', priority: 'normal', details: '' });
  const rows = (tk.data || []).filter((t) => (filter === 'active' ? t.status !== 'resolved' : filter === 'resolved' ? t.status === 'resolved' : true));
  const update = async (t, body) => { try { const r = await api(`/api/staff/tickets/${t.id}`, { method: 'PATCH', body }); setOpen(r); setNote(''); setReplyText(''); tk.reload(); } catch (e) { notify(e.message, 'error'); } };
  const create = async (e) => { e.preventDefault(); try { await api('/api/staff/tickets', { method: 'POST', body: f }); setAdding(false); setF({ subject: '', category: 'other', priority: 'normal', details: '' }); notify('Ticket created.'); tk.reload(); } catch (x) { notify(x.message, 'error'); } };
  return (
    <>
      <PageHead title="Customer requests" sub="Requests customers send from their Help and support page, plus tickets raised automatically for critical batteries. Reply to the customer or keep internal notes." actions={<button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={15} /> New ticket</button>} />
      <div className="mb-3 flex gap-2">{[['active', 'Active'], ['resolved', 'Resolved'], ['all', 'All']].map(([k, l]) => <button key={k} className={`btn btn-sm ${filter === k ? 'btn-blue' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}</div>
      <Glass className="overflow-hidden">
        {!tk.data ? <div className="p-4"><Skeleton h={160} /></div> : !rows.length ? <Empty title="Nothing here" text="No tickets match this filter." /> : (
          <table className="t"><thead><tr><th>Ticket</th><th>Subject</th><th>Vehicle</th><th>Priority</th><th>Status</th><th>Raised</th></tr></thead>
            <tbody>{rows.map((t) => (<tr key={t.id} className="cursor-pointer" onClick={() => setOpen(t)}><td className="num">{t.id}<div className="text-[11px] text-[var(--muted)]">{t.source === 'system' ? 'Automatic' : t.source === 'customer' ? `From ${t.owner_name || 'customer'}` : 'Staff'}</div></td><td className="max-w-[380px]"><b>{t.subject}</b></td><td className="num">{t.plate || '-'}</td><td><Badge tone={t.priority === 'high' ? 'red' : t.priority === 'normal' ? 'blue' : ''}>{t.priority}</Badge></td><td><Badge tone={t.status === 'resolved' ? 'green' : t.status === 'in_progress' ? 'orange' : 'red'}>{t.status.replace('_', ' ')}</Badge></td><td className="num text-xs">{stamp(t.created_at)}</td></tr>))}</tbody></table>
        )}
      </Glass>
      {adding && (
        <Modal title="New ticket" onClose={() => setAdding(false)}>
          <form onSubmit={create} className="grid gap-3">
            <Field label="Subject"><input className="input" required minLength="4" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3"><Field label="Category"><select className="select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{['battery', 'station', 'booking', 'account', 'other'].map((x) => <option key={x}>{x}</option>)}</select></Field><Field label="Priority"><select className="select" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{['low', 'normal', 'high'].map((x) => <option key={x}>{x}</option>)}</select></Field></div>
            <Field label="Details"><textarea className="input" rows="4" value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} /></Field>
            <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button><button className="btn btn-primary">Create ticket</button></div>
          </form>
        </Modal>
      )}
      {open && (
        <Modal title={`${open.id}: ${open.subject}`} onClose={() => setOpen(null)} wide>
          <p className="text-sm">{open.details || 'No details.'}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--muted)]"><span>{open.category}</span><span>Raised {stamp(open.created_at)}</span>{open.plate && <span>Vehicle {open.plate}</span>}{open.assignee && <span>Assigned to {open.assignee}</span>}</div>
          <div className="mt-4 flex gap-2">{['open', 'in_progress', 'resolved'].map((s) => <button key={s} className={`btn btn-sm ${open.status === s ? 'btn-blue' : ''}`} onClick={() => update(open, { status: s })}>{s.replace('_', ' ')}</button>)}</div>
          {open.owner_id && (
            <>
              <h4 className="mb-2 mt-5 font-semibold">Conversation with {open.owner_name || 'the customer'}</h4>
              {(open.replies || []).length ? <ul className="grid gap-2">{open.replies.map((r, i) => <li key={i} className={`glass p-3 text-sm ${r.from === 'support' ? 'tint-green' : ''}`}>{r.text}<div className="mt-1 text-[11px] text-[var(--muted)]">{r.by}, {stamp(r.time)}</div></li>)}</ul> : <p className="text-sm text-[var(--muted)]">No messages yet.</p>}
              <div className="mt-3 flex gap-2"><input className="input" placeholder="Reply to the customer (they will see this)" value={replyText} onChange={(e) => setReplyText(e.target.value)} /><button className="btn btn-primary" disabled={!replyText.trim()} onClick={() => update(open, { reply: replyText })}>Send reply</button></div>
            </>
          )}
          <h4 className="mb-2 mt-5 font-semibold">Internal notes (customer cannot see these)</h4>
          {open.notes.length ? <ul className="grid gap-2">{open.notes.map((n, i) => <li key={i} className="glass p-3 text-sm">{n.text}<div className="mt-1 text-[11px] text-[var(--muted)]">{n.by}, {stamp(n.time)}</div></li>)}</ul> : <p className="text-sm text-[var(--muted)]">No notes yet.</p>}
          <div className="mt-3 flex gap-2"><input className="input" placeholder="Add a note" value={note} onChange={(e) => setNote(e.target.value)} /><button className="btn" disabled={!note.trim()} onClick={() => update(open, { note })}>Add</button></div>
        </Modal>
      )}
    </>
  );
}

export function OpsImpact() {
  const im = useLoad(() => api('/api/staff/impact'), [], 30000);
  const d = im.data;
  if (!d) return <><PageHead title="Network impact" /><Skeleton h={260} /></>;
  const m = d.measured_offline;
  const pol = m?.nearest ? [{ name: 'Nearest station', wait: +m.nearest.mean_wait_min.toFixed(2) }, { name: 'Least loaded now', wait: +m.least_loaded_now.mean_wait_min.toFixed(2) }, { name: 'EarthVein model', wait: +m.earthvein_model.mean_wait_min.toFixed(2) }] : [];
  return (
    <>
      <PageHead title="Network impact" sub="All registered vehicles together. The offline comparison below is measured on data the model never saw." actions={<button className="btn" onClick={() => window.print()}>Print report</button>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Fuel saved" value={fmt(d.fuel_saved_l, 0)} unit="litres" tone="orange" />
        <Stat label="CO2 reduced" value={fmt(d.co2_saved_kg / 1000, 2)} unit="tonnes" tone="green" />
        <Stat label="Average delay" value={fmt(d.avg_delay_min)} unit="min" tone="blue" note="residual queue after booking" />
        <Stat label="Utilization balance" value={fmt(d.balance_improvement_pct, 0)} unit="%" tone="orange" note="more even than nearest-station use" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Glass className="p-5"><h3 className="text-lg font-semibold">Offline policy test</h3><p className="mb-3 text-xs text-[var(--muted)]">Mean realised wait in minutes over {m?.requests} simulated requests on the held-out period.</p>
          <div className="h-[240px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={pol} margin={{ left: -10 }}><CartesianGrid stroke="rgba(255,255,255,.08)" vertical={false} /><XAxis dataKey="name" tick={tick} tickLine={false} axisLine={false} /><YAxis tick={tick} tickLine={false} axisLine={false} /><Tooltip contentStyle={tip} /><Bar dataKey="wait" fill="#f28a33" radius={[8, 8, 0, 0]} maxBarSize={70} /></BarChart></ResponsiveContainer></div>
          {m?.improvement_vs_nearest && <p className="mt-2 text-sm">Wait reduced by <b>{fmt(m.improvement_vs_nearest.mean_wait_reduction_pct, 0)}%</b>; travel plus wait reduced by <b>{fmt(m.improvement_vs_nearest.travel_plus_wait_reduction_pct, 0)}%</b> against always using the nearest station.</p>}</Glass>
        <Glass tint="blue" className="p-5 text-sm"><h3 className="mb-2 text-lg font-semibold">Live figures</h3>
          <ul className="grid gap-2"><li>Network utilization now: <b>{d.network_utilization_pct}%</b></li><li>Bookings: <b>{d.bookings}</b>, of which <b>{d.redirected_sessions}</b> ({d.redirected_pct}%) went to a different station than the nearest</li><li>Sessions outside peak hours: <b>{d.offpeak_sessions}</b></li><li>Tracked distance: <b>{fmt(d.tracked_km, 0)} km</b>, {fmt(d.ev_energy_kwh, 0)} kWh used</li></ul>
          <p className="mt-3 text-[var(--muted)]">{d.method.co2}</p><p className="mt-2 text-[var(--muted)]">{d.method.delay}</p></Glass>
      </div>
    </>
  );
}
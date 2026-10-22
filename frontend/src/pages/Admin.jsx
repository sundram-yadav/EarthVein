import React, { useEffect, useState } from 'react';
import { Cpu, Plus, RefreshCw, Search } from 'lucide-react';
import { api } from '../api';
import { useLoad } from '../hooks';
import { Badge, Field, Glass, Modal, PageHead, Skeleton, fmt, stamp } from '../components/ui';

export function Audit() {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);
  const log = useLoad(() => api(`/api/admin/audit?q=${encodeURIComponent(dq)}`), [dq], 10000);
  const tone = (a) => (/override|disabled|deleted|failed/i.test(a) ? 'orange' : /signed|created|booked/i.test(a) ? 'green' : 'blue');
  return (
    <>
      <PageHead title="Audit log" sub="Sign-ins, bookings, overrides, record views and account changes. Only administrators can read this." />
      <Glass className="overflow-hidden">
        <div className="flex items-center gap-3 p-4"><div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" /><input className="input !pl-9" placeholder="Search action, person, target" value={q} onChange={(e) => setQ(e.target.value)} /></div><span className="text-xs text-[var(--muted)]">{log.data?.length || 0} events, newest first</span></div>
        {!log.data ? <div className="p-4"><Skeleton h={240} /></div> : (
          <div className="max-h-[700px] overflow-auto"><table className="t"><thead><tr><th>Time</th><th>Action</th><th>By</th><th>Details</th><th>Change</th></tr></thead>
            <tbody>{log.data.map((r) => (<tr key={r.id}><td className="num whitespace-nowrap text-xs">{stamp(r.timestamp)}</td><td><Badge tone={tone(r.action)}>{r.action}</Badge></td><td>{r.actor}<div className="text-[11px] text-[var(--muted)]">{r.role || 'unknown'}</div></td><td className="max-w-[440px] text-[13px]">{r.details}</td><td className="text-xs">{r.old || r.new ? `${r.old ?? ''} \u2192 ${r.new ?? ''}` : ''}</td></tr>))}</tbody></table></div>
        )}
      </Glass>
    </>
  );
}

export function UsersPage({ ctx }) {
  const { notify, user } = ctx;
  const us = useLoad(() => api('/api/admin/users'), [], 20000);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: '', email: '', role: 'control', password: '' });
  const [err, setErr] = useState('');
  const toggle = async (u) => { try { await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }); us.reload(); } catch (e) { notify(e.message, 'error'); } };
  const create = async (e) => { e.preventDefault(); setErr(''); try { await api('/api/admin/users', { method: 'POST', body: f }); setAdding(false); setF({ name: '', email: '', role: 'control', password: '' }); notify('Staff account created.'); us.reload(); } catch (x) { setErr(x.message); } };
  return (
    <>
      <PageHead title="Users and access" sub="Customers, control panel staff and admins." actions={<button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={15} /> Add staff account</button>} />
      <Glass className="overflow-hidden">{!us.data ? <div className="p-4"><Skeleton h={200} /></div> : (
        <div className="overflow-auto"><table className="t"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Sign-in</th><th>Vehicles</th><th>Last sign-in</th><th /></tr></thead>
          <tbody>{us.data.map((u) => (<tr key={u.id}><td><b>{u.name}</b></td><td>{u.email}</td><td><Badge tone={u.role === 'admin' ? 'orange' : u.role === 'control' ? 'blue' : 'green'}>{u.role}</Badge></td><td>{u.provider}</td><td className="num">{u.vehicles}</td><td className="num text-xs">{u.last_login ? stamp(u.last_login) : 'Never'}</td>
            <td>{u.id !== user.id && <button className={`btn btn-sm ${u.active ? 'btn-danger' : ''}`} onClick={() => toggle(u)}>{u.active ? 'Disable' : 'Enable'}</button>}</td></tr>))}</tbody></table></div>)}</Glass>
      {adding && (
        <Modal title="Add staff account" onClose={() => setAdding(false)}>
          <form onSubmit={create} className="grid gap-3">
            <Field label="Name"><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Email"><input className="input" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Role"><select className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="control">Control panel</option><option value="admin">Admin</option></select></Field>
            <Field label="Temporary password" hint="At least 10 characters."><input className="input" type="password" minLength="10" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
            {err && <div className="rounded-xl border border-[rgba(229,100,90,.5)] bg-[rgba(229,100,90,.12)] px-3 py-2 text-sm text-[#ffb4ad]" role="alert">{err}</div>}
            <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button><button className="btn btn-primary">Create account</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}

const pct = (x) => `${fmt(x * 100, 1)}%`;

export function ModelPage({ ctx }) {
  const m = useLoad(() => api('/api/admin/model'), [], 6000);
  const d = m.data;
  const retrain = async () => { try { await api('/api/admin/model/retrain', { method: 'POST' }); ctx.notify('Retraining started. It takes about a minute.'); m.reload(); } catch (e) { ctx.notify(e.message, 'error'); } };
  if (!d) return <><PageHead title="Allocation model" /><Skeleton h={300} /></>;
  const dm = d.demand_model, wm = d.wait_model, pe = d.policy_evaluation, meta = d.meta;
  return (
    <>
      <PageHead title="Allocation model" sub="Two gradient boosting models trained on real charger occupancy data. This page shows how they did on data held back from training." actions={<button className="btn btn-primary" onClick={retrain} disabled={d.training?.running}><RefreshCw size={15} className={d.training?.running ? 'animate-spin' : ''} /> {d.training?.running ? 'Training' : 'Retrain'}</button>} />
      {d.training?.error && <div className="mb-4 rounded-xl border border-[rgba(229,100,90,.5)] bg-[rgba(229,100,90,.12)] px-3 py-2 text-sm" role="alert">Training failed: {d.training.error}</div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Glass tint="blue" className="p-5"><div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Cpu size={16} /> Training data</div><p className="text-sm text-[var(--muted)]">{meta.dataset}</p><dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><div><dt className="text-xs text-[var(--muted)]">Zones</dt><dd className="num">{meta.dataset_zones}</dd></div><div><dt className="text-xs text-[var(--muted)]">Hours</dt><dd className="num">{meta.dataset_hours}</dd></div><div><dt className="text-xs text-[var(--muted)]">Train rows</dt><dd className="num">{fmt(meta.train_rows, 0)}</dd></div><div><dt className="text-xs text-[var(--muted)]">Test rows</dt><dd className="num">{fmt(meta.test_rows, 0)}</dd></div></dl><p className="mt-3 text-[11px] text-[var(--muted)]">Trained {stamp(meta.trained_at)} in {meta.train_seconds}s with scikit-learn {meta.sklearn_version}.</p></Glass>
        <Glass tint="orange" className="p-5"><h3 className="mb-2 font-semibold">Demand forecast (error as occupancy share)</h3>
          <table className="t"><thead><tr><th>Horizon</th><th>Model</th><th>Keep current</th></tr></thead><tbody>{['1-3 h ahead', '4-12 h ahead', '13-24 h ahead'].map((k) => <tr key={k}><td>{k}</td><td className="num">{pct(dm[k].model_mae)}</td><td className="num">{pct(dm[k].persistence_mae)}</td></tr>)}</tbody></table>
          <p className="mt-2 text-[11px] text-[var(--muted)]">Mean absolute error, lower is better. Overall R2 {fmt(dm.overall.r2, 2)}.</p></Glass>
        <Glass tint="green" className="p-5"><h3 className="mb-2 font-semibold">Queue wait prediction</h3><div className="big-num text-5xl">{fmt(wm.model_mae_min, 2)}<span className="text-lg"> min</span></div><p className="mt-1 text-sm text-[var(--muted)]">Mean absolute error. The formula-only baseline scores {fmt(wm.naive_mae_min, 2)} min. R2 {fmt(wm.r2, 2)}.</p><p className="mt-2 text-[11px] text-[var(--muted)]">Only about {pct(wm.share_of_rows_with_wait_over_5_min)} of test rows have a wait over 5 minutes, so most of the value is in avoiding the busy cases.</p></Glass>
      </div>
      <Glass className="mt-4 overflow-hidden"><div className="p-4 pb-2"><h3 className="text-lg font-semibold">Station choice policies on unseen data</h3><p className="text-xs text-[var(--muted)]">{pe.requests} random requests across both cities. Realised wait comes from the real occupancy at the arrival hour.</p></div>
        <table className="t"><thead><tr><th>Policy</th><th>Mean wait</th><th>90th percentile</th><th>Wait over 10 min</th><th>Travel plus wait</th><th>Stations used</th></tr></thead>
          <tbody>{[['nearest', 'Nearest station'], ['least_loaded_now', 'Least loaded now'], ['earthvein_model', 'EarthVein model']].map(([k, l]) => <tr key={k} style={k === 'earthvein_model' ? { background: 'rgba(242,138,51,.12)' } : null}><td><b>{l}</b></td><td className="num">{fmt(pe[k].mean_wait_min, 2)} min</td><td className="num">{fmt(pe[k].p90_wait_min, 2)} min</td><td className="num">{pct(pe[k].share_wait_over_10_min)}</td><td className="num">{fmt(pe[k].mean_travel_plus_wait_min, 1)} min</td><td className="num">{pe[k].stations_used}</td></tr>)}</tbody></table>
        <p className="px-4 py-3 text-[11px] text-[var(--muted)]">Least loaded now wins on wait only by sending vehicles much farther, which is why travel plus wait is the fairer column. The test ignores the effect of vehicles on each other's queues.</p></Glass>
    </>
  );
}

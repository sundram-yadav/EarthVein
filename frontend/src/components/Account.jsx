import React, { useState } from 'react';
import { Download, KeyRound, Trash2 } from 'lucide-react';
import { api } from '../api';
import { Badge, Field, Modal } from './ui';

export default function Account({ user, onClose, onToken, onDeleted, notify }) {
  const [f, setF] = useState({ current: '', next: '', again: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState('');
  const staff = user.role !== 'customer';

  const change = async (e) => {
    e.preventDefault(); setErr('');
    if (f.next !== f.again) return setErr('The new passwords do not match.');
    setBusy(true);
    try {
      const r = await api('/api/auth/change-password', { method: 'POST', body: { current: f.current, new: f.next } });
      onToken(r.token); setF({ current: '', next: '', again: '' }); notify('Password changed. Other devices were signed out.');
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const download = async () => {
    try {
      const data = await api('/api/me/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'earthvein-my-data.json'; a.click(); URL.revokeObjectURL(url);
    } catch (x) { notify(x.message, 'error'); }
  };
  const remove = async () => {
    try { await api('/api/me', { method: 'DELETE' }); onDeleted(); } catch (x) { notify(x.message, 'error'); }
  };

  return (
    <Modal title="My account" onClose={onClose}>
      <div className="glass tint-blue mb-4 p-3 text-sm"><b>{user.name}</b><div className="text-[var(--muted)]">{user.email}</div><Badge tone="blue">{user.role}</Badge></div>
      {user.provider === 'google' ? <p className="text-sm text-[var(--muted)]">You sign in with Google, so there is no EarthVein password to change.</p> : (
        <form onSubmit={change} className="grid gap-3">
          <h4 className="flex items-center gap-2 font-semibold"><KeyRound size={15} /> Change password</h4>
          <Field label="Current password"><input className="input" type="password" required autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
          <Field label="New password" hint={staff ? 'At least 10 characters with letters and a number.' : 'At least 8 characters with letters and a number.'}><input className="input" type="password" required autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
          <Field label="Repeat new password"><input className="input" type="password" required autoComplete="new-password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} /></Field>
          {err && <div className="rounded-xl border border-[rgba(229,100,90,.5)] bg-[rgba(229,100,90,.12)] px-3 py-2 text-sm text-[#ffb4ad]" role="alert">{err}</div>}
          <button className="btn btn-primary" disabled={busy}>Change password</button>
        </form>
      )}
      <div className="mt-6 grid gap-3 border-t border-white/10 pt-4">
        <button className="btn" onClick={download}><Download size={15} /> Download my data (JSON)</button>
        {user.role === 'customer' && (
          <div className="glass p-3">
            <h4 className="flex items-center gap-2 font-semibold text-[#ffb4ad]"><Trash2 size={15} /> Delete my account</h4>
            <p className="mt-1 text-xs text-[var(--muted)]">Removes your profile, vehicles and bookings permanently. Type DELETE to confirm.</p>
            <div className="mt-2 flex gap-2"><input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Type DELETE" /><button className="btn btn-danger" disabled={confirm !== 'DELETE'} onClick={remove}>Delete</button></div>
          </div>
        )}
      </div>
    </Modal>
  );
}

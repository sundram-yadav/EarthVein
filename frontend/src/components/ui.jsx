import React, { useEffect, useRef } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';

export const fmt = (n, d = 1) => Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: d });
export const inr = (n) => '\u20B9' + Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
export const hhmm = (iso) => (iso ? iso.slice(11, 16) : '');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Timestamps are IST strings from the server. Read them as text so the browser's own timezone cannot shift the date.
export const dayLabel = (iso) => (iso ? `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]}` : '');
export const stamp = (iso) => (iso ? `${dayLabel(iso)}, ${hhmm(iso)}` : '');

export function Glass({ tint, edge, stripe, className = '', children, ...rest }) {
  return (
    <div className={`glass ${tint ? 'tint-' + tint : ''} ${edge ? 'edge' : ''} ${stripe ? 'stripe' : ''} ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function PageHead({ title, sub, actions }) {
  return (
    <div className="page-head mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1>{title}</h1>
        {sub && <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">{sub}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

export function Badge({ tone = '', children }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Stat({ label, value, unit, tone = 'blue', note, icon: Icon }) {
  return (
    <Glass tint={tone} stripe className="p-5">
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium text-[var(--muted)]">{label}</span>
        {Icon && <Icon size={18} className="opacity-80" />}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="big-num text-5xl">{value}</span>
        {unit && <span className="text-sm text-[var(--muted)]">{unit}</span>}
      </div>
      {note && <p className="mt-2 text-xs text-[var(--muted)]">{note}</p>}
    </Glass>
  );
}

export function Field({ label, hint, error, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && !error && <small className="text-[11px] opacity-70">{hint}</small>}
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-[rgba(4,8,20,.65)] p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <Glass edge className={`max-h-[90dvh] w-full overflow-y-auto p-6 ${wide ? 'max-w-3xl' : 'max-w-lg'}`} style={{ background: 'rgba(14,23,48,.9)' }}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-semibold">{title}</h3>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close"><X size={15} /></button>
        </div>
        {children}
      </Glass>
    </div>
  );
}

export function Empty({ title, text, action }) {
  return (
    <div className="grid place-items-center gap-2 px-6 py-12 text-center">
      <div className="h-12 w-12 rounded-2xl border border-dashed border-white/30" />
      <b className="font-display text-lg">{title}</b>
      <p className="max-w-sm text-sm text-[var(--muted)]">{text}</p>
      {action}
    </div>
  );
}

export function Skeleton({ h = 120 }) {
  return <div className="shimmer w-full" style={{ height: h }} />;
}

export function Toast({ toast, onClose }) {
  const t = useRef();
  useEffect(() => {
    if (!toast) return;
    clearTimeout(t.current);
    t.current = setTimeout(onClose, toast.type === 'alert' ? 9000 : 4500);
    return () => clearTimeout(t.current);
  }, [toast, onClose]);
  if (!toast) return null;
  const cls = toast.type === 'error' || toast.type === 'alert' ? 'border-[rgba(229,100,90,.6)]' : 'border-[rgba(53,185,130,.6)]';
  return (
    <div className={`glass fixed bottom-5 right-5 z-[80] flex max-w-sm items-start gap-3 p-4 ${cls}`} role="status" style={{ background: 'rgba(14,23,48,.92)' }}>
      {toast.type === 'success' ? <CheckCircle2 size={18} className="mt-0.5 text-[var(--green)]" /> : <AlertTriangle size={18} className="mt-0.5 text-[var(--orange)]" />}
      <p className="text-sm">{toast.message}</p>
      <button onClick={onClose} aria-label="Dismiss"><X size={14} /></button>
    </div>
  );
}

// Circular charge gauge. Colour follows the alert level.
export function Ring({ value, size = 190, level = 'ok', children }) {
  const r = size / 2 - 14;
  const c = 2 * Math.PI * r;
  const color = level === 'ok' ? 'var(--green)' : level === 'warning' ? 'var(--orange)' : 'var(--red)';
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,.12)" strokeWidth="12" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="12" fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(100, value)) / 100)} style={{ transition: 'stroke-dashoffset .8s ease, stroke .4s' }} />
      </svg>
      <div className="absolute text-center">{children}</div>
    </div>
  );
}

export const pressureTone = (p) => (p === 'High' ? 'red' : p === 'Moderate' ? 'orange' : 'green');
export const levelTone = (l) => (l === 'ok' ? 'green' : l === 'warning' ? 'orange' : 'red');
export const CLASS_NAME = { '2W': 'Two-wheeler', '3W': 'Three-wheeler', car: 'Car', lcv: 'Light van', truck: 'Truck' };

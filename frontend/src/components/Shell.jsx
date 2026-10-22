import React, { useState } from 'react';
import { BatteryCharging, Car, CalendarClock, Cpu, Gauge, LayoutDashboard, Leaf, LifeBuoy, LogOut, Map as MapIcon, Menu, ScrollText, ShieldCheck, Users, ClipboardList, Globe2, BarChart3, MessageSquare } from 'lucide-react';

export const NAV = {
  customer: [
    ['dashboard', 'Dashboard', LayoutDashboard], ['map', 'Live map and route', MapIcon], ['vehicles', 'My vehicles', Car],
    ['slots', 'Slot booking', CalendarClock], ['battery', 'Battery monitor', BatteryCharging], ['impact', 'My impact', Leaf],
    ['support', 'Help and support', LifeBuoy],
  ],
  control: [
    ['ops', 'Operations overview', Gauge], ['registry', 'Vehicle registry', ClipboardList], ['allbookings', 'Slot bookings', CalendarClock],
    ['citymap', 'City network map', Globe2], ['requests', 'Customer requests', MessageSquare], ['opsimpact', 'Network impact', BarChart3],
  ],
  admin: [['audit', 'Audit log', ScrollText], ['users', 'Users and access', Users], ['model', 'Allocation model', Cpu]],
};
const GROUPS = { customer: 'My workspace', control: 'Control panel', admin: 'Administration' };
export const sectionsFor = (role) => (role === 'customer' ? ['customer'] : role === 'control' ? ['control'] : ['customer', 'control', 'admin']);
export const firstPage = (role) => (role === 'customer' ? 'dashboard' : role === 'control' ? 'ops' : 'ops');

export function Logo({ size = 34 }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="10" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.25)" />
        <path d="M6 10c6 0 6 6 10 6s4-6 10-6" stroke="#F28A33" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        <path d="M6 22c6 0 6-6 10-6s4 6 10 6" stroke="#35B982" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        <circle cx="16" cy="16" r="2.6" fill="#3F7CF0" />
      </svg>
      <span className="font-display text-[1.35rem] font-bold tracking-tight">Earth<span className="text-[var(--orange)]">Vein</span></span>
    </div>
  );
}

const ROLE_LABEL = { customer: 'Customer', control: 'Control panel', admin: 'Admin' };

export default function Shell({ user, page, setPage, onLogout, onAccount, ticker, banner, children }) {
  const [open, setOpen] = useState(false);
  const go = (id) => { setPage(id); setOpen(false); };
  return (
    <div className="shell">
      <aside className={`sidebar glass ${open ? 'open' : ''}`} style={{ borderRadius: 0, borderWidth: '0 1px 0 0' }}>
        <div className="px-2 pt-1"><Logo /></div>
        <div className="glass tint-blue mx-1 p-3 text-xs">
          <div className="text-[var(--muted)]">Signed in as</div>
          <div className="mt-0.5 truncate text-sm font-semibold">{user.name}</div>
          <span className={`badge mt-2 ${user.role === 'admin' ? 'orange' : user.role === 'control' ? 'blue' : 'green'}`}>{ROLE_LABEL[user.role]}</span>
        </div>
        <nav className="flex-1">
          {sectionsFor(user.role).map((sec) => (
            <div key={sec}>
              <div className="nav-label">{GROUPS[sec]}</div>
              {NAV[sec].filter(([id]) => !(id === 'support' && user.role !== 'customer')).map(([id, label, Icon]) => (
                <button key={id} className={`nav-btn ${page === id ? 'active' : ''}`} onClick={() => go(id)}>
                  <Icon size={17} /> <span>{label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <button className="btn w-full" onClick={onAccount}>My account</button>
        <button className="btn w-full btn-danger" onClick={onLogout}><LogOut size={16} /> Log out</button>
      </aside>
      <main className="min-w-0">
        <div className="ticker" aria-hidden="true">
          <div className="ticker-track">{[...ticker, ...ticker].map((t, i) => <span key={i}>{t}</span>)}</div>
        </div>
        <header className="topbar">
          <button className="btn btn-sm menu-btn" onClick={() => setOpen(!open)} aria-label="Menu"><Menu size={16} /></button>
          <div className="hidden items-center gap-2 text-sm text-[var(--muted)] md:flex"><ShieldCheck size={15} /> Private workspace. Customer data is visible only to its owner.</div>
          <div className="flex items-center gap-3">
            <button className="hidden text-right text-xs hover:opacity-80 sm:block" onClick={onAccount} title="My account"><div className="font-semibold">{user.name}</div><div className="text-[var(--muted)]">{ROLE_LABEL[user.role]} - account</div></button>
            <button className="btn btn-sm btn-danger" onClick={onLogout}><LogOut size={14} /> Log out</button>
          </div>
        </header>
        {banner && <div className="mx-auto mt-4 max-w-[1500px] px-6"><div className="glass px-4 py-2 text-sm" style={{ borderColor: 'rgba(242,138,51,.6)' }} role="status">{banner}</div></div>}
        <div className="page">{children}</div>
      </main>
    </div>
  );
}
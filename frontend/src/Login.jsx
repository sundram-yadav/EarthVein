import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, BatteryCharging, Eye, EyeOff, MapPin, Route, ShieldCheck, Truck } from 'lucide-react';
import { api } from './api';
import { Logo } from './components/Shell';

const PORTALS = [
  ['customer', 'Customer', 'Book charging, track your vehicles and battery.'],
  ['control', 'Control panel', 'Fleet registry, bookings and support desk.'],
  ['admin', 'Admin', 'Everything, plus audit log and access control.'],
];

// Animated city network: flowing veins between charging nodes, with vehicles riding the routes.
function Scene() {
  const paths = [
    ['M40 420 C 180 380, 220 250, 380 260 S 560 120, 700 150', 'var(--orange)', ''],
    ['M60 120 C 200 160, 260 300, 400 310 S 600 430, 720 400', 'var(--blue)', 'slow'],
    ['M120 520 C 260 470, 330 380, 470 390 S 640 300, 740 260', 'var(--green)', 'rev'],
    ['M30 260 C 150 250, 240 180, 340 190 S 520 250, 640 210', 'rgba(255,255,255,.5)', 'slow rev'],
  ];
  const nodes = [[380, 260, 'var(--orange)'], [400, 310, 'var(--blue)'], [470, 390, 'var(--green)'], [700, 150, 'var(--orange)'], [340, 190, 'var(--blue)'], [640, 210, 'var(--green)'], [180, 380, 'var(--green)'], [260, 300, 'var(--orange)']];
  return (
    <svg viewBox="0 0 780 600" className="h-full w-full" aria-hidden="true">
      <defs><filter id="soft"><feGaussianBlur stdDeviation="3" /></filter></defs>
      {paths.map(([d, c, cls], i) => (
        <g key={i}>
          <path d={d} stroke={c} strokeWidth="9" fill="none" opacity=".12" filter="url(#soft)" />
          <path d={d} className={`vein ${cls}`} stroke={c} />
        </g>
      ))}
      {nodes.map(([x, y, c], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="14" fill={c} opacity=".25" className="node-pulse" style={{ animationDelay: `${i * 0.3}s` }} />
          <circle cx={x} cy={y} r="6" fill={c} stroke="#fff" strokeWidth="1.5" />
        </g>
      ))}
      {paths.slice(0, 3).map(([d, c], i) => (
        <circle key={i} r="7" fill="#fff" stroke={c} strokeWidth="3" className="rider" style={{ offsetPath: `path("${d}")`, animationDuration: `${12 + i * 4}s`, animationDelay: `${-i * 4}s` }} />
      ))}
    </svg>
  );
}

export default function Login({ onSession }) {
  const [portal, setPortal] = useState('customer');
  const [mode, setMode] = useState('signin');
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [googleId, setGoogleId] = useState(null);
  const [slow, setSlow] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const signup = portal === 'customer' && mode === 'signup';

  useEffect(() => { api('/api/meta', { auth: false }).then((m) => setGoogleId(m.google_client_id || null)).catch(() => {}); }, []);

  useEffect(() => {
    if (!googleId || portal !== 'customer') return;
    const draw = () => {
      if (!window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: googleId,
        callback: async (r) => {
          try { onSession(await api('/api/auth/google', { method: 'POST', body: { credential: r.credential }, auth: false })); } catch (e) { setError(e.message); }
        },
      });
      const el = document.getElementById('g-btn');
      if (el) window.google.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', shape: 'pill', width: 320, text: 'continue_with' });
    };
    if (window.google?.accounts?.id) return draw();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = draw;
    document.body.appendChild(s);
  }, [googleId, portal, mode, onSession]);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    const wake = setTimeout(() => setSlow(true), 4000);
    try {
      const data = signup
        ? await api('/api/auth/signup', { method: 'POST', auth: false, body: form })
        : await api('/api/auth/login', { method: 'POST', auth: false, body: { email: form.email, password: form.password, portal } });
      onSession(data, signup);
    } catch (err) { setError(err.message); } finally { clearTimeout(wake); setSlow(false); setBusy(false); }
  };

  return (
    <div className="relative min-h-[100dvh] overflow-hidden">
      <div className="backdrop"><span className="orb o1" /><span className="orb o2" /><span className="orb o3" /></div>
      <div className="grain" />
      <div className="relative z-10 mx-auto grid min-h-[100dvh] max-w-[1400px] grid-cols-1 items-center gap-8 px-5 py-8 lg:grid-cols-[1.15fr_.85fr]">
        <section className="relative hidden lg:block">
          <Logo size={42} />
          <h1 className="mt-10 max-w-[18ch] text-[clamp(2.6rem,5vw,4.6rem)] font-extrabold leading-[.95]">
            Every vehicle, <span className="text-[var(--orange)]">every charger</span>, one flow.
          </h1>
          <p className="mt-5 max-w-md text-[var(--muted)]">EarthVein spreads delivery traffic and charging demand across a city so existing roads and stations carry more, without building new ones.</p>
          <div className="glass edge stripe relative mt-8 h-[400px] overflow-hidden">
            <Scene />
            <div className="absolute bottom-4 left-4 flex flex-wrap gap-2">
              <span className="badge orange"><Truck size={12} /> Heavy freight off-peak</span>
              <span className="badge green"><BatteryCharging size={12} /> Battery-aware slots</span>
              <span className="badge blue"><Route size={12} /> Auto-route</span>
            </div>
          </div>
        </section>

        <motion.section initial={{ opacity: 0, y: 26, rotateX: 8 }} animate={{ opacity: 1, y: 0, rotateX: 0 }} transition={{ type: 'spring', stiffness: 90, damping: 16 }} className="mx-auto w-full max-w-[460px]" style={{ perspective: 900 }}>
          <div className="mb-5 lg:hidden"><Logo /></div>
          <div className="glass edge p-6 sm:p-7" style={{ background: 'rgba(14,23,48,.72)' }}>
            <div className="grid grid-cols-3 gap-1 rounded-2xl border border-white/10 bg-black/20 p-1" role="tablist">
              {PORTALS.map(([id, label]) => (
                <button key={id} role="tab" aria-selected={portal === id} onClick={() => { setPortal(id); setMode('signin'); setError(''); }}
                  className="relative rounded-xl px-2 py-2 text-[13px] font-semibold" style={{ color: portal === id ? '#1b0f03' : 'var(--muted)' }}>
                  {portal === id && <motion.span layoutId="portal-pill" className="absolute inset-0 rounded-xl" style={{ background: 'linear-gradient(135deg,#f59a4b,#e87a22)' }} transition={{ type: 'spring', stiffness: 380, damping: 30 }} />}
                  <span className="relative">{label}</span>
                </button>
              ))}
            </div>
            <AnimatePresence mode="wait">
              <motion.div key={portal + mode} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14 }} transition={{ duration: 0.18 }}>
                <h2 className="mt-5 text-2xl font-bold">{signup ? 'Create your account' : portal === 'customer' ? 'Welcome back' : portal === 'control' ? 'Control panel sign-in' : 'Admin sign-in'}</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">{signup ? 'Takes a minute. You add your vehicle next.' : PORTALS.find((p) => p[0] === portal)[2]}</p>
                <form onSubmit={submit} className="mt-5 grid gap-3.5">
                  {signup && <label className="field"><span>Full name</span><input className="input" value={form.name} onChange={set('name')} required autoComplete="name" /></label>}
                  <label className="field"><span>Email</span><input className="input" type="email" value={form.email} onChange={set('email')} required autoComplete="email" /></label>
                  {signup && <label className="field"><span>Mobile number (optional)</span><input className="input" inputMode="numeric" value={form.phone} onChange={set('phone')} autoComplete="tel" /></label>}
                  <label className="field"><span>Password</span>
                    <div className="relative">
                      <input className="input pr-11" type={show ? 'text' : 'password'} value={form.password} onChange={set('password')} required autoComplete={signup ? 'new-password' : 'current-password'} />
                      <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                    </div>
                    {signup && <small className="text-[11px] opacity-70">At least 8 characters, with letters and a number.</small>}
                  </label>
                  {slow && <div className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-[var(--muted)]" role="status">The server was idle and is waking up. This can take up to a minute on the first request.</div>}
                  {error && <div className="rounded-xl border border-[rgba(229,100,90,.5)] bg-[rgba(229,100,90,.12)] px-3 py-2 text-sm text-[#ffb4ad]" role="alert">{error}</div>}
                  <button className="btn btn-primary w-full py-3" disabled={busy}>{busy ? 'Please wait' : signup ? 'Create account' : 'Sign in'} <ArrowRight size={16} /></button>
                </form>
                {portal === 'customer' && (
                  <>
                    <div className="my-4 flex items-center gap-3 text-xs text-[var(--muted)]"><span className="h-px flex-1 bg-white/15" />or<span className="h-px flex-1 bg-white/15" /></div>
                    {googleId ? <div id="g-btn" className="flex justify-center" /> : (
                      <button type="button" className="btn w-full" onClick={() => setError('Google sign-in is switched off until a Google client ID is added to the .env files. Email sign-in works now.')}>Continue with Google</button>
                    )}
                    <p className="mt-4 text-center text-sm text-[var(--muted)]">
                      {signup ? 'Already registered?' : 'New to EarthVein?'}{' '}
                      <button className="font-semibold text-[var(--orange)] underline-offset-4 hover:underline" onClick={() => { setMode(signup ? 'signin' : 'signup'); setError(''); }}>{signup ? 'Sign in' : 'Create an account'}</button>
                    </p>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
          <p className="mt-4 flex items-center justify-center gap-2 text-center text-xs text-[var(--muted)]"><ShieldCheck size={13} /> Each customer can see only their own vehicles, routes and bookings.</p>
          <p className="mt-1 flex items-center justify-center gap-2 text-xs text-[var(--muted)]"><MapPin size={13} /> Demo stations in Delhi NCR and Bengaluru</p>
        </motion.section>
      </div>
    </div>
  );
}

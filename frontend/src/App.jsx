import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api';
import { useLoad } from './hooks';
import Login from './Login';
import Shell, { firstPage } from './components/Shell';
import { Toast } from './components/ui';
import Account from './components/Account';
import { Battery, CustomerSupport, Dashboard, Impact, MapPage, Slots, Vehicles } from './pages/Customer';
import { AllBookings, CityMap, Ops, OpsImpact, Registry, Support } from './pages/Staff';
import { Audit, ModelPage, UsersPage } from './pages/Admin';

const levelOf = (soc) => (soc <= 10 ? 3 : soc <= 20 ? 2 : soc <= 30 ? 1 : 0);
const LEVEL_TEXT = ['', 'Charge is at or below 30%.', 'Low battery, 20% or below.', 'Critical battery, 10% or below.'];

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(!!getToken());
  const [page, setPage] = useState('dashboard');
  const [vehId, setVehId] = useState(null);
  const [toast, setToast] = useState(null);
  const [nav, setNav] = useState({});
  const [account, setAccount] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const seen = useRef({});
  const notify = useCallback((message, type = 'success') => setToast({ message, type }), []);

  const logout = useCallback(async (silent) => {
    if (!silent) { try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* token may already be invalid */ } }
    setToken(null); setUser(null); setVehId(null); seen.current = {};
  }, []);

  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  useEffect(() => { setUnauthorizedHandler(() => { logout(true); notify('Your session ended. Please sign in again.', 'error'); }); }, [logout, notify]);
  useEffect(() => {
    if (!getToken()) return;
    api('/api/auth/me').then((r) => { setUser(r.user); setPage(firstPage(r.user.role)); }).catch(() => setToken(null)).finally(() => setBooting(false));
  }, []);

  const onSession = (data, isNew) => { setToken(data.token); setUser(data.user); setNav(isNew ? { add: true } : {}); setPage(isNew ? 'vehicles' : firstPage(data.user.role)); };
  const go = (id, opts) => { setPage(id); setNav(opts || {}); };

  const isCustomerish = user && (user.role === 'customer' || user.role === 'admin');
  const meta = useLoad(() => api('/api/meta', { auth: false }), [user?.id]);
  const veh = useLoad(() => (isCustomerish ? api('/api/me/vehicles') : Promise.resolve([])), [user?.id], 10000);
  const vehicles = veh.data || [];
  useEffect(() => { if (vehicles.length && !vehicles.some((v) => v.id === vehId)) setVehId(vehicles[0].id); }, [vehicles, vehId]);

  // Battery alerts: fire once each time a vehicle drops into a worse band.
  useEffect(() => {
    vehicles.forEach((v) => {
      const lvl = levelOf(v.soc);
      const prev = seen.current[v.id];
      seen.current[v.id] = lvl;
      if (prev !== undefined && lvl > prev && lvl > 0) {
        notify(`${v.plate}: ${LEVEL_TEXT[lvl]} Open Battery monitor to see the nearest chargers.`, 'alert');
        if ('Notification' in window && Notification.permission === 'granted') new Notification('EarthVein battery alert', { body: `${v.plate} is at ${Math.round(v.soc)}%.` });
      }
    });
  }, [vehicles, notify]);
  useEffect(() => { if (isCustomerish && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); }, [isCustomerish]);

  if (booting) return <div className="grid min-h-[100dvh] place-items-center"><div className="backdrop" /><span className="relative z-10 text-sm text-[var(--muted)]">Loading</span></div>;
  if (!user) return <><Login onSession={onSession} /><Toast toast={toast} onClose={() => setToast(null)} /></>;

  const activeId = vehicles.some((v) => v.id === vehId) ? vehId : vehicles[0]?.id;
  const ctx = { user, vehicles, vehId: activeId, setVehId, reload: veh.reload, notify, go, nav, autoAdd: !!nav.add, clearNav: () => setNav({}), clearAutoAdd: () => setNav({}), meta: meta.data || { city_centres: { delhi: [28.6139, 77.209], bengaluru: [12.9716, 77.5946] } }, refreshMeta: meta.reload };
  const low = vehicles.filter((v) => v.soc <= 20).length;
  const ticker = [
    'EarthVein balances delivery traffic and charger load across the city',
    'Heavy freight is scheduled outside 08:00-11:00 and 17:00-21:00',
    isCustomerish ? `You have ${vehicles.length} registered vehicle${vehicles.length === 1 ? '' : 's'}${low ? `, ${low} at 20% or lower` : ''}` : 'Control panel session: record views are audited',
    meta.data?.rush ? 'Rush-hour scenario is ON: demand is 35% above normal' : 'Demand replayed from real charger data (UrbanEV)',
    'Estimates are not BMS readings. Keep an 8% reserve',
  ];
  const pages = {
    dashboard: Dashboard, map: MapPage, vehicles: Vehicles, slots: Slots, battery: Battery, impact: Impact,
    ops: Ops, registry: Registry, allbookings: AllBookings, citymap: CityMap, requests: Support, support: CustomerSupport, opsimpact: OpsImpact,
    audit: Audit, users: UsersPage, model: ModelPage,
  };
  const Page = pages[page] || Dashboard;
  return (
    <>
      <div className="backdrop"><span className="orb o1" /><span className="orb o2" /><span className="orb o3" /></div>
      <div className="grain" />
      <Shell user={user} page={page} setPage={(id) => go(id)} onLogout={() => logout(false)} onAccount={() => setAccount(true)} ticker={ticker} banner={!online ? 'You are offline. Figures will refresh when the connection returns.' : null}>
        <Page ctx={ctx} />
      </Shell>
      {account && <Account user={user} notify={notify} onClose={() => setAccount(false)} onToken={(t) => setToken(t)} onDeleted={() => { setAccount(false); logout(true); notify('Your account was deleted.'); }} />}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </>
  );
}
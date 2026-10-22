// Production build: same origin as the page (the backend serves the frontend). Dev: the local Flask server.
const BASE = (import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:5000' : '')).replace(/\/$/, '');
const KEY = 'earthvein_token';

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };
export const getToken = () => sessionStorage.getItem(KEY);
export const apiBase = BASE;
export const setToken = (t) => (t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY));

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Cannot reach the EarthVein server. Check your connection. If the server was idle it may take up to a minute to wake up.');
  }
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 401 && auth && token) onUnauthorized();
  if (res.status === 429 && !data.error) data.error = 'Too many requests. Please wait a moment.';
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Road geometry from the public OSRM demo server. Falls back to a straight line.
export async function roadRoute(from, to) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const json = await res.json();
    const r = json.routes?.[0];
    if (r) return { points: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]), km: r.distance / 1000, min: r.duration / 60, road: true };
  } catch { /* use fallback */ }
  return { points: [from, to], km: null, min: null, road: false };
}

import React, { useEffect, useMemo, useRef } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';

// Icons are created once and reused. Creating a new icon on every render makes
// Leaflet swap the marker element, which closes open popups and looks like a reset.
const iconCache = new Map();
function icon(key, html, size, cls) {
  if (!iconCache.has(key)) iconCache.set(key, L.divIcon({ className: '', html: `<div class="pin ${cls}" style="width:${size}px;height:${size}px">${html}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }));
  return iconCache.get(key);
}
const stationIcon = (s) => {
  const cls = s.status !== 'online' ? 'st-off' : s.utilization >= 0.8 ? 'st-hot' : s.utilization >= 0.5 ? 'st-mid' : 'st-ok';
  return icon(`st-${cls}-${s.power_type}`, s.power_type[0], 24, cls);
};
const vehIcon = (v, selected) => icon(`veh-${v.vclass}-${selected}`, { '2W': '2W', '3W': '3W', car: 'C', lcv: 'V', truck: 'T' }[v.vclass], selected ? 30 : 26, `veh ${selected ? 'pulse-ring' : ''}`);
const meIcon = icon('me', 'GPS', 30, 'me pulse-ring');

// Moves the camera only when `focus` changes (an explicit user action), never when data refreshes.
function Camera({ focus, bounds }) {
  const map = useMap();
  const first = useRef(true);
  const last = useRef(null);
  useEffect(() => {
    if (first.current && bounds?.length) {
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13, animate: false });
      first.current = false;
    }
  }, [bounds, map]);
  useEffect(() => {
    if (!focus || focus.key === last.current) return;
    last.current = focus.key;
    if (focus.bounds) map.flyToBounds(focus.bounds, { padding: [50, 50], maxZoom: 15, duration: 0.8 });
    else map.flyTo(focus.center, focus.zoom || 14, { duration: 0.8 });
  }, [focus, map]);
  return null;
}

export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-[11px] text-[var(--muted)]">
      <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[var(--green)]" />Free</span>
      <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[var(--orange)]" />Busy</span>
      <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[var(--red)]" />Full</span>
      <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#5b6785]" />Maintenance</span>
      <span>Letter: L light, M mixed, F fast, H heavy freight</span>
    </div>
  );
}

export default function MapView({ stations = [], vehicles = [], selectedVehicle, me, route, routeColor = '#f28a33', focus, height = 520, onStation, onRoute, children }) {
  const bounds = useMemo(() => {
    const pts = [...stations.map((s) => [s.lat, s.lng]), ...vehicles.map((v) => [v.lat, v.lng])];
    return pts.length ? pts : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stations.length > 0, vehicles.length > 0]);
  return (
    <MapContainer center={[28.6139, 77.209]} zoom={11} scrollWheelZoom style={{ height, width: '100%' }} zoomControl>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" subdomains="abc" maxZoom={19} />
      <Camera focus={focus} bounds={bounds} />
      {route?.length > 1 && <Polyline positions={route} pathOptions={{ color: routeColor, weight: 5, opacity: 0.9, dashArray: route.length < 4 ? '8 10' : null }} />}
      {stations.map((s) => (
        <Marker key={s.id} position={[s.lat, s.lng]} icon={stationIcon(s)} eventHandlers={{ click: () => onStation?.(s) }}>
          <Popup>
            <b>{s.name}</b><br />
            {s.occupied}/{s.bays} bays in use, {s.queue_min} min queue<br />
            {s.power_type} up to {s.max_kw} kW, {'\u20B9'}{s.tariff_inr_kwh}/kWh<br />
            {s.distance_km != null && <>{s.distance_km} km away, arrive with {s.soc_on_arrival}%<br /></>}
            {s.status !== 'online' && <b>Under maintenance</b>}
            {onRoute && s.status === 'online' && <button className="btn btn-sm mt-2" onClick={() => onRoute(s)}>Show route here</button>}
          </Popup>
        </Marker>
      ))}
      {vehicles.map((v) => (
        <Marker key={v.id} position={[v.lat, v.lng]} icon={vehIcon(v, v.id === selectedVehicle)}>
          <Popup><b>{v.plate}</b><br />{v.make} {v.model}<br />Charge {Math.round(v.soc)}%</Popup>
        </Marker>
      ))}
      {me && <Marker position={me} icon={meIcon}><Popup>Your device location</Popup></Marker>}
      {children}
    </MapContainer>
  );
}
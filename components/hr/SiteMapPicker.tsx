'use client';

import { useEffect, useRef } from 'react';
import type { Circle, Map as LeafletMap, Marker } from 'leaflet';
import 'leaflet/dist/leaflet.css';

/** India, zoomed out, until the site has a spot. */
const DEFAULT_CENTER: [number, number] = [20.5937, 78.9629];
const DEFAULT_ZOOM = 5;
const SITE_ZOOM = 17;

const PIN_HTML =
  '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:#063F35;border:3px solid #fff;' +
  'transform:rotate(-45deg);box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>';

/**
 * OpenStreetMap view of an office site: tap the map or drag the pin to set the spot, and the
 * circle shows the allowed check-in radius. Leaflet loads in the browser only.
 */
export function SiteMapPicker({
  lat,
  lng,
  radiusM,
  onPick,
}: {
  lat: number | null;
  lng: number | null;
  radiusM: number;
  onPick: (lat: number, lng: number) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const circle = useRef<Circle | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const latest = useRef({ lat, lng, radiusM });
  latest.current = { lat, lng, radiusM };

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    void import('leaflet').then((L) => {
      if (cancelled || !el.current || map.current) return;
      const { lat: a, lng: b } = latest.current;
      const has = a != null && b != null;
      const m = L.map(el.current, { scrollWheelZoom: false }).setView(
        has ? [a, b] : DEFAULT_CENTER,
        has ? SITE_ZOOM : DEFAULT_ZOOM,
      );
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(m);
      const icon = L.divIcon({ html: PIN_HTML, className: '', iconSize: [22, 22], iconAnchor: [11, 22] });
      marker.current = L.marker(has ? [a, b] : DEFAULT_CENTER, { draggable: true, icon });
      circle.current = L.circle(has ? [a, b] : DEFAULT_CENTER, {
        radius: latest.current.radiusM,
        color: '#063F35',
        weight: 2,
        fillOpacity: 0.12,
      });
      if (has) {
        marker.current.addTo(m);
        circle.current.addTo(m);
      }
      marker.current.on('dragend', () => {
        const p = marker.current!.getLatLng();
        pick.current(p.lat, p.lng);
      });
      m.on('click', (e) => pick.current(e.latlng.lat, e.latlng.lng));
      map.current = m;
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Follow the form: typed coordinates, "Use my current location", or a pick on the map.
  useEffect(() => {
    const m = map.current;
    if (!m || !marker.current || !circle.current) return;
    if (lat == null || lng == null) {
      marker.current.remove();
      circle.current.remove();
      return;
    }
    const first = !m.hasLayer(marker.current);
    marker.current.setLatLng([lat, lng]).addTo(m);
    circle.current.setLatLng([lat, lng]).setRadius(radiusM).addTo(m);
    if (first) m.setView([lat, lng], SITE_ZOOM);
    else if (!m.getBounds().pad(-0.2).contains([lat, lng])) m.panTo([lat, lng]);
  }, [lat, lng, radiusM]);

  return (
    <div className="space-y-1">
      <div ref={el} className="z-0 h-64 w-full overflow-hidden rounded-lg border border-border" />
      <p className="text-xs text-text-secondary">Tap the map or drag the pin to the shop entrance. The circle is the check-in area.</p>
    </div>
  );
}

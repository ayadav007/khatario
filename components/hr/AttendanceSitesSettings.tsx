'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2, LocateFixed, MapPin, Plus, Trash2, Wifi } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToastContext } from '@/contexts/ToastContext';
import { SiteMapPicker } from '@/components/hr/SiteMapPicker';

type Wifi = { bssid: string; ssid: string | null };
type Suggestion = Wifi & { employees: number; seen: number };
type Site = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
  require_wifi: boolean;
  wifi: Wifi[];
  assigned_employees: number;
  wifi_suggestions: Suggestion[];
};
type Draft = { id?: string; name: string; lat: string; lng: string; radius_m: string; require_wifi: boolean; wifi: Wifi[] };

const EMPTY: Draft = { name: '', lat: '', lng: '', radius_m: '150', require_wifi: false, wifi: [] };

/** The old single-office geofence from the attendance policy, still enforced while there are no sites. */
export type LegacyGeofence = { lat: number; lng: number; radius_m: number };

function coords(lat: string, lng: string): { lat: number; lng: number } | null {
  if (!lat.trim() || !lng.trim()) return null;
  const a = Number(lat);
  const b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 ? { lat: a, lng: b } : null;
}

function mapUrl(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
}

type AddressState = { status: 'idle' | 'loading' | 'done' | 'error'; text?: string | null };

function toDraft(s: Site): Draft {
  return {
    id: s.id,
    name: s.name,
    lat: String(s.lat),
    lng: String(s.lng),
    radius_m: String(s.radius_m),
    require_wifi: s.require_wifi,
    wifi: s.wifi,
  };
}

/** Office sites for the Khatario Staff app: location, radius and trusted Wi-Fi routers. */
export function AttendanceSitesSettings({
  legacyGeofence,
  onTurnOffGeofence,
}: {
  legacyGeofence?: LegacyGeofence | null;
  onTurnOffGeofence?: () => Promise<void>;
} = {}) {
  const toast = useToastContext();
  const [address, setAddress] = useState<AddressState>({ status: 'idle' });
  const [turningOff, setTurningOff] = useState(false);
  const [sites, setSites] = useState<Site[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newBssid, setNewBssid] = useState('');
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/employees/attendance/sites');
    const data = await res.json().catch(() => ({}));
    if (res.ok) setSites(data.sites ?? []);
    else {
      setSites([]);
      toast.error(data.error || 'Could not load office sites');
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Street address for the coordinates being edited, from OpenStreetMap.
  const point = draft ? coords(draft.lat, draft.lng) : null;
  const pointKey = point ? `${point.lat.toFixed(5)},${point.lng.toFixed(5)}` : '';
  useEffect(() => {
    if (!pointKey) {
      setAddress({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setAddress({ status: 'loading' });
    const timer = setTimeout(async () => {
      const [lat, lng] = pointKey.split(',');
      try {
        const res = await fetch(`/api/employees/attendance/sites/address?lat=${lat}&lng=${lng}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        setAddress(res.ok ? { status: 'done', text: data.address ?? null } : { status: 'error' });
      } catch {
        if (!cancelled) setAddress({ status: 'error' });
      }
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pointKey]);

  function fillMyLocation() {
    if (!navigator.geolocation || !draft) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDraft((d) => (d ? { ...d, lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) } : d));
        setLocating(false);
      },
      () => {
        toast.error('Could not read your location. Allow location access or type the coordinates.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  function addWifi(w: Wifi) {
    setDraft((d) => (d && !d.wifi.some((x) => x.bssid === w.bssid) ? { ...d, wifi: [...d.wifi, w] } : d));
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch(draft.id ? `/api/employees/attendance/sites/${draft.id}` : '/api/employees/attendance/sites', {
        method: draft.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          lat: Number(draft.lat),
          lng: Number(draft.lng),
          radius_m: Number(draft.radius_m),
          require_wifi: draft.require_wifi,
          wifi: draft.wifi,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Could not save the site');
        return;
      }
      toast.success('Site saved');
      setDraft(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(site: Site) {
    if (!window.confirm(`Remove ${site.name}? Staff can no longer check in there.`)) return;
    const res = await fetch(`/api/employees/attendance/sites/${site.id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('Site removed');
      await load();
    } else toast.error('Could not remove the site');
  }

  const editingSite = draft?.id ? sites?.find((s) => s.id === draft.id) : undefined;

  return (
    <Card padding="md" className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-text-primary">Office sites for the Khatario Staff app</h2>
          <p className="text-xs text-text-muted">
            Staff check in only when they are inside a site, from the Khatario Staff app, the employee portal or
            the kiosk. Adding the office Wi-Fi makes fake GPS much harder. Manual entries by an admin are not
            restricted.
          </p>
        </div>
        {!draft && (
          <Button size="sm" variant="secondary" onClick={() => setDraft({ ...EMPTY })}>
            <Plus className="mr-1 h-4 w-4" /> Add site
          </Button>
        )}
      </div>

      {legacyGeofence && sites?.length === 0 && !draft && (
        <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-100">
          <p>
            Your earlier office geofence is still on: check-ins must be within {legacyGeofence.radius_m} m of{' '}
            <a
              className="underline"
              href={mapUrl(legacyGeofence.lat, legacyGeofence.lng)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {legacyGeofence.lat}, {legacyGeofence.lng}
            </a>
            . Save it as a site to manage it here, or turn it off.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setDraft({
                  ...EMPTY,
                  name: 'Office',
                  lat: String(legacyGeofence.lat),
                  lng: String(legacyGeofence.lng),
                  radius_m: String(Math.max(20, legacyGeofence.radius_m)),
                })
              }
            >
              Save as a site
            </Button>
            {onTurnOffGeofence && (
              <Button
                size="sm"
                variant="ghost"
                disabled={turningOff}
                onClick={async () => {
                  setTurningOff(true);
                  try {
                    await onTurnOffGeofence();
                  } finally {
                    setTurningOff(false);
                  }
                }}
              >
                {turningOff ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Turn it off'}
              </Button>
            )}
          </div>
        </div>
      )}

      {sites === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
      ) : sites.length === 0 && !draft ? (
        <p className="text-sm text-text-secondary">No sites yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {sites.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1 text-sm font-medium text-text-primary">
                  <MapPin className="h-4 w-4 shrink-0" /> {s.name}
                </p>
                <a
                  className="inline-flex items-center gap-1 text-xs text-primary-500 hover:underline dark:text-primary-200"
                  href={mapUrl(s.lat, s.lng)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {s.lat}, {s.lng} <ExternalLink className="h-3 w-3" />
                </a>
                <p className="text-xs text-text-secondary">
                  {s.radius_m} m · {s.wifi.length} Wi-Fi {s.require_wifi ? '(required)' : ''} ·{' '}
                  {s.assigned_employees ? `${s.assigned_employees} assigned` : 'open to all staff'}
                  {s.wifi_suggestions.length ? ` · ${s.wifi_suggestions.length} Wi-Fi to review` : ''}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="ghost" onClick={() => setDraft(toDraft(s))}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Remove ${s.name}`} onClick={() => void remove(s)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {draft && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <Input label="Site name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <SiteMapPicker
            lat={point?.lat ?? null}
            lng={point?.lng ?? null}
            radiusM={Math.min(5000, Math.max(20, Number(draft.radius_m) || 150))}
            onPick={(lat, lng) => setDraft((d) => (d ? { ...d, lat: lat.toFixed(6), lng: lng.toFixed(6) } : d))}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Latitude"
              type="number"
              step="any"
              value={draft.lat}
              onChange={(e) => setDraft({ ...draft, lat: e.target.value })}
            />
            <Input
              label="Longitude"
              type="number"
              step="any"
              value={draft.lng}
              onChange={(e) => setDraft({ ...draft, lng: e.target.value })}
            />
          </div>
          <Button size="sm" variant="secondary" onClick={fillMyLocation} disabled={locating}>
            {locating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <LocateFixed className="mr-1 h-4 w-4" />}
            Use my current location
          </Button>
          {point && (
            <div className="rounded-md bg-black/[0.03] px-3 py-2 text-sm dark:bg-white/5">
              <p className="flex items-start gap-1.5 text-text-primary">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                <span>
                  {address.status === 'loading' && 'Finding the address…'}
                  {address.status === 'done' && (address.text || 'No street address found at this spot.')}
                  {address.status === 'error' && 'Could not look up the address. Check the spot on the map.'}
                </span>
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-text-secondary">
                <a
                  className="inline-flex items-center gap-1 font-medium text-primary-500 hover:underline dark:text-primary-200"
                  href={mapUrl(point.lat, point.lng)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View on map <ExternalLink className="h-3 w-3" />
                </a>
                <span>Address and map © OpenStreetMap contributors</span>
              </p>
            </div>
          )}
          <Input
            label="Allowed radius (metres)"
            type="number"
            min={20}
            max={5000}
            value={draft.radius_m}
            onChange={(e) => setDraft({ ...draft, radius_m: e.target.value })}
            helperText="100–200 m suits most shops and offices."
          />

          <div className="space-y-2">
            <p className="text-sm font-medium text-text-primary">Office Wi-Fi</p>
            {draft.wifi.length === 0 && (
              <p className="text-xs text-text-secondary">
                None yet. After staff check in here, the routers their phones saw show up below to trust.
              </p>
            )}
            {draft.wifi.map((w) => (
              <div key={w.bssid} className="flex items-center justify-between rounded border border-border px-2 py-1 text-sm">
                <span className="flex items-center gap-2">
                  <Wifi className="h-4 w-4" /> {w.ssid || 'Hidden network'}{' '}
                  <span className="font-mono text-xs text-text-secondary">{w.bssid}</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      wifi: draft.wifi.filter((x) => x.bssid !== w.bssid),
                      require_wifi: draft.wifi.length > 1 && draft.require_wifi,
                    })
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
            {editingSite?.wifi_suggestions
              .filter((s) => !draft.wifi.some((w) => w.bssid === s.bssid))
              .map((s) => (
                <div
                  key={s.bssid}
                  className="flex items-center justify-between rounded border border-dashed border-border px-2 py-1 text-sm"
                >
                  <span>
                    {s.ssid || 'Hidden network'} <span className="font-mono text-xs text-text-secondary">{s.bssid}</span>
                    <span className="block text-xs text-text-secondary">
                      Seen by {s.employees} staff in {s.seen} check-ins
                    </span>
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => addWifi({ bssid: s.bssid, ssid: s.ssid })}>
                    Trust
                  </Button>
                </div>
              ))}
            <div className="flex gap-2">
              <Input
                placeholder="Router address, e.g. a4:2b:b0:11:22:33"
                value={newBssid}
                onChange={(e) => setNewBssid(e.target.value)}
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const hex = newBssid.toLowerCase().replace(/[^0-9a-f]/g, '');
                  if (hex.length !== 12) {
                    toast.error('A router address has 12 letters and numbers.');
                    return;
                  }
                  addWifi({ bssid: hex.match(/.{2}/g)!.join(':'), ssid: null });
                  setNewBssid('');
                }}
              >
                Add
              </Button>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={draft.require_wifi}
                disabled={draft.wifi.length === 0}
                onChange={(e) => setDraft({ ...draft, require_wifi: e.target.checked })}
              />
              <span>
                Require office Wi-Fi
                <span className="block text-xs text-text-secondary">
                  Strictest. Check-in fails unless the phone sees one of these routers.
                </span>
              </span>
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save site'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

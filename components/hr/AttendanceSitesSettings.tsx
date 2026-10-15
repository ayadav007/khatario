'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, LocateFixed, MapPin, Plus, Trash2, Wifi } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToastContext } from '@/contexts/ToastContext';

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
export function AttendanceSitesSettings() {
  const toast = useToastContext();
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
            Staff check in from their own phone only when they are inside a site. Adding the office Wi-Fi makes
            fake GPS much harder. When you add sites, they replace the single geofence above.
          </p>
        </div>
        {!draft && (
          <Button size="sm" variant="secondary" onClick={() => setDraft({ ...EMPTY })}>
            <Plus className="mr-1 h-4 w-4" /> Add site
          </Button>
        )}
      </div>

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

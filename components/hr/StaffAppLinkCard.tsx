'use client';

import { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Loader2, Smartphone } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';
import { StaffFaceEnrollment } from '@/components/hr/StaffFaceEnrollment';

type Device = {
  id: string;
  device_model: string | null;
  os_version: string | null;
  hardware_backed: boolean;
  created_at: string;
  last_seen_at: string | null;
};
type Site = { id: string; name: string };
type Pairing = { code: string; qr: string; expires_at: string };

function when(iso: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Link this employee's phone to the Khatario Staff app, and pick the sites they may check in at. */
export function StaffAppLinkCard({ employeeId }: { employeeId: string }) {
  const toast = useToastContext();
  const [device, setDevice] = useState<Device | null>(null);
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    const [d, s] = await Promise.all([
      fetch(`/api/employees/${employeeId}/staff-app`).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/employees/attendance/sites').then((r) => (r.ok ? r.json() : null)),
    ]);
    setDevice(d?.device ?? null);
    setSiteIds(d?.site_ids ?? []);
    setSites(s?.sites ?? []);
    setLoaded(true);
  }, [employeeId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Count down the code, and notice when the phone has linked.
  useEffect(() => {
    if (!pairing) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      const r = await fetch(`/api/employees/${employeeId}/staff-app`);
      const d = r.ok ? await r.json() : null;
      if (d?.device && d.device.id !== device?.id) {
        setDevice(d.device);
        setPairing(null);
        toast.success('Phone linked');
      }
    }, 4000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [pairing, employeeId, device?.id, toast]);

  async function createCode() {
    setBusy(true);
    try {
      const res = await fetch(`/api/employees/${employeeId}/staff-app`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(data.error || 'Could not create a code');
      else setPairing(data);
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    if (!window.confirm('Unlink this phone? The employee will need a new code to check in.')) return;
    const res = await fetch(`/api/employees/${employeeId}/staff-app`, { method: 'DELETE' });
    if (res.ok) {
      setDevice(null);
      toast.success('Phone unlinked');
    } else toast.error('Could not unlink');
  }

  async function toggleSite(id: string) {
    const next = siteIds.includes(id) ? siteIds.filter((x) => x !== id) : [...siteIds, id];
    const res = await fetch(`/api/employees/${employeeId}/staff-app`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_ids: next }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setSiteIds(data.site_ids ?? next);
    else toast.error(data.error || 'Could not save sites');
  }

  if (!loaded) return null;
  const secondsLeft = pairing ? Math.max(0, Math.round((new Date(pairing.expires_at).getTime() - now) / 1000)) : 0;

  return (
    <Card padding="md" className="space-y-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Smartphone className="h-4 w-4" /> Khatario Staff app
        </h3>
        <p className="mt-1 text-sm text-text-secondary">
          The employee checks in from their own phone. Location, office Wi-Fi and fake-GPS checks run on every
          check-in. One phone per employee.
        </p>
      </div>

      {device ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
          <div>
            <p className="font-medium text-text-primary">{device.device_model || 'Android phone'}</p>
            <p className="text-xs text-text-secondary">
              Linked {when(device.created_at)} · last used {when(device.last_seen_at)}
              {device.hardware_backed ? ' · key in secure hardware' : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => void createCode()} disabled={busy}>
              Link a new phone
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void unlink()}>
              Unlink
            </Button>
          </div>
        </div>
      ) : !pairing ? (
        <Button size="sm" onClick={() => void createCode()} disabled={busy}>
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          Link staff phone
        </Button>
      ) : null}

      {pairing && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border p-4 text-center">
          {secondsLeft > 0 ? (
            <>
              <QRCodeSVG value={pairing.qr} size={180} />
              <p className="font-mono text-lg tracking-widest text-text-primary">{pairing.code}</p>
              <p className="text-xs text-text-secondary">
                Open Khatario Staff on the employee&apos;s phone and scan this, or type the code. Works once, for{' '}
                {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')} more.
                {device ? ' Linking a new phone unlinks the old one.' : ''}
              </p>
            </>
          ) : (
            <p className="text-sm text-text-secondary">This code expired.</p>
          )}
          <div className="flex gap-2">
            {secondsLeft === 0 && (
              <Button size="sm" onClick={() => void createCode()}>
                New code
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setPairing(null)}>
              Close
            </Button>
          </div>
        </div>
      )}

      {device && <StaffFaceEnrollment employeeId={employeeId} />}

      {sites.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-text-primary">Can check in at</p>
          {sites.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={siteIds.includes(s.id)} onChange={() => void toggleSite(s.id)} />
              {s.name}
            </label>
          ))}
          <p className="text-xs text-text-secondary">
            {siteIds.length === 0 ? 'None ticked: any of your sites.' : 'Only the ticked sites.'}
          </p>
        </div>
      )}
    </Card>
  );
}

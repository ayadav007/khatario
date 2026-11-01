'use client';

import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { leadsApi } from './leadLabels';

const field =
  'w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary dark:border-border-dark dark:bg-surface-dark';
const labelCls = 'mb-1 block text-xs font-medium text-text-secondary';

type Option = { id: string; name: string };

const SOURCES: Array<[value: 'call' | 'walk_in' | 'manual', label: string]> = [
  ['call', 'Call'],
  ['walk_in', 'Walk-in'],
  ['manual', 'Other'],
];

/**
 * Adds a lead by hand (a phone call, a walk-in). A number that already has an open lead returns that
 * lead instead: onSaved gets existing = true and the page opens it.
 */
export function AddLeadDialog({
  stages,
  agents,
  onClose,
  onSaved,
}: {
  stages: Option[];
  agents: Option[];
  onClose: () => void;
  onSaved: (leadId: string, existing: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [source, setSource] = useState<'call' | 'walk_in' | 'manual'>('call');
  const [note, setNote] = useState('');
  const [stageId, setStageId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return setError('Enter a name');
    if (phone.replace(/\D/g, '').length < 10) return setError('Enter a 10-digit mobile number, or one with its country code');
    setBusy(true);
    setError(null);
    try {
      const { ok, data } = await leadsApi<{ lead?: { id: string }; existing?: boolean }>('/api/whatsapp/leads', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          source,
          note: note.trim() || undefined,
          stage_id: stageId || undefined,
          owner_id: ownerId || undefined,
        }),
      });
      if (!ok || !data.lead) {
        setError(data.error || 'Could not add the lead');
        return;
      }
      onSaved(data.lead.id, !!data.existing);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Add lead">
      <form
        className="max-h-full w-full max-w-md overflow-y-auto rounded-xl bg-white p-4 shadow-xl dark:bg-surface-dark"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
          <UserPlus className="h-5 w-5 text-primary-600" />
          Add lead
        </h2>
        <p className="mt-1 text-xs text-text-secondary">For enquiries that came by phone or in person. WhatsApp leads are added on their own.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="add-lead-name">Name</label>
            <input id="add-lead-name" autoFocus className={field} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="add-lead-phone">Phone</label>
            <input
              id="add-lead-phone"
              className={field}
              inputMode="tel"
              placeholder="98765 43210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="add-lead-source">Came by</label>
            <select id="add-lead-source" className={field} value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
              {SOURCES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="add-lead-stage">Stage</label>
            <select id="add-lead-stage" className={field} value={stageId} onChange={(e) => setStageId(e.target.value)}>
              <option value="">First open stage</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="add-lead-owner">Owner</label>
            <select id="add-lead-owner" className={field} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Nobody yet</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="add-lead-note">Note (optional)</label>
            <textarea id="add-lead-note" className={field} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? 'Adding…' : 'Add lead'}
          </Button>
        </div>
      </form>
    </div>
  );
}

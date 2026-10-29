'use client';

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { LeadRow } from '@/lib/leads/list';
import { ConvertLeadDialog } from './ConvertLeadDialog';
import { LeadDrawer, NewEnquiryButton } from './LeadDrawer';
import { leadsApi, phoneTail, sourceLabel } from './leadLabels';

/** This number's leads in the chat's contact panel, newest first; each opens the lead drawer. */
export function ChatLeadsSection({ phone }: { phone: string }) {
  const [leads, setLeads] = useState<LeadRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [convertOpen, setConvertOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tail = phoneTail(phone);

  const load = useCallback(async () => {
    if (tail.length < 10) {
      setLeads([]);
      return;
    }
    const { ok, data } = await leadsApi<{ rows: LeadRow[] }>(`/api/whatsapp/leads?search=${encodeURIComponent(tail)}&status=all`);
    // Search is a substring match; keep only this number's leads (last 10 digits).
    setLeads(ok ? (data.rows || []).filter((r) => phoneTail(r.phone) === tail) : []);
  }, [tail]);

  useEffect(() => {
    setLeads(null);
    setError(null);
    void load();
  }, [load]);

  if (!leads || leads.length === 0) return null;
  const open = leads.find((l) => !l.closed_at) ?? null;

  return (
    <div className="space-y-2 border-b border-gray-200 pb-4 dark:border-border-dark">
      <span className="mb-1 block text-xs font-medium text-gray-700 dark:text-text-secondary">Leads from this number</span>
      <ul className="space-y-1">
        {leads.map((l) => (
          <li key={l.id}>
            <button
              type="button"
              onClick={() => setOpenId(l.id)}
              className="flex w-full items-center gap-2 rounded-lg border border-gray-200 px-2 py-1.5 text-left text-xs hover:bg-gray-50 dark:border-border-dark dark:hover:bg-surface-dark"
            >
              <span className="text-gray-800 dark:text-text-primary">{format(new Date(l.opened_at), 'd MMM yyyy')}</span>
              <span className="truncate text-gray-500">
                {l.stage_name || 'Not on the pipeline'} · {sourceLabel(l.source)}
              </span>
              <span className={`ml-auto shrink-0 font-medium ${l.closed_at ? 'text-gray-500' : 'text-primary-700'}`}>
                {l.closed_at ? 'Closed' : 'Open'}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <div className="flex flex-wrap gap-2">
          <NewEnquiryButton
            lead={open}
            onCreated={(id) => {
              void load();
              setOpenId(id);
            }}
            onError={setError}
          />
          {!open.customer_id && (
            <Button type="button" variant="secondary" size="sm" onClick={() => setConvertOpen(true)}>
              <UserCheck className="mr-1 h-4 w-4" />
              Convert to customer
            </Button>
          )}
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}

      {open && convertOpen && (
        <ConvertLeadDialog
          leadId={open.id}
          name={open.name}
          phone={open.phone}
          onClose={() => setConvertOpen(false)}
          onConverted={() => {
            setConvertOpen(false);
            void load();
          }}
        />
      )}

      <LeadDrawer leadId={openId} onClose={() => setOpenId(null)} onChanged={() => void load()} onOpenLead={setOpenId} />
    </div>
  );
}

'use client';

import { useState } from 'react';
import { clsx } from 'clsx';
import { FileSignature, Landmark, Paperclip, QrCode, ScrollText, StickyNote, X } from 'lucide-react';
import { SectionLabel } from './Kbd';
import type { Seller } from '../_lib/mock-data';

type AddOnId = 'notes' | 'terms' | 'bank' | 'qr' | 'signature' | 'attachments';

const ADD_ONS: { id: AddOnId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'notes', label: 'Notes', icon: StickyNote },
  { id: 'terms', label: 'Terms & conditions', icon: ScrollText },
  { id: 'bank', label: 'Bank account', icon: Landmark },
  { id: 'qr', label: 'Payment QR', icon: QrCode },
  { id: 'signature', label: 'Signature', icon: FileSignature },
  { id: 'attachments', label: 'Attachments', icon: Paperclip },
];

const textareaCls =
  'w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-primary-500 focus:ring-4 focus:ring-primary-100';

export function AddOnsPanel({ seller }: { seller: Seller }) {
  const [active, setActive] = useState<Set<AddOnId>>(new Set(['terms', 'bank']));

  const toggle = (id: AddOnId) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const shown = ADD_ONS.filter((a) => active.has(a.id));
  const hidden = ADD_ONS.filter((a) => !active.has(a.id));

  return (
    <div className="flex min-w-0 flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <SectionLabel>Printed on invoice</SectionLabel>
      </div>

      {hidden.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {hidden.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => toggle(a.id)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 transition hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700"
            >
              <a.icon className="h-3.5 w-3.5" />+ {a.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {shown.map((a) => (
          <AddOnCard key={a.id} title={a.label} icon={a.icon} onRemove={() => toggle(a.id)} wide={a.id === 'notes' || a.id === 'terms'}>
            {a.id === 'notes' && (
              <textarea rows={2} autoFocus placeholder="Visible to the customer, e.g. delivery instructions" className={textareaCls} />
            )}
            {a.id === 'terms' && (
              <textarea
                rows={3}
                className={textareaCls}
                defaultValue={
                  '1. Goods once sold will not be taken back.\n2. Interest @18% p.a. on payments after due date.\n3. Subject to Pune jurisdiction.'
                }
              />
            )}
            {a.id === 'bank' && (
              seller.bank.account ? (
                <div className="text-xs leading-relaxed text-slate-600">
                  <p className="text-sm font-semibold text-slate-900">{seller.bank.name}</p>
                  <p>
                    A/c <span className="font-mono font-semibold">••••{seller.bank.account.slice(-4)}</span> · IFSC{' '}
                    <span className="font-mono">{seller.bank.ifsc}</span>
                  </p>
                  <p>{seller.bank.branch}</p>
                  <button type="button" className="mt-1 font-semibold text-primary-700 hover:underline">
                    Change account
                  </button>
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  No bank account in Business profile.{' '}
                  <span className="font-semibold text-primary-700">Add one</span>
                </p>
              )
            )}
            {a.id === 'qr' && (
              <div className="flex items-center gap-3">
                <FakeQr />
                <div className="text-xs text-slate-600">
                  <p className="font-semibold text-slate-900">UPI</p>
                  <p className="font-mono">{seller.upi}</p>
                  <p className="mt-1 text-slate-400">Amount is pre-filled in the QR</p>
                </div>
              </div>
            )}
            {a.id === 'signature' && (
              <div className="flex h-16 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400">
                <span className="font-[cursive] text-lg text-slate-500">A. Yadav</span>
                Authorised signatory
              </div>
            )}
            {a.id === 'attachments' && (
              <div className="flex h-16 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-500 transition hover:border-primary-300 hover:bg-primary-50/40">
                Drop PO, challan or photos, or <span className="ml-1 font-semibold text-primary-700">browse</span>
              </div>
            )}
          </AddOnCard>
        ))}
      </div>
    </div>
  );
}

function AddOnCard({
  title,
  icon: Icon,
  onRemove,
  wide,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  onRemove: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={clsx('rounded-xl border border-slate-200 bg-slate-50/50 p-3', wide && 'sm:col-span-2')}>
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          <Icon className="h-3.5 w-3.5 text-primary-600" /> {title}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
          aria-label={`Remove ${title}`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {children}
    </div>
  );
}

function FakeQr() {
  const cells = Array.from({ length: 81 }, (_, i) => ((i * 37 + (i % 7) * 11) % 5 < 2 ? 1 : 0));
  return (
    <div className="grid h-16 w-16 shrink-0 grid-cols-9 gap-px rounded-md border border-slate-200 bg-white p-1">
      {cells.map((c, i) => (
        <span key={i} className={c ? 'bg-slate-900' : 'bg-transparent'} />
      ))}
    </div>
  );
}

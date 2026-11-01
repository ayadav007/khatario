'use client';

import React from 'react';
import Link from 'next/link';
import { formatDistanceToNowStrict } from 'date-fns';
import { CalendarClock, ClipboardList, FileText, Inbox, IndianRupee, RotateCcw, Send, ShoppingCart, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { InboxItem, InboxKind } from '@/lib/supplier-hub-home';

const ICON: Record<InboxKind, React.ComponentType<{ className?: string }>> = {
  connection_request: UserPlus,
  order_to_answer: ClipboardList,
  order_to_confirm: ShoppingCart,
  bill_to_receive: Inbox,
  ready_to_bill: FileText,
  draft_to_send: Send,
  payment_to_record: IndianRupee,
  credit_note_to_issue: RotateCcw,
  standing_to_accept: CalendarClock,
};

export const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/**
 * One thing waiting in the Supplier Hub: what happened, the money involved, and the action that
 * clears it. `onAct` runs the in-place actions (confirm, send, accept, decline); links navigate.
 */
export function HubInboxCard({
  item,
  busy,
  onAct,
}: {
  item: InboxItem;
  busy: boolean;
  onAct: (item: InboxItem, choice?: 'accept' | 'decline') => void;
}) {
  const Icon = ICON[item.kind];
  const selling = item.side === 'selling';
  const a = item.action;

  return (
    <li className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
            selling ? 'bg-amber-50 text-amber-700' : 'bg-primary-50 text-primary-700'
          }`}
          aria-hidden
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="font-semibold leading-snug text-text-primary">{item.title}</p>
            {item.amount != null && (
              <p className="shrink-0 font-semibold tabular-nums text-text-primary">
                {item.approx ? '~' : ''}
                {inr(item.amount)}
              </p>
            )}
          </div>
          <p className="mt-0.5 text-sm text-text-secondary">{item.detail}</p>
          <p className="mt-1 text-xs text-text-muted">
            {selling ? 'Selling' : 'Buying'} · {formatDistanceToNowStrict(new Date(item.at), { addSuffix: true })}
          </p>
        </div>
      </div>

      <div className="mt-3 flex gap-2 sm:justify-end sm:pl-[3.25rem]">
        {a.kind === 'request' || a.kind === 'standing' ? (
          <>
            <Button className="flex-1 sm:flex-none" onClick={() => onAct(item, 'accept')} disabled={busy}>
              Accept
            </Button>
            <Button variant="ghost" className="flex-1 sm:flex-none" onClick={() => onAct(item, 'decline')} disabled={busy}>
              Decline
            </Button>
          </>
        ) : (
          <>
            {a.kind === 'link' ? (
              <Link href={a.href} className="flex-1 sm:flex-none">
                <Button className="w-full">{a.label}</Button>
              </Link>
            ) : (
              <Button className="flex-1 sm:flex-none" onClick={() => onAct(item)} disabled={busy}>
                {busy ? 'Working…' : a.label}
              </Button>
            )}
            {!(a.kind === 'link' && a.href === item.href) && (
              <Link href={item.href} className="flex-1 sm:flex-none">
                <Button variant="secondary" className="w-full">
                  {a.kind === 'order' && a.orderAction === 'confirm' ? 'Change' : 'Open'}
                </Button>
              </Link>
            )}
          </>
        )}
      </div>
    </li>
  );
}

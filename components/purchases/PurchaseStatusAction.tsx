'use client';

import { Ban, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import {
  getPurchaseAction,
  PURCHASE_ACTION_COPY,
  type PurchaseActionInput,
  type PurchaseActionKind,
} from '@/lib/accounting-ui/purchase-actions';

interface PurchaseStatusActionProps {
  purchase: PurchaseActionInput & { id: string };
  layout: 'card' | 'row';
  onSelect: (kind: Exclude<PurchaseActionKind, 'none'>) => void;
}

/** Status-dependent destructive action: "Delete draft", "Cancel bill", or nothing for cancelled bills. */
export function PurchaseStatusAction({ purchase, layout, onSelect }: PurchaseStatusActionProps) {
  const action = getPurchaseAction(purchase);
  if (action.kind === 'none') return null;

  const isDraft = action.kind === 'delete_draft';
  const label = isDraft ? PURCHASE_ACTION_COPY.deleteDraft.button : PURCHASE_ACTION_COPY.cancelBill.button;
  const Icon = isDraft ? Trash2 : Ban;
  const noteId = `purchase-action-note-${purchase.id}`;

  return (
    <span
      className={clsx('inline-flex flex-col gap-0.5', layout === 'card' ? 'items-end' : 'items-center')}
      onClick={(e) => e.stopPropagation()}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!!action.blocked}
        title={action.blocked?.message ?? label}
        aria-describedby={action.blocked ? noteId : undefined}
        data-testid={`purchase-action-${purchase.id}`}
        className="text-red-600 hover:text-red-700 hover:bg-red-50 disabled:text-gray-400 disabled:hover:bg-transparent"
        onClick={(e) => {
          e.stopPropagation();
          onSelect(action.kind as Exclude<PurchaseActionKind, 'none'>);
        }}
      >
        <Icon className="w-4 h-4 mr-1" />
        {label}
      </Button>
      {action.blocked && (
        <span id={noteId} className="text-2xs text-gray-500 max-w-[11rem] leading-tight">
          <span className="sr-only">{action.blocked.message}</span>
          <span aria-hidden="true">Can&apos;t cancel: {action.blocked.shortLabel.toLowerCase()}</span>
        </span>
      )}
    </span>
  );
}

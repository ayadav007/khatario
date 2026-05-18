'use client';

import React from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import toast from 'react-hot-toast';

type DeleteActionVariant = 'delete' | 'deactivate';

export function DeleteAction({
  entityName,
  variant,
  deleteFn,
  onSuccess,
  disabled = false,
  disabledTooltip,
  confirmMessage,
  successMessage,
  open,
  onOpenChange,
  hideButton = false,
}: {
  entityName: string;
  variant: DeleteActionVariant;
  deleteFn: () => Promise<void>;
  onSuccess?: () => void | Promise<void>;
  disabled?: boolean;
  disabledTooltip?: string;
  /** Optional override for the body text in the confirmation modal */
  confirmMessage?: string;
  /** Optional override for the success toast message */
  successMessage?: string;
  /** Optional controlled open state */
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
  /** Render only the modal (no trigger button) */
  hideButton?: boolean;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const isControlled = typeof open === 'boolean';
  const isOpen = isControlled ? open : uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  const defaultConfirm =
    variant === 'deactivate'
      ? `Are you sure you want to deactivate this ${entityName}? You can reactivate later.`
      : `Are you sure you want to delete this ${entityName}?`;

  const onConfirm = async () => {
    setBusy(true);
    try {
      await deleteFn();
      toast.success(
        successMessage || (variant === 'deactivate' ? 'Deactivated successfully' : 'Deleted successfully')
      );
      setOpen(false);
      await onSuccess?.();
    } catch (e: any) {
      toast.error(e?.message || 'Action failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const buttonTitle = disabled ? disabledTooltip : variant === 'deactivate' ? 'Deactivate' : 'Delete';

  return (
    <>
      {!hideButton && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || busy}
          title={buttonTitle}
          onClick={() => setOpen(true)}
          className="text-text-muted hover:text-red-600 disabled:hover:text-text-muted"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      )}

      {isOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4"
          onClick={() => {
            if (!busy) setOpen(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-lg border border-border bg-surface p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="mb-2 text-base font-semibold text-text-primary">
              {variant === 'deactivate' ? `Deactivate ${entityName}?` : `Delete ${entityName}?`}
            </div>
            <div className="text-sm text-text-secondary">{confirmMessage || defaultConfirm}</div>

            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={onConfirm}
                disabled={busy}
                className="border border-red-200 text-red-700 hover:bg-red-50"
              >
                {busy ? 'Please wait…' : variant === 'deactivate' ? 'Deactivate' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}


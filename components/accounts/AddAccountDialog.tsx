'use client';

import React, { useEffect } from 'react';
import { AccountCreateForm } from '@/components/accounts/AccountCreateForm';

export function AddAccountDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-4 sm:items-center" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-account-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 shadow-xl dark:bg-surface sm:p-5"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="add-account-title" className="text-lg font-semibold text-text-primary">
              Add account
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              Name the ledger and choose where it sits. Nature and the Profit & Loss section follow that choice.
            </p>
          </div>
          <button type="button" className="text-sm text-text-secondary" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <AccountCreateForm
          onCancel={onClose}
          onCreated={() => {
            onCreated();
            onClose();
          }}
        />
      </div>
    </div>
  );
}

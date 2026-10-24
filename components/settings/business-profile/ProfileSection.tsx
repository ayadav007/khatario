'use client';

import React from 'react';
import { clsx } from 'clsx';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/** Shopify-style annotated row: explanation on the left, settings card on the right. */
export function ProfileSection({
  id,
  tour,
  title,
  description,
  children,
}: {
  id?: string;
  tour?: string;
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      data-tour={tour}
      className="scroll-mt-24 grid grid-cols-1 gap-3 border-t border-border pt-6 first:border-t-0 first:pt-0 dark:border-border-dark lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:gap-10"
    >
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-text-primary">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-text-secondary">{description}</p>
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  );
}

export function EditableCard({
  title,
  isEditing,
  onEdit,
  onCancel,
  onSave,
  saving,
  canEdit = true,
  editTour,
  headerAction,
  summary,
  children,
}: {
  title: string;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  canEdit?: boolean;
  editTour?: string;
  headerAction?: React.ReactNode;
  summary: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={clsx('card overflow-hidden', isEditing && 'ring-2 ring-primary-500/40')}>
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4 py-2.5 dark:border-border-dark md:px-5">
        <h4 className="text-sm font-semibold text-text-primary">{title}</h4>
        {!isEditing && (headerAction ?? (canEdit ? (
          <Button type="button" size="sm" variant="ghost" onClick={onEdit} data-tour={editTour}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Edit
          </Button>
        ) : null))}
      </div>
      <div className="px-4 py-4 md:px-5">
        {isEditing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSave();
            }}
            className="space-y-4"
          >
            {children}
            <div className="flex justify-end gap-2 border-t border-border pt-4 dark:border-border-dark">
              <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" size="sm" isLoading={saving} disabled={saving}>
                Save
              </Button>
            </div>
          </form>
        ) : (
          summary
        )}
      </div>
    </div>
  );
}

export type SummaryRow = {
  label: string;
  value?: string | null;
  /** Shown in amber when empty: the field is needed on invoices. */
  required?: boolean;
  emptyText?: string;
};

export function SummaryList({ rows }: { rows: SummaryRow[] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm">
      {rows.map((r) => (
        <React.Fragment key={r.label}>
          <dt className="text-text-secondary">{r.label}</dt>
          <dd className="min-w-0 break-words">
            {r.value?.trim() ? (
              <span className="text-text-primary">{r.value}</span>
            ) : r.required ? (
              <span className="font-medium text-amber-700 dark:text-amber-400">Missing, needed on invoices</span>
            ) : (
              <span className="text-text-muted">{r.emptyText ?? 'Not added'}</span>
            )}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

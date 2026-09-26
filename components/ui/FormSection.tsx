'use client';

import React, { useId, useState } from 'react';
import { clsx } from 'clsx';
import { ChevronDown } from 'lucide-react';

export type FormSectionProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  /** When true, the header toggles the body open and closed. */
  collapsible?: boolean;
  /** Initial open state when `collapsible` is true. Defaults to open. */
  defaultOpen?: boolean;
};

/**
 * Standard form section: neutral header with thin primary left accent (see `.form-section-header` in `app/globals.css`).
 * Prefer semantic tokens over raw `primary-*` utilities in feature code.
 */
export function FormSection({
  title,
  description,
  children,
  className,
  collapsible = false,
  defaultOpen = true,
}: FormSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const isOpen = collapsible ? open : true;

  const headerContent = (
    <>
      <div className="min-w-0 flex-1">
        <h2 className="form-section-title">{title}</h2>
        {description ? <p className="form-section-description">{description}</p> : null}
      </div>
      {collapsible ? (
        <ChevronDown
          className={clsx(
            'mt-0.5 h-5 w-5 shrink-0 text-text-muted transition-transform duration-200',
            isOpen && 'rotate-180'
          )}
          aria-hidden
        />
      ) : null}
    </>
  );

  return (
    <section
      className={clsx(
        'rounded-xl border border-border bg-surface shadow-sm overflow-hidden',
        'dark:bg-surface-dark dark:border-border-dark',
        className
      )}
    >
      {collapsible ? (
        <button
          type="button"
          className={clsx(
            'form-section-header flex w-full items-start justify-between gap-3 text-left',
            !isOpen && 'border-b-transparent'
          )}
          aria-expanded={isOpen}
          aria-controls={bodyId}
          onClick={() => setOpen((current) => !current)}
        >
          {headerContent}
        </button>
      ) : (
        <header className="form-section-header">{headerContent}</header>
      )}
      <div
        id={bodyId}
        hidden={!isOpen}
        className={clsx('form-section-body', !isOpen && 'hidden')}
      >
        {children}
      </div>
    </section>
  );
}

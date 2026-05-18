import React from 'react';
import { clsx } from 'clsx';

export type FormSectionProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
};

/**
 * Standard form section: neutral header with thin primary left accent (see `.form-section-header` in `app/globals.css`).
 * Prefer semantic tokens over raw `primary-*` utilities in feature code.
 */
export function FormSection({ title, description, children, className }: FormSectionProps) {
  return (
    <section
      className={clsx(
        'rounded-xl border border-border bg-surface shadow-sm overflow-hidden',
        'dark:bg-surface-dark dark:border-border-dark',
        className
      )}
    >
      <header className="form-section-header">
        <h2 className="form-section-title">{title}</h2>
        {description ? (
          <p className="form-section-description">{description}</p>
        ) : null}
      </header>
      <div className="form-section-body">{children}</div>
    </section>
  );
}

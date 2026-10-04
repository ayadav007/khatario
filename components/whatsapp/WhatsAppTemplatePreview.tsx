'use client';

import { ImageIcon, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export type WhatsAppPreviewModel = {
  title?: string;
  header?: string | null;
  headerKind?: 'none' | 'text' | 'document' | 'image' | 'video';
  body: string;
  footer?: string | null;
  cta?: string | null;
  /** When set, {{n}} is replaced with these examples. Otherwise placeholders stay visible. */
  examples?: string[];
};

function fillBody(body: string, examples?: string[]): string {
  if (!examples?.length) return body;
  return body.replace(/\{\{(\d+)\}\}/g, (_, n) => {
    const v = examples[Number(n) - 1];
    return v?.trim() ? v : `{{${n}}}`;
  });
}

/** Phone-style WhatsApp bubble used for template gallery preview. */
export function WhatsAppTemplatePreviewCard({
  model,
  className,
}: {
  model: WhatsAppPreviewModel;
  className?: string;
}) {
  const headerKind = model.headerKind || (model.header?.trim() ? 'text' : 'none');
  const showMedia = headerKind === 'image' || headerKind === 'video' || headerKind === 'document';
  const body = fillBody(model.body, model.examples);

  return (
    <div className={className}>
      <div className="mx-auto w-full max-w-[320px] overflow-hidden rounded-2xl border border-border bg-white shadow-md dark:border-border-dark dark:bg-surface-dark">
        {showMedia ? (
          <div className="flex h-28 items-center justify-center bg-amber-50 dark:bg-amber-950/30">
            <ImageIcon className="h-10 w-10 text-amber-400" aria-hidden />
          </div>
        ) : null}
        <div className="space-y-2 px-4 py-3 text-sm text-text-primary">
          {headerKind === 'text' && model.header?.trim() ? (
            <p className="font-semibold">{model.header}</p>
          ) : null}
          <p className="whitespace-pre-wrap leading-relaxed">{body}</p>
          {model.footer?.trim() ? <p className="text-xs text-text-muted">{model.footer}</p> : null}
        </div>
        {model.cta?.trim() ? (
          <div className="border-t border-border px-4 py-2.5 text-center text-sm font-medium text-sky-600 dark:border-border-dark">
            {model.cta}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function WhatsAppTemplatePreviewModal({
  open,
  model,
  onClose,
  primaryLabel,
  onPrimary,
  primaryDisabled,
}: {
  open: boolean;
  model: WhatsAppPreviewModel | null;
  onClose: () => void;
  primaryLabel?: string;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
}) {
  if (!open || !model) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <button type="button" className="absolute inset-0" aria-label="Close preview" onClick={onClose} />
      <div className="relative z-[91] w-full max-w-md rounded-2xl bg-[#f7f7f5] p-4 shadow-xl dark:bg-zinc-900">
        <div className="mb-3 flex items-center justify-between">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-white">
            WA
          </span>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-text-muted hover:bg-white" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        {model.title ? <p className="mb-3 text-sm font-semibold text-text-primary">{model.title}</p> : null}
        <WhatsAppTemplatePreviewCard model={model} />
        {onPrimary ? (
          <Button className="mt-4 w-full" onClick={onPrimary} disabled={primaryDisabled}>
            {primaryLabel || 'Review and submit'}
          </Button>
        ) : (
          <Button className="mt-4 w-full" variant="secondary" onClick={onClose}>
            Close
          </Button>
        )}
      </div>
    </div>
  );
}

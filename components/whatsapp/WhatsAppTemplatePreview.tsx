'use client';

import type { ReactNode } from 'react';
import { ExternalLink, FileText, ImageIcon, Phone, Video, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export type WhatsAppPreviewModel = {
  title?: string;
  header?: string | null;
  headerKind?: 'none' | 'text' | 'document' | 'image' | 'video';
  body: string;
  footer?: string | null;
  cta?: string | null;
  ctaUrl?: string | null;
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

/** Render WhatsApp *bold*, _italic_, ~strike~, and keep {{n}} readable. */
function formatWhatsAppText(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|\{\{\d+\}\})/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith('*')) {
      nodes.push(<strong key={key++}>{token.slice(1, -1)}</strong>);
    } else if (token.startsWith('_')) {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith('~')) {
      nodes.push(<s key={key++}>{token.slice(1, -1)}</s>);
    } else {
      nodes.push(
        <span key={key++} className="rounded bg-emerald-100/80 px-0.5 font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
          {token}
        </span>,
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function MediaHeader({ kind }: { kind: 'document' | 'image' | 'video' }) {
  const Icon = kind === 'video' ? Video : kind === 'document' ? FileText : ImageIcon;
  const label = kind === 'video' ? 'Video' : kind === 'document' ? 'Document' : 'Image';
  return (
    <div className="mb-1.5 flex h-[140px] items-center justify-center rounded-lg bg-[#FFE9C9]">
      <div className="flex flex-col items-center gap-1 text-[#E8A838]">
        <Icon className="h-10 w-10" aria-hidden />
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
    </div>
  );
}

/** Phone-style WhatsApp bubble used for template gallery + editor preview. */
export function WhatsAppTemplatePreviewCard({
  model,
  className,
  phone = true,
}: {
  model: WhatsAppPreviewModel;
  className?: string;
  /** Wrap in a chat phone chrome. */
  phone?: boolean;
}) {
  const headerKind = model.headerKind || (model.header?.trim() ? 'text' : 'none');
  const showMedia = headerKind === 'image' || headerKind === 'video' || headerKind === 'document';
  const body = fillBody(model.body, model.examples);
  const now = '10:24';

  const bubble = (
    <div className="max-w-[92%]">
      <div className="relative rounded-lg rounded-tl-none bg-white px-2 pb-1.5 pt-1.5 shadow-sm">
        {showMedia ? <MediaHeader kind={headerKind} /> : null}
        {headerKind === 'text' && model.header?.trim() ? (
          <p className="mb-0.5 text-[15px] font-semibold leading-snug text-[#111b21]">{model.header}</p>
        ) : null}
        <p className="whitespace-pre-wrap text-[14.2px] leading-[1.35] text-[#111b21]">{formatWhatsAppText(body)}</p>
        {model.footer?.trim() ? (
          <p className="mt-1 text-[12.5px] leading-snug text-[#667781]">{model.footer}</p>
        ) : null}
        <div className="mt-0.5 flex justify-end">
          <span className="text-[11px] leading-none text-[#667781]">{now}</span>
        </div>
        {model.cta?.trim() ? (
          <div className="mt-1.5 border-t border-[#e9edef] pt-2">
            <div className="flex items-center justify-center gap-1.5 text-[14px] font-medium text-[#027eb5]">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              {model.cta}
            </div>
          </div>
        ) : null}
      </div>
      {model.ctaUrl?.trim() ? (
        <div className="mt-2 rounded-lg bg-white/90 px-3 py-2 text-center text-[12px] text-[#667781] shadow-sm">
          {model.ctaUrl}
        </div>
      ) : null}
    </div>
  );

  if (!phone) {
    return <div className={className}>{bubble}</div>;
  }

  return (
    <div className={className}>
      <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-[1.75rem] border border-[#d1d7db] bg-[#0b141a] shadow-xl">
        {/* Status bar */}
        <div className="flex items-center justify-between bg-[#008069] px-4 pb-1 pt-2 text-[11px] font-medium text-white">
          <span>9:41</span>
          <div className="flex items-center gap-1 opacity-90">
            <span className="inline-block h-2 w-3 rounded-sm bg-white/90" />
            <span className="inline-block h-2.5 w-4 rounded-sm bg-white/90" />
          </div>
        </div>
        {/* Chat header */}
        <div className="flex items-center gap-2 bg-[#008069] px-3 pb-2.5 pt-1 text-white">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-xs font-bold">B</div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-medium leading-tight">{model.title || 'Your business'}</p>
            <p className="text-[11px] text-white/80">online</p>
          </div>
          <Phone className="h-4 w-4 opacity-90" aria-hidden />
          <Video className="h-4 w-4 opacity-90" aria-hidden />
        </div>
        {/* Chat wallpaper */}
        <div
          className="min-h-[360px] px-2.5 py-3"
          style={{
            backgroundColor: '#efeae2',
            backgroundImage:
              'radial-gradient(circle at 20% 20%, rgba(0,0,0,0.03) 0 1px, transparent 1px), radial-gradient(circle at 80% 60%, rgba(0,0,0,0.03) 0 1px, transparent 1px)',
            backgroundSize: '18px 18px',
          }}
        >
          {bubble}
        </div>
        <div className="flex items-center gap-2 bg-[#f0f2f5] px-2 py-2">
          <div className="h-9 flex-1 rounded-full bg-white px-3 text-[13px] leading-9 text-[#8696a0]">Message</div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#008069] text-white">
            <span className="text-lg leading-none">▶</span>
          </div>
        </div>
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
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/45 p-4 sm:items-center">
      <button type="button" className="absolute inset-0" aria-label="Close preview" onClick={onClose} />
      <div className="relative z-[91] w-full max-w-md rounded-2xl bg-[#f0f2f5] p-4 shadow-xl dark:bg-zinc-900">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-[11px] font-bold text-white">
              WA
            </span>
            <p className="truncate text-sm font-semibold text-text-primary">{model.title || 'Preview'}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-text-muted hover:bg-white" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
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

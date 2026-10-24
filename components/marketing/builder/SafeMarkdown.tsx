import { Fragment, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { isSafeHref } from '@/lib/marketing-builder/safe-url';

const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)\s]+\))/g;

function renderInline(text: string, keyPrefix: string, linkClassName?: string): ReactNode[] {
  const parts = text.split(INLINE_RE).filter((p) => p !== '');
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={key} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const [, label, href] = link;
      if (!isSafeHref(href)) return <Fragment key={key}>{label}</Fragment>;
      const external = /^https?:\/\//i.test(href);
      return (
        <a
          key={key}
          href={href}
          className={clsx('font-semibold underline-offset-2 hover:underline', linkClassName ?? 'text-primary-700')}
          {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {label}
        </a>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

function renderLines(lines: string[], keyPrefix: string, linkClassName?: string): ReactNode[] {
  return lines.flatMap((line, i) => {
    const nodes = renderInline(line, `${keyPrefix}-${i}`, linkClassName);
    return i < lines.length - 1 ? [...nodes, <br key={`${keyPrefix}-br-${i}`} />] : nodes;
  });
}

/**
 * Renders a tiny markdown subset: paragraphs, line breaks, **bold**, *italic*,
 * [links](url) and "- " / "1. " lists. No raw HTML is ever emitted.
 */
export function SafeMarkdown({
  text,
  className,
  linkClassName,
  inline = false,
}: {
  text: string;
  className?: string;
  linkClassName?: string;
  inline?: boolean;
}) {
  if (!text) return null;
  if (inline) {
    return <span className={className}>{renderLines(text.split('\n'), 'i', linkClassName)}</span>;
  }

  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return (
    <div className={className}>
      {blocks.map((block, bi) => {
        const lines = block.split('\n').filter((l) => l.trim() !== '');
        if (lines.length === 0) return null;
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return (
            <ul key={bi} className="my-3 list-disc space-y-1 pl-5 first:mt-0 last:mb-0">
              {lines.map((l, li) => (
                <li key={li}>{renderInline(l.replace(/^\s*[-*]\s+/, ''), `${bi}-${li}`, linkClassName)}</li>
              ))}
            </ul>
          );
        }
        if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
          return (
            <ol key={bi} className="my-3 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0">
              {lines.map((l, li) => (
                <li key={li}>{renderInline(l.replace(/^\s*\d+[.)]\s+/, ''), `${bi}-${li}`, linkClassName)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={bi} className="my-3 first:mt-0 last:mb-0">
            {renderLines(lines, `${bi}`, linkClassName)}
          </p>
        );
      })}
    </div>
  );
}

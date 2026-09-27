'use client';

import { Fragment, type ReactNode } from 'react';

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\[\d{1,2}\])/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const token = m[0];
    if (token.startsWith('**')) {
      out.push(
        <strong key={`${keyPrefix}-b${i++}`} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      out.push(
        <sup key={`${keyPrefix}-c${i++}`} className="ml-0.5 text-[10px] font-semibold text-primary-600 dark:text-primary-400">
          {token}
        </sup>,
      );
    }
    last = idx + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Minimal, XSS-safe markdown: paragraphs, bullet/numbered lists, bold and [n] citation marks. */
export function MessageContent({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocks.map((block, bi) => {
        const lines = block.split('\n').filter((l) => l.trim());
        const isList = lines.length > 0 && lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l));
        if (isList) {
          const ordered = /^\s*\d+[.)]/.test(lines[0]);
          const items = lines.map((l, li) => (
            <li key={li}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''), `${bi}-${li}`)}</li>
          ));
          return ordered ? (
            <ol key={bi} className="list-decimal space-y-1 pl-5">
              {items}
            </ol>
          ) : (
            <ul key={bi} className="list-disc space-y-1 pl-5">
              {items}
            </ul>
          );
        }
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 ? <br /> : null}
                {inline(l, `${bi}-${li}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

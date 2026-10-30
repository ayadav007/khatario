'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { SuggestResult } from '@/lib/store/store-suggest';
import { splitHighlight } from './highlight';

const DEBOUNCE_MS = 200;
const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

type Row =
  | { kind: 'product'; id: string; item: SuggestResult['products'][number] }
  | { kind: 'category'; id: string; item: SuggestResult['categories'][number] }
  | { kind: 'submit'; id: 'submit' };

function Highlight({ text, q }: { text: string; q: string }) {
  return (
    <>
      {splitHighlight(text, q).map((p, i) =>
        p.match ? (
          <strong key={i} className="font-semibold text-gray-900">
            {p.text}
          </strong>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

export function SearchSuggest({
  subdomain,
  value,
  onChange,
  onPick,
  onSubmit,
  placeholder = 'Search products',
  className,
}: {
  subdomain: string;
  value: string;
  onChange: (q: string) => void;
  onPick: (pick: { type: 'product' | 'category'; id: string }) => void;
  onSubmit: (q: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [result, setResult] = useState<SuggestResult | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Debounced fetch; the previous request is aborted on every keystroke.
  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) {
      setResult(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/public/store/${encodeURIComponent(subdomain)}/search/suggest?q=${encodeURIComponent(q)}`,
          { signal: ctrl.signal },
        );
        if (!res.ok) return;
        setResult((await res.json()) as SuggestResult);
        setActive(-1);
      } catch {
        // aborted or offline: suggestions are optional
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [value, subdomain]);

  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, []);

  const q = value.trim();
  const rows: Row[] = [];
  if (q.length >= 2) {
    for (const p of result?.products ?? []) rows.push({ kind: 'product', id: p.id, item: p });
    for (const c of result?.categories ?? []) rows.push({ kind: 'category', id: c.id, item: c });
    rows.push({ kind: 'submit', id: 'submit' });
  }
  const expanded = open && rows.length > 0;
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const choose = (row: Row) => {
    setOpen(false);
    if (row.kind === 'submit') onSubmit(q);
    else onPick({ type: row.kind, id: row.id });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    } else if (e.key === 'ArrowDown' && rows.length) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % rows.length);
    } else if (e.key === 'ArrowUp' && rows.length) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a <= 0 ? rows.length - 1 : a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (expanded && active >= 0 && rows[active]) choose(rows[active]);
      else if (q) {
        setOpen(false);
        onSubmit(q);
      }
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className ?? ''}`}>
      <input
        type="search"
        role="combobox"
        aria-label="Search"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-[var(--paper,#fff)] px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
      />
      <ul
        id={listId}
        role="listbox"
        hidden={!expanded}
        className="absolute inset-x-0 top-full z-40 mt-1 max-h-[70vh] overflow-y-auto rounded-lg border border-gray-200 bg-[var(--paper,#fff)] py-1 shadow-lg"
      >
        {expanded &&
          rows.map((row, i) => (
            <li
              key={`${row.kind}-${row.id}`}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              // mousedown (not click) so the choice lands before the input blurs
              onMouseDown={(e) => {
                e.preventDefault();
                choose(row);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex min-h-[44px] cursor-pointer items-center gap-3 px-3 py-1.5 text-sm text-gray-600 ${
                i === active ? 'bg-gray-100' : ''
              }`}
            >
              {row.kind === 'product' && (
                <>
                  {row.item.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.item.image_url} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                  ) : (
                    <span aria-hidden className="h-10 w-10 shrink-0 rounded bg-gray-100" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    <Highlight text={row.item.name} q={q} />
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="font-medium text-gray-900">{rupees(row.item.selling_price)}</span>
                    {row.item.mrp != null && row.item.mrp > row.item.selling_price && (
                      <span className="ml-1.5 text-xs text-gray-400 line-through">{rupees(row.item.mrp)}</span>
                    )}
                  </span>
                </>
              )}
              {row.kind === 'category' && (
                <>
                  <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center text-gray-400">
                    ▤
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <Highlight text={row.item.name} q={q} /> <span className="text-xs text-gray-400">in categories</span>
                  </span>
                </>
              )}
              {row.kind === 'submit' && (
                <span className="font-medium text-[var(--primary)]">Search for “{q}”</span>
              )}
            </li>
          ))}
      </ul>
    </div>
  );
}

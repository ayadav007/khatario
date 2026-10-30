'use client';

import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { withStoreDraft } from '@/lib/store/store-context';
import { SearchSuggest } from './SearchSuggest';

export type SearchPick = { type: 'product' | 'category'; id: string };

/**
 * A store header search box with live suggestions. Typing only drives the dropdown; the grid
 * follows on submit. On the catalog the page passes onSubmit/onPick; elsewhere it navigates there.
 */
export function HeaderSearch({
  subdomain,
  value,
  onSubmit,
  onPick,
  placeholder,
  inputRef,
  inputId,
  className,
}: {
  subdomain: string;
  /** The search the grid is showing (the URL's q). */
  value: string;
  onSubmit?: (q: string) => void;
  onPick?: (pick: SearchPick) => void;
  placeholder?: string;
  /** The shell focuses this on "/" and on ?focus=search. */
  inputRef?: RefObject<HTMLInputElement>;
  inputId?: string;
  className?: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(value);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(value), [value]);

  // SearchSuggest owns its input; hand that element to the shell's ref and keep the old id.
  useEffect(() => {
    const input = rootRef.current?.querySelector('input');
    if (!input) return;
    if (inputId) input.id = inputId;
    if (inputRef) (inputRef as MutableRefObject<HTMLInputElement | null>).current = input;
    return () => {
      if (inputRef && inputRef.current === input) (inputRef as MutableRefObject<HTMLInputElement | null>).current = null;
    };
  }, [inputRef, inputId]);

  // Off the catalog: open it with the search or category (keeping a studio preview's draft token).
  const toCatalog = (params: Record<string, string>) => {
    const qs = withStoreDraft(new URLSearchParams(params)).toString();
    router.push(qs ? `/?${qs}` : '/');
  };

  const submit = (q: string) => {
    if (onSubmit) onSubmit(q);
    else if (q) toCatalog({ q });
  };

  const pick = (p: SearchPick) => {
    if (p.type === 'product') router.push(`/products/${encodeURIComponent(p.id)}`);
    else if (onPick) onPick(p);
    else toCatalog({ cat: p.id });
  };

  return (
    <div ref={rootRef} className={className}>
      <SearchSuggest
        subdomain={subdomain}
        value={draft}
        onChange={(q) => {
          setDraft(q);
          // Clearing the box (the search field's own ×) clears the results too.
          if (!q && value) submit('');
        }}
        onPick={pick}
        onSubmit={submit}
        placeholder={placeholder}
      />
    </div>
  );
}

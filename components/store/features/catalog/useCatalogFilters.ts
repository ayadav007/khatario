'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  clearCatalogFilters,
  parseCatalogFilters,
  serializeCatalogFilters,
  toApiParams,
  type CatalogFilterValue,
} from './catalog-filters';

/** Catalog filters held in the page URL; other params (studio draft, utm) are preserved. */
export function useCatalogFilters() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const paramsString = searchParams?.toString() ?? '';
  const value = useMemo(() => parseCatalogFilters(new URLSearchParams(paramsString)), [paramsString]);
  const apiParams = useMemo(() => toApiParams(value).toString(), [value]);

  // Each change is a history entry, so Back undoes a filter; `replace` is for changes that should not
  // add one (live typing).
  const write = useCallback(
    (next: CatalogFilterValue, opts?: { replace?: boolean }) => {
      const qs = serializeCatalogFilters(next, new URLSearchParams(paramsString)).toString();
      const href = qs ? `${pathname}?${qs}` : pathname;
      if (opts?.replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [paramsString, pathname, router],
  );

  const set = useCallback(
    (patch: Partial<CatalogFilterValue>, opts?: { replace?: boolean }) => write({ ...value, ...patch }, opts),
    [value, write],
  );
  const clear = useCallback(() => write(clearCatalogFilters(value)), [value, write]);

  return { value, set, clear, apiParams };
}

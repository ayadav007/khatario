import type { CatalogFilterValue } from './catalog-filters';

const keyOf = (v: CatalogFilterValue) => JSON.stringify(v);

/**
 * Sidebar edit buffer. Every change builds on the latest local value (never on stale props),
 * and props only overwrite it when they actually change to something we did not send.
 * Checkbox-style changes send at once (with any pending price); price changes share ONE debounce.
 */
export function createPendingFilters(
  initial: CatalogFilterValue,
  send: (v: CatalogFilterValue) => void,
  onLocal: (v: CatalogFilterValue) => void,
  delayMs = 400,
) {
  let pending = initial;
  let propsKey = keyOf(initial);
  // Sends whose echo (the URL catching up) has not arrived yet, oldest first. Echoes arrive in order
  // (router.replace), so an echo also retires every send before it. Once echoed, a key is no longer masked.
  let outstanding: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    outstanding.push(keyOf(pending));
    send(pending);
  };

  return {
    get: () => pending,
    patch(change: Partial<CatalogFilterValue>, debounce: boolean) {
      pending = { ...pending, ...change };
      onLocal(pending);
      if (!debounce) return flush();
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    /** Call with the parent's value on every render. */
    sync(props: CatalogFilterValue) {
      const k = keyOf(props);
      if (k === propsKey) return;
      propsKey = k;
      const at = outstanding.indexOf(k);
      if (at >= 0) {
        outstanding = outstanding.slice(at + 1);
        return;
      }
      outstanding = [];
      pending = props;
      onLocal(props);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

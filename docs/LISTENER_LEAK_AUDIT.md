# Listener leak investigation

## Enable attribution probe

```js
localStorage.setItem('khatario_debug_listeners', '1')
// optional: stack on every add
localStorage.setItem('khatario:listener-probe-verbose', '1')
```

Hard reload, then wait 30s idle on a hot page (`/invoices`, `/customers`, `/dashboard`).

If you see `Invalid value used as weak map key` in the console, pull latest — the probe must not throw (older builds could spam this and add CPU load).

```js
window.__KHATARIO_LISTENER_PROBE__.snapshot()
window.__KHATARIO_LISTENER_PROBE__.topLeakers(15)
```

Every **5s** the console prints grouped top sources: `file`, `event`, `target`, `adds/removes/net`, `dup`, `phase`.

**Critical signal:** `renderAdds > 0` or console errors `addEventListener during RENDER` → listener registered in render path (fix immediately).

**Unmatched removes:** handler identity changed between add/remove (unstable inline callback).

**Duplicate adds:** same `(target, type, handler)` registered twice without remove.

## Shell navigation (HAR finding)

`commitShellNavigation` / `handleShellNavClick` use `window.location.assign` → **full document reload** per sidebar/more link. Each navigation:

- Remounts entire provider tree from `app/layout.tsx`
- Re-runs all `useEffect` listener registration once per mount

Performance Monitor “JS event listeners” can still climb on a **single page** if something registers in a loop without cleanup.

## Static audit — inspected files

| File | Listeners | Cleanup | Stable deps | Notes |
|------|-----------|---------|-------------|-------|
| `ListenerLeakProbeBoot` | — | N/A | — | Install moved to **module load** via `app/layout.tsx` import; boot is backup only |
| `RuntimeProbeBoot` | none | — | — | Timers only when `khatario:runtime-probe=1` |
| `ServiceWorkerRegistration` | `controllerchange`, `focus`, `error`, `load`, `updatefound`, `statechange` | partial | `[]` | `updatefound` on `reg` was re-attachable; **fixed** with module singleton guard |
| `NetworkStatusProvider` | `online`, `offline`, Capacitor `networkStatusChange` | yes | was `[applyOnlineState]` | **Fixed** — handlers use ref; effect deps `[]` |
| `OfflineSyncProvider` | `NETWORK_RECONNECT_EVENT` | yes | `[scope, isOffline, triggerSync]` | Re-subscribes when `triggerSync` identity changes (pending count) |
| `CatalogSyncProvider` | `NETWORK_RECONNECT_EVENT` | yes | `[scope, userId, isOnline]` | OK |
| `LayoutProvider` | none | — | — | OK |
| `AuthContext` | `NETWORK_RECONNECT_EVENT` | yes | `[]` | OK |
| `NotificationContext` | `visibilitychange` (+ SSE when enabled) | yes | `[business, user, fetchNotifications]` | SSE/poll gated by `DISABLE_NOTIFICATION_SSE` |
| `app/(app)/layout.tsx` | `posModeChanged`, `storage` | yes | `[]` | OK |
| `PromotionBanner` | none | — | — | Layout shift CLS from `animate-in slide-in-from-top` |
| `ProductTour` | `matchMedia`, `PRODUCT_TOUR_START_EVENT` | yes | many | **Fixed** — tour handler uses refs; fewer re-subscribes on pathname churn |
| `TopBar` | `matchMedia`, `mousedown` | yes | `[]` / `[]` | OK |
| `CommandPalette` + `useCommandPalette` | duplicate `keydown` on `document` | yes | `[]` | 2 stable listeners (acceptable) |
| `more/page.tsx` | none | — | — | Slowness likely full reload + provider remount, not local listeners |

## Finding (2026-03): top leakers = IndexedDB

When `topLeakers()` shows `8283-*.js` / `object:IDBRequest` / `object:IDBTransaction` at the top, the churn is from the **`idb` npm package** (catalog + offline DB), not React DOM listeners.

Typical cause in Khatario web builds:

- `IdbCatalogDriver.getStatus()` used to **walk entire item/customer indexes** on every `withReadyCatalog()` call (items/invoices/customers list hydration calls `browseCatalogItemsLocal` → `getStatus` + heavy reads).
- Each IDB cursor step registers short-lived `success`/`error` listeners (normal), but **thousands of calls per minute** keeps Performance Monitor climbing.

**Mitigations shipped:**

- 5s status cache + meta-backed counts in `idb-catalog-driver.ts`
- 5s “catalog ready” cache in `client-search.ts` (`withReadyCatalog`)
- One recount after catalog sync (`refreshIdbCatalogCountMeta`)

Re-run probe after deploy; IDB lines should drop in `adds/sec` at idle.

## Next steps after probe run

1. Note top `file:event@target` lines with highest **net** and **adds/sec** in 5s reports.
2. If `renderAdds > 0`, open `snapshot().recentRenderPhaseAdds`.
3. If `dup` high with `phase=effect`, find effect with unstable handler in that file/line.
4. Share one 5s report block + `topLeakers(5)` for a targeted code fix.

# Offline catalog (SQLite / IndexedDB)

Phase **3d** adds a local **catalog layer** so item and customer search works without network. The action queue stays in IndexedDB; only reference data (items, variants, customers) moves into the catalog store.

## Storage

| Runtime | Driver | Database |
|---------|--------|----------|
| Capacitor APK | `@capacitor-community/sqlite` | `khatario_catalog` |
| Web / dev | IndexedDB | `khatario_catalog_v1` |

Both implement the same `CatalogRepository` interface (`lib/offline/catalog/`).

## Sync

- **Full sync** on first login while online (via `CatalogSyncProvider`).
- **Delta sync** on reconnect and manual trigger (`updated_after` on items/customers APIs).
- Items include **variants** and **branch/warehouse stock** via `GET /api/offline-sync/catalog/items`.
- Caps: 20,000 items / 20,000 customers (warning in UI when approached).

## Offline billing flow

1. User opens app online once → catalog downloads.
2. User goes offline → `ItemAutocomplete`, barcode scanner, mobile item picker, and customer search read from local catalog.
3. Invoice finalize still uses the IndexedDB action queue + server replay (Phases 3a–3c).

## Settings

`/settings/offline-sync` shows catalog counts, last sync time, and **Delta sync** / **Full re-download** buttons.

## APK builds

After adding or upgrading `@capacitor-community/sqlite`, run:

```bash
npm run cap:android:staging:install
```

Confirm native plugin is synced (`npx cap sync android`).

## Out of scope (v1)

- Offline create item/customer
- Supplier catalog
- Moving the action queue to SQLite

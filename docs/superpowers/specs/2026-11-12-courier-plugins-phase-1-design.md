# Courier plugins, Phase 1 (plugin framework + Shiprocket): design

Date: 2026-11-12. Status: written for owner review, nothing built.

## 1. What the owner asked, and what is assumed

Said by the owner:

- Showing Dukaan's Shiprocket plugin screen: "currently we are integrating shiprocket or others using apis, but dukaan.io uses this. can we also have this kind of thing?"
- Showing Dukaan's plugin settings form (account email, password, auto-push toggle): "when i click on connect in previous screen, it brings this screen".
- "what are the other couriers we have in india, we need to have those options also".
- On the proposed first batch (Shiprocket, Delhivery, NimbusPost or iThink Logistics, Porter or Borzo) and the generic plugin system: "yes i will go with you".

Assumed, and open to correction:

- Plugins are open to every plan. Today Shiprocket credentials can only be saved by a business with the `advanced_online_store` feature, because the form lives in the online-store settings API. Phase 1 removes that gate for connecting the courier. See section 11.
- The plugin opens as its own page with tabs (Overview, Setup, FAQ, Settings), not a pop-up followed by a second page as Dukaan has. One page does the same job with less to build.
- Cards use a truck icon, not courier logos. Logos need each brand's artwork and permission.
- "Coming soon" cards are shown only for the couriers already planned: Delhivery, NimbusPost, iThink Logistics, Porter, Borzo.

Success means: a merchant opens Settings → Integrations, sees Shiprocket under Shipping, reads what it does, enters the API user's email and password, and is told at once if Shiprocket rejects them. Everything Shiprocket does today (rates, booking, labels, manifests, tracking, failed-delivery actions, return pickups) works exactly as before. A second courier can later be added without a new table or a new settings screen.

## 2. Where this sits in the larger work

| Phase | What ships |
|---|---|
| **1 (this spec)** | Plugin framework; Shiprocket moved into it. No change to how parcels are booked. |
| 2 | Common courier contract; several couriers connected at once; courier picker when booking; opt-in auto-booking. |
| 3 | Delhivery adapter. |
| 4 | NimbusPost or iThink Logistics adapter. |
| 5 | Porter or Borzo (same-city; no AWB or manifest). |

Each later phase gets its own spec. Nothing in Phase 1 depends on them.

## 3. What exists today

- **Marketplace:** `/settings/integrations` renders `INTEGRATION_CATALOG` from `lib/integrations/catalog.ts` through `components/settings/IntegrationMarketplaceList.tsx`. Each card links to an existing settings page (`configureHref`). `hooks/useIntegrationMarketplaceStatus.ts` works out "Active" with one hand-written fetch per entry.
- **Shiprocket credentials:** three columns on `business_settings`: `store_shiprocket_email`, `store_shiprocket_password_enc` (AES-256-GCM via `lib/payments/secret-encryption.ts`), `store_shiprocket_webhook_token_hash` (SHA-256, unique).
- **Readers of those columns (all of them):**
  - `loadShiprocketCreds` in `lib/store/delivery/index.ts`: every booking, label, manifest, return pickup and rate call goes through it.
  - `resolveBusinessIdForShiprocketToken` in `lib/store/order-lifecycle.ts`: the tracking webhook.
  - `app/api/settings/online-store/route.ts`: GET returns `store_shiprocket_email`, `shiprocket_configured`, `shiprocket_webhook_configured`; PATCH saves the email, password and webhook token.
- **Screens that use that API for Shiprocket:** the web online-store settings page (form under the delivery-provider dropdown) and the phone app (`phone/lib/screens/settings/settings_router.dart`, `items_orders_settings.dart`).
- **Not saved anywhere today:** whether the credentials actually work. A wrong password is only discovered when a booking fails.

## 4. Approaches considered

| | Approach | Verdict |
|---|---|---|
| A | Add a Shiprocket card to the catalogue that links to a new hand-built settings page; keep the three columns. | Rejected. Every further courier would need new columns and a new page. |
| B | One `business_integrations` table, field lists declared in the catalogue, one generated settings page, one API. Shiprocket's own client code is untouched; only where its credentials come from changes. | **Chosen.** |
| C | B, plus rewriting Shiprocket behind a common courier contract now. | Later (Phase 2). It touches booking, webhooks and returns, and Phase 1 should not change behaviour. |

## 5. Data

### 5.1 New table (migration `476_business_integrations.sql`, written but not applied by the agent)

```sql
CREATE TABLE IF NOT EXISTS business_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider VARCHAR(40) NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,       -- non-secret fields, e.g. {"email": "..."}
  secrets_enc JSONB NOT NULL DEFAULT '{}'::jsonb,  -- field -> ciphertext, e.g. {"password": "<base64>"}
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,     -- plugin options (empty in Phase 1)
  webhook_token_hash VARCHAR(64),
  last_verified_at TIMESTAMPTZ,
  connected_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, provider)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_integrations_webhook_token
  ON business_integrations (provider, webhook_token_hash)
  WHERE webhook_token_hash IS NOT NULL;
```

- Each secret is encrypted on its own with the existing `encryptPaymentSecret`, so the value already stored in `store_shiprocket_password_enc` can be copied across as it is.
- A row exists only while the plugin is connected. Disconnecting deletes the row.
- `businesses(id)` is a UUID and `order_fulfilments` references it the same way (migration 355), so the foreign key matches existing tables.

### 5.2 Copying existing Shiprocket connections

Same migration, after the table:

```sql
INSERT INTO business_integrations (business_id, provider, config, secrets_enc, webhook_token_hash)
SELECT business_id,
       'shiprocket',
       jsonb_build_object('email', store_shiprocket_email),
       CASE WHEN store_shiprocket_password_enc IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('password', store_shiprocket_password_enc) END,
       store_shiprocket_webhook_token_hash
FROM business_settings
WHERE store_shiprocket_password_enc IS NOT NULL
   OR store_shiprocket_webhook_token_hash IS NOT NULL
ON CONFLICT (business_id, provider) DO NOTHING;
```

- The three old columns are **not dropped** in Phase 1. New code never reads them. Disconnect sets them to NULL, so running the copy again can never bring back a connection the merchant removed.
- The copy is safe to run twice. If a merchant saves credentials through the old code between the migration and the deploy, run `database/scripts/476-post-deploy-shiprocket-sync.sql` once after the deploy (`pm2 reload`): it repeats the `INSERT` for new rows and refreshes rows that are still exactly the copy (never saved by the new code) from the old columns, which re-running the `INSERT` alone would not do (ruling R6, `docs/SERVER_INFRASTRUCTURE.md` Migration 476).
- Dropping the old columns is a separate later migration, once Phase 1 has run in production.

## 6. The catalogue

`lib/integrations/catalog.ts` stays the single list. Changes:

- `IntegrationCategory` gains `'shipping'` (label "Shipping"); `MARKETPLACE_CATEGORY_PARAMS` gains `shipping`.
- `IntegrationIconKey` gains `'Truck'`.
- `IntegrationCatalogEntry` gains an optional `plugin` block. Entries without it (Email, WhatsApp, AI Sales Agent, SMS) behave exactly as now.

```ts
plugin?: {
  provider: string;                 // key in business_integrations.provider
  overview: string[];               // paragraphs
  setupSteps: string[];
  faq: { q: string; a: string }[];
  fields: PluginField[];
};

type PluginField = {
  key: string;
  label: string;
  help?: string;
  kind: 'text' | 'email' | 'password' | 'webhook_token';
  required: boolean;
};
```

- `password` fields are secrets: stored in `secrets_enc`, never returned.
- `webhook_token` is a token the page generates (32 letters and digits), shows once for the merchant to paste into the courier's panel, and stores only as a hash.
- All other kinds go to `config`.

New entries:

| id | Title | State |
|---|---|---|
| `shiprocket` | Shiprocket | Live. Fields: `email` ("API user email", required), `password` ("API user password", required), `webhook_token` ("Tracking webhook token", optional). |
| `delhivery`, `nimbuspost`, `ithink-logistics`, `porter`, `borzo` | as named | `comingSoon: true`, no `plugin` block. |

Shiprocket copy must say plainly that the login is the **API user** created in Shiprocket under Settings → API, not the main Shiprocket login; that is the mistake Dukaan's "account email" label invites.

Server-only behaviour (credential checks) cannot live in `catalog.ts`, which the browser imports. It goes in `lib/integrations/providers.ts`:

```ts
type ProviderServer = {
  verify(values: { config: Record<string, string>; secrets: Record<string, string> }):
    Promise<{ ok: true } | { ok: false; reason: 'rejected' | 'unreachable'; message: string }>;
  /** Parcels or pickups still with this courier; disconnect is refused when above zero. */
  countInFlight(businessId: string): Promise<number>;
  onChanged?(businessId: string): void;   // e.g. clear the cached Shiprocket token
};
```

Shiprocket's `verify` calls the same login endpoint the client already uses (`/auth/login` in `lib/store/delivery/shiprocket.ts`), without reading or writing the token cache.

## 7. Service and API

### 7.1 `lib/integrations/service.ts`

One module owns the table. Nothing else writes SQL against it.

- `listConnections(businessId)` → `{ provider, config, secretsSet: string[], webhookConfigured, lastVerifiedAt }[]`
- `getConnection(businessId, provider)` → the same shape, or null
- `loadSecrets(businessId, provider)` → decrypted `{ config, secrets }` or null. Server-side callers only.
- `saveConnection(businessId, provider, input, actorUserId)`
- `disconnect(businessId, provider)`
- `resolveBusinessForWebhookToken(provider, token)` → business id or null

`saveConnection` rules:

1. Reject unknown providers and unknown field keys; trim values; require every `required` field (a required secret may be left blank only when one is already stored).
2. A blank secret means "keep the stored one". The values checked are the stored ones overlaid with what was sent.
3. Call the provider's `verify`. `rejected` → nothing is saved, the caller gets the courier's message. `unreachable` → nothing is saved, the caller is told to try again.
4. Upsert `config`, `secrets_enc`, `last_verified_at = now()`, `connected_by`. The webhook token hash changes only when a new token was sent.
5. Call `onChanged`.

`disconnect` rules, in one transaction:

1. If `countInFlight` is above zero, refuse and return the count.
2. Delete the row.
3. For Shiprocket: set the three old `business_settings` columns to NULL, and set `store_delivery_provider` to `'self'` if it was `'shiprocket'`.
4. Call `onChanged`.

`countInFlight` for Shiprocket counts `order_fulfilments` rows with `method = 'shiprocket'` and `status` in `shipped`, `out_for_delivery`, `delivery_failed`, plus return pickups that `hasLivePickup` (in `lib/returns/pickup.ts`) treats as live.

### 7.2 Routes

| Route | Permission | Does |
|---|---|---|
| `GET /api/integrations` | settings, read | `listConnections` for the session's business. |
| `GET /api/integrations/[id]` | settings, read | One connection: `config`, which secrets are set, `webhookConfigured`. Never a secret or a hash. |
| `PUT /api/integrations/[id]` | settings, update | `saveConnection`. 400 with the courier's message when rejected; 502 when unreachable; 409 "Generate a new webhook token" on a token collision. |
| `DELETE /api/integrations/[id]` | settings, update | `disconnect`. 409 with the in-flight count when refused. |

- All four use `requireTenantPermission`, as the online-store route does; the business always comes from the session it validates, never from the request body alone.
- `[id]` is the catalogue id; a catalogue entry without a `plugin` block is 404.
- No plan gate (see section 11).

### 7.3 Existing code that changes source

| Place | Change |
|---|---|
| `loadShiprocketCreds` (`lib/store/delivery/index.ts`) | Reads through `loadSecrets(businessId, 'shiprocket')`. Same return type; no caller changes. |
| `resolveBusinessIdForShiprocketToken` (`lib/store/order-lifecycle.ts`) | Calls `resolveBusinessForWebhookToken('shiprocket', token)`. |
| `GET /api/settings/online-store` | `store_shiprocket_email`, `shiprocket_configured`, `shiprocket_webhook_configured` are filled from the connection, so the phone app keeps working. |
| `PATCH /api/settings/online-store` | When the body carries `store_shiprocket_email`, `store_shiprocket_password` or `store_shiprocket_webhook_token`, they are passed to `saveConnection` (with the credential check). The rest of the PATCH is unchanged. A webhook token of `null` clears the hash, as now. A body that carries only a webhook token changes just the token on an existing connection, without a credential check; with no connection it is refused with "Connect Shiprocket first". |
| Help strings that say "Settings → Online store → Delivery" for connecting Shiprocket (for example `lib/returns/pickup.ts`) | Point to Settings → Integrations → Shiprocket. |

Everything else that mentions Shiprocket (booking, labels, manifests, NDR, returns, COD remittance, the webhook route body) is not edited.

## 8. Screens

### 8.1 Marketplace list (`/settings/integrations`)

- Shipping entries appear in "All integrations" and under `?category=shipping`.
- `useIntegrationMarketplaceStatus` makes one call to `GET /api/integrations`; an entry with a `plugin` block is Active when its provider is in the result. The existing WhatsApp and email checks stay.
- A card with a `plugin` block opens `/settings/integrations/[id]`. Button label: "Connect" when not connected, "Manage" when connected.

### 8.2 Plugin page (`/settings/integrations/[id]`)

- Header: icon, title, short description, a "Connected" badge when connected, and the primary button ("Connect", which opens the Settings tab; or "Disconnect").
- Tabs: **Overview**, **Setup**, **FAQ**, **Settings**. The first three render the catalogue text.
- **Settings** is generated from `fields`:
  - `text` / `email`: an input filled from `config`.
  - `password`: empty input. When a secret is stored, the placeholder reads "Saved. Type a new one to replace it."
  - `webhook_token`: shows the webhook address to paste into the courier's panel (`https://<this site>/api/webhooks/store/shiprocket`), whether a token is saved, and a "Generate token" button. A generated token is shown once with a copy button and the note that it is not shown again; it is sent with the next save.
  - "Save and verify" button. On success: "Connected. Shiprocket accepted these details." On rejection the courier's message is shown under the form and nothing is saved.
- **Disconnect** asks for confirmation. If parcels are in flight the page says how many and that the plugin can be disconnected once they are delivered or returned.
- A user without settings-update permission sees the tabs and the connection state but no form or Disconnect button.
- Unknown id, or an entry without a `plugin` block: the app's not-found page.

### 8.3 Online-store settings page

- The Shiprocket email, password and webhook-token block is removed.
- The delivery-provider dropdown stays. "Shiprocket" can be chosen only when the plugin is connected; otherwise the page shows "Connect Shiprocket under Integrations" with a link.

### 8.4 Phone app

Not changed in Phase 1. Its Shiprocket settings screen keeps reading and saving through the online-store API (section 7.3). Plugin screens on the phone are a follow-up.

## 9. Errors and edge cases

- **Wrong API login:** 400, nothing saved, message from Shiprocket plus "Use the API user from Shiprocket → Settings → API, not your main login."
- **Shiprocket down or slow while saving:** 502, nothing saved, "Could not reach Shiprocket. Nothing was saved; try again." The check has a 10 second limit.
- **Editing only the email:** the stored password is used for the check; if the pair is rejected nothing changes.
- **`PAYMENT_ENCRYPTION_KEY` missing:** save fails with a server error and logs the cause, as today. No plaintext is ever stored.
- **Same webhook token on two businesses:** unique index → 409, "Generate a new webhook token".
- **Row with a webhook token but no password** (possible in existing data): shown as not connected; `loadShiprocketCreds` returns null as it does today; the webhook still resolves.
- **Disconnect while Shiprocket is the checkout provider:** the store falls back to its own delivery charges (`store_delivery_provider = 'self'`).
- **Secrets in logs and responses:** no route returns a secret, a ciphertext or a token hash; errors are logged without request bodies.

## 10. Tests

Unit (`tests/lib/integrations/`):

- Catalogue: every `plugin` entry has unique field keys, at most one `webhook_token`, a provider registered in `providers.ts`; coming-soon entries have no `plugin` block.
- Field validation: unknown keys rejected, required fields enforced, blank secret keeps the stored one.

DB (`tests/db/business-integrations.db.test.ts`, on `kh_phase2_test` only):

- Save with a stub `verify`: rejected → no row; accepted → row with encrypted secret that decrypts to the input.
- `getConnection` and `listConnections` never include secrets or hashes.
- Business A cannot read, change or delete business B's connection; a `business_id` in the body for another business is refused.
- Webhook token: resolves to the right business; unknown token → null; duplicate → conflict.
- Disconnect: refused with an in-flight parcel; otherwise deletes the row, nulls the old columns, resets `store_delivery_provider`.
- The copy statement: a `business_settings` row with old columns produces the expected connection; running it twice changes nothing; a disconnected business is not brought back.
- `loadShiprocketCreds` returns the same credentials from the new table.

Existing tests that seed `store_shiprocket_webhook_token_hash` on `business_settings` (`store-order-safety`, `shiprocket-booking`, `order-return-pickup`, `phase3-6a-store-cancel`) are updated to seed `business_integrations`.

Not automated: a real Shiprocket login. The staging checklist covers it (connect with a real API user, wrong password, book one parcel, receive one tracking update, disconnect).

## 11. Decisions for the owner

1. **Plan gate.** Connecting Shiprocket is open to every plan in this design. Today it effectively needs `advanced_online_store`. If couriers should stay a paid feature, the catalogue entry gets `featureKeys` and the API checks it; say which feature.
2. **Coming-soon list.** Delhivery, NimbusPost, iThink Logistics, Porter, Borzo. Add or remove names freely; they are catalogue text only.
3. **Disconnect with parcels in flight** is refused outright. The alternative is a "disconnect anyway" that stops tracking updates for those parcels.

## 12. Out of scope for Phase 1

- Any courier other than Shiprocket.
- Choosing a courier per order, or more than one courier in use at once.
- Auto-booking new orders ("auto-push").
- Phone-app plugin screens.
- Moving payment gateways, WhatsApp or email into `business_integrations`.
- Dropping the old `business_settings` columns.
- Courier logos.

import { query, queryOne } from '@/lib/db';
import { DEFAULT_SHOP_WELCOME, SHOP_WELCOME_MAX } from './constants';

export { DEFAULT_SHOP_WELCOME, SHOP_WELCOME_MAX };

export type ShopItemScope = 'all' | 'store';

export type ShopSyncSummary = {
  at: string;
  pushed: number;
  removed: number;
  unchanged: number;
  skippedNoImage: number;
  errors: Array<{ item: string; message: string }>;
};

export type ShopSettings = {
  enabled: boolean;
  metaCatalogId: string | null;
  itemScope: ShopItemScope;
  hideOutOfStock: boolean;
  welcomeText: string;
  lastSyncedAt: string | null;
  lastSyncSummary: ShopSyncSummary | null;
};

const DEFAULTS: ShopSettings = {
  enabled: false,
  metaCatalogId: null,
  itemScope: 'all',
  hideOutOfStock: false,
  welcomeText: DEFAULT_SHOP_WELCOME,
  lastSyncedAt: null,
  lastSyncSummary: null,
};

type Row = {
  enabled: boolean;
  meta_catalog_id: string | null;
  item_scope: string;
  hide_out_of_stock: boolean;
  welcome_text: string | null;
  last_synced_at: Date | string | null;
  last_sync_summary: ShopSyncSummary | null;
};

export async function getShopSettings(businessId: string): Promise<ShopSettings> {
  const row = await queryOne<Row>(
    `SELECT enabled, meta_catalog_id, item_scope, hide_out_of_stock, welcome_text, last_synced_at, last_sync_summary
       FROM whatsapp_shop_settings WHERE business_id = $1`,
    [businessId],
  );
  if (!row) return { ...DEFAULTS };
  return {
    enabled: row.enabled,
    metaCatalogId: row.meta_catalog_id?.trim() || null,
    itemScope: row.item_scope === 'store' ? 'store' : 'all',
    hideOutOfStock: row.hide_out_of_stock,
    welcomeText: row.welcome_text?.trim() || DEFAULT_SHOP_WELCOME,
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at).toISOString() : null,
    lastSyncSummary: row.last_sync_summary ?? null,
  };
}

export type ShopSettingsInput = Partial<Pick<ShopSettings, 'enabled' | 'metaCatalogId' | 'itemScope' | 'hideOutOfStock' | 'welcomeText'>>;

/** Meta catalog ids are numeric strings. */
export function normalizeCatalogId(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (!/^\d{5,30}$/.test(s)) throw new Error('Catalog ID should be the number shown in Commerce Manager.');
  return s;
}

export async function saveShopSettings(businessId: string, input: ShopSettingsInput): Promise<ShopSettings> {
  const current = await getShopSettings(businessId);
  const next = {
    enabled: input.enabled ?? current.enabled,
    metaCatalogId: input.metaCatalogId !== undefined ? normalizeCatalogId(input.metaCatalogId) : current.metaCatalogId,
    itemScope: input.itemScope === 'store' || input.itemScope === 'all' ? input.itemScope : current.itemScope,
    hideOutOfStock: input.hideOutOfStock ?? current.hideOutOfStock,
    welcomeText: (input.welcomeText ?? current.welcomeText).trim().slice(0, SHOP_WELCOME_MAX) || DEFAULT_SHOP_WELCOME,
  };
  const catalogChanged = next.metaCatalogId !== current.metaCatalogId;
  await query(
    `INSERT INTO whatsapp_shop_settings (business_id, enabled, meta_catalog_id, item_scope, hide_out_of_stock, welcome_text)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (business_id) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       meta_catalog_id = EXCLUDED.meta_catalog_id,
       item_scope = EXCLUDED.item_scope,
       hide_out_of_stock = EXCLUDED.hide_out_of_stock,
       welcome_text = EXCLUDED.welcome_text,
       last_synced_at = CASE WHEN $7 THEN NULL ELSE whatsapp_shop_settings.last_synced_at END,
       last_sync_summary = CASE WHEN $7 THEN NULL ELSE whatsapp_shop_settings.last_sync_summary END,
       updated_at = NOW()`,
    [businessId, next.enabled, next.metaCatalogId, next.itemScope, next.hideOutOfStock, next.welcomeText, catalogChanged],
  );
  if (catalogChanged) {
    // A different catalog starts empty; forget what was pushed to the old one.
    await query(`DELETE FROM whatsapp_catalog_items WHERE business_id = $1`, [businessId]);
  }
  return getShopSettings(businessId);
}

export async function recordShopSync(businessId: string, summary: ShopSyncSummary): Promise<void> {
  await query(
    `UPDATE whatsapp_shop_settings
        SET last_synced_at = NOW(), last_sync_summary = $2::jsonb, updated_at = NOW()
      WHERE business_id = $1`,
    [businessId, JSON.stringify(summary)],
  );
}

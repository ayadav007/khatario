import { query, queryOne } from '@/lib/db';

/** Platform switch. False hides Supplier Hub everywhere; the plan checkbox is separate. */
export async function isSupplierHubVisible(): Promise<boolean> {
  try {
    const row = await queryOne<{ supplier_hub_visible: boolean | null }>(
      `SELECT supplier_hub_visible FROM platform_settings WHERE id = 'default'`,
    );
    return row?.supplier_hub_visible === true;
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code;
    // Column not migrated yet: keep the previous menus until the migration runs.
    if (code === '42703') return true;
    throw error;
  }
}

/** When on, a new directory listing waits for platform approval (migration 430). */
export async function isListingReviewOn(): Promise<boolean> {
  try {
    const row = await queryOne<{ on: boolean | null }>(
      `SELECT supplier_hub_review_listings AS on FROM platform_settings WHERE id = 'default'`,
    );
    return row?.on === true;
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === '42703') return false;
    throw error;
  }
}

export async function setListingReview(on: boolean): Promise<void> {
  const updated = await query(
    `UPDATE platform_settings SET supplier_hub_review_listings = $1, updated_at = CURRENT_TIMESTAMP WHERE id = 'default'`,
    [on],
  );
  if ((updated.rowCount ?? 0) > 0) return;
  await query(`INSERT INTO platform_settings (id, supplier_hub_review_listings) VALUES ('default', $1)`, [on]);
}

export async function setSupplierHubVisible(visible: boolean): Promise<void> {
  const updated = await query(
    `UPDATE platform_settings
     SET supplier_hub_visible = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = 'default'`,
    [visible],
  );
  if ((updated.rowCount ?? 0) > 0) return;
  await query(
    `INSERT INTO platform_settings (id, supplier_hub_visible) VALUES ('default', $1)`,
    [visible],
  );
}

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

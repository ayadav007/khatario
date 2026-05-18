/**
 * Shared validation for bundle component lines (create/update bundle APIs).
 * Does not modify schema or invoice logic.
 */

import { queryRows } from '@/lib/db';

export type BundleComponentInput = { item_id: string; quantity?: number | string };

export type BundleComponentsValidationResult =
  | { ok: true }
  | { ok: false; error: string; code?: string };

/**
 * Validates component item IDs for a bundle (existence, business, deleted, active, type, nested bundle, variants).
 * Quantity checks are done separately by callers (must be > 0).
 */
export async function validateBundleComponentItems(
  businessId: string,
  componentIds: string[]
): Promise<BundleComponentsValidationResult> {
  if (!componentIds.length) {
    return { ok: false, error: 'Bundle must include at least one component item', code: 'BUNDLE_EMPTY' };
  }
  if (new Set(componentIds).size !== componentIds.length) {
    return {
      ok: false,
      error: 'Each component item can only appear once in a bundle',
      code: 'BUNDLE_DUP_COMPONENT',
    };
  }

  const rows = await queryRows<{
    id: string;
    has_variants: boolean;
    is_bundle: boolean;
    item_type: string;
    deleted_at: Date | null;
    is_active: boolean | null;
  }>(
    `SELECT id,
            COALESCE(has_variants, false) AS has_variants,
            COALESCE(is_bundle, false) AS is_bundle,
            item_type,
            deleted_at,
            is_active
     FROM items
     WHERE id = ANY($1::uuid[]) AND business_id = $2`,
    [componentIds, businessId]
  );

  if (rows.length !== componentIds.length) {
    return {
      ok: false,
      error: 'One or more component items were not found in this business',
      code: 'BUNDLE_COMPONENT_NOT_FOUND',
    };
  }

  for (const r of rows) {
    if (r.deleted_at != null) {
      return {
        ok: false,
        error:
          'A selected component is deleted. Remove it from the bundle or restore the item first.',
        code: 'BUNDLE_COMPONENT_DELETED',
      };
    }
    if (r.is_active === false) {
      return {
        ok: false,
        error:
          'A selected component is inactive. Activate the item or replace it with another component.',
        code: 'BUNDLE_COMPONENT_INACTIVE',
      };
    }
    if (r.is_bundle) {
      return {
        ok: false,
        error: 'Cannot add a bundle as a component of another bundle',
        code: 'BUNDLE_NESTED',
      };
    }
    if (r.has_variants) {
      return {
        ok: false,
        error: 'Items with variants cannot be bundle components (use non-variant items)',
        code: 'BUNDLE_VARIANT_CHILD',
      };
    }
    if (r.item_type !== 'goods') {
      return {
        ok: false,
        error: 'Only goods items can be bundle components',
        code: 'BUNDLE_NON_GOODS_CHILD',
      };
    }
  }

  return { ok: true };
}

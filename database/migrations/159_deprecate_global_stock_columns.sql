-- Migration 159: Document deprecated global stock columns (source of truth = branch / warehouse tables)

COMMENT ON COLUMN items.current_stock IS
  'DEPRECATED as source of truth: denormalized aggregate SUM(branch_item_stock.quantity) per item for catalog/UI. '
  'Do not write directly in multi-branch flows; use branch_item_stock + refreshItemGlobalStockFromBranches.';

COMMENT ON COLUMN item_variants.current_stock IS
  'DEPRECATED as source of truth: denormalized aggregate SUM(branch_item_variant_stock.quantity) per variant. '
  'Do not write directly in multi-branch flows; use branch_item_variant_stock + refreshVariantGlobalStockFromBranches, '
  'or location_stock when warehouse mode is enabled.';

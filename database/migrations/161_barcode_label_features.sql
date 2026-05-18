-- Migration 161: Enterprise barcode / label printing features
-- Registers the platform features that gate the enterprise barcode + label
-- printing system delivered across Phases 1-4 (see plan:
-- enterprise-barcode-label-system).
--
-- Mirrors the pattern established in 160_dead_stock_widget_feature.sql.
-- Each feature id is stable and matches the canonical key used in code
-- (lib/featureKeys.ts InventoryFeatures), so no additional
-- canonical->registry mapping is required.

-- 1) Register the platform features
INSERT INTO platform_features (id, category, label, description, is_active, sort_order)
VALUES
  (
    'barcode_label_printing',
    'inventory',
    'Barcode Label Printing',
    'Print real EAN-13 / Code-128 / GS1-128 barcode labels with per-SKU copies, variants, and in-store prefix generation',
    TRUE,
    108
  ),
  (
    'barcode_label_from_purchase',
    'inventory',
    'Print Labels from Purchase (GRN)',
    'Print barcode labels directly from a finalized purchase / goods receipt with copies pre-filled from received quantities',
    TRUE,
    109
  ),
  (
    'barcode_label_templates',
    'inventory',
    'Label Template Designer',
    'Design custom label templates (A4 sheet / roll / thermal) with configurable fields, sizes, and symbology',
    TRUE,
    110
  ),
  (
    'barcode_thermal_printer',
    'inventory',
    'Thermal Printer (ZPL) Output',
    'Emit ZPL for Zebra-compatible thermal label printers with DPI-aware field positioning',
    TRUE,
    111
  ),
  (
    'barcode_weight_embedded',
    'inventory',
    'Weight-Embedded PLU Barcodes',
    'Support 13-digit weight-embedded EAN barcodes (2X + 5-digit PLU + 5-digit weight) for loose / produce items sold by weight',
    TRUE,
    112
  )
ON CONFLICT (id) DO NOTHING;

-- 2) Enable for all existing subscription plans by default. Admins can toggle
-- per plan via /admin/plans/[planId]/features if a stricter matrix is needed.
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT sp.id, feat.feature_id, TRUE
FROM subscription_plans sp
CROSS JOIN (
  VALUES
    ('barcode_label_printing'),
    ('barcode_label_from_purchase'),
    ('barcode_label_templates'),
    ('barcode_thermal_printer'),
    ('barcode_weight_embedded')
) AS feat(feature_id)
ON CONFLICT (plan_id, feature_id) DO NOTHING;

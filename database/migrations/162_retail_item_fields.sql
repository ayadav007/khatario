-- Migration 162: Retail compliance fields on items
-- Adds the four fields Indian packaged-goods retailers must show on a label
-- per the Legal Metrology (Packaged Commodities) Rules and FSSAI labelling
-- norms: FSSAI Licence number, Net Quantity, Country of Origin, Brand.
--
-- Surfaced on the new-item form behind the `barcode_label_templates`
-- feature (Phase 3 of plan: enterprise-barcode-label-system).

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS fssai_licence_no VARCHAR(20),
  ADD COLUMN IF NOT EXISTS net_quantity     VARCHAR(50),
  ADD COLUMN IF NOT EXISTS country_of_origin VARCHAR(2),
  ADD COLUMN IF NOT EXISTS brand            VARCHAR(100);

COMMENT ON COLUMN items.fssai_licence_no IS '14-digit FSSAI Licence / Registration number printed on the food label';
COMMENT ON COLUMN items.net_quantity     IS 'Free-text net quantity, e.g. "100 g", "1 L", "12 x 50 g". Required by Legal Metrology Rules.';
COMMENT ON COLUMN items.country_of_origin IS 'ISO-3166 alpha-2 country code, e.g. "IN".';
COMMENT ON COLUMN items.brand            IS 'Manufacturer / brand name printed at top of the label.';

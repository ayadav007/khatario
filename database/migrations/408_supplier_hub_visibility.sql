-- One platform switch for Supplier Hub. Off removes it from menus and direct links.
-- The plan checkbox still decides which plans include it once this is turned on.
-- Default is hidden so it stays out of the product until you turn the switch on.

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS supplier_hub_visible BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN platform_settings.supplier_hub_visible IS
  'When false, Supplier Hub is hidden for every business. Plan features apply only after this is turned on.';

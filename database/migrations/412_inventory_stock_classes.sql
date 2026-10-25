-- Manufacturing stock sits beside Inventory (1104), which remains stock-in-trade.
-- Existing items stay trading, so posted books do not move until an item is classified.

ALTER TABLE items ADD COLUMN IF NOT EXISTS stock_class VARCHAR(20) NOT NULL DEFAULT 'trading'
  CHECK (stock_class IN ('trading', 'raw_material', 'wip', 'finished_goods'));

COMMENT ON COLUMN items.stock_class IS
  'trading uses Inventory 1104. raw_material 1160, wip 1161, finished_goods 1162.';

INSERT INTO accounts (
  business_id, account_code, account_name, account_type, account_group_id, nature, is_system, sort_order
)
SELECT b.id, v.code, v.name, 'asset', g.id, 'debit', true, v.sort
  FROM businesses b
  JOIN account_groups g ON g.business_id = b.id AND g.group_code = '1100'
  CROSS JOIN (VALUES
    ('1160', 'Raw material', 60),
    ('1161', 'Work in progress', 61),
    ('1162', 'Finished goods', 62)
  ) AS v(code, name, sort)
 WHERE NOT EXISTS (
   SELECT 1 FROM accounts a WHERE a.business_id = b.id AND a.account_code = v.code
 );

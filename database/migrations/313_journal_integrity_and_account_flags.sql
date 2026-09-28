-- repair: journals and chart-of-accounts flags (QA Run 6: C7, J6, J7)
--  * journal_entries gets soft-delete columns; headers left without any ledger
--    lines by the old DELETE / narration-only PATCH are soft-deleted.
--  * Duplicate live journal numbers are renumbered, then a partial unique index
--    keeps the JRN series unique.
--  * is_system is reset on accounts that are not part of the seeded chart
--    (the old PATCH let users set it on their own accounts).

ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS deleted_by UUID;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS delete_reason TEXT;

UPDATE journal_entries je
   SET deleted_at = CURRENT_TIMESTAMP,
       delete_reason = 'repair 313: header without ledger lines'
 WHERE je.deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM ledger_entry_lines lel
      WHERE lel.business_id = je.business_id
        AND lel.voucher_id = je.voucher_id
        AND lel.voucher_type = 'journal'
   );

DO $$
DECLARE
  r RECORD;
  v_next INTEGER;
  v_year TEXT;
  v_new TEXT;
BEGIN
  FOR r IN
    SELECT id, business_id, voucher_id, voucher_number
      FROM (
        SELECT je.*,
               ROW_NUMBER() OVER (PARTITION BY business_id, voucher_number ORDER BY created_at, id) AS rn
          FROM journal_entries je
         WHERE deleted_at IS NULL AND voucher_number IS NOT NULL
      ) d
     WHERE d.rn > 1
     ORDER BY business_id, voucher_number
  LOOP
    v_year := COALESCE(SUBSTRING(r.voucher_number FROM '^JRN/([0-9]{4})/'), TO_CHAR(CURRENT_DATE, 'YYYY'));
    SELECT COALESCE(MAX(CAST(SUBSTRING(voucher_number FROM '[0-9]+$') AS INTEGER)), 0) + 1
      INTO v_next
      FROM journal_entries
     WHERE business_id = r.business_id AND voucher_number LIKE 'JRN/' || v_year || '/%';
    v_new := 'JRN/' || v_year || '/' || LPAD(v_next::TEXT, 6, '0');

    UPDATE journal_entries SET voucher_number = v_new, updated_at = CURRENT_TIMESTAMP WHERE id = r.id;
    UPDATE ledger_entries SET voucher_number = v_new
     WHERE business_id = r.business_id AND transaction_id = r.voucher_id AND transaction_type = 'journal';
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_entries_live_number
  ON journal_entries (business_id, voucher_number)
  WHERE deleted_at IS NULL AND voucher_number IS NOT NULL;

UPDATE accounts
   SET is_system = false, updated_at = CURRENT_TIMESTAMP
 WHERE is_system = true
   AND account_code NOT IN (
     '1101','1102','1103','1104','1105','1106','1107','1108','1109','1110','1111','1112','1113',
     '1114','1115','1116','1117','1118','1201','1202',
     '2101','2102','2103','2104','2105','2106','2107','2108','2109','2110','2111','2112','2113',
     '2114','2115','2116','2117','2118','2150','2151','2152','2153','2154','2155','2156',
     '2201','2202','2203',
     '3001','3002','3003','3100',
     '4101','4102','4103','4201','4202','4203','4204','4205',
     '5101','5102','5103','5104','5105','5106',
     '5201','5202','5203','5204','5205','5206','5207','5208','5209','5210','5211',
     '5212','5213','5214','5215','5216','5217','5218','5299'
   );

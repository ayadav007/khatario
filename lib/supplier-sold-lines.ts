/**
 * SQL CTE body (needs the linked and supplied_items CTEs, $2 = from, $3 = to): the linked shops'
 * posted sales lines. A bundle line (for example a 1 kg packet made from loose rice) is credited to
 * its component items, split by each component's share of the bundle's value, and a line of a
 * repacked item (items.pack_source_item_id, counted packets filled by Repack) is credited in full to
 * the bulk item it was packed from, so repacked goods still count. A packed item this supplier
 * supplies itself is not credited twice.
 */
export const SOLD_LINES_SQL = `
  sold_lines AS (
    SELECT inv.business_id AS customer_id, ii.item_id, ii.item_name, ii.line_total AS amount
      FROM invoices inv
      JOIN invoice_items ii ON ii.invoice_id = inv.id
     WHERE inv.status = 'final'
       AND inv.invoice_date >= $2::date AND inv.invoice_date <= $3::date
       AND inv.business_id IN (SELECT customer_id FROM linked)
    UNION ALL
    SELECT inv.business_id, bi.item_id, ci.name, ii.line_total * w.share
      FROM invoices inv
      JOIN invoice_items ii ON ii.invoice_id = inv.id
      JOIN bundle_items bi ON bi.bundle_id = ii.item_id
      JOIN items ci ON ci.id = bi.item_id
      JOIN LATERAL (
        SELECT CASE
                 WHEN SUM(b2.quantity * COALESCE(i2.selling_price, 0)) > 0
                   THEN (bi.quantity * COALESCE(ci.selling_price, 0)) / SUM(b2.quantity * COALESCE(i2.selling_price, 0))
                 ELSE 1.0 / COUNT(*)
               END AS share
          FROM bundle_items b2
          JOIN items i2 ON i2.id = b2.item_id
         WHERE b2.bundle_id = bi.bundle_id
      ) w ON true
     WHERE inv.status = 'final'
       AND inv.invoice_date >= $2::date AND inv.invoice_date <= $3::date
       AND inv.business_id IN (SELECT customer_id FROM linked)
    UNION ALL
    SELECT inv.business_id, pk.pack_source_item_id, src.name, ii.line_total
      FROM invoices inv
      JOIN invoice_items ii ON ii.invoice_id = inv.id
      JOIN items pk ON pk.id = ii.item_id AND pk.business_id = inv.business_id
       AND pk.pack_source_item_id IS NOT NULL AND NOT COALESCE(pk.is_bundle, false)
      JOIN items src ON src.id = pk.pack_source_item_id
     WHERE inv.status = 'final'
       AND inv.invoice_date >= $2::date AND inv.invoice_date <= $3::date
       AND inv.business_id IN (SELECT customer_id FROM linked)
       AND NOT EXISTS (
             SELECT 1 FROM supplied_items s2
              WHERE s2.item_id = ii.item_id AND s2.customer_id = inv.business_id)
  )`;

interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

/** Indian financial year (1 Apr – 31 Mar) containing the date, as [start, endExclusive] ISO dates. */
export function financialYearBounds(date: string | Date): [string, string] {
  const d = new Date(date);
  const startYear = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return [`${startYear}-04-01`, `${startYear + 1}-04-01`];
}

/**
 * A supplier's invoice number is unique within a financial year (Rule 46(b)), so a second
 * bill with the same number from the same supplier is almost always a double entry and
 * would claim ITC twice.
 */
export async function findDuplicateSupplierBill(
  db: Queryable,
  opts: {
    businessId: string;
    supplierId: string | null;
    billNumber: string | null | undefined;
    billDate: string | Date;
    excludePurchaseId?: string | null;
  }
): Promise<{ id: string; bill_number: string; bill_date: string; status: string } | null> {
  const billNumber = String(opts.billNumber || '').trim();
  if (!opts.supplierId || !billNumber) return null;
  const [fyStart, fyEnd] = financialYearBounds(opts.billDate);
  const res = await db.query(
    `SELECT id, COALESCE(invoice_number, bill_number) AS bill_number, bill_date, status
       FROM purchases
      WHERE business_id = $1
        AND supplier_id = $2
        AND deleted_at IS NULL
        AND COALESCE(status, '') <> 'cancelled'
        AND LOWER(TRIM(COALESCE(invoice_number, bill_number))) = LOWER($3)
        AND bill_date >= $4 AND bill_date < $5
        AND ($6::uuid IS NULL OR id <> $6::uuid)
      LIMIT 1`,
    [opts.businessId, opts.supplierId, billNumber, fyStart, fyEnd, opts.excludePurchaseId ?? null]
  );
  return res.rows[0] ?? null;
}

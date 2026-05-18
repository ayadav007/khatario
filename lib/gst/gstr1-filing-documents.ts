import type { PoolClient } from 'pg';

export type Gstr1FilingDocumentType = 'invoice' | 'credit_note' | 'debit_note';

/**
 * Replace all document links for a draft GSTR-1 filing (invoices + CDN in period, branch).
 */
export async function replaceGstr1FilingDocuments(params: {
  client: PoolClient;
  filingId: string;
  businessId: string;
  branchId: string;
  month: number;
  year: number;
}): Promise<void> {
  const { client, filingId, businessId, branchId, month, year } = params;
  const start = `${year}-${String(month).padStart(2, '0')}-01`;

  await client.query(`DELETE FROM gstr1_filing_documents WHERE gstr1_filing_id = $1`, [filingId]);

  const invRes = await client.query<{ id: string }>(
    `
    SELECT i.id
    FROM invoices i
    WHERE i.business_id = $1::uuid
      AND i.branch_id = $2::uuid
      AND i.deleted_at IS NULL
      AND i.status = 'final'
      AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')
      AND i.invoice_date >= $3::date
      AND i.invoice_date < ($3::date + INTERVAL '1 month')
    `,
    [businessId, branchId, start]
  );

  const cnRes = await client.query<{ id: string }>(
    `
    SELECT cn.id
    FROM credit_notes cn
    WHERE cn.business_id = $1::uuid
      AND cn.branch_id = $2::uuid
      AND cn.credit_note_date >= $3::date
      AND cn.credit_note_date < ($3::date + INTERVAL '1 month')
    `,
    [businessId, branchId, start]
  );

  const dnRes = await client.query<{ id: string }>(
    `
    SELECT dn.id
    FROM debit_notes dn
    WHERE dn.business_id = $1::uuid
      AND dn.branch_id = $2::uuid
      AND dn.debit_note_date >= $3::date
      AND dn.debit_note_date < ($3::date + INTERVAL '1 month')
    `,
    [businessId, branchId, start]
  );

  const rows: { t: Gstr1FilingDocumentType; id: string }[] = [
    ...invRes.rows.map((r) => ({ t: 'invoice' as const, id: r.id })),
    ...cnRes.rows.map((r) => ({ t: 'credit_note' as const, id: r.id })),
    ...dnRes.rows.map((r) => ({ t: 'debit_note' as const, id: r.id })),
  ];

  for (const { t, id } of rows) {
    await client.query(
      `
      INSERT INTO gstr1_filing_documents (gstr1_filing_id, document_type, document_id)
      VALUES ($1::uuid, $2, $3::uuid)
      ON CONFLICT (gstr1_filing_id, document_type, document_id) DO NOTHING
      `,
      [filingId, t, id]
    );
  }
}

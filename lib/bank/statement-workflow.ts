import { queryOne } from '@/lib/db';

export async function isBankStatementReconciliationCompleted(
  businessId: string,
  bankStatementId: string
): Promise<boolean> {
  const row = await queryOne<{ rs: string | null; ir: boolean | null }>(
    `SELECT reconciliation_status, is_reconciled
     FROM bank_statements WHERE id = $1 AND business_id = $2`,
    [bankStatementId, businessId]
  );
  if (!row) return false;
  if (row.rs === 'completed') return true;
  if (row.ir === true) return true;
  return false;
}

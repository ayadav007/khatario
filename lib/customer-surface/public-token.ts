import crypto from 'crypto';
import { query, queryOne } from '@/lib/db';

const TOKEN_BYTES = 24;

export function generatePublicInvoiceToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Ensure invoice has a public_token. Safe to call repeatedly.
 * Only assigns when missing (does not rotate).
 */
export async function ensureInvoicePublicToken(invoiceId: string): Promise<string> {
  const existing = await queryOne<{ public_token: string | null }>(
    `SELECT public_token FROM invoices WHERE id = $1 AND deleted_at IS NULL`,
    [invoiceId]
  );
  if (!existing) {
    throw new Error('Invoice not found');
  }
  if (existing.public_token) {
    return existing.public_token;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const token = generatePublicInvoiceToken();
    try {
      const updated = await queryOne<{ public_token: string }>(
        `UPDATE invoices
         SET public_token = $2
         WHERE id = $1 AND public_token IS NULL
         RETURNING public_token`,
        [invoiceId, token]
      );
      if (updated?.public_token) return updated.public_token;
      const again = await queryOne<{ public_token: string | null }>(
        `SELECT public_token FROM invoices WHERE id = $1`,
        [invoiceId]
      );
      if (again?.public_token) return again.public_token;
    } catch {
      // unique violation — retry
    }
  }
  throw new Error('Failed to assign public invoice token');
}

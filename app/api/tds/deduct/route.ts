import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { withPremiumSubscriptionApi } from '@/lib/security/premium-module-api';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { purchaseOutstanding, recomputePurchaseBalance } from '@/lib/purchases/purchase-balance';
import { round2 } from '@/lib/invoices/line-gst';
import { normalizePan, panFromGstin, tdsRateWithoutPan } from '@/lib/tax/pan';

export const dynamic = 'force-dynamic';

function financialYearAndQuarter(date: Date): { financialYear: string; quarter: string } {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const financialYear = month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
  const quarter = month >= 4 && month <= 6 ? 'Q1' : month <= 9 && month >= 7 ? 'Q2' : month >= 10 ? 'Q3' : 'Q4';
  return { financialYear, quarter };
}

/**
 * POST /api/tds/deduct
 * Records TDS withheld from a supplier: Dr Accounts Payable / Cr TDS Payable, and reduces
 * what is owed to the supplier (and on the linked bill). The section threshold is tested on
 * the payee's aggregate for the financial year, not per payment.
 */
export const POST = withPremiumSubscriptionApi(
  { parseJsonBody: true },
  async ({ body, businessId, userId }) => {
    const {
      supplier_id,
      payment_id,
      purchase_id,
      tds_category_id,
      payment_amount,
      transaction_date,
      notes,
    } = (body ?? {}) as Record<string, unknown>;

    const baseAmount = round2(Number(payment_amount));
    if (!tds_category_id || !transaction_date || !Number.isFinite(baseAmount) || baseAmount <= 0) {
      return NextResponse.json(
        { error: 'tds_category_id, a positive payment_amount, and transaction_date are required', code: 'INVALID_INPUT' },
        { status: 400 }
      );
    }
    const transDate = new Date(String(transaction_date));
    if (Number.isNaN(transDate.getTime())) {
      return NextResponse.json({ error: 'Invalid transaction_date', code: 'INVALID_INPUT' }, { status: 400 });
    }

    try {
      await authorize(userId, 'payments', 'create', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const client = await getPool().connect();
    const reject = async (status: number, error: string, code: string, extra?: Record<string, unknown>) => {
      await client.query('ROLLBACK');
      return NextResponse.json({ error, code, ...extra }, { status });
    };

    try {
      await client.query('BEGIN');

      const categoryRes = await client.query(
        'SELECT section_code, rate, threshold_amount FROM tds_categories WHERE id = $1 AND business_id = $2',
        [tds_category_id, businessId]
      );
      const category = categoryRes.rows[0];
      if (!category) return reject(404, 'TDS category not found', 'CATEGORY_NOT_FOUND');

      let supplierId = supplier_id ? String(supplier_id) : null;
      let purchaseId = purchase_id ? String(purchase_id) : null;
      let branchId: string | null = null;

      if (payment_id) {
        const payRes = await client.query(
          `SELECT supplier_id, reference_type, reference_id, branch_id, type, status
             FROM payments WHERE id = $1 AND business_id = $2`,
          [payment_id, businessId]
        );
        const payment = payRes.rows[0];
        if (!payment) return reject(404, 'Payment not found', 'PAYMENT_NOT_FOUND');
        if (payment.status === 'reversed') return reject(409, 'TDS cannot be deducted on a reversed payment', 'PAYMENT_REVERSED');
        if (payment.type !== 'payable') return reject(400, 'TDS can only be deducted on a payment made to a supplier', 'PAYMENT_NOT_PAYABLE');
        if (supplierId && payment.supplier_id && supplierId !== payment.supplier_id) {
          return reject(400, 'Payment belongs to a different supplier', 'SUPPLIER_MISMATCH');
        }
        supplierId = supplierId || payment.supplier_id;
        if (!purchaseId && payment.reference_type === 'purchase') purchaseId = payment.reference_id;
        branchId = payment.branch_id;
      }

      let purchase: any = null;
      if (purchaseId) {
        const purRes = await client.query(
          `SELECT id, supplier_id, branch_id, status, grand_total, tax_total, is_reverse_charge,
                  paid_amount, COALESCE(tds_deducted, 0) AS tds_deducted,
                  COALESCE(advance_adjusted, 0) AS advance_adjusted, bill_number
             FROM purchases WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL FOR UPDATE`,
          [purchaseId, businessId]
        );
        purchase = purRes.rows[0];
        if (!purchase) return reject(404, 'Purchase bill not found', 'PURCHASE_NOT_FOUND');
        if (purchase.status === 'cancelled') return reject(400, 'Cannot deduct TDS on a cancelled bill', 'PURCHASE_CANCELLED');
        if (supplierId && purchase.supplier_id && supplierId !== purchase.supplier_id) {
          return reject(400, 'Bill belongs to a different supplier', 'SUPPLIER_MISMATCH');
        }
        supplierId = supplierId || purchase.supplier_id;
        branchId = branchId || purchase.branch_id;
      }

      if (!supplierId) return reject(400, 'supplier_id is required to deduct TDS', 'SUPPLIER_REQUIRED');

      const supRes = await client.query(
        'SELECT id, pan, gstin FROM suppliers WHERE id = $1 AND business_id = $2',
        [supplierId, businessId]
      );
      const supplier = supRes.rows[0];
      if (!supplier) return reject(404, 'Supplier not found', 'SUPPLIER_NOT_FOUND');

      const { financialYear, quarter } = financialYearAndQuarter(transDate);
      const payeePan = normalizePan(supplier.pan) ?? panFromGstin(supplier.gstin);
      const sectionRate = Number(category.rate) || 0;
      const tdsRate = payeePan ? sectionRate : tdsRateWithoutPan(String(category.section_code), sectionRate);
      // s.288B: TDS is rounded to the nearest rupee.
      const tdsAmount = Math.round((baseAmount * tdsRate) / 100);
      if (tdsAmount <= 0) return reject(400, 'Computed TDS is zero', 'ZERO_TDS');

      const threshold = Number(category.threshold_amount) || 0;
      if (threshold > 0) {
        const [fyStartYear] = financialYear.split('-').map(Number);
        const aggRes = await client.query(
          `SELECT
             COALESCE((SELECT SUM(payment_amount) FROM tds_transactions
                        WHERE business_id = $1 AND supplier_id = $2 AND section_code = $3 AND financial_year = $4
                          AND status = 'active'), 0) AS tds_base,
             COALESCE((SELECT SUM(subtotal) FROM purchases
                        WHERE business_id = $1 AND supplier_id = $2 AND deleted_at IS NULL
                          AND COALESCE(status, '') NOT IN ('cancelled', 'draft')
                          AND bill_date >= make_date($5, 4, 1) AND bill_date < make_date($5 + 1, 4, 1)), 0) AS credited`,
          [businessId, supplierId, category.section_code, financialYear, fyStartYear]
        );
        const agg = aggRes.rows[0];
        const aggregate = Math.max(Number(agg.tds_base) + baseAmount, Number(agg.credited));
        if (aggregate < threshold) {
          return reject(
            400,
            `Aggregate paid/credited to this supplier in FY ${financialYear} (₹${aggregate.toFixed(2)}) is below the section ${category.section_code} threshold of ₹${threshold.toFixed(2)}`,
            'BELOW_THRESHOLD',
            { aggregate, threshold }
          );
        }
      }

      if (purchase) {
        const outstanding = purchaseOutstanding(purchase);
        if (tdsAmount > outstanding + 0.01) {
          return reject(
            400,
            `TDS ₹${tdsAmount.toFixed(2)} exceeds the amount still owed on the bill (₹${outstanding.toFixed(2)})`,
            'TDS_EXCEEDS_OUTSTANDING',
            { outstanding }
          );
        }
      }

      const accRes = await client.query(
        `SELECT account_code, id FROM accounts
          WHERE business_id = $1 AND account_code IN ('2101', '2102') AND is_active = true`,
        [businessId]
      );
      const accounts = Object.fromEntries(accRes.rows.map((r) => [r.account_code, r.id]));
      if (!accounts['2101'] || !accounts['2102']) {
        return reject(500, 'Accounts Payable (2101) or TDS Payable (2102) account is missing', 'ACCOUNTS_MISSING');
      }

      const tdsRes = await client.query(
        `INSERT INTO tds_transactions (
           business_id, supplier_id, payment_id, purchase_id, tds_category_id, section_code,
           payment_amount, tds_rate, tds_amount, net_payment_amount,
           transaction_date, financial_year, quarter, notes, created_by,
           payee_pan, higher_rate_206aa
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING *`,
        [
          businessId,
          supplierId,
          payment_id || null,
          purchaseId,
          tds_category_id,
          category.section_code,
          baseAmount,
          tdsRate,
          tdsAmount,
          round2(baseAmount - tdsAmount),
          transaction_date,
          financialYear,
          quarter,
          notes || null,
          userId,
          payeePan,
          !payeePan && tdsRate > sectionRate,
        ]
      );
      const tds = tdsRes.rows[0];

      const narration = `TDS u/s ${category.section_code} @ ${tdsRate}%${payeePan ? '' : ' (no PAN, s.206AA)'} on ₹${baseAmount.toFixed(2)}`;
      const reference = `TDS-${String(tds.id).substring(0, 8)}`;
      for (const [accountId, debit, credit] of [
        [accounts['2101'], tdsAmount, 0],
        [accounts['2102'], 0, tdsAmount],
      ] as const) {
        await client.query(
          `INSERT INTO ledger_entry_lines (
             business_id, voucher_id, voucher_type, account_id, entry_date,
             debit, credit, narration, reference_number, branch_id
           ) VALUES ($1, $2, 'tds', $3, $4, $5, $6, $7, $8, $9)`,
          [businessId, tds.id, accountId, transaction_date, debit, credit, narration, reference, branchId]
        );
      }

      await client.query(
        `UPDATE suppliers SET current_balance = current_balance - $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2 AND business_id = $3`,
        [tdsAmount, supplierId, businessId]
      );

      let bill = null;
      if (purchase) {
        await client.query(
          `UPDATE purchases SET tds_deducted = COALESCE(tds_deducted, 0) + $1 WHERE id = $2 AND business_id = $3`,
          [tdsAmount, purchase.id, businessId]
        );
        bill = await recomputePurchaseBalance(client, purchase.id, businessId);
      }

      await client.query('COMMIT');

      return NextResponse.json(
        { tds_transaction: tds, purchase_balance: bill, message: 'TDS deducted successfully' },
        { status: 201 }
      );
    } catch (error: any) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Error deducting TDS:', error);
      return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    } finally {
      client.release();
    }
  },
);

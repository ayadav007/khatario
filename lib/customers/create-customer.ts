import { queryOne, getPool } from '@/lib/db';
import { Customer } from '@/types/database';
import { enforceAccess } from '@/lib/enforce-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { normalizePhoneOrNull } from '@/lib/utils/phone';
import { resolveGstinAndState } from '@/lib/tax/gstin';
import { resolveState } from '@/lib/tax/state-names';
import {
  assertReceivableTarget,
  receivableControlAccountId,
  ReceivableAccountError,
} from '@/lib/accounting/receivable-accounts';
import { hasCustomerReceivableAccounts } from '@/lib/accounting/receivable-accounts-schema';
import { parseReceivableAccountId } from '@/lib/customers/receivable-account-request';
import type { CreateResult, ServiceCtx } from '@/lib/import/types';

/** The body fields POST /api/customers reads. */
export interface CreateCustomerInput {
  name: string;
  company_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  billing_address?: string | null;
  shipping_address?: string | null;
  city?: string | null;
  state?: string | null;
  state_code?: string | null;
  pincode?: string | null;
  shipping_city?: string | null;
  shipping_state?: string | null;
  shipping_pincode?: string | null;
  country?: string | null;
  gstin?: string | null;
  opening_balance?: number;
  opening_balance_type?: 'debit' | 'credit';
  credit_limit?: number;
  credit_days?: number | string | null;
  receivable_account_id?: string | null;
}

/**
 * enforceAccess refused the create (plan, feature or customer limit). The transaction is
 * already rolled back; `reason` is the original error for enforceAccessErrorResponse.
 */
export class CustomerAccessRefused extends Error {
  constructor(public readonly reason: unknown) {
    super(reason instanceof Error ? reason.message : 'Access refused');
  }
}

/** Create code for a failed insert that returned no row (answered as `{ error }` with 500). */
export const CREATE_FAILED = 'CREATE_FAILED';

/**
 * Validate and insert one customer for the session business. Duplicates by phone or email
 * come back as `ok: false` with status 200 and the existing customer. Throws
 * CustomerAccessRefused when enforceAccess refuses; other errors are thrown as they are.
 */
export async function createCustomer(
  ctx: ServiceCtx,
  input: CreateCustomerInput
): Promise<CreateResult<Customer>> {
  const business_id = ctx.businessId;
  const created_by = ctx.userId;
  const {
    name,
    company_name,
    phone,
    email,
    address,
    billing_address,
    shipping_address,
    city, // Billing city
    state, // Billing state
    state_code, // GST state code (2-digit)
    pincode, // Billing pincode
    shipping_city,
    shipping_state,
    shipping_pincode,
    country,
    gstin,
    opening_balance = 0,
    opening_balance_type = 'debit',
    credit_limit = 0,
    credit_days: bodyCreditDays,
    receivable_account_id: bodyReceivableAccountId,
  } = input;

  const hadPhoneDigits =
    phone != null && String(phone).replace(/\D/g, '').length > 0;
  const phoneNorm = normalizePhoneOrNull(phone);
  if (hadPhoneDigits && phoneNorm == null) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_PHONE',
      error: 'Enter a valid phone number (8–15 digits including country code).',
    };
  }
  const emailNorm =
    typeof email === 'string' && email.trim() !== '' ? email.trim().toLowerCase() : null;

  let creditDays: number | null = null;
  if (bodyCreditDays !== undefined && bodyCreditDays !== null && bodyCreditDays !== '') {
    const n = parseInt(String(bodyCreditDays), 10);
    if (Number.isFinite(n) && n >= 0) creditDays = n;
  }

  if (phoneNorm) {
    const existingPhone = await queryOne<Customer>(
      `SELECT * FROM customers
       WHERE business_id = $1 AND is_active = true AND deleted_at IS NULL AND phone IS NOT NULL AND trim(phone) = $2
       LIMIT 1`,
      [business_id, phoneNorm]
    );
    if (existingPhone) {
      const name = existingPhone.name?.trim();
      return {
        ok: false,
        status: 200,
        code: 'DUPLICATE_PHONE',
        error: name
          ? `A customer named ${name} already uses this phone number.`
          : 'A customer with this phone number already exists.',
        existing: existingPhone,
      };
    }
  }
  if (emailNorm) {
    const existingEmail = await queryOne<Customer>(
      `SELECT * FROM customers
       WHERE business_id = $1 AND is_active = true AND deleted_at IS NULL AND email IS NOT NULL AND lower(trim(email)) = $2
       LIMIT 1`,
      [business_id, emailNorm]
    );
    if (existingEmail) {
      const name = existingEmail.name?.trim();
      return {
        ok: false,
        status: 200,
        code: 'DUPLICATE_EMAIL',
        error: name
          ? `A customer named ${name} already uses this email.`
          : 'A customer with this email already exists.',
        existing: existingEmail,
      };
    }
  }

  const finalBillingAddress = billing_address || address || null;
  const finalShippingAddress = shipping_address || address || null;

  const gstinCheck = resolveGstinAndState({ gstin, state, state_code });
  if (!gstinCheck.ok) {
    return { ok: false, status: 400, code: gstinCheck.code, error: gstinCheck.error };
  }
  const finalState = gstinCheck.state;
  const finalStateCode =
    gstinCheck.state_code || (finalState ? resolveState(finalState)?.state_code ?? '' : null);

  // The ledger account this customer's sales are recorded in; null keeps Accounts Receivable.
  let receivableAccountId: string | null = null;
  if (bodyReceivableAccountId != null && bodyReceivableAccountId !== '' && (await hasCustomerReceivableAccounts())) {
    try {
      const chosen = await assertReceivableTarget(business_id, parseReceivableAccountId(bodyReceivableAccountId));
      receivableAccountId = chosen === (await receivableControlAccountId(business_id)) ? null : chosen;
    } catch (error) {
      if (error instanceof ReceivableAccountError) {
        return { ok: false, status: error.status, code: error.code, error: error.message };
      }
      throw error;
    }
  }

  const sql = `
    INSERT INTO customers (
      business_id, name, company_name, phone, email, address, billing_address, shipping_address,
      city, state, state_code, pincode, shipping_city, shipping_state, shipping_pincode,
      country, gstin, opening_balance, opening_balance_type, credit_limit, credit_days
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
    RETURNING *
  `;

  const pool = getPool();
  const client = await pool.connect();
  let customer: Customer | null = null;
  let rolledBack = false;

  try {
    await client.query('BEGIN');

    try {
      await enforceAccess({
        businessId: business_id,
        userId: created_by,
        feature: FeatureKeys.CUSTOMER_MANAGEMENT,
        limitType: 'customers',
        poolClient: client,
      });
    } catch (e) {
      await client.query('ROLLBACK');
      rolledBack = true;
      throw new CustomerAccessRefused(e);
    }

    const insertResult = await client.query<Customer>(sql, [
      business_id,
      name,
      company_name || null,
      phoneNorm,
      emailNorm,
      address || null,
      finalBillingAddress,
      finalShippingAddress,
      city || null,
      finalState,
      finalStateCode || null,
      pincode || null,
      shipping_city || null,
      shipping_state || null,
      shipping_pincode || null,
      country || 'India',
      gstinCheck.gstin,
      opening_balance,
      opening_balance_type,
      credit_limit,
      creditDays,
    ]);

    customer = insertResult.rows[0] ?? null;
    if (!customer) {
      await client.query('ROLLBACK');
      return { ok: false, status: 500, code: CREATE_FAILED, error: 'Failed to create customer' };
    }
    if (receivableAccountId) {
      const withAccount = await client.query<Customer>(
        `UPDATE customers SET receivable_account_id = $1 WHERE id = $2 AND business_id = $3 RETURNING *`,
        [receivableAccountId, customer.id, business_id]
      );
      customer = withAccount.rows[0] ?? customer;
    }

    await client.query('COMMIT');
  } catch (e) {
    if (!rolledBack) await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  if (opening_balance > 0 && customer) {
    try {
      const { postOpeningBalanceLedgerEntry } = await import('@/lib/ledger-utils');
      await postOpeningBalanceLedgerEntry({
        businessId: business_id,
        entityType: 'customer',
        entityId: customer.id,
        entityName: name,
        openingBalance: opening_balance,
        openingBalanceType: opening_balance_type,
      });
    } catch (ledgerError: any) {
      console.error('Error posting opening balance ledger entry for customer:', ledgerError);
    }
  }

  return { ok: true, record: customer as Customer };
}

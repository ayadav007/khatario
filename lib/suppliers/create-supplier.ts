import * as db from '@/lib/db';
import { Supplier } from '@/types/database';
import { enforceAccess } from '@/lib/enforce-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { normalizePhoneOrNull } from '@/lib/utils/phone';
import { normalizePan, panFromGstin } from '@/lib/tax/pan';
import { resolveGstinAndState } from '@/lib/tax/gstin';
import { resolveState } from '@/lib/tax/state-names';
import { openConnectionRequest } from '@/lib/supplier-hub-links';
import type { CreateResult, ServiceCtx } from '@/lib/import/types';

/** The body fields POST /api/suppliers reads. */
export interface CreateSupplierInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  state_code?: string | null;
  pincode?: string | null;
  gstin?: string | null;
  pan?: string | null;
  opening_balance?: number;
  opening_balance_type?: 'debit' | 'credit';
  linked_business_id?: string | null;
  allow_low_stock_access?: boolean;
}

/**
 * enforceAccess refused the create (plan, feature or supplier limit). `reason` is the
 * original error for enforceAccessErrorResponse.
 */
export class SupplierAccessRefused extends Error {
  constructor(public readonly reason: unknown) {
    super(reason instanceof Error ? reason.message : 'Access refused');
  }
}

/** Codes answered as `{ error }` alone (no `code`), as POST /api/suppliers always has. */
export const INVALID_PAN = 'INVALID_PAN';
export const NAME_REQUIRED = 'NAME_REQUIRED';
export const CREATE_FAILED = 'CREATE_FAILED';
export const SELF_LINK = 'SELF_LINK';
export const DUPLICATE_GSTIN = 'DUPLICATE_GSTIN';
export const DUPLICATE_SUPPLIER = 'DUPLICATE_SUPPLIER';

type Refusal = Extract<CreateResult<Supplier>, { ok: false }>;
type Checked = Extract<ReturnType<typeof resolveGstinAndState>, { ok: true }>;

/**
 * The checks POST /api/suppliers runs before authorize, in order: PAN format, name, GSTIN and
 * state, PAN against the PAN inside the GSTIN. No database access.
 */
export function checkSupplierInput(
  input: CreateSupplierInput
): { ok: true; gstinCheck: Checked } | Refusal {
  const { name, state, state_code, gstin, pan } = input;

  if (pan && !normalizePan(pan)) {
    return { ok: false, status: 400, code: INVALID_PAN, error: `Invalid PAN "${pan}". Expected format: ABCDE1234F` };
  }

  if (!name) {
    return { ok: false, status: 400, code: NAME_REQUIRED, error: 'name is required' };
  }

  const gstinCheck = resolveGstinAndState({ gstin, state, state_code });
  if (!gstinCheck.ok) {
    return { ok: false, status: 400, code: gstinCheck.code, error: gstinCheck.error };
  }
  if (gstinCheck.pan && pan && normalizePan(pan) && normalizePan(pan) !== gstinCheck.pan) {
    return {
      ok: false,
      status: 400,
      code: 'PAN_GSTIN_MISMATCH',
      error: `PAN ${String(pan).toUpperCase()} does not match the PAN inside GSTIN (${gstinCheck.pan}).`,
    };
  }
  return { ok: true, gstinCheck };
}

/**
 * Validate and insert one supplier for the session business. A GSTIN already on an active
 * supplier comes back as `ok: false` with status 200 and the existing supplier. Throws
 * SupplierAccessRefused when enforceAccess refuses; other errors are thrown as they are,
 * except a unique violation (23505), which is answered as DUPLICATE_SUPPLIER with 409.
 * The activity log is written only when `audit` is passed.
 */
export async function createSupplier(
  ctx: ServiceCtx,
  input: CreateSupplierInput,
  audit?: { ip: string | null; userAgent: string | null }
): Promise<CreateResult<Supplier>> {
  const business_id = ctx.businessId;
  const createdByUserId = ctx.userId;
  const {
    name,
    phone,
    email,
    address,
    city,
    pincode,
    gstin,
    pan,
    opening_balance = 0,
    opening_balance_type = 'credit',
    linked_business_id,
    allow_low_stock_access = false,
  } = input;

  const checked = checkSupplierInput(input);
  if (!checked.ok) return checked;
  const { gstinCheck } = checked;

  try {
    try {
      await enforceAccess({
        businessId: business_id,
        userId: createdByUserId,
        feature: FeatureKeys.SUPPLIER_MANAGEMENT,
        limitType: 'suppliers',
      });
    } catch (e) {
      throw new SupplierAccessRefused(e);
    }

    const finalState = gstinCheck.state;
    const finalStateCode = gstinCheck.state_code || (finalState ? resolveState(finalState)?.state_code ?? '' : null);

    // A link to another business stays pending until that business approves it
    // (POST /api/suppliers/[id]/approve); every hub gate requires approval_status = 'approved'.
    if (linked_business_id && String(linked_business_id) === String(business_id)) {
      return { ok: false, status: 400, code: SELF_LINK, error: 'A business cannot be its own supplier' };
    }
    const approvalStatus = linked_business_id ? 'pending' : 'none';
    const approvedAt = null;

    // allow_low_stock_access can only be true if linked to a business
    const finalAllowLowStockAccess = linked_business_id ? allow_low_stock_access === true : false;

    const phoneNorm = normalizePhoneOrNull(phone);
    const gstinNorm = gstinCheck.gstin;

    if (gstinNorm) {
      const existingGstin = await db.queryOne<Supplier>(
        `SELECT * FROM suppliers
         WHERE business_id = $1 AND deleted_at IS NULL AND is_active = true
           AND gstin IS NOT NULL AND UPPER(TRIM(gstin)) = $2
         LIMIT 1`,
        [business_id, gstinNorm]
      );
      if (existingGstin) {
        return {
          ok: false,
          status: 200,
          code: DUPLICATE_GSTIN,
          error: 'Existing supplier with this GSTIN returned.',
          existing: existingGstin,
        };
      }
    }

    const gstinStatePrefix =
      gstinNorm && gstinNorm.length >= 2 && /^\d{2}$/.test(gstinNorm.slice(0, 2)) ? gstinNorm.slice(0, 2) : null;
    const finalStateCodeResolved = finalStateCode || gstinStatePrefix || null;

    const supplier = await db.queryOne<Supplier>(
      `
      INSERT INTO suppliers (
        business_id, name, phone, email, address,
        city, state, state_code, pincode, gstin,
        opening_balance, opening_balance_type,
        linked_business_id, requested_by_business_id, approval_status,
        approved_at, allow_low_stock_access, pan
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *
    `,
      [
        business_id, name, phoneNorm, email, address,
        city, finalState, finalStateCodeResolved, pincode, gstinNorm,
        opening_balance, opening_balance_type,
        linked_business_id || null,
        linked_business_id ? business_id : null, // Set requester if linking
        approvalStatus,
        approvedAt,
        finalAllowLowStockAccess,
        normalizePan(pan) ?? panFromGstin(gstinNorm),
      ]
    );

    if (!supplier) {
      return { ok: false, status: 500, code: CREATE_FAILED, error: 'Failed to create supplier' };
    }

    // Post opening balance to ledger; best effort, the supplier row already holds it.
    if (opening_balance > 0) {
      try {
        const { postOpeningBalanceLedgerEntry } = await import('@/lib/ledger-utils');
        await postOpeningBalanceLedgerEntry({
          businessId: business_id,
          entityType: 'supplier',
          entityId: supplier.id,
          entityName: name,
          openingBalance: opening_balance,
          openingBalanceType: opening_balance_type,
        });
      } catch (ledgerError: any) {
        console.error('Error posting opening balance ledger entry for supplier:', ledgerError);
      }
    }

    // Linking to a business account is a Supplier Hub connection request; the pending
    // supplier row goes live when that business accepts it in the hub.
    if (linked_business_id) {
      await openConnectionRequest({
        buyerBusinessId: business_id,
        supplierBusinessId: String(linked_business_id),
        createdByUserId,
        shareLowStock: finalAllowLowStockAccess,
      });
    }

    if (audit) {
      const { logActivity } = await import('@/lib/activity-logger');
      await logActivity({
        business_id,
        user_id: createdByUserId,
        action_type: 'create',
        module: 'suppliers',
        entity_id: supplier.id,
        entity_type: 'supplier',
        description: `Created supplier ${name}`,
        ip_address: audit.ip ?? undefined,
        user_agent: audit.userAgent ?? undefined,
        metadata: {
          name,
          gstin: gstin || null,
          linked_business_id: linked_business_id || null,
        },
      });
    }

    return { ok: true, record: supplier };
  } catch (error: any) {
    if (error?.code === '23505') {
      return {
        ok: false,
        status: 409,
        code: DUPLICATE_SUPPLIER,
        error: 'A supplier with this GSTIN or name already exists for your business.',
        details: error?.message,
      };
    }
    throw error;
  }
}

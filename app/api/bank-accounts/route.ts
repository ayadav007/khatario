import { NextRequest, NextResponse } from 'next/server';
import { actingUserId, getUserIdFromRequest, getBusinessIdFromRequest, requireTenantBusinessId, resolveCreatedByUserId } from '@/lib/auth-helpers';
import { denyIfFeatureMissing } from '@/lib/subscription/feature-access';
import { queryRows, queryOne, getPool } from '@/lib/db';
import { deleteVoucher } from '@/lib/accounting/voucher-posting';
import { authorize } from '@/lib/authorization';
import { AuthorizationError } from '@/lib/authorization';
import {
  applyBankLedgerOpeningBalance,
  assertBankLedgerAvailable,
  BankRegisterError,
  createBankLedger,
} from '@/lib/accounting/bank-register';
import { ledgerHasOpeningBalance } from '@/lib/accounting/settlement-accounts-db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/bank-accounts
 * List bank accounts
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check read permission (bank accounts are part of settings/accounting)
    try {
      await authorize(userId, 'settings', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const accounts = await queryRows(`
      SELECT 
        ba.*,
        a.account_code as ledger_account_code,
        a.account_name as ledger_account_name
      FROM bank_accounts ba
      LEFT JOIN accounts a ON ba.ledger_account_id = a.id
      WHERE ba.business_id = $1
      ORDER BY ba.created_at DESC
    `, [businessId]);

    const linkableLedgers = await queryRows(`
      SELECT a.id, a.account_code, a.account_name
        FROM accounts a
        LEFT JOIN account_groups ag ON ag.id = a.account_group_id
       WHERE a.business_id = $1
         AND COALESCE(a.is_active, true)
         AND (
           a.account_code IN ('1102', '2112')
           OR (
             a.account_type = 'asset'
             AND a.account_code LIKE '11%'
             AND a.account_code <> '1101'
             AND (a.account_name ILIKE '%bank%' OR COALESCE(ag.group_name, '') ILIKE '%bank%')
             AND a.account_name NOT ILIKE '%cash%'
           )
         )
         AND NOT EXISTS (
           SELECT 1 FROM bank_accounts ba
            WHERE ba.business_id = a.business_id AND ba.ledger_account_id = a.id
         )
       ORDER BY a.account_code
    `, [businessId]);

    return NextResponse.json({ accounts, linkable_ledgers: linkableLedgers });
  } catch (error: any) {
    console.error('Error fetching bank accounts:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/bank-accounts
 * Add bank account
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('[Bank Accounts API] POST request received:', body);
    
    const {
      business_id,
      account_name,
      account_number,
      bank_name,
      ifsc_code,
      branch_name,
      account_type,
      is_active = true,
      ledger_account_id,
      create_ledger = false,
      opening_balance = 0,
      opening_balance_date,
      notes,
    } = body;
    const createdByUserId = resolveCreatedByUserId(request, body);

    if (!business_id || !account_name || !account_number || !bank_name) {
      console.error('[Bank Accounts API] Missing required fields:', { business_id: !!business_id, account_name: !!account_name, account_number: !!account_number, bank_name: !!bank_name });
      return NextResponse.json(
        { error: 'business_id, account_name, account_number, and bank_name are required' },
        { status: 400 }
      );
    }

    if (!createdByUserId) {
      return NextResponse.json(
        { error: 'created_by_user_id is required for authorization' },
        { status: 400 }
      );
    }
    const tenant = requireTenantBusinessId(request, business_id);
    if (!tenant.ok) return tenant.response;
    const planDenied = await denyIfFeatureMissing(tenant.businessId, 'accounting_bank');
    if (planDenied) return planDenied;

    // AUTHORIZATION: Check create permission (bank accounts are part of settings/accounting)
    try {
      await authorize(createdByUserId, 'settings', 'create', { businessId: business_id });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Check if account number already exists
    const existing = await queryOne(
      'SELECT id FROM bank_accounts WHERE business_id = $1 AND account_number = $2',
      [business_id, account_number]
    );

    if (existing) {
      return NextResponse.json(
        { error: 'Bank account with this account number already exists' },
        { status: 409 }
      );
    }

    const wantsNewLedger = create_ledger === true || create_ledger === 'true';
    if (!wantsNewLedger && !ledger_account_id) {
      return NextResponse.json(
        { error: 'Link this bank to a chart account, or create a bank ledger for it.' },
        { status: 400 }
      );
    }

    const openingAmount = Number(opening_balance) || 0;
    const pool = getPool();
    const client = await pool.connect();
    let createdLedgerId: string | null = null;
    let account: any = null;
    try {
      await client.query('BEGIN');
      const ledgerId = wantsNewLedger
        ? await createBankLedger(client, business_id, `${bank_name} ${account_name}`.trim())
        : ledger_account_id;
      if (wantsNewLedger) createdLedgerId = ledgerId;
      else await assertBankLedgerAvailable(client, business_id, ledgerId);
      if (!wantsNewLedger && openingAmount !== 0 && (await ledgerHasOpeningBalance(business_id, ledgerId))) {
        throw new BankRegisterError(
          'This ledger already has an opening balance. Change it on the chart account. A second opening is not posted.',
          'OPENING_ALREADY_POSTED',
          409,
        );
      }
      const inserted = await client.query(
        `INSERT INTO bank_accounts (
          business_id, account_name, account_number, bank_name, ifsc_code,
          branch_name, account_type, is_active, ledger_account_id, opening_balance,
          opening_balance_date, notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *`,
        [
          business_id,
          account_name,
          account_number,
          bank_name,
          ifsc_code || null,
          branch_name || null,
          account_type || null,
          is_active !== undefined ? is_active : true,
          ledgerId,
          openingAmount,
          opening_balance_date || null,
          notes || null,
        ]
      );
      account = inserted.rows[0];
      await client.query('COMMIT');
    } catch (e: any) {
      await client.query('ROLLBACK').catch(() => {});
      if (e instanceof BankRegisterError) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
      }
      if (e?.code === '23505') {
        return NextResponse.json(
          { error: 'That ledger or account number is already linked to a bank account.' },
          { status: 409 }
        );
      }
      console.error('Error adding bank account:', e);
      return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 });
    } finally {
      client.release();
    }

    if (account && openingAmount !== 0) {
      try {
        await applyBankLedgerOpeningBalance(business_id, account.ledger_account_id, openingAmount, false);
      } catch (e: any) {
        await queryOne('DELETE FROM bank_accounts WHERE id = $1 AND business_id = $2', [account.id, business_id]);
        if (createdLedgerId) {
          await queryOne('DELETE FROM accounts WHERE id = $1 AND business_id = $2', [createdLedgerId, business_id]);
        }
        const status = e instanceof BankRegisterError ? e.status : 400;
        return NextResponse.json(
          { error: e.message || 'Opening balance could not be posted to the ledger.' },
          { status }
        );
      }
    }

    return NextResponse.json({ account }, { status: 201 });
  } catch (error: any) {
    console.error('Error adding bank account:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/bank-accounts
 * Update bank account
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      id,
      business_id,
      account_name,
      account_number,
      bank_name,
      ifsc_code,
      branch_name,
      account_type,
      is_active,
      notes,
      ledger_account_id,
      updated_by_user_id: bodyUpdatedBy,
    } = body;
    const updated_by_user_id = actingUserId(request, bodyUpdatedBy);

    if (!id || !business_id) {
      return NextResponse.json(
        { error: 'id and business_id are required' },
        { status: 400 }
      );
    }

    if (!updated_by_user_id) {
      return NextResponse.json(
        { error: 'updated_by_user_id is required for authorization' },
        { status: 400 }
      );
    }
    const tenant = requireTenantBusinessId(request, business_id);
    if (!tenant.ok) return tenant.response;
    const planDenied = await denyIfFeatureMissing(tenant.businessId, 'accounting_bank');
    if (planDenied) return planDenied;

    // Verify the account belongs to the business
    const existing = await queryOne(
      'SELECT id, business_id FROM bank_accounts WHERE id = $1 AND business_id = $2',
      [id, business_id]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'Bank account not found' },
        { status: 404 }
      );
    }

    // AUTHORIZATION: Check update permission (bank accounts are part of settings/accounting)
    try {
      await authorize(updated_by_user_id, 'settings', 'update', { businessId: existing.business_id, resourceId: id });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Check if account number is being changed and if it conflicts
    if (account_number) {
      const conflict = await queryOne(
        'SELECT id FROM bank_accounts WHERE business_id = $1 AND account_number = $2 AND id != $3',
        [business_id, account_number, id]
      );

      if (conflict) {
        return NextResponse.json(
          { error: 'Bank account with this account number already exists' },
          { status: 409 }
        );
      }
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (account_name !== undefined) {
      updates.push(`account_name = $${paramIndex++}`);
      values.push(account_name);
    }
    if (account_number !== undefined) {
      updates.push(`account_number = $${paramIndex++}`);
      values.push(account_number);
    }
    if (bank_name !== undefined) {
      updates.push(`bank_name = $${paramIndex++}`);
      values.push(bank_name);
    }
    if (ifsc_code !== undefined) {
      updates.push(`ifsc_code = $${paramIndex++}`);
      values.push(ifsc_code || null);
    }
    if (branch_name !== undefined) {
      updates.push(`branch_name = $${paramIndex++}`);
      values.push(branch_name || null);
    }
    if (account_type !== undefined) {
      updates.push(`account_type = $${paramIndex++}`);
      values.push(account_type || null);
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(is_active);
    }
    if (notes !== undefined) {
      updates.push(`notes = $${paramIndex++}`);
      values.push(notes || null);
    }
    if (ledger_account_id) {
      const statements = await queryOne<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM bank_statements WHERE bank_account_id = $1 AND business_id = $2`,
        [id, business_id],
      );
      if (Number(statements?.n || 0) > 0) {
        const current = await queryOne<{ ledger_account_id: string | null }>(
          `SELECT ledger_account_id FROM bank_accounts WHERE id = $1 AND business_id = $2`,
          [id, business_id],
        );
        if (current?.ledger_account_id && current.ledger_account_id !== ledger_account_id) {
          return NextResponse.json(
            { error: 'This bank already has a statement. Its ledger link cannot be changed.' },
            { status: 409 },
          );
        }
      }
      const pool = getPool();
      const linkClient = await pool.connect();
      try {
        await assertBankLedgerAvailable(linkClient, business_id, ledger_account_id, id);
      } catch (e: any) {
        if (e instanceof BankRegisterError) {
          return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
        }
        throw e;
      } finally {
        linkClient.release();
      }
      updates.push(`ledger_account_id = $${paramIndex++}`);
      values.push(ledger_account_id);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id, business_id);

    const account = await queryOne(
      `UPDATE bank_accounts 
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex} AND business_id = $${paramIndex + 1}
       RETURNING *`,
      values
    );

    return NextResponse.json({ account });
  } catch (error: any) {
    console.error('Error updating bank account:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/bank-accounts
 * Delete bank account
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization

    if (!id || !businessId) {
      return NextResponse.json(
        { error: 'id and business_id are required' },
        { status: 400 }
      );
    }
    const planDenied = await denyIfFeatureMissing(businessId, 'accounting_bank');
    if (planDenied) return planDenied;

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // Verify the account belongs to the business
    const existing = await queryOne(
      'SELECT id, business_id FROM bank_accounts WHERE id = $1 AND business_id = $2',
      [id, businessId]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'Bank account not found' },
        { status: 404 }
      );
    }

    // AUTHORIZATION: Check delete permission (bank accounts are part of settings/accounting)
    try {
      await authorize(userId, 'settings', 'delete', { businessId: existing.business_id, resourceId: id });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await deleteVoucher(client, businessId, id, 'opening_balance', 'regenerate:opening_balance', userId);
      await client.query('DELETE FROM bank_accounts WHERE id = $1 AND business_id = $2', [id, businessId]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    return NextResponse.json({ message: 'Bank account deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting bank account:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}


import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest, resolveCreatedByUserId } from '@/lib/auth-helpers';
import { queryRows, queryOne } from '@/lib/db';
import { authorize } from '@/lib/authorization';
import { AuthorizationError } from '@/lib/authorization';

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

    return NextResponse.json({ accounts });
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

    console.log('[Bank Accounts API] Inserting bank account with values:', {
      business_id,
      account_name,
      account_number,
      bank_name,
      ifsc_code: ifsc_code || null,
      branch_name: branch_name || null,
      account_type: account_type || null,
      is_active: is_active !== undefined ? is_active : true,
    });

    const account = await queryOne(
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
        ledger_account_id || null,
        opening_balance,
        opening_balance_date || null,
        notes || null,
      ]
    );

    console.log('[Bank Accounts API] Bank account created successfully:', account?.id);
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
      updated_by_user_id, // REQUIRED for authorization
    } = body;

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

    await queryOne(
      'DELETE FROM bank_accounts WHERE id = $1 AND business_id = $2',
      [id, businessId]
    );

    return NextResponse.json({ message: 'Bank account deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting bank account:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}


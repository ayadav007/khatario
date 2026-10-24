import { NextRequest, NextResponse } from 'next/server';
import { queryRows, getPool } from '@/lib/db';
import { fundingAccountId, postAssetCapitalisation } from '@/lib/accounting/fixed-asset-posting';
import { itBlockByKey, scheduleIIByKey, wdvRateFromLife } from '@/lib/accounting/it-depreciation';
import { guardLedgerRoute } from '@/lib/http/ledger-route-guard';

export const dynamic = 'force-dynamic';

import { requireTenantBusinessId } from '@/lib/auth-helpers';

/**
 * GET /api/fixed-assets
 * List fixed assets
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
    if (!tenant.ok) return tenant.response;
    const businessId = tenant.businessId;
    const isDisposed = searchParams.get('is_disposed');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    let sql = `
      SELECT 
        fa.*,
        to_char(COALESCE(fa.put_to_use_date, fa.purchase_date), 'YYYY-MM-DD') AS put_to_use_on,
        (SELECT to_char(MAX(ds.period_end_date), 'YYYY-MM-DD')
           FROM depreciation_schedule ds WHERE ds.asset_id = fa.id) AS last_depreciated_to,
        a.account_code as asset_account_code,
        a.account_name as asset_account_name,
        da.account_code as depreciation_account_code,
        da.account_name as depreciation_account_name
      FROM fixed_assets fa
      LEFT JOIN accounts a ON fa.account_id = a.id
      LEFT JOIN accounts da ON fa.depreciation_account_id = da.id
      WHERE fa.business_id = $1
    `;
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (isDisposed !== null) {
      sql += ` AND fa.is_disposed = $${paramIndex}`;
      params.push(isDisposed === 'true');
      paramIndex++;
    }

    sql += ` ORDER BY fa.purchase_date DESC`;

    const assets = await queryRows(sql, params);

    return NextResponse.json({ assets });
  } catch (error: any) {
    console.error('Error fetching fixed assets:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/fixed-assets
 * Add fixed asset and post the capitalisation voucher
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, any>;
  const {
    asset_code,
    asset_name,
    asset_category,
    purchase_date,
    purchase_cost,
    account_id,
    depreciation_account_id,
    depreciation_method,
    residual_value = 0,
    location,
    vendor_name,
    invoice_number,
    warranty_expiry_date,
    notes,
    funding = 'bank',
    credit_account_id,
    branch_id,
    it_block,
    schedule_ii_category,
  } = body;
  const putToUseDate = body.put_to_use_date || purchase_date;

  if (!['bank', 'cash', 'credit', 'opening', 'purchase_bill'].includes(funding)) {
    return NextResponse.json(
      { error: "funding must be one of 'bank', 'cash', 'credit', 'opening' or 'purchase_bill'" },
      { status: 400 }
    );
  }
  if (!(Number(purchase_cost) > 0)) {
    return NextResponse.json({ error: 'purchase_cost must be greater than 0' }, { status: 400 });
  }
  if (!['SLM', 'WDV'].includes(depreciation_method)) {
    return NextResponse.json({ error: "depreciation_method must be 'SLM' or 'WDV'" }, { status: 400 });
  }
  if (it_block && !itBlockByKey(it_block)) {
    return NextResponse.json({ error: 'Unknown Income-tax block' }, { status: 400 });
  }
  const schedCat = schedule_ii_category ? scheduleIIByKey(schedule_ii_category) : undefined;
  if (schedule_ii_category && !schedCat) {
    return NextResponse.json({ error: 'Unknown Schedule II category' }, { status: 400 });
  }
  const usefulLife = Number(body.useful_life_years) || schedCat?.usefulLifeYears || 0;

  if (!asset_code || !asset_name || !purchase_date || !account_id || !depreciation_account_id || !(usefulLife > 0)) {
    return NextResponse.json(
      { error: 'Required fields: asset_code, asset_name, purchase_date, purchase_cost, account_id, depreciation_account_id, useful_life_years (or a Schedule II category)' },
      { status: 400 }
    );
  }
  if (String(putToUseDate) < String(purchase_date)) {
    return NextResponse.json({ error: 'put_to_use_date cannot be before purchase_date' }, { status: 400 });
  }
  const residual = Number(residual_value) || 0;
  if (residual < 0 || residual >= Number(purchase_cost)) {
    return NextResponse.json({ error: 'residual_value must be at least 0 and below the cost' }, { status: 400 });
  }
  const depreciationRate =
    depreciation_method === 'WDV'
      ? Number(body.depreciation_rate) || wdvRateFromLife(usefulLife, residual > 0 ? residual / Number(purchase_cost) : 0.05)
      : Number(body.depreciation_rate) || null;

  const guard = await guardLedgerRoute(request, {
    claimedBusinessId: body.business_id,
    branchId: branch_id,
    action: 'create',
    // Opening-balance assets carry historical dates that are usually in closed periods.
    dates: funding === 'opening' ? undefined : [purchase_date],
    actionLabel: 'capitalise this asset',
  });
  if (!guard.ok) return guard.response;
  const business_id = guard.businessId;

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const accountIds = [account_id, depreciation_account_id, credit_account_id].filter(Boolean);
    const owned = await client.query(
      `SELECT id FROM accounts WHERE business_id = $1 AND is_active = true AND id = ANY($2::uuid[])`,
      [business_id, accountIds]
    );
    if (owned.rowCount !== new Set(accountIds).size) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'One or more accounts do not belong to this business' }, { status: 400 });
    }

    const existing = await client.query(
      'SELECT id FROM fixed_assets WHERE business_id = $1 AND asset_code = $2',
      [business_id, asset_code]
    );
    if (existing.rows[0]) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Asset code already exists' }, { status: 409 });
    }

    const postingBranchId = funding === 'opening' ? null : guard.branchId;
    const block = itBlockByKey(it_block);

    const asset = await client.query(
      `INSERT INTO fixed_assets (
        business_id, asset_code, asset_name, asset_category, purchase_date,
        purchase_cost, account_id, depreciation_account_id, depreciation_method,
        useful_life_years, depreciation_rate, residual_value, current_book_value,
        location, vendor_name, invoice_number, warranty_expiry_date, notes,
        put_to_use_date, it_block, it_rate, schedule_ii_category, branch_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $6, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      RETURNING *`,
      [
        business_id,
        asset_code,
        asset_name,
        asset_category || schedCat?.label || null,
        purchase_date,
        purchase_cost,
        account_id,
        depreciation_account_id,
        depreciation_method,
        usefulLife,
        depreciationRate,
        residual,
        location || null,
        vendor_name || null,
        invoice_number || null,
        warranty_expiry_date || null,
        notes || null,
        putToUseDate,
        block?.key ?? null,
        block?.rate ?? null,
        schedCat?.key ?? null,
        postingBranchId,
      ]
    );

    const creditAccountId = await fundingAccountId(client, business_id, funding, credit_account_id);

    if (creditAccountId !== account_id) await postAssetCapitalisation(client, {
      businessId: business_id,
      branchId: postingBranchId,
      voucherId: asset.rows[0].id,
      assetAccountId: account_id,
      creditAccountId,
      amount: Number(purchase_cost),
      date: purchase_date,
      assetName: asset_name,
      assetCode: asset_code,
    });

    await client.query('COMMIT');

    return NextResponse.json({
      asset: asset.rows[0],
      message: 'Fixed asset added successfully',
    }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error adding fixed asset:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

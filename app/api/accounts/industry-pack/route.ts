import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { withPremiumSubscriptionApi } from '@/lib/security';
import { applyIndustryCoa, previewIndustryCoa } from '@/lib/accounting/apply-industry-coa';

export const dynamic = 'force-dynamic';

/**
 * GET /api/accounts/industry-pack
 * Ledgers and expense categories the business's industry pack would add.
 */
export const GET = withPremiumSubscriptionApi({}, async (ctx) => {
  try {
    await authorize(ctx.userId, 'settings', 'read');
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }

  const client = await getPool().connect();
  try {
    const preview = await previewIndustryCoa(client, ctx.businessId);
    if (!preview) return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    return NextResponse.json({
      industry: preview.profile.industry,
      business_type: preview.profile.businessType,
      business_model: preview.profile.businessModel,
      packs: preview.packs,
      missing_ledgers: preview.missingLedgers.map((l) => ({ code: l.code, name: l.name, account_type: l.account_type })),
      missing_categories: preview.missingCategories.map((c) => c.name),
      conflicting_codes: preview.conflictingCodes,
    });
  } catch (error) {
    console.error('Error previewing industry ledgers:', error);
    return NextResponse.json({ error: 'Failed to load industry ledgers' }, { status: 500 });
  } finally {
    client.release();
  }
});

/**
 * POST /api/accounts/industry-pack
 * Adds the missing industry ledgers and expense categories. Never changes existing accounts.
 */
export const POST = withPremiumSubscriptionApi({}, async (ctx) => {
  try {
    await authorize(ctx.userId, 'settings', 'create');
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await applyIndustryCoa(client, ctx.businessId);
    await client.query('COMMIT');
    return NextResponse.json({
      success: true,
      packs: result.packs,
      accounts_created: result.accountsCreated.length,
      categories_created: result.categoriesCreated.length,
      conflicting_codes: result.conflictingCodes,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Error adding industry ledgers:', error);
    return NextResponse.json({ error: 'Failed to add industry ledgers' }, { status: 500 });
  } finally {
    client.release();
  }
});

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getAuthenticatedUserId, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { CustomerCreditError, listAvailableCustomerCredits } from '@/lib/credit-notes/customer-credit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/customers/[id]/credits
 * Unused credit from paid credit notes. Tenant comes from the session.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const businessId = getSessionScopedBusinessId(request);
  const userId = getAuthenticatedUserId(request);
  if (!businessId || !userId) {
    return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  try {
    await authorize(userId, 'customers', 'read', { businessId });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    const credits = await listAvailableCustomerCredits(client, businessId, params.id);
    return NextResponse.json(credits);
  } catch (error) {
    if (error instanceof CustomerCreditError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to load customer credit';
    if (/credit_note_applications/i.test(message)) {
      return NextResponse.json(
        { error: 'Customer credit is not available until the database migration is applied', code: 'MIGRATION_REQUIRED' },
        { status: 503 }
      );
    }
    console.error('Error loading customer credit:', error);
    return NextResponse.json({ error: 'Failed to load customer credit' }, { status: 500 });
  } finally {
    client.release();
  }
}

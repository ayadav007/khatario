import { NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { normalizePhone } from '@/lib/utils/phone';
import {
  buildWhoToMessageQuery,
  parseWhoToMessageParams,
  reasonForRow,
  type WhoToMessageRow,
} from '@/lib/whatsapp/who-to-message';

export const dynamic = 'force-dynamic';

type SqlRow = {
  phone: string | null;
  name: string | null;
  last_on: string | null;
  amount: string | number | null;
  bill_count: number | null;
};

/**
 * GET /api/whatsapp/who-to-message?condition=&days=&period_days=&limit=
 * Tenant comes from the session. Do not trust a client business id.
 */
export const GET = withWhatsAppPremiumApi({ managePermission: 'read' }, async ({ request, businessId }) => {
  const parsed = parseWhoToMessageParams(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const built = buildWhoToMessageQuery(parsed.value);
  const rows = await queryRows<SqlRow>(built.text, [businessId, ...built.values]);

  const seen = new Set<string>();
  const people: WhoToMessageRow[] = [];
  for (const row of rows) {
    const phone = normalizePhone(String(row.phone || ''));
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    const amount = row.amount == null || row.amount === '' ? null : Number(row.amount);
    const billCount = row.bill_count == null ? null : Number(row.bill_count);
    const lastOn = row.last_on ? String(row.last_on).slice(0, 10) : null;
    people.push({
      phone,
      name: (row.name || '').trim() || 'Customer',
      lastOn,
      amount: amount != null && Number.isFinite(amount) ? amount : null,
      billCount: billCount != null && Number.isFinite(billCount) ? billCount : null,
      reason: reasonForRow(
        parsed.value.condition,
        { lastOn, amount: amount != null && Number.isFinite(amount) ? amount : null, billCount },
        parsed.value.periodDays,
      ),
    });
  }

  return NextResponse.json({
    condition: parsed.value.condition,
    people,
  });
});

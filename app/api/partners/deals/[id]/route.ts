import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { requirePartnerRequest } from '@/lib/partners/request-auth';
import type { PartnerDealStage } from '@/lib/partners/types';

export const dynamic = 'force-dynamic';

const STAGES = new Set<PartnerDealStage>([
  'lead',
  'contacted',
  'demo_booked',
  'demo_done',
  'trial',
  'proposal',
  'won',
  'lost',
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requirePartnerRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (typeof body.contact_name === 'string' && body.contact_name.trim()) {
      sets.push(`contact_name = $${i++}`);
      values.push(body.contact_name.trim());
    }
    if (body.contact_phone !== undefined) {
      sets.push(`contact_phone = $${i++}`);
      values.push(typeof body.contact_phone === 'string' ? body.contact_phone.trim() || null : null);
    }
    if (body.contact_email !== undefined) {
      sets.push(`contact_email = $${i++}`);
      values.push(typeof body.contact_email === 'string' ? body.contact_email.trim() || null : null);
    }
    if (body.company_name !== undefined) {
      sets.push(`company_name = $${i++}`);
      values.push(typeof body.company_name === 'string' ? body.company_name.trim() || null : null);
    }
    if (typeof body.stage === 'string' && STAGES.has(body.stage as PartnerDealStage)) {
      sets.push(`stage = $${i++}`);
      values.push(body.stage);
    }
    if (body.notes !== undefined) {
      sets.push(`notes = $${i++}`);
      values.push(typeof body.notes === 'string' ? body.notes.trim() || null : null);
    }
    if (body.business_id !== undefined) {
      sets.push(`business_id = $${i++}`);
      values.push(typeof body.business_id === 'string' ? body.business_id || null : null);
    }

    if (!sets.length) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    sets.push('updated_at = CURRENT_TIMESTAMP');
    values.push(params.id, auth.session.partner_id);

    const deal = await queryOne(
      `UPDATE partner_deals SET ${sets.join(', ')}
       WHERE id = $${i++} AND partner_id = $${i}
       RETURNING id, contact_name, contact_phone, contact_email, company_name, stage, notes,
                 business_id, created_at, updated_at`,
      values,
    );

    if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    return NextResponse.json({ success: true, deal });
  } catch (error) {
    console.error('[partners/deals PATCH]', error);
    return NextResponse.json({ error: 'Failed to update deal' }, { status: 500 });
  }
}

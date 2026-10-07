import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
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

export async function GET(request: NextRequest) {
  const auth = await requirePartnerRequest(request);
  if (!auth.ok) return auth.response;

  const deals = await queryRows(
    `SELECT d.id, d.contact_name, d.contact_phone, d.contact_email, d.company_name,
            d.stage, d.notes, d.business_id, b.name AS business_name,
            d.created_at, d.updated_at,
            a.partner_id IS NOT NULL AS attributed
     FROM partner_deals d
     LEFT JOIN businesses b ON b.id = d.business_id
     LEFT JOIN business_partner_attributions a
       ON a.business_id = d.business_id AND a.partner_id = d.partner_id
     WHERE d.partner_id = $1
     ORDER BY d.updated_at DESC
     LIMIT 200`,
    [auth.session.partner_id],
  );

  return NextResponse.json({ deals });
}

export async function POST(request: NextRequest) {
  const auth = await requirePartnerRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const contactName = typeof body.contact_name === 'string' ? body.contact_name.trim() : '';
    if (!contactName) {
      return NextResponse.json({ error: 'contact_name is required' }, { status: 400 });
    }
    const stage =
      typeof body.stage === 'string' && STAGES.has(body.stage as PartnerDealStage)
        ? (body.stage as PartnerDealStage)
        : 'lead';

    const deal = await queryOne(
      `INSERT INTO partner_deals (
         partner_id, contact_name, contact_phone, contact_email, company_name, stage, notes, business_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, contact_name, contact_phone, contact_email, company_name, stage, notes,
                 business_id, created_at, updated_at`,
      [
        auth.session.partner_id,
        contactName,
        typeof body.contact_phone === 'string' ? body.contact_phone.trim() || null : null,
        typeof body.contact_email === 'string' ? body.contact_email.trim() || null : null,
        typeof body.company_name === 'string' ? body.company_name.trim() || null : null,
        stage,
        typeof body.notes === 'string' ? body.notes.trim() || null : null,
        typeof body.business_id === 'string' ? body.business_id : null,
      ],
    );

    return NextResponse.json({ success: true, deal }, { status: 201 });
  } catch (error) {
    console.error('[partners/deals POST]', error);
    return NextResponse.json({ error: 'Failed to create deal' }, { status: 500 });
  }
}

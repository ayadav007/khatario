import { z } from 'zod';
import { queryOne } from '@/lib/db';
import { attachLead, markHandedOff } from '../conversations';

export const LeadInputSchema = z.object({
  name: z.string().trim().min(2).max(200),
  phone: z.string().trim().min(10).max(20),
  email: z.string().trim().email().max(255).optional().or(z.literal('').transform(() => undefined)),
  businessName: z.string().trim().max(255).optional(),
  businessType: z.string().trim().max(100).optional(),
  city: z.string().trim().max(100).optional(),
  teamSize: z.string().trim().max(50).optional(),
  needs: z.array(z.string().trim().max(60)).max(10).optional(),
  recommendedPlan: z.string().trim().max(100).optional(),
  note: z.string().trim().max(1000).optional(),
  handoff: z.boolean().optional(),
});
export type LeadInput = z.infer<typeof LeadInputSchema>;

/** Indian mobile as 10 digits (accepts +91 / 0 prefixes); null when it isn't a mobile number. */
export function normalizeIndianMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const ten = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

export interface CapturedLead {
  id: string;
  isNew: boolean;
}

/**
 * Upsert by phone so repeat visitors enrich one lead instead of creating duplicates.
 * Anyone can type any phone number, so unverified submissions only fill blank fields; contact
 * details are overwritten only when `phoneVerified` (the number passed a WhatsApp OTP).
 */
export async function captureLead(
  input: LeadInput,
  ctx: { channel: string; visitorId?: string | null; conversationId?: string | null; notify?: boolean; phoneVerified?: boolean },
): Promise<CapturedLead> {
  const phone = normalizeIndianMobile(input.phone);
  if (!phone) throw new LeadValidationError('Please enter a valid 10-digit Indian mobile number.');

  const row = await queryOne<{ id: string; inserted: boolean }>(
    `INSERT INTO assistant_leads
       (name, phone, email, business_name, business_type, city, team_size, needs, recommended_plan,
        source_channel, visitor_id, conversation_id, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10, $11, $12, $13)
     ON CONFLICT (phone) WHERE phone IS NOT NULL DO UPDATE SET
       name = CASE WHEN $14 THEN EXCLUDED.name ELSE COALESCE(assistant_leads.name, EXCLUDED.name) END,
       email = CASE WHEN $14 THEN COALESCE(EXCLUDED.email, assistant_leads.email)
                    ELSE COALESCE(assistant_leads.email, EXCLUDED.email) END,
       business_name = CASE WHEN $14 THEN COALESCE(EXCLUDED.business_name, assistant_leads.business_name)
                            ELSE COALESCE(assistant_leads.business_name, EXCLUDED.business_name) END,
       business_type = COALESCE(assistant_leads.business_type, EXCLUDED.business_type),
       city = COALESCE(assistant_leads.city, EXCLUDED.city),
       team_size = COALESCE(assistant_leads.team_size, EXCLUDED.team_size),
       needs = (SELECT ARRAY(SELECT DISTINCT unnest(assistant_leads.needs || EXCLUDED.needs))),
       recommended_plan = COALESCE(EXCLUDED.recommended_plan, assistant_leads.recommended_plan),
       conversation_id = COALESCE(assistant_leads.conversation_id, EXCLUDED.conversation_id),
       visitor_id = COALESCE(assistant_leads.visitor_id, EXCLUDED.visitor_id),
       notes = CASE WHEN EXCLUDED.notes IS NULL THEN assistant_leads.notes
                    ELSE concat_ws(E'\n', assistant_leads.notes, EXCLUDED.notes) END,
       status = CASE WHEN assistant_leads.status = 'lost' THEN 'new' ELSE assistant_leads.status END,
       updated_at = NOW()
     RETURNING id, (xmax = 0) AS inserted`,
    [
      input.name,
      phone,
      input.email ?? null,
      input.businessName ?? null,
      input.businessType ?? null,
      input.city ?? null,
      input.teamSize ?? null,
      input.needs ?? [],
      input.recommendedPlan ?? null,
      ctx.channel,
      ctx.visitorId ?? null,
      ctx.conversationId ?? null,
      input.note ?? null,
      ctx.phoneVerified === true,
    ],
  );
  if (!row) throw new Error('Could not save lead');

  if (ctx.conversationId) {
    if (input.handoff) await markHandedOff(ctx.conversationId, row.id);
    else await attachLead(ctx.conversationId, row.id);
  }

  if (ctx.notify === false) return { id: row.id, isNew: row.inserted };
  void import('@/lib/platform-push')
    .then(({ raisePlatformIncident }) =>
      raisePlatformIncident({
        kind: 'assistant_lead',
        title: input.handoff ? `Assistant: ${input.name} wants to talk` : `Assistant lead: ${input.name}`,
        body: [phone, input.businessName, input.businessType, input.city, input.note].filter(Boolean).join(' · ').slice(0, 300),
        url: '/admin/assistant?tab=leads',
        metadata: { lead_id: row.id, conversation_id: ctx.conversationId ?? null, handoff: Boolean(input.handoff) },
      }),
    )
    .catch((err) => console.error('[assistant] lead notify failed', err));

  return { id: row.id, isNew: row.inserted };
}

export class LeadValidationError extends Error {}

/** Link a demo booking (created via /api/bookings/create) to the assistant lead for the same phone. */
export async function linkBookingToLead(
  bookingId: string,
  ctx: { channel: string; visitorId?: string | null; conversationId?: string | null },
): Promise<{ leadId: string; bookingNumber: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return null;
  const booking = await queryOne<{ id: string; name: string; email: string; phone: string; company_name: string | null; booking_number: string }>(
    `SELECT id, name, email, phone, company_name, booking_number FROM demo_bookings
      WHERE id = $1 AND created_at > NOW() - INTERVAL '30 minutes'`,
    [bookingId],
  );
  if (!booking) return null;
  const lead = await captureLead(
    { name: booking.name, phone: booking.phone, email: booking.email, businessName: booking.company_name ?? undefined },
    // /api/bookings/create only accepts a booking after the phone passed WhatsApp OTP.
    { ...ctx, notify: false, phoneVerified: true },
  );
  await queryOne(
    `UPDATE assistant_leads SET booking_id = $2, status = 'demo_booked', updated_at = NOW() WHERE id = $1 RETURNING id`,
    [lead.id, booking.id],
  );
  return { leadId: lead.id, bookingNumber: booking.booking_number };
}

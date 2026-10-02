import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import { captureLead, LeadInputSchema, LeadValidationError, linkBookingToLead } from './actions/leads';
import { recommendPlan, RecommendInputSchema } from './actions/recommend';
import { findOwnedConversation, insertMessage, type ConversationOwner } from './conversations';
import { HR_COMING_SOON, HR_LAUNCHED } from './product-availability';

async function json(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function handleAction(request: NextRequest, owner: ConversationOwner): Promise<NextResponse> {
  const body = await json(request);
  if (!body) return bad('Invalid request');
  const conversation =
    typeof body.conversationId === 'string' ? await findOwnedConversation(body.conversationId, owner) : null;
  const ctx = { channel: owner.channel, visitorId: owner.visitorId ?? null, conversationId: conversation?.id ?? null };

  try {
    switch (body.type) {
      case 'capture_lead': {
        const parsed = LeadInputSchema.safeParse(body.lead);
        if (!parsed.success) return bad('Please check your name and mobile number.');
        const lead = await captureLead(parsed.data, ctx);
        if (conversation) {
          await insertMessage({
            conversationId: conversation.id,
            role: 'assistant',
            content: parsed.data.handoff
              ? 'Thanks! The Khatario team will contact you shortly.'
              : 'Thanks! I have saved your details.',
            action: { type: 'lead_captured', leadId: lead.id, handoff: Boolean(parsed.data.handoff) },
            model: 'action',
            answered: true,
          });
        }
        return NextResponse.json({ ok: true, leadId: lead.id });
      }
      case 'recommend_plan': {
        const parsed = RecommendInputSchema.safeParse(body.answers ?? {});
        if (!parsed.success) return bad('Please answer the questions again.');
        if (parsed.data.product === 'hr' && !HR_LAUNCHED) return bad(HR_COMING_SOON, 404);
        const rec = await recommendPlan(parsed.data);
        if (!rec) return bad('No plan found for that product right now.', 404);
        if (conversation) {
          await insertMessage({
            conversationId: conversation.id,
            role: 'assistant',
            content: `Recommended plan: ${rec.displayName}. ${rec.reasons.join(' ')}`,
            action: { type: 'plan_recommended', input: parsed.data, planId: rec.planId },
            model: 'action',
            answered: true,
          });
        }
        return NextResponse.json({ ok: true, recommendation: rec });
      }
      case 'link_booking': {
        if (typeof body.bookingId !== 'string') return bad('Missing booking');
        const linked = await linkBookingToLead(body.bookingId, ctx);
        if (!linked) return bad('Booking not found', 404);
        if (conversation) {
          await insertMessage({
            conversationId: conversation.id,
            role: 'assistant',
            content: `Demo booked. Booking number ${linked.bookingNumber}.`,
            action: { type: 'demo_booked', leadId: linked.leadId, bookingId: body.bookingId },
            model: 'action',
            answered: true,
          });
        }
        return NextResponse.json({ ok: true, bookingNumber: linked.bookingNumber });
      }
      default:
        return bad('Unknown action');
    }
  } catch (err) {
    if (err instanceof LeadValidationError) return bad(err.message);
    console.error('[assistant] action failed:', err instanceof Error ? err.message : err);
    return bad('Something went wrong. Please try again.', 500);
  }
}

export async function handleFeedback(request: NextRequest, owner: ConversationOwner): Promise<NextResponse> {
  const body = await json(request);
  const messageId = typeof body?.messageId === 'string' ? body.messageId : '';
  const rating = body?.rating === 1 || body?.rating === -1 ? body.rating : null;
  if (!/^[0-9a-f-]{36}$/i.test(messageId) || rating == null) return bad('Invalid feedback');
  const comment = typeof body?.comment === 'string' ? body.comment.trim().slice(0, 1000) || null : null;

  const msg = await queryOne<{ conversation_id: string }>(
    `SELECT conversation_id FROM kb_messages WHERE id = $1 AND role = 'assistant'`,
    [messageId],
  );
  if (!msg || !(await findOwnedConversation(msg.conversation_id, owner))) return bad('Message not found', 404);

  await queryOne(
    `INSERT INTO kb_feedback (message_id, rating, comment) VALUES ($1, $2, $3)
     ON CONFLICT (message_id) DO UPDATE SET rating = EXCLUDED.rating, comment = COALESCE(EXCLUDED.comment, kb_feedback.comment)
     RETURNING id`,
    [messageId, rating, comment],
  );
  return NextResponse.json({ ok: true });
}

export async function handleHistory(conversationId: string, owner: ConversationOwner): Promise<NextResponse> {
  const conversation = await findOwnedConversation(conversationId, owner);
  if (!conversation) return bad('Conversation not found', 404);
  const messages = await queryRows<{ id: string; role: string; content: string; action: unknown; created_at: string }>(
    `SELECT id, role, content, action, created_at FROM (
       SELECT id, role, content, action, created_at FROM kb_messages
        WHERE conversation_id = $1 AND role IN ('user', 'assistant')
        ORDER BY created_at DESC LIMIT 40
     ) t ORDER BY created_at ASC`,
    [conversation.id],
  );
  return NextResponse.json({ conversationId: conversation.id, status: conversation.status, messages });
}

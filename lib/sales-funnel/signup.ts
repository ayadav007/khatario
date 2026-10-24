import { queryOne } from '@/lib/db';
import { BUSINESS_TYPES } from './default-flow';
import { anchorKinds, scheduleAnchor } from './engine';
import { cancelFollowups, getLeadById, logLeadEvent, setPipelineStatus, type FunnelLead } from './leads';
import { verifySignupToken } from './signup-link';
import { getPublishedFlow } from './store';

export type SignupPrefill = {
  valid: boolean;
  reason?: 'invalid' | 'used';
  name?: string;
  businessName?: string;
  businessType?: string;
  industry?: string;
  phone?: string;
};

async function leadFromToken(token: string | null | undefined): Promise<{ lead: FunnelLead; phone10: string } | null> {
  const parsed = verifySignupToken(token);
  if (!parsed) return null;
  const lead = await getLeadById(parsed.leadId);
  if (!lead || lead.phone !== parsed.phone10) return null;
  return { lead, phone10: parsed.phone10 };
}

export async function signupPrefill(token: string | null | undefined): Promise<SignupPrefill> {
  const found = await leadFromToken(token);
  if (!found) return { valid: false, reason: 'invalid' };
  if (found.lead.business_id) return { valid: false, reason: 'used' };
  const bt = BUSINESS_TYPES.find((b) => b.value === found.lead.business_type);
  return {
    valid: true,
    name: found.lead.name ?? undefined,
    businessName: found.lead.business_name ?? undefined,
    businessType: bt?.signupType,
    industry: bt?.signupIndustry,
    phone: found.phone10.length === 10 ? found.phone10 : undefined,
  };
}

/**
 * The lead token proves the person messaged us from this number on WhatsApp, which is the same
 * proof a WhatsApp OTP gives. Only valid while the lead is not yet linked to a business.
 */
export async function signupTokenVerifiesPhone(token: string | null | undefined, phone10: string | null): Promise<string | null> {
  if (!token || !phone10) return null;
  const found = await leadFromToken(token);
  if (!found || found.lead.business_id || found.phone10 !== phone10) return null;
  return found.lead.id;
}

/**
 * After signup commits: link the WhatsApp lead (by token, else by phone) to the new business,
 * move it to trial_created and schedule the trial follow-ups. Never throws.
 */
export async function linkSignupToLead(input: { businessId: string; phone10: string | null; leadId?: string | null }): Promise<void> {
  try {
    let lead = input.leadId ? await getLeadById(input.leadId) : null;
    if (!lead && input.phone10) {
      lead = await queryOne<FunnelLead>(`SELECT * FROM assistant_leads WHERE phone = $1`, [input.phone10]);
    }
    if (!lead || lead.business_id) return;
    const linked = await queryOne<{ id: string }>(
      `UPDATE assistant_leads SET business_id = $2, updated_at = NOW() WHERE id = $1 AND business_id IS NULL RETURNING id`,
      [lead.id, input.businessId],
    );
    if (!linked) return;
    lead.business_id = input.businessId;
    await logLeadEvent(lead.id, 'signup', { business_id: input.businessId, via: input.leadId ? 'whatsapp_link' : 'phone_match' });
    await setPipelineStatus(lead, 'trial_created', 'signup');

    const { flow } = await getPublishedFlow();
    await cancelFollowups(lead.id, [...anchorKinds(flow, 'awaiting_reply'), ...anchorKinds(flow, 'demo_sent')]);
    if (!lead.opted_out_at) await scheduleAnchor(flow, lead.id, 'trial_created');
  } catch (err) {
    console.error('[sales-funnel] link signup failed:', err instanceof Error ? err.message : err);
  }
}

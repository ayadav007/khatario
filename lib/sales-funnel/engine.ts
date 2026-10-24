import { query } from '@/lib/db';
import { sendTextMessage } from '@/lib/meta-whatsapp';
import type { PlatformIncomingQueueJob } from '@/lib/whatsapp-queue-types';
import { classifyReply, looksLikeQuestion } from './classify';
import {
  findOption,
  findOptionByTitle,
  findStep,
  isKeyword,
  isWaitingStep,
  normalizeKeyword,
  stepMessages,
  stepOptions,
  type FlowDefinition,
  type FlowEntry,
  type FlowMessage,
  type FlowOption,
  type FlowStep,
} from './definition';
import {
  adEntryKey,
  applyAttribution,
  cancelFollowups,
  leadContext,
  mergeFlowData,
  recordInboundEvent,
  recordOutbound,
  scheduleFollowup,
  setLeadFields,
  setLeadStep,
  setOptOut,
  setPipelineStatus,
  upsertInboundLead,
  type FunnelLead,
} from './leads';
import { notifySales } from './notify';
import { leadVars, sendFlowMessage, siteBase, usesVar, type RenderVars } from './render';
import { createSignupToken, signupLinkUrl } from './signup-link';
import { getPublishedFlow } from './store';

/** flow_step while a person from sales owns the chat; the bot stays quiet. */
export const HANDED_OFF = '_handed_off';
/** A handover with no reply from sales for this long goes back to the bot and assistant. */
const HANDOFF_EXPIRY_MS = 48 * 60 * 60 * 1000;
const MAX_STEP_CHAIN = 8;

export type AnswerFn = (text: string) => Promise<void>;

type Ctx = {
  flow: FlowDefinition;
  version: number;
  lead: FunnelLead;
  phone: string;
  answer: AnswerFn;
  /** Messages already sent this turn; after any, a failure must not fall back to another reply. */
  sent: number;
};

export function anchorKinds(flow: FlowDefinition, anchor: string): string[] {
  return flow.followups.filter((f) => f.anchor === anchor).map((f) => f.kind);
}

export async function scheduleAnchor(flow: FlowDefinition, leadId: string, anchor: string, from = new Date()): Promise<void> {
  for (const f of flow.followups) {
    if (!f.enabled || f.anchor !== anchor) continue;
    await scheduleFollowup(leadId, f.kind, new Date(from.getTime() + f.delayMinutes * 60_000));
  }
}

export function pickEntry(
  flow: FlowDefinition,
  input: { adEntry: string | null; adId: string | null; text: string },
): { entry: FlowEntry; matched: boolean } {
  const byId = (id: string | null) => (id ? flow.entries.find((e) => e.id === id) : undefined);
  const fromAd = byId(input.adEntry) ?? (input.adId ? flow.entries.find((e) => e.adIds?.includes(input.adId as string)) : undefined);
  if (fromAd) return { entry: fromAd, matched: true };
  const t = normalizeKeyword(input.text);
  if (t) {
    for (const e of flow.entries) {
      if ((e.keywords || []).some((k) => {
        const nk = normalizeKeyword(k);
        return nk.length > 0 && ` ${t} `.includes(` ${nk} `);
      })) {
        return { entry: e, matched: true };
      }
    }
  }
  return { entry: byId(flow.defaultEntry) ?? flow.entries[0], matched: false };
}

async function sendMessages(ctx: Ctx, messages: FlowMessage[], extra: RenderVars = {}): Promise<void> {
  const vars = leadVars(ctx.lead, extra);
  for (const m of messages) {
    const sent = await sendFlowMessage(ctx.phone, m, vars);
    ctx.sent += sent.length;
    for (const s of sent) await recordOutbound(ctx.lead, s.messageId, s.summary);
  }
}

async function sendText(ctx: Ctx, body: string): Promise<void> {
  const { messageId } = await sendTextMessage({ to: ctx.phone, body });
  ctx.sent += 1;
  await recordOutbound(ctx.lead, messageId, body);
}

function handoffStep(flow: FlowDefinition): FlowStep | null {
  return flow.steps.find((s) => s.actions?.includes('handoff_to_sales')) ?? null;
}

/** The interactive message the lead is answering, to re-send when they type something else. */
function promptMessage(step: FlowStep, ctx: Ctx): FlowMessage | null {
  const msgs = stepMessages(step, leadContext(ctx.lead));
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.type === 'buttons' || m.type === 'list') return m;
  }
  if (step.collect) {
    const text = [...msgs].reverse().find((m) => m.type === 'text');
    return text ?? null;
  }
  return null;
}

async function signupVars(ctx: Ctx): Promise<RenderVars> {
  const phone = ctx.lead.phone || ctx.phone;
  const token = createSignupToken(ctx.lead.id, phone);
  await mergeFlowData(ctx.lead, { signup_token_issued_at: new Date().toISOString() });
  return { signup_link: signupLinkUrl(siteBase(), token) };
}

export async function enterStep(ctx: Ctx, stepId: string, reason: string, depth = 0): Promise<void> {
  if (depth > MAX_STEP_CHAIN) {
    console.error('[sales-funnel] step chain too long at', stepId);
    return;
  }
  const step = findStep(ctx.flow, stepId);
  if (!step) {
    console.error('[sales-funnel] missing step', stepId);
    return;
  }
  const lc = leadContext(ctx.lead);
  if (step.skipIfSet && step.skipTo && lc[step.skipIfSet]) {
    return enterStep(ctx, step.skipTo, `skip:${step.id}`, depth + 1);
  }

  await setLeadStep(ctx.lead, step.id, ctx.version, reason);
  if ((ctx.lead.flow_data?.reasks ?? 0) > 0) await mergeFlowData(ctx.lead, { reasks: 0 });

  const messages = stepMessages(step, lc);
  let extra: RenderVars = {};
  let handoff = false;
  for (const action of step.actions || []) {
    switch (action) {
      case 'mark_qualified':
        await setPipelineStatus(ctx.lead, 'qualified', `step:${step.id}`);
        break;
      case 'mark_demo_interested':
        await setPipelineStatus(ctx.lead, 'demo_interested', `step:${step.id}`);
        break;
      case 'mark_demo_sent':
        await query(`UPDATE assistant_leads SET demo_sent_at = COALESCE(demo_sent_at, NOW()), updated_at = NOW() WHERE id = $1`, [ctx.lead.id]);
        ctx.lead.demo_sent_at = ctx.lead.demo_sent_at ?? new Date();
        await scheduleAnchor(ctx.flow, ctx.lead.id, 'demo_sent');
        break;
      case 'send_signup_link':
        extra = { ...extra, ...(await signupVars(ctx)) };
        break;
      case 'mark_lost':
        await setPipelineStatus(ctx.lead, 'lost', `step:${step.id}`);
        break;
      case 'handoff_to_sales':
        handoff = true;
        break;
    }
  }
  if (!extra.signup_link && usesVar(messages, 'signup_link')) extra = { ...extra, ...(await signupVars(ctx)) };

  await sendMessages(ctx, messages, extra);

  if (handoff) {
    await setLeadStep(ctx.lead, HANDED_OFF, ctx.version, `handoff:${step.id}`);
    await cancelFollowups(ctx.lead.id, anchorKinds(ctx.flow, 'awaiting_reply'));
    await notifySales(ctx.lead, ctx.flow.settings, { reason: 'handoff' });
    return;
  }
  if (step.next && !step.collect) return enterStep(ctx, step.next, `auto:${step.id}`, depth + 1);
  if (isWaitingStep(step, leadContext(ctx.lead))) await scheduleAnchor(ctx.flow, ctx.lead.id, 'awaiting_reply');
}

async function applyOption(ctx: Ctx, option: FlowOption, via: string): Promise<void> {
  if (option.set && Object.keys(option.set).length > 0) await setLeadFields(ctx.lead, option.set);
  if (option.next) {
    await enterStep(ctx, option.next, `option:${option.id}:${via}`);
  }
}

async function startFlow(ctx: Ctx, text: string, adId: string | null): Promise<void> {
  const { entry } = pickEntry(ctx.flow, { adEntry: await adEntryKey(adId), adId, text });
  if (entry.set && Object.keys(entry.set).length > 0) {
    // Entry values (e.g. the ad's pain point) only fill gaps; a lead's own answers win.
    const lc = leadContext(ctx.lead);
    const gaps = Object.fromEntries(Object.entries(entry.set).filter(([k]) => !lc[k as keyof typeof lc]));
    if (Object.keys(gaps).length) await setLeadFields(ctx.lead, gaps);
  }
  await query(`UPDATE assistant_leads SET entry_key = COALESCE(entry_key, $2), updated_at = NOW() WHERE id = $1`, [ctx.lead.id, entry.id]);
  ctx.lead.entry_key = ctx.lead.entry_key ?? entry.id;
  // Ad prefills ("I want to know about GST billing.") are statements; a real first question gets answered before the flow starts.
  if (looksLikeQuestion(text)) await ctx.answer(text);
  await enterStep(ctx, entry.step, `entry:${entry.id}`);
}

async function handleTypedReply(ctx: Ctx, step: FlowStep, text: string): Promise<void> {
  const lc = leadContext(ctx.lead);
  if (step.collect) {
    const value = text.trim();
    const valid = value.length >= 2 && value.length <= 100 && !(value.includes('?') && looksLikeQuestion(value));
    if (valid) {
      await setLeadFields(ctx.lead, { [step.collect]: value });
      if (step.next) await enterStep(ctx, step.next, `collect:${step.id}`);
      return;
    }
    await ctx.answer(text);
    const prompt = promptMessage(step, ctx);
    if (prompt) await sendMessages(ctx, [prompt]);
    await scheduleAnchor(ctx.flow, ctx.lead.id, 'awaiting_reply');
    return;
  }

  const options = stepOptions(step, lc);
  if (options.length === 0 || step.terminal) {
    await ctx.answer(text);
    return;
  }
  const prompt = promptMessage(step, ctx);
  const question = prompt && 'body' in prompt ? prompt.body : step.label;
  const result = await classifyReply(text, options, question);
  if (result.optionId) {
    const option = options.find((o) => o.id === result.optionId);
    if (option) return applyOption(ctx, option, result.via);
  }

  const reasks = ctx.lead.flow_data?.reasks ?? 0;
  const isQuestion = looksLikeQuestion(text);
  if (isQuestion || reasks >= ctx.flow.settings.maxReasks) await ctx.answer(text);
  if (reasks < ctx.flow.settings.maxReasks) {
    if (!isQuestion) await sendText(ctx, ctx.flow.settings.notUnderstood);
    if (prompt) await sendMessages(ctx, [prompt]);
    await mergeFlowData(ctx.lead, { reasks: reasks + 1 });
    await scheduleAnchor(ctx.flow, ctx.lead.id, 'awaiting_reply');
  }
}

export type FunnelJob = Pick<PlatformIncomingQueueJob, 'from' | 'profileName' | 'text' | 'messageId' | 'replyId' | 'referral'>;

/**
 * Runs one inbound message from a prospect through the published flow. `answer` is the existing
 * assistant reply, used for questions and free text the flow cannot place.
 */
export async function handleFunnelMessage(
  job: FunnelJob,
  answer: AnswerFn,
  opts: { knownUser?: boolean } = {},
): Promise<boolean> {
  const { flow, version } = await getPublishedFlow();
  const s = flow.settings;
  if (!s.funnelEnabled) return false;
  const text = (job.text || '').trim();
  const phone = job.from.replace(/\D/g, '');

  if (opts.knownUser) {
    // Registered users only reach the funnel for opt-out, HELP and taps on funnel buttons.
    const relevant = isKeyword(text, s.stopKeywords) || isKeyword(text, s.startKeywords) || isKeyword(text, s.helpKeywords) || Boolean(job.replyId && (findOption(flow, job.replyId) || findOptionByTitle(flow, job.replyId)));
    if (!relevant) return false;
    const { getLeadByPhone } = await import('./leads');
    if (!(await getLeadByPhone(phone))) return false;
  }

  const { lead } = await upsertInboundLead(phone, job.profileName);
  const ctx: Ctx = { flow, version, lead, phone, answer: async () => undefined, sent: 0 };
  ctx.answer = async (t: string) => {
    await answer(t);
    ctx.sent += 1;
  };
  try {
    return await runTurn(ctx, job, text);
  } catch (err) {
    if (ctx.sent === 0) throw err;
    console.error('[sales-funnel] failed after replying:', err instanceof Error ? err.message : err);
    return true;
  }
}

async function runTurn(ctx: Ctx, job: FunnelJob, text: string): Promise<boolean> {
  const { flow, version, lead } = ctx;
  const s = flow.settings;
  const answer = ctx.answer;
  await recordInboundEvent(lead, text, job.replyId ?? null, job.messageId);
  if (job.referral) {
    await applyAttribution(lead, {
      adId: job.referral.sourceId,
      sourceType: job.referral.sourceType,
      sourceUrl: job.referral.sourceUrl,
      headline: job.referral.headline,
      ctwaClid: job.referral.ctwaClid,
    });
  }
  await cancelFollowups(lead.id, anchorKinds(flow, 'awaiting_reply'));

  if (isKeyword(text, s.stopKeywords)) {
    await setOptOut(lead, true);
    await sendText(ctx, s.optOutReply);
    return true;
  }
  if (lead.opted_out_at) {
    if (!isKeyword(text, s.startKeywords)) return true;
    await setOptOut(lead, false);
    await sendText(ctx, s.optInReply);
    return true;
  }

  if (isKeyword(text, s.restartKeywords)) {
    const { entry } = pickEntry(flow, { adEntry: null, adId: null, text: '' });
    await enterStep(ctx, entry.step, 'restart');
    return true;
  }
  if (isKeyword(text, s.helpKeywords) && lead.flow_step !== HANDED_OFF) {
    const step = handoffStep(flow);
    if (step) {
      await enterStep(ctx, step.id, 'help_keyword');
      return true;
    }
  }

  if (lead.flow_step === HANDED_OFF) {
    const since = lead.flow_data?.last_handoff_notify_at ? new Date(lead.flow_data.last_handoff_notify_at).getTime() : 0;
    const lastOut = lead.last_outbound_at ? new Date(lead.last_outbound_at).getTime() : 0;
    if (Date.now() - Math.max(since, lastOut) < HANDOFF_EXPIRY_MS) {
      await notifySales(lead, s, { reason: 'message_while_handed_off', text });
      return true;
    }
    // Back to the terminal handover step: typed questions now get the assistant, buttons still work.
    await setLeadStep(lead, handoffStep(flow)?.id ?? null, version, 'handoff_expired');
  }

  if (job.replyId) {
    const found = findOption(flow, job.replyId) ?? findOptionByTitle(flow, job.replyId);
    if (found) {
      await applyOption(ctx, found.option, 'tap');
      return true;
    }
  }

  if (!lead.flow_step) {
    if (lead.business_id || lead.pipeline_status === 'trial_created' || lead.pipeline_status === 'activated' || lead.pipeline_status === 'converted') {
      await answer(text);
      return true;
    }
    await startFlow(ctx, text, job.referral?.sourceId ?? null);
    return true;
  }

  const step = findStep(flow, lead.flow_step);
  if (!step) {
    // The step was removed in a newer flow version: restart unless the lead is already past signup.
    if (lead.business_id) {
      await answer(text);
    } else {
      const { entry } = pickEntry(flow, { adEntry: null, adId: null, text: '' });
      await enterStep(ctx, entry.step, 'step_missing');
    }
    return true;
  }

  if (!text) return true;
  await handleTypedReply(ctx, step, text);
  return true;
}

/**
 * Admin "resume bot": put a handed-off lead back on a step (or the assistant when none).
 * With `send`, the step's messages go out now, which needs the lead's 24-hour window to be open.
 */
export async function resumeBot(leadId: string, stepId: string | null, opts: { send?: boolean } = {}): Promise<void> {
  const { getLeadById } = await import('./leads');
  const lead = await getLeadById(leadId);
  if (!lead) throw new Error('Lead not found');
  const { flow, version } = await getPublishedFlow();
  if (stepId && !findStep(flow, stepId)) throw new Error('Step not found in the published flow');
  if (!stepId || !opts.send) {
    await setLeadStep(lead, stepId, version, 'admin_resume');
    return;
  }
  const phone = (lead.wa_phone || lead.phone || '').replace(/\D/g, '');
  if (!phone) throw new Error('Lead has no WhatsApp number');
  const ctx: Ctx = { flow, version, lead, phone, answer: async () => undefined, sent: 0 };
  await enterStep(ctx, stepId, 'admin_resume');
}

/** "Send test": a step's messages from any flow (usually the draft) with sample lead details. */
export async function previewStep(flow: FlowDefinition, stepId: string, toPhone: string): Promise<number> {
  const step = findStep(flow, stepId);
  if (!step) throw new Error('Step not found');
  const vars: RenderVars = {
    first_name: 'Ramesh',
    name_suffix: ' Ramesh',
    owner_name: 'Ramesh Kumar',
    business_name: 'Sharma Traders',
    business_type_label: 'Wholesale / Distribution',
    pain_point_label: 'GST billing',
    app_link: siteBase(),
    signup_link: `${siteBase()}/signup?src=whatsapp`,
  };
  let count = 0;
  for (const m of step.messages) count += (await sendFlowMessage(toPhone, m, vars)).length;
  return count;
}

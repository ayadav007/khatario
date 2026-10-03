import { z } from 'zod';
import { WA_LIMITS } from '@/lib/meta-whatsapp';

/**
 * A sales flow is data, not code: steps send messages and wait for a button, list choice or typed
 * answer. Options and actions come from fixed lists so an edited flow can never do more than the
 * engine allows (no account creation or subscription changes from flow config).
 */

export const FLOW_ACTIONS = [
  'mark_qualified',
  'mark_demo_interested',
  'mark_demo_sent',
  'send_signup_link',
  'handoff_to_sales',
  'mark_lost',
] as const;
export type FlowAction = (typeof FLOW_ACTIONS)[number];

/** Lead fields a choice or typed answer may set. */
export const LEAD_FIELDS = ['business_type', 'pain_point', 'business_name', 'owner_name', 'city'] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];

export const FOLLOWUP_ANCHORS = ['awaiting_reply', 'demo_sent', 'trial_created'] as const;
export const FOLLOWUP_CONDITIONS = ['no_reply', 'no_trial', 'no_invoice', 'activated_not_paid'] as const;

const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers and underscores');

export const OptionSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(WA_LIMITS.listRowTitle),
  description: z.string().trim().max(WA_LIMITS.listRowDescription).optional(),
  next: idSchema.optional(),
  set: z.record(z.enum(LEAD_FIELDS), z.string().trim().max(100)).optional(),
  /** Words that pick this option when typed instead of tapped. */
  keywords: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});
export type FlowOption = z.infer<typeof OptionSchema>;

const mediaKeySchema = z.string().trim().min(1).max(64);

export const MessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), body: z.string().trim().min(1).max(4096) }),
  z.object({
    type: z.literal('buttons'),
    body: z.string().trim().min(1).max(WA_LIMITS.interactiveBody),
    headerText: z.string().trim().max(WA_LIMITS.headerText).optional(),
    headerMediaKey: mediaKeySchema.optional(),
    footer: z.string().trim().max(WA_LIMITS.interactiveFooter).optional(),
    options: z.array(OptionSchema.extend({ title: z.string().trim().min(1).max(WA_LIMITS.buttonTitle) })).min(1).max(WA_LIMITS.buttonsMax),
  }),
  z.object({
    type: z.literal('list'),
    body: z.string().trim().min(1).max(WA_LIMITS.interactiveBody),
    buttonText: z.string().trim().min(1).max(WA_LIMITS.listButton),
    headerText: z.string().trim().max(WA_LIMITS.headerText).optional(),
    footer: z.string().trim().max(WA_LIMITS.interactiveFooter).optional(),
    options: z.array(OptionSchema).min(1).max(WA_LIMITS.listRowsMax),
  }),
  z.object({
    type: z.literal('image'),
    mediaKey: mediaKeySchema,
    caption: z.string().trim().max(WA_LIMITS.caption).optional(),
  }),
  z.object({
    type: z.literal('video'),
    mediaKey: mediaKeySchema,
    caption: z.string().trim().max(WA_LIMITS.caption).optional(),
    /** Sent instead when the video has not been uploaded yet. */
    fallback: z
      .array(z.object({ type: z.enum(['text', 'image']), body: z.string().optional(), mediaKey: z.string().optional(), caption: z.string().optional() }))
      .max(5)
      .optional(),
  }),
]);
export type FlowMessage = z.infer<typeof MessageSchema>;

export const VariantSchema = z.object({
  when: z.object({ business_type: z.string().optional(), pain_point: z.string().optional() }),
  messages: z.array(MessageSchema).min(1).max(6),
});

export const StepSchema = z.object({
  id: idSchema,
  label: z.string().trim().min(1).max(100),
  messages: z.array(MessageSchema).max(6),
  variants: z.array(VariantSchema).max(40).optional(),
  actions: z.array(z.enum(FLOW_ACTIONS)).max(6).optional(),
  /** Typed answer saved to a lead field, then go to `next`. */
  collect: z.enum(LEAD_FIELDS).optional(),
  /** Go straight on after sending (no reply needed). */
  next: idSchema.optional(),
  /** After this step the bot stops leading; typed questions go to the assistant. */
  terminal: z.boolean().optional(),
  /** Jump to `skipTo` without sending when the lead already has this field (e.g. set by the ad entry). */
  skipIfSet: z.enum(LEAD_FIELDS).optional(),
  skipTo: idSchema.optional(),
});
export type FlowStep = z.infer<typeof StepSchema>;

export const EntrySchema = z.object({
  id: idSchema,
  label: z.string().trim().min(1).max(100),
  step: idSchema,
  adIds: z.array(z.string().trim().min(1).max(64)).max(200).optional(),
  /** Phrases from the ad's prefilled message, matched case-insensitively. */
  keywords: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  set: z.record(z.enum(LEAD_FIELDS), z.string().trim().max(100)).optional(),
});
export type FlowEntry = z.infer<typeof EntrySchema>;

export const FollowupSchema = z.object({
  kind: idSchema.max(48),
  label: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
  anchor: z.enum(FOLLOWUP_ANCHORS),
  delayMinutes: z.number().int().min(1).max(60 * 24 * 60),
  condition: z.enum(FOLLOWUP_CONDITIONS),
  /** Sent as normal messages inside the 24-hour window. */
  messages: z.array(MessageSchema).max(4).optional(),
  /** Re-send the step the lead is waiting on after `messages`. */
  repeatCurrentStep: z.boolean().optional(),
  /** Approved template used outside the 24-hour window (platform template event key). */
  templateEventKey: z.string().trim().max(64).optional(),
  /** Lead variables for {{1}}..{{n}} in the template body. */
  templateVars: z.array(z.string().trim().max(40)).max(5).optional(),
  /** Header image or video per pain point for media-header templates. */
  headerMediaByPainPoint: z.record(z.string(), z.string()).optional(),
});
export type FlowFollowup = z.infer<typeof FollowupSchema>;

export const SettingsSchema = z.object({
  /** Off: prospects get only the assistant, as before the funnel existed. */
  funnelEnabled: z.boolean().default(true),
  /** Platform admin notified (push) on handover; also used for optional WhatsApp/email alerts. */
  salesNotifyPhone: z.string().trim().max(20).optional(),
  salesNotifyEmail: z.string().trim().max(255).optional(),
  optOutReply: z.string().trim().min(1).max(1000),
  optInReply: z.string().trim().min(1).max(1000),
  notUnderstood: z.string().trim().min(1).max(500),
  stopKeywords: z.array(z.string().trim().min(1).max(30)).max(20),
  startKeywords: z.array(z.string().trim().min(1).max(30)).max(20),
  helpKeywords: z.array(z.string().trim().min(1).max(30)).max(20),
  restartKeywords: z.array(z.string().trim().min(1).max(30)).max(20),
  /** Re-ask the waiting question at most this many times in a row before only answering. */
  maxReasks: z.number().int().min(0).max(5),
});
export type FlowSettings = z.infer<typeof SettingsSchema>;

export const FlowDefinitionSchema = z
  .object({
    entries: z.array(EntrySchema).min(1).max(50),
    defaultEntry: idSchema,
    steps: z.array(StepSchema).min(1).max(80),
    followups: z.array(FollowupSchema).max(20),
    settings: SettingsSchema,
  })
  .superRefine((def, ctx) => {
    const stepIds = new Set<string>();
    for (const s of def.steps) {
      if (stepIds.has(s.id)) ctx.addIssue({ code: 'custom', message: `Duplicate step id "${s.id}"` });
      stepIds.add(s.id);
    }
    const check = (id: string | undefined, where: string) => {
      if (id && !stepIds.has(id)) ctx.addIssue({ code: 'custom', message: `${where} points to missing step "${id}"` });
    };
    const optionIds = new Map<string, string>();
    for (const s of def.steps) {
      check(s.next, `Step "${s.id}"`);
      check(s.skipTo, `Step "${s.id}" skip`);
      if (s.skipIfSet && !s.skipTo) ctx.addIssue({ code: 'custom', message: `Step "${s.id}" has a skip field but no skip target` });
      if (s.collect && !s.next) ctx.addIssue({ code: 'custom', message: `Step "${s.id}" collects an answer but has no next step` });
      const all = [...s.messages, ...(s.variants || []).flatMap((v) => v.messages)];
      for (const m of all) {
        if (m.type !== 'buttons' && m.type !== 'list') continue;
        for (const o of m.options) {
          check(o.next, `Option "${o.id}" in step "${s.id}"`);
          const owner = optionIds.get(o.id);
          if (owner && owner !== s.id) {
            ctx.addIssue({ code: 'custom', message: `Option id "${o.id}" is used in steps "${owner}" and "${s.id}"; ids must be unique` });
          }
          optionIds.set(o.id, s.id);
        }
      }
    }
    const entryIds = new Set(def.entries.map((e) => e.id));
    for (const e of def.entries) check(e.step, `Entry "${e.id}"`);
    if (!entryIds.has(def.defaultEntry)) ctx.addIssue({ code: 'custom', message: `Default entry "${def.defaultEntry}" does not exist` });
    const kinds = new Set<string>();
    for (const f of def.followups) {
      if (kinds.has(f.kind)) ctx.addIssue({ code: 'custom', message: `Duplicate follow-up "${f.kind}"` });
      kinds.add(f.kind);
      if (!f.messages?.length && !f.repeatCurrentStep && !f.templateEventKey) {
        ctx.addIssue({ code: 'custom', message: `Follow-up "${f.kind}" has nothing to send` });
      }
    }
  });
export type FlowDefinition = z.infer<typeof FlowDefinitionSchema>;

export function validateFlow(raw: unknown): { ok: true; flow: FlowDefinition } | { ok: false; errors: string[] } {
  const parsed = FlowDefinitionSchema.safeParse(raw);
  if (parsed.success) return { ok: true, flow: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.slice(0, 20).map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)),
  };
}

export function findStep(flow: FlowDefinition, id: string | null | undefined): FlowStep | null {
  if (!id) return null;
  return flow.steps.find((s) => s.id === id) ?? null;
}

export type LeadContext = Partial<Record<LeadField, string | null>>;

/** The step's messages, replaced by the most specific matching variant. */
export function stepMessages(step: FlowStep, lead: LeadContext): FlowMessage[] {
  let best: { score: number; messages: FlowMessage[] } | null = null;
  for (const v of step.variants || []) {
    const conds = Object.entries(v.when).filter(([, val]) => val);
    if (conds.length === 0) continue;
    const matches = conds.every(([k, val]) => (lead as Record<string, unknown>)[k] === val);
    if (matches && (!best || conds.length > best.score)) best = { score: conds.length, messages: v.messages };
  }
  return best ? best.messages : step.messages;
}

/** Options the lead can pick at this step (from the last interactive message sent). */
export function stepOptions(step: FlowStep, lead: LeadContext): FlowOption[] {
  const msgs = stepMessages(step, lead);
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.type === 'buttons' || m.type === 'list') return m.options;
  }
  return [];
}

/** Find an option by id anywhere in the flow, so taps on older buttons still work. */
export function findOption(flow: FlowDefinition, optionId: string): { step: FlowStep; option: FlowOption } | null {
  for (const step of flow.steps) {
    const all = [...step.messages, ...(step.variants || []).flatMap((v) => v.messages)];
    for (const m of all) {
      if (m.type !== 'buttons' && m.type !== 'list') continue;
      const option = m.options.find((o) => o.id === optionId);
      if (option) return { step, option };
    }
  }
  return null;
}

/** Template quick-reply taps carry the button text, not an option id. */
export function findOptionByTitle(flow: FlowDefinition, title: string): { step: FlowStep; option: FlowOption } | null {
  const t = normalizeKeyword(title);
  if (!t) return null;
  for (const step of flow.steps) {
    const all = [...step.messages, ...(step.variants || []).flatMap((v) => v.messages)];
    for (const m of all) {
      if (m.type !== 'buttons' && m.type !== 'list') continue;
      const option = m.options.find((o) => normalizeKeyword(o.title) === t);
      if (option) return { step, option };
    }
  }
  return null;
}

/** Steps that wait for the lead: typed answers, or choices without an automatic next step. */
export function isWaitingStep(step: FlowStep, lead: LeadContext): boolean {
  if (step.terminal) return false;
  if (step.collect) return true;
  return !step.next && stepOptions(step, lead).length > 0;
}

export function normalizeKeyword(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** Whole-message keyword match, so "don't stop" never opts anyone out. */
export function isKeyword(text: string, keywords: string[]): boolean {
  const t = normalizeKeyword(text);
  return t.length > 0 && keywords.some((k) => normalizeKeyword(k) === t);
}

import {
  DefaultUIConfig,
  validateUIConfig,
  type WhatsAppBotUIConfig,
} from '@/types/whatsapp-bot-config';

export type AgentKeySource = 'own' | 'khatario';
export type AgentMode = 'dev' | 'prod';
export type ConversationLeadStatus = 'new' | 'interested' | 'follow_up' | 'converted' | 'lost';

export interface AgentHandoff {
  enabled: boolean;
  triggerPhrases: string[];
  message: string;
  /** 'auto' uses the business auto-assign rules; otherwise a user id. */
  assignTo: string;
  pauseMinutes: number;
  pauseOnStaffReply: boolean;
}

export interface LeadQuestion {
  id: string;
  text: string;
  /** Saved to whatsapp_conversation_custom_fields under this key. */
  fieldKey: string;
  required: boolean;
}

export interface LeadSkill {
  enabled: boolean;
  questions: LeadQuestion[];
  onQualify: {
    labels: string[];
    leadStatus: ConversationLeadStatus | '';
    assignTo: string;
    handoff: boolean;
  };
}

export interface AgentSkills {
  takeOrders: boolean;
  orderStatus: boolean;
  paymentLinks: boolean;
}

export interface AgentSettings {
  agentName: string;
  greetingMessage: string;
  businessSummary: string;
  instructions: string;
  behavior: WhatsAppBotUIConfig;
  fallbackMessage: string;
  afterHoursMessage: string;
  postPaymentMessage: string;
  handoff: AgentHandoff;
  leadSkill: LeadSkill;
  skills: AgentSkills;
  quickRepliesEnabled: boolean;
  setupCompletedAt: string | null;
}

/** Provider side of the agent. Never carries the API key itself. */
export interface AgentProviderSummary {
  keySource: AgentKeySource;
  provider: string;
  model: string;
  apiBaseUrl: string;
  hasKey: boolean;
  keyLast4: string | null;
  temperature: number;
  maxTokens: number;
  chatbotEnabled: boolean;
  leadAnalyzerEnabled: boolean;
  mode: AgentMode;
  devAllowedPhones: string[];
  typingEnabled: boolean;
  typingDelaySeconds: number;
  dailyLimit: number;
  configured: boolean;
}

export interface AgentUsage {
  repliesToday: number;
  dailyLimit: number;
  repliesThisMonth: number;
  keySource: AgentKeySource;
  khatarioAi: {
    active: boolean;
    monthlyQuota: number;
    trialRemaining: number;
    trialTotal: number;
    price: number;
  };
}

export const INSTRUCTIONS_MAX = 2000;
export const MESSAGE_MAX = 1000;
export const MAX_TRIGGER_PHRASES = 20;
export const MAX_LEAD_QUESTIONS = 8;
export const MAX_TEST_NUMBERS = 3;

export const DEFAULT_FALLBACK_MESSAGE =
  "Sorry, I couldn't answer that right now. Someone from our team will get back to you shortly.";
export const DEFAULT_HANDOFF_MESSAGE =
  "Sure, I'm connecting you to our team. Someone will reply here shortly.";
export const DEFAULT_AFTER_HOURS_MESSAGE =
  "Thanks for your message! We're closed right now and will reply when we open.";
export const DEFAULT_POST_PAYMENT_MESSAGE =
  "Thanks! Your payment is confirmed — we'll share the order details shortly.";

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  agentName: '',
  greetingMessage: '',
  businessSummary: '',
  instructions: '',
  behavior: DefaultUIConfig,
  fallbackMessage: '',
  afterHoursMessage: '',
  postPaymentMessage: '',
  handoff: {
    enabled: true,
    triggerPhrases: ['talk to a human', 'call me', 'agent', 'customer care'],
    message: '',
    assignTo: 'auto',
    pauseMinutes: 30,
    pauseOnStaffReply: true,
  },
  leadSkill: {
    enabled: false,
    questions: [],
    onQualify: { labels: [], leadStatus: 'interested', assignTo: '', handoff: false },
  },
  skills: { takeOrders: true, orderStatus: true, paymentLinks: true },
  quickRepliesEnabled: false,
  setupCompletedAt: null,
};

function isObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function str(v: unknown, max: number, fallback = ''): string {
  return typeof v === 'string' ? v.slice(0, max) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isObject(base) || !isObject(patch)) return (patch === undefined ? base : (patch as T));
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const cur = out[k];
    out[k] = isObject(cur) && isObject(v) ? deepMerge(cur, v) : v;
  }
  return out as T;
}

export function slugFieldKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/** Fill gaps and clamp everything to safe sizes; used on load and before save. */
export function normalizeAgentSettings(input: unknown): AgentSettings {
  const d = DEFAULT_AGENT_SETTINGS;
  const src = isObject(input) ? input : {};
  const handoff = isObject(src.handoff) ? src.handoff : {};
  const lead = isObject(src.leadSkill) ? src.leadSkill : {};
  const onQualify = isObject(lead.onQualify) ? lead.onQualify : {};
  const skills = isObject(src.skills) ? src.skills : {};

  const phrases = Array.isArray(handoff.triggerPhrases)
    ? handoff.triggerPhrases
        .filter((p): p is string => typeof p === 'string')
        .map((p) => p.trim().slice(0, 60))
        .filter(Boolean)
        .slice(0, MAX_TRIGGER_PHRASES)
    : d.handoff.triggerPhrases;

  const questions: LeadQuestion[] = Array.isArray(lead.questions)
    ? lead.questions
        .filter(isObject)
        .map((q, i) => {
          const text = str(q.text, 200).trim();
          return {
            id: str(q.id, 40) || `q${i + 1}`,
            text,
            fieldKey: slugFieldKey(str(q.fieldKey, 40) || text) || `question_${i + 1}`,
            required: bool(q.required, false),
          };
        })
        .filter((q) => q.text)
        .slice(0, MAX_LEAD_QUESTIONS)
    : [];

  const leadStatuses: Array<ConversationLeadStatus | ''> = ['', 'new', 'interested', 'follow_up', 'converted', 'lost'];
  const leadStatus = leadStatuses.includes(onQualify.leadStatus as ConversationLeadStatus)
    ? (onQualify.leadStatus as ConversationLeadStatus | '')
    : d.leadSkill.onQualify.leadStatus;

  const pause = Number(handoff.pauseMinutes);

  return {
    agentName: str(src.agentName, 120),
    greetingMessage: str(src.greetingMessage, MESSAGE_MAX),
    businessSummary: str(src.businessSummary, INSTRUCTIONS_MAX),
    instructions: str(src.instructions, INSTRUCTIONS_MAX),
    behavior: deepMerge(DefaultUIConfig, isObject(src.behavior) ? src.behavior : {}),
    fallbackMessage: str(src.fallbackMessage, MESSAGE_MAX),
    afterHoursMessage: str(src.afterHoursMessage, MESSAGE_MAX),
    postPaymentMessage: str(src.postPaymentMessage, MESSAGE_MAX),
    handoff: {
      enabled: bool(handoff.enabled, d.handoff.enabled),
      triggerPhrases: phrases,
      message: str(handoff.message, MESSAGE_MAX),
      assignTo: str(handoff.assignTo, 64) || 'auto',
      pauseMinutes: Number.isFinite(pause) ? Math.min(Math.max(Math.round(pause), 5), 1440) : d.handoff.pauseMinutes,
      pauseOnStaffReply: bool(handoff.pauseOnStaffReply, d.handoff.pauseOnStaffReply),
    },
    leadSkill: {
      enabled: bool(lead.enabled, false),
      questions,
      onQualify: {
        labels: Array.isArray(onQualify.labels)
          ? onQualify.labels.filter((l): l is string => typeof l === 'string').map((l) => l.trim().slice(0, 40)).filter(Boolean).slice(0, 10)
          : [],
        leadStatus,
        assignTo: str(onQualify.assignTo, 64),
        handoff: bool(onQualify.handoff, false),
      },
    },
    skills: {
      takeOrders: bool(skills.takeOrders, d.skills.takeOrders),
      orderStatus: bool(skills.orderStatus, d.skills.orderStatus),
      paymentLinks: bool(skills.paymentLinks, d.skills.paymentLinks),
    },
    quickRepliesEnabled: bool(src.quickRepliesEnabled, false),
    setupCompletedAt: typeof src.setupCompletedAt === 'string' ? src.setupCompletedAt : null,
  };
}

export interface AgentValidationError {
  field: string;
  message: string;
}

export function validateAgentSettings(s: AgentSettings): AgentValidationError[] {
  const errors: AgentValidationError[] = validateUIConfig(s.behavior).map((e) => ({
    field: `behavior.${e.field}`,
    message: e.message,
  }));
  if (s.instructions.length > INSTRUCTIONS_MAX) {
    errors.push({ field: 'instructions', message: `Instructions must be under ${INSTRUCTIONS_MAX} characters` });
  }
  if (s.handoff.enabled && s.handoff.triggerPhrases.length === 0) {
    errors.push({ field: 'handoff.triggerPhrases', message: 'Add at least one trigger phrase or turn off handoff' });
  }
  if (s.leadSkill.enabled && s.leadSkill.questions.length === 0) {
    errors.push({ field: 'leadSkill.questions', message: 'Add at least one qualification question' });
  }
  const keys = new Set<string>();
  for (const q of s.leadSkill.questions) {
    if (keys.has(q.fieldKey)) {
      errors.push({ field: 'leadSkill.questions', message: `Two questions save to the same field "${q.fieldKey}"` });
    }
    keys.add(q.fieldKey);
  }
  return errors;
}

export interface GoLiveCheck {
  id: string;
  label: string;
  ok: boolean;
}

export function goLiveChecklist(
  settings: AgentSettings,
  provider: AgentProviderSummary,
  knowledgeReady: boolean,
): GoLiveCheck[] {
  return [
    { id: 'summary', label: 'Business summary is filled in', ok: settings.businessSummary.trim().length >= 20 },
    { id: 'knowledge', label: 'At least one knowledge source is ready', ok: knowledgeReady },
    { id: 'fallback', label: 'Fallback message is set', ok: settings.fallbackMessage.trim().length > 0 },
    {
      id: 'provider',
      label: provider.keySource === 'khatario' ? 'Khatario AI is active' : 'Your API key is saved',
      ok: provider.configured,
    },
  ];
}

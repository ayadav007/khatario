export const AUDIENCES = ['prospect', 'tenant_user', 'tenant_customer', 'internal'] as const;
export type Audience = (typeof AUDIENCES)[number];

export const CHANNELS = ['web', 'signup', 'trial_app', 'in_app', 'whatsapp'] as const;
export type Channel = (typeof CHANNELS)[number];

export type SourceKind =
  | 'markdown'
  | 'plans'
  | 'marketing_page'
  | 'tenant_policy'
  | 'tenant_catalog'
  | 'tenant_url';

export type Locale = 'en' | 'hinglish' | 'hi';

export interface RetrievalScope {
  audience: Audience;
  /** Required for tenant_customer; must be null for platform audiences. */
  businessId?: string | null;
}

export interface KbDocumentInput {
  docKey: string;
  title: string;
  url?: string | null;
  audiences: Audience[];
  locale: Locale;
  tags: string[];
  requiredFeature?: string | null;
  body: string;
}

export interface KbSourceInput {
  kind: SourceKind;
  locator: string;
  audiences: Audience[];
  businessId?: string | null;
  documents: KbDocumentInput[];
}

export interface ChunkDraft {
  ordinal: number;
  headingPath: string;
  content: string;
  tokenEstimate: number;
}

export interface RetrievedChunk {
  id: string;
  documentId: string;
  title: string;
  url: string | null;
  headingPath: string;
  content: string;
  score: number;
  vectorRank: number | null;
  textRank: number | null;
  vectorSimilarity: number | null;
}

export type AssistantIntent =
  | 'question'
  | 'pricing'
  | 'book_demo'
  | 'recommend_plan'
  | 'start_trial'
  | 'talk_to_human'
  | 'greeting'
  | 'other';

export interface Citation {
  title: string;
  url: string | null;
  headingPath: string;
}

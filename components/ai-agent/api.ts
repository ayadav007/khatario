import type {
  AgentProviderSummary,
  AgentSettings,
  AgentUsage,
  GoLiveCheck,
} from '@/lib/ai-agent/types';

export interface AgentSnapshot {
  settings: AgentSettings;
  saved: boolean;
  businessName: string;
  companyIntroduction: string;
  catalogItems: number;
  paymentsConfigured: boolean;
  provider: AgentProviderSummary;
  usage: AgentUsage;
  knowledgeReady: boolean;
  checklist: GoLiveCheck[];
}

export class AgentApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

function withBusiness(path: string, businessId: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}business_id=${encodeURIComponent(businessId)}`;
}

export async function agentFetch<T>(businessId: string, path: string, init: RequestInit = {}): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const res = await fetch(withBusiness(path, businessId), {
    credentials: 'include',
    ...init,
    headers: isForm ? init.headers : { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AgentApiError(data.error || `Request failed (${res.status})`, res.status, data.code);
  }
  return data as T;
}

export const agentJson = (body: unknown): RequestInit['body'] => JSON.stringify(body);

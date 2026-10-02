// AI Provider Factory - Abstraction layer for multiple AI providers
// Supports: OpenAI, Google Gemini, Groq, Custom APIs

import { queryOne } from '@/lib/db';
import { decryptSecret } from '@/lib/secret-encryption';

// Supported AI providers
export type AIProvider = 'openai' | 'gemini' | 'groq' | 'anthropic' | 'custom';

export interface AIProviderConfig {
  provider: AIProvider;
  apiKey: string;
  apiBaseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  content: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

// Base interface for all AI providers
export interface AIProviderInterface {
  chat(messages: ChatMessage[]): Promise<AIResponse>;
  chatJSON(messages: ChatMessage[]): Promise<any>; // For structured responses
  analyzeImage(imageUrl: string, prompt: string): Promise<string>; // For vision/OCR
}

// OpenAI Provider
class OpenAIProvider implements AIProviderInterface {
  constructor(private config: AIProviderConfig) {}

  async chat(messages: ChatMessage[]): Promise<AIResponse> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model || 'gpt-3.5-turbo',
        messages: messages,
        temperature: this.config.temperature || 0.7,
        max_tokens: this.config.maxTokens || 500,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return {
      content: data.choices[0]?.message?.content || '',
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };
  }

  async chatJSON(messages: ChatMessage[]): Promise<any> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model || 'gpt-3.5-turbo',
        messages: messages,
        temperature: this.config.temperature || 0.3,
        max_tokens: this.config.maxTokens || 1000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || '{}';
    return JSON.parse(content);
  }

  async analyzeImage(imageUrl: string, prompt: string): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model || 'gpt-4o', // Use GPT-4o by default for vision
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl
                }
              }
            ]
          }
        ],
        max_tokens: this.config.maxTokens || 1000,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI Vision API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || '';
  }
}

// Google Gemini Provider
export function geminiThinks(model: string): boolean {
  const m = /gemini-(\d+(?:\.\d+)?)/.exec(model);
  return !!m && Number(m[1]) >= 2.5;
}

class GeminiProvider implements AIProviderInterface {
  constructor(private config: AIProviderConfig) {}

  async chat(messages: ChatMessage[]): Promise<AIResponse> {
    // Convert messages to Gemini format
    const contents: any[] = [];
    let systemInstruction = '';

    messages.forEach(msg => {
      if (msg.role === 'system') {
        systemInstruction = msg.content;
      } else {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        });
      }
    });

    const model = this.config.model || 'gemini-pro';
    const maxTokens = this.config.maxTokens || 500;
    const requestBody: any = {
      contents: contents,
      generationConfig: {
        temperature: this.config.temperature || 0.7,
        // Gemini 2.5+ thinks before answering and the thinking counts against maxOutputTokens.
        maxOutputTokens: geminiThinks(model) ? maxTokens + 1024 : maxTokens,
      },
    };

    if (systemInstruction) {
      requestBody.systemInstruction = {
        parts: [{ text: systemInstruction }]
      };
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.config.apiKey,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30_000),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${error.slice(0, 300)}`);
    }

    const data = await response.json();
    const parts: Array<{ text?: string; thought?: boolean }> = data.candidates?.[0]?.content?.parts ?? [];
    return {
      content: parts.filter((p) => !p.thought).map((p) => p.text ?? '').join(''),
    };
  }

  async chatJSON(messages: ChatMessage[]): Promise<any> {
    // Add instruction to return JSON
    const jsonMessages: ChatMessage[] = [
      ...messages,
      {
        role: 'user',
        content: 'Please respond with valid JSON only, no additional text.',
      },
    ];

    const response = await this.chat(jsonMessages);
    try {
      return JSON.parse(response.content);
    } catch {
      // Try to extract JSON from response
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('Failed to parse JSON response from Gemini');
    }
  }

  async analyzeImage(imageUrl: string, prompt: string): Promise<string> {
    // Determine model (flash is better/cheaper for simple vision)
    const model = this.config.model || 'gemini-1.5-flash';
    
    // For Gemini, we need to handle the image. 
    // If it's a URL, we need to fetch it and convert to base64 for inline_data
    // or use file API. For simplicity here, we'll try to fetch and send as inline_data.
    
    try {
      const imgResponse = await fetch(imageUrl);
      const buffer = await imgResponse.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      const mimeType = imgResponse.headers.get('content-type') || 'image/jpeg';

      const requestBody = {
        contents: [{
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64
              }
            }
          ]
        }],
        generationConfig: {
          maxOutputTokens: this.config.maxTokens || 1000,
        }
      };

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.config.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Gemini Vision API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (error: any) {
      throw new Error(`Gemini Vision analysis failed: ${error.message}`);
    }
  }
}

/**
 * gpt-oss models reason before answering and the reasoning counts against the token limit, so a
 * plain `max_tokens: 600` can come back with empty content. Keep reasoning low and leave room for it.
 */
export function groqRequestBody(
  model: string,
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const reasoning = model.startsWith('openai/gpt-oss');
  return {
    model,
    messages,
    temperature,
    max_completion_tokens: reasoning ? maxTokens + 1024 : maxTokens,
    ...(reasoning ? { reasoning_effort: 'low', include_reasoning: false } : {}),
    ...extra,
  };
}

// Groq Provider
class GroqProvider implements AIProviderInterface {
  constructor(private config: AIProviderConfig) {}

  async chat(messages: ChatMessage[]): Promise<AIResponse> {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        groqRequestBody(this.config.model || 'llama-3.1-8b-instant', messages, this.config.temperature || 0.7, this.config.maxTokens || 500),
      ),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Groq API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return {
      content: data.choices[0]?.message?.content || '',
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };
  }

  async chatJSON(messages: ChatMessage[]): Promise<any> {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        groqRequestBody(this.config.model || 'llama-3.1-8b-instant', messages, this.config.temperature || 0.3, this.config.maxTokens || 1000, {
          response_format: { type: 'json_object' },
        }),
      ),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Groq API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || '{}';
    return JSON.parse(content);
  }

  async analyzeImage(imageUrl: string, prompt: string): Promise<string> {
    throw new Error('Groq provider does not support vision yet');
  }
}

// Custom Provider (for custom API endpoints)
class CustomProvider implements AIProviderInterface {
  constructor(private config: AIProviderConfig) {}

  async chat(messages: ChatMessage[]): Promise<AIResponse> {
    if (!this.config.apiBaseUrl) {
      throw new Error('Custom provider requires apiBaseUrl');
    }

    const response = await fetch(this.config.apiBaseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: messages,
        temperature: this.config.temperature || 0.7,
        max_tokens: this.config.maxTokens || 500,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Custom API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    // Assume OpenAI-compatible response format
    return {
      content: data.choices?.[0]?.message?.content || data.content || '',
    };
  }

  async chatJSON(messages: ChatMessage[]): Promise<any> {
    const response = await this.chat(messages);
    try {
      return JSON.parse(response.content);
    } catch {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('Failed to parse JSON response');
    }
  }

  async analyzeImage(imageUrl: string, prompt: string): Promise<string> {
    // Assume custom provider might support OpenAI-compatible vision if it's based on it
    const response = await fetch(this.config.apiBaseUrl!, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl
                }
              }
            ]
          }
        ],
        max_tokens: this.config.maxTokens || 1000,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Custom Vision API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || data.content || '';
  }
}


export function getAIProviderFromConfig(config: AIProviderConfig): AIProviderInterface | null {
  switch (config.provider) {
    case 'openai':
      return new OpenAIProvider(config);
    case 'gemini':
      return new GeminiProvider(config);
    case 'groq':
      return new GroqProvider(config);
    case 'custom':
      return new CustomProvider(config);
    default:
      console.warn(`Unsupported AI provider: ${config.provider}`);
      return null;
  }
}

/** Tries each provider in turn; used for Khatario's own key (Groq first, Gemini as fallback). */
class FallbackProvider implements AIProviderInterface {
  constructor(private providers: AIProviderInterface[]) {}

  private async first<T>(run: (p: AIProviderInterface) => Promise<T>, ok: (v: T) => boolean): Promise<T> {
    let lastError: unknown = null;
    for (const p of this.providers) {
      try {
        const v = await run(p);
        if (ok(v)) return v;
      } catch (error) {
        lastError = error;
        console.warn('[AI Provider Factory] platform provider failed, trying next:', error instanceof Error ? error.message : error);
      }
    }
    if (lastError) throw lastError;
    throw new Error('All platform AI providers returned empty responses');
  }

  chat(messages: ChatMessage[]): Promise<AIResponse> {
    return this.first((p) => p.chat(messages), (r) => !!r?.content?.trim());
  }

  chatJSON(messages: ChatMessage[]): Promise<any> {
    return this.first((p) => p.chatJSON(messages), (r) => r != null);
  }

  analyzeImage(imageUrl: string, prompt: string): Promise<string> {
    return this.first((p) => p.analyzeImage(imageUrl, prompt), (r) => !!r?.trim());
  }
}

/** Khatario's model key (Khatario AI add-on / trial). Null when the server has no platform key. */
export function getPlatformAIProvider(opts: { temperature?: number; maxTokens?: number } = {}): AIProviderInterface | null {
  const providers: AIProviderInterface[] = [];
  const groq = process.env.GROQ_API_KEY?.trim();
  const gemini = process.env.GEMINI_API_KEY?.trim();
  if (groq) {
    providers.push(new GroqProvider({
      provider: 'groq',
      apiKey: groq,
      model: process.env.GROQ_AGENT_MODEL || process.env.GROQ_RAG_MODEL || 'llama-3.3-70b-versatile',
      temperature: opts.temperature ?? 0.5,
      maxTokens: opts.maxTokens ?? 600,
    }));
  }
  if (gemini) {
    providers.push(new GeminiProvider({
      provider: 'gemini',
      apiKey: gemini,
      model: process.env.ASSISTANT_GEMINI_MODEL || 'gemini-3.5-flash',
      temperature: opts.temperature ?? 0.5,
      maxTokens: opts.maxTokens ?? 600,
    }));
  }
  if (!providers.length) return null;
  return providers.length === 1 ? providers[0] : new FallbackProvider(providers);
}

interface ProviderConfigRow {
  provider: string;
  api_key: string | null;
  api_key_encrypted?: string | null;
  key_source?: 'own' | 'khatario' | null;
  api_base_url?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  chatbot_enabled?: boolean;
}

async function loadConfigRow(businessId: string): Promise<ProviderConfigRow | null> {
  try {
    return await queryOne<ProviderConfigRow>(
      `SELECT provider, api_key, api_key_encrypted, key_source, api_base_url, model, temperature, max_tokens, chatbot_enabled
         FROM ai_provider_config WHERE business_id = $1`,
      [businessId],
    );
  } catch {
    return queryOne<ProviderConfigRow>(
      `SELECT provider, api_key, api_base_url, model, temperature, max_tokens, chatbot_enabled
         FROM ai_provider_config WHERE business_id = $1`,
      [businessId],
    );
  }
}

function shopKey(row: ProviderConfigRow): string | null {
  if (row.api_key_encrypted) {
    try {
      return decryptSecret(row.api_key_encrypted);
    } catch (error) {
      console.error('[AI Provider Factory] could not decrypt shop key:', error instanceof Error ? error.message : error);
    }
  }
  return row.api_key?.trim() ? row.api_key : null;
}

/** Provider built from the shop's own saved key, ignoring the key source. */
export function shopProviderFromRow(row: ProviderConfigRow): AIProviderInterface | null {
  const apiKey = shopKey(row);
  if (!apiKey) return null;
  return getAIProviderFromConfig({
    provider: row.provider as AIProvider,
    apiKey,
    apiBaseUrl: row.api_base_url || undefined,
    model: row.model || undefined,
    temperature: row.temperature ? parseFloat(row.temperature.toString()) : undefined,
    maxTokens: row.max_tokens || undefined,
  });
}

/**
 * Business AI provider for lead analysis, payment OCR and similar helpers. Uses the shop's own
 * key, or Khatario's key when the shop runs on an active Khatario AI add-on.
 */
export async function getAIProvider(businessId: string): Promise<AIProviderInterface | null> {
  try {
    const config = await loadConfigRow(businessId);
    if (!config) return null;
    // chatbot_enabled defaults to true, so only block if explicitly false
    if (config.chatbot_enabled === false) return null;

    if (config.key_source === 'khatario') {
      const { hasKhatarioAiAddon } = await import('@/lib/ai-agent/billing');
      return (await hasKhatarioAiAddon(businessId)) ? getPlatformAIProvider() : null;
    }
    return shopProviderFromRow(config);
  } catch (error) {
    console.error('Error getting AI provider:', error);
    return null;
  }
}

export type AgentProviderResult =
  | { provider: AIProviderInterface; via: 'own' | 'khatario_addon' | 'khatario_trial' }
  | { provider: null; reason: 'not_configured' | 'disabled' | 'no_key' | 'quota_exhausted' | 'trial_exhausted' | 'live_needs_addon' };

/**
 * Provider for the shop's WhatsApp AI agent. `live` is true for real customers in Live mode
 * (the Khatario AI trial only covers Test mode and the test chat). `ignoreDisabled` lets the
 * editor's test chat run while the agent is switched off.
 */
export async function resolveAgentProvider(
  businessId: string,
  opts: { live: boolean; ignoreDisabled?: boolean },
): Promise<AgentProviderResult> {
  const config = await loadConfigRow(businessId).catch(() => null);
  if (!config) {
    if (!opts.ignoreDisabled) return { provider: null, reason: 'not_configured' };
  } else if (config.chatbot_enabled === false && !opts.ignoreDisabled) {
    return { provider: null, reason: 'disabled' };
  }

  const keySource = config?.key_source === 'khatario' || (!config && opts.ignoreDisabled) ? 'khatario' : 'own';
  if (keySource === 'own' && config) {
    const provider = shopProviderFromRow(config);
    return provider ? { provider, via: 'own' } : { provider: null, reason: 'no_key' };
  }

  const { khatarioAccess } = await import('@/lib/ai-agent/billing');
  const access = await khatarioAccess(businessId, { live: opts.live });
  if (!access.ok) return { provider: null, reason: access.reason };
  const provider = getPlatformAIProvider({
    temperature: config?.temperature ? parseFloat(config.temperature.toString()) : undefined,
  });
  if (!provider) return { provider: null, reason: 'not_configured' };
  return { provider, via: access.via === 'addon' ? 'khatario_addon' : 'khatario_trial' };
}

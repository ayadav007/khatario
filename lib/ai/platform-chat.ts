/**
 * Khatario-hosted chat (same Groq/Gemini keys as HSN lookup / invoice extract).
 * Loads .env on the request so local Next picks up keys even if they were added after boot.
 * If those keys are missing, uses the business AI config already stored for WhatsApp/HSN.
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import { config as loadEnv } from 'dotenv';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

function loadPlatformAiEnv(): void {
  const files = ['.env.local', '.env', '.env.production'];
  for (const file of files) {
    const path = resolve(process.cwd(), file);
    if (existsSync(path)) loadEnv({ path, override: false });
  }
}

function groqKey(): string {
  loadPlatformAiEnv();
  return (process.env.GROQ_API_KEY || '').trim();
}

function geminiKey(): string {
  loadPlatformAiEnv();
  return (process.env.GEMINI_API_KEY || '').trim();
}

async function groqChat(prompt: string, system: string): Promise<string | null> {
  const apiKey = groqKey();
  if (!apiKey) return null;
  const model = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_tokens: 220,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq ${response.status}: ${err.slice(0, 200)}`);
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  return typeof content === 'string' && content.trim() ? content : null;
}

async function geminiChat(prompt: string, system: string): Promise<string | null> {
  const apiKey = geminiKey();
  if (!apiKey) return null;
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 220 },
      }),
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini ${response.status}: ${err.slice(0, 200)}`);
  }
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof content === 'string' && content.trim() ? content : null;
}

export function platformAiConfigured(): boolean {
  return Boolean(groqKey() || geminiKey());
}

export async function platformChat(
  system: string,
  prompt: string,
  businessId?: string,
): Promise<string> {
  const groq = groqKey();
  const gemini = geminiKey();
  if (groq) {
    try {
      const text = await groqChat(prompt, system);
      if (text) return text;
    } catch (error) {
      console.warn('[platform-chat] Groq failed:', error instanceof Error ? error.message : error);
    }
  }
  if (gemini) {
    try {
      const text = await geminiChat(prompt, system);
      if (text) return text;
    } catch (error) {
      console.warn('[platform-chat] Gemini failed:', error instanceof Error ? error.message : error);
    }
  }
  if (businessId) {
    const { getAIProvider } = await import('@/lib/services/ai-provider-factory');
    const provider = await getAIProvider(businessId);
    if (provider) {
      const result = await provider.chat([
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ]);
      if (result.content?.trim()) return result.content;
    }
  }
  if (!groq && !gemini) {
    throw new Error('KHATARIO_AI_UNAVAILABLE');
  }
  throw new Error('KHATARIO_AI_FAILED');
}

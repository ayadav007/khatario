'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type AssistantMode = 'public' | 'app';
export type AssistantChannel = 'web' | 'signup' | 'trial_app' | 'in_app';

export type AssistantAction =
  | { type: 'book_demo' }
  | { type: 'start_trial'; url: string }
  | { type: 'recommend_plan' }
  | { type: 'talk_to_human' }
  | { type: 'upgrade'; url: string };

export interface InsightCardData {
  title: string;
  subtitle?: string;
  rows: Array<{ label: string; value: string; hint?: string }>;
  empty?: string;
  link?: { label: string; url: string };
}

export interface AssistantCitation {
  title: string;
  url: string | null;
  headingPath: string;
}

export interface ChatMessage {
  key: string;
  role: 'user' | 'assistant';
  content: string;
  messageId?: string;
  citations?: AssistantCitation[];
  action?: AssistantAction | null;
  /** Business figures for the owner; shown instead of the plain-text version in `content`. */
  insight?: InsightCardData[];
  quickReplies?: string[];
  answered?: boolean;
  streaming?: boolean;
  error?: boolean;
  feedback?: 1 | -1;
}

export function assistantApiBase(mode: AssistantMode): string {
  return mode === 'app' ? '/api/assistant' : '/api/public/assistant';
}

const storageKey = (channel: AssistantChannel) => `kh_assistant_conversation_${channel}`;
let keySeq = 0;
const nextKey = () => `m${Date.now().toString(36)}${(keySeq++).toString(36)}`;

const ACTION_TYPES = new Set(['book_demo', 'start_trial', 'recommend_plan', 'talk_to_human', 'upgrade']);

export function useAssistantChat(mode: AssistantMode, channel: AssistantChannel) {
  const base = assistantApiBase(mode);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const restore = useCallback(async () => {
    if (restored) return;
    setRestored(true);
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey(channel)) : null;
    if (!saved) return;
    try {
      const res = await fetch(`${base}/conversation/${encodeURIComponent(saved)}?channel=${channel}`, { credentials: 'include' });
      if (!res.ok) {
        window.localStorage.removeItem(storageKey(channel));
        return;
      }
      const data = (await res.json()) as {
        conversationId: string;
        messages: Array<{
          id: string;
          role: 'user' | 'assistant';
          content: string;
          action: { type?: string; cards?: InsightCardData[] } | null;
        }>;
      };
      setConversationId(data.conversationId);
      setMessages(
        data.messages.map((m) => ({
          key: m.id,
          role: m.role,
          content: m.content,
          messageId: m.role === 'assistant' ? m.id : undefined,
          action: m.action?.type && ACTION_TYPES.has(m.action.type) ? (m.action as AssistantAction) : null,
          insight: m.action?.type === 'insight' && Array.isArray(m.action.cards) ? m.action.cards : undefined,
        })),
      );
    } catch {
      // Starting fresh is fine.
    }
  }, [base, channel, restored]);

  const patchLast = (fn: (m: ChatMessage) => ChatMessage) =>
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === 'assistant') {
          next[i] = fn(next[i]);
          break;
        }
      }
      return next;
    });

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setBusy(true);
      setMessages((prev) => [
        ...prev.map((m) => (m.quickReplies ? { ...m, quickReplies: undefined } : m)),
        { key: nextKey(), role: 'user', content: message },
        { key: nextKey(), role: 'assistant', content: '', streaming: true },
      ]);

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(`${base}/chat?channel=${channel}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            conversationId,
            pagePath: typeof window !== 'undefined' ? window.location.pathname : null,
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as { error?: string }).error || 'The assistant is unavailable right now.');
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const raw = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const dataLine = raw.split('\n').find((l) => l.startsWith('data:'));
            if (!dataLine) continue;
            let ev: { type: string; [k: string]: unknown };
            try {
              ev = JSON.parse(dataLine.slice(5).trim());
            } catch {
              continue;
            }
            switch (ev.type) {
              case 'meta':
                setConversationId(ev.conversationId as string);
                window.localStorage.setItem(storageKey(channel), ev.conversationId as string);
                break;
              case 'delta':
                patchLast((m) => ({ ...m, content: m.content + (ev.text as string) }));
                break;
              case 'action':
                patchLast((m) => ({ ...m, action: ev.action as AssistantAction }));
                break;
              case 'insight':
                patchLast((m) => ({ ...m, insight: ev.cards as InsightCardData[] }));
                break;
              case 'citations':
                patchLast((m) => ({ ...m, citations: ev.citations as AssistantCitation[] }));
                break;
              case 'quick_replies':
                patchLast((m) => ({ ...m, quickReplies: ev.replies as string[] }));
                break;
              case 'done':
                patchLast((m) => ({ ...m, streaming: false, messageId: ev.messageId as string, answered: ev.answered as boolean }));
                break;
              case 'error':
                patchLast((m) => ({ ...m, streaming: false, error: true, content: (ev.message as string) || 'Something went wrong.' }));
                break;
            }
          }
        }
        patchLast((m) => ({ ...m, streaming: false }));
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          patchLast((m) => ({ ...m, streaming: false }));
        } else {
          patchLast((m) => ({
            ...m,
            streaming: false,
            error: true,
            content: err instanceof Error ? err.message : 'Something went wrong.',
          }));
        }
      } finally {
        abortRef.current = null;
        setBusy(false);
      }
    },
    [base, busy, channel, conversationId],
  );

  const addAssistantNote = useCallback((content: string) => {
    setMessages((prev) => [...prev, { key: nextKey(), role: 'assistant', content }]);
  }, []);

  const clearAction = useCallback((key: string) => {
    setMessages((prev) => prev.map((m) => (m.key === key ? { ...m, action: null } : m)));
  }, []);

  const sendFeedback = useCallback(
    async (key: string, messageId: string, rating: 1 | -1) => {
      setMessages((prev) => prev.map((m) => (m.key === key ? { ...m, feedback: rating } : m)));
      await fetch(`${base}/feedback?channel=${channel}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, rating }),
      }).catch(() => undefined);
    },
    [base, channel],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    window.localStorage.removeItem(storageKey(channel));
    setConversationId(null);
    setMessages([]);
  }, [channel]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { messages, conversationId, busy, send, restore, addAssistantNote, clearAction, sendFeedback, reset };
}

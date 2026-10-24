'use client';

import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronRight, Hand, Loader2, RotateCcw, Send, ShoppingCart, Sparkles, UserCheck, Wallet, Clock, AlertCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { MessageContent } from '@/components/assistant/MessageContent';
import type { AgentSettings } from '@/lib/ai-agent/types';
import { AgentApiError, agentFetch, agentJson } from './api';

type Chip = { kind: string; label: string };

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  chips?: Chip[];
  sources?: string[];
  quickReplies?: string[];
  error?: boolean;
}

const SAMPLE_QUESTIONS = [
  'What are your timings?',
  'Do you deliver to my area?',
  'What is the price of your best seller?',
  'I want to order 2 items',
  'Can I talk to someone?',
];

const CHIP_ICON: Record<string, typeof ShoppingCart> = {
  order: ShoppingCart,
  payment: Wallet,
  handoff: Hand,
  lead: UserCheck,
  greeting: Sparkles,
  after_hours: Clock,
  fallback: AlertCircle,
};

export function TestChatPanel({
  businessId,
  draftSettings,
  agentName,
  onHide,
  onUsageChanged,
  className,
}: {
  businessId: string;
  draftSettings: AgentSettings;
  agentName: string;
  onHide?: () => void;
  onUsageChanged?: () => void;
  className?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || sending) return;
    const history = messages.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: 'user', content: message }]);
    setInput('');
    setSending(true);
    try {
      const res = await agentFetch<{ reply: string; chips: Chip[]; sources: string[]; quickReplies?: string[] }>(
        businessId,
        '/api/ai-agent/test',
        { method: 'POST', body: agentJson({ message, history, draftSettings }) },
      );
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: res.reply, chips: res.chips, sources: res.sources, quickReplies: res.quickReplies },
      ]);
      onUsageChanged?.();
    } catch (e) {
      const msg = e instanceof AgentApiError || e instanceof Error ? e.message : 'Test failed';
      setMessages((m) => [...m, { role: 'assistant', content: msg, error: true }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={clsx('flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface', className)}>
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-[#075e54] px-3 py-2.5 text-white">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">Test your agent</p>
          <p className="truncate text-[11px] text-white/80">{agentName || 'AI Agent'} · uses unsaved changes</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMessages([])}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-white/10"
            title="Reset chat"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
          {onHide && (
            <button type="button" onClick={onHide} className="inline-flex items-center gap-0.5 rounded px-2 py-1 text-xs hover:bg-white/10">
              Hide <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#efeae2] p-3 dark:bg-slate-900">
        {messages.length === 0 && (
          <div className="space-y-3 pt-2">
            <p className="rounded-lg bg-white/80 px-3 py-2 text-center text-xs text-gray-600 dark:bg-slate-800 dark:text-slate-300">
              Chat like a customer. Nothing is sent on WhatsApp.
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {SAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => send(q)}
                  className="rounded-full border border-[#25d366]/40 bg-white px-3 py-1 text-xs text-gray-800 hover:bg-green-50 dark:bg-slate-800 dark:text-slate-100"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={clsx('flex flex-col', m.role === 'user' ? 'items-end' : 'items-start')}>
            <div
              className={clsx(
                'max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm',
                m.role === 'user'
                  ? 'rounded-tr-none bg-[#d9fdd3] text-gray-900'
                  : m.error
                    ? 'rounded-tl-none border border-red-200 bg-red-50 text-red-800'
                    : 'rounded-tl-none bg-white text-gray-900 dark:bg-slate-800 dark:text-slate-100',
              )}
            >
              {m.role === 'assistant' && !m.error ? <MessageContent text={m.content} /> : <span className="whitespace-pre-wrap">{m.content}</span>}
            </div>
            {m.quickReplies && m.quickReplies.length > 0 && (
              <div className="mt-1 flex max-w-[85%] flex-wrap gap-1">
                {m.quickReplies.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => send(q)}
                    className="rounded-lg border border-border bg-white px-2.5 py-1 text-xs font-medium text-[#008069] hover:bg-gray-50 dark:bg-slate-800"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
            {m.chips && m.chips.length > 0 && (
              <div className="mt-1 flex max-w-[85%] flex-wrap gap-1">
                {m.chips.map((c, j) => {
                  const Icon = CHIP_ICON[c.kind] ?? Sparkles;
                  return (
                    <span key={j} className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-900">
                      <Icon className="h-3 w-3" /> {c.label}
                    </span>
                  );
                })}
              </div>
            )}
            {m.sources && m.sources.length > 0 && (
              <div className="mt-1 flex max-w-[85%] flex-wrap gap-1">
                {m.sources.slice(0, 4).map((s) => (
                  <span key={s} className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-slate-800 dark:text-slate-300">
                    <BookOpen className="h-3 w-3" /> {s}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> typing…
          </div>
        )}
      </div>

      <form
        className="flex shrink-0 items-center gap-2 border-t border-border bg-surface p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          className="input flex-1"
          value={input}
          maxLength={1000}
          placeholder="Type a message"
          onChange={(e) => setInput(e.target.value)}
          aria-label="Test message"
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white disabled:opacity-50"
          aria-label="Send"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

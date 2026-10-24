'use client';

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import Link from 'next/link';
import { Loader2, MessageCircle, RotateCcw, Send, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { ActionCard } from './ActionCards';
import { ASSISTANT_ASK_EVENT } from './events';
import { InsightCards } from './InsightCards';
import { MessageContent } from './MessageContent';
import {
  assistantApiBase,
  useAssistantChat,
  type AssistantAction,
  type AssistantChannel,
  type AssistantMode,
  type ChatMessage,
} from './useAssistantChat';

interface Props {
  mode?: AssistantMode;
  channel?: AssistantChannel;
  /** Open automatically once (e.g. on /book-demo) — remembered per session. */
  autoOpenDelayMs?: number;
  /** Extra bottom offset (px) for the launcher and desktop panel. */
  bottomOffset?: number;
  /** Extra launcher offset below the `sm` breakpoint, to clear mobile bottom bars. */
  mobileBottomOffset?: number;
}

const APP_STARTERS = ['How do I create an invoice?', 'How do I connect WhatsApp?', 'How do I prepare GSTR-1?', 'How do I add staff users?'];
const OWNER_STARTERS = ['How was sales today?', 'Who owes me the most?', 'Top products this month', 'How do I create an invoice?'];

const STARTERS: Record<AssistantChannel, string[]> = {
  web: ['How much does Khatario cost?', 'Can I file GSTR-1 from it?', 'Does it work offline?', 'Kitne ka hai?'],
  signup: ['Is there a free trial?', 'Do I need a credit card?', 'What happens after the trial?'],
  trial_app: APP_STARTERS,
  in_app: APP_STARTERS,
};

const APP_TITLE = { title: 'Khatario help', subtitle: 'How-to answers from our guides' };
const TITLES: Record<AssistantChannel, { title: string; subtitle: string }> = {
  web: { title: 'Khatario assistant', subtitle: 'Ask in English or Hinglish' },
  signup: { title: 'Questions before you start?', subtitle: 'Ask in English or Hinglish' },
  trial_app: APP_TITLE,
  in_app: APP_TITLE,
};

export function AssistantWidget({
  mode = 'public',
  channel = 'web',
  autoOpenDelayMs,
  bottomOffset = 0,
  mobileBottomOffset = 0,
}: Props) {
  const [enabled, setEnabled] = useState(false);
  const [owner, setOwner] = useState(false);
  // In the app the server picks the channel from the subscription (trial_app or in_app).
  const [activeChannel, setActiveChannel] = useState<AssistantChannel>(channel);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const chat = useAssistantChat(mode, activeChannel);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const base = assistantApiBase(mode);

  useEffect(() => {
    let cancelled = false;
    fetch(`${base}/chat?channel=${channel}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d: { enabled?: boolean; channel?: AssistantChannel; owner?: boolean }) => {
        if (cancelled) return;
        if (mode === 'app' && (d.channel === 'trial_app' || d.channel === 'in_app')) setActiveChannel(d.channel);
        setOwner(mode === 'app' && d.owner === true);
        setEnabled(Boolean(d.enabled));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [base, channel, mode]);

  useEffect(() => {
    if (!enabled || !autoOpenDelayMs) return;
    const key = `kh_assistant_autoopen_${channel}`;
    if (window.sessionStorage.getItem(key)) return;
    const id = window.setTimeout(() => {
      window.sessionStorage.setItem(key, '1');
      setOpen(true);
    }, autoOpenDelayMs);
    return () => window.clearTimeout(id);
  }, [enabled, autoOpenDelayMs, channel]);

  useEffect(() => {
    if (open) {
      void chat.restore();
      window.setTimeout(() => inputRef.current?.focus(), 80);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [chat.messages]);

  const chatRef = useRef(chat);
  chatRef.current = chat;
  useEffect(() => {
    if (!enabled) return;
    const onAsk = (e: Event) => {
      const question = (e as CustomEvent<{ question?: string }>).detail?.question?.trim();
      if (!question) return;
      void (async () => {
        await chatRef.current.restore();
        setOpen(true);
        void chatRef.current.send(question);
      })();
    };
    window.addEventListener(ASSISTANT_ASK_EVENT, onAsk);
    return () => window.removeEventListener(ASSISTANT_ASK_EVENT, onAsk);
  }, [enabled]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!enabled) return null;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    void chat.send(text);
  };

  const showAction = (m: ChatMessage, action: AssistantAction) => (
    <ActionCard
      action={action}
      base={base}
      channel={activeChannel}
      conversationId={chat.conversationId}
      onDone={(note) => {
        chat.clearAction(m.key);
        chat.addAssistantNote(note);
      }}
      onAction={(next) => {
        chat.clearAction(m.key);
        if (next.type === 'book_demo') void chat.send('I want to book a demo');
      }}
    />
  );

  const { title, subtitle } = owner
    ? { title: 'Khatario assistant', subtitle: 'Your business figures and how-to help' }
    : TITLES[activeChannel];
  const starters = owner ? OWNER_STARTERS : STARTERS[activeChannel];
  const bottom = 20 + bottomOffset;

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={
            {
              '--kh-launcher-bottom': `${bottom}px`,
              '--kh-launcher-bottom-mobile': `${bottom + mobileBottomOffset}px`,
            } as CSSProperties
          }
          className="fixed bottom-[var(--kh-launcher-bottom-mobile)] right-5 z-[60] flex sm:bottom-[var(--kh-launcher-bottom)] items-center gap-2 rounded-full bg-primary-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-primary-600/30 transition hover:bg-primary-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary-500/40"
          aria-label="Open Khatario assistant"
          data-testid="assistant-launcher"
        >
          <MessageCircle className="h-5 w-5" />
          <span className="hidden sm:inline">{mode === 'app' ? 'Help' : 'Ask Khatario'}</span>
        </button>
      ) : null}

      {open ? (
        <section
          role="dialog"
          aria-label={title}
          style={{ '--kh-assistant-bottom': `${bottom}px` } as CSSProperties}
          className="fixed inset-x-0 bottom-0 z-[60] flex sm:bottom-[var(--kh-assistant-bottom)] h-[100dvh] flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-900 sm:inset-x-auto sm:right-5 sm:h-[min(640px,calc(100dvh-40px))] sm:w-[400px] sm:rounded-2xl sm:border sm:border-slate-200 dark:sm:border-slate-700"
          data-testid="assistant-panel"
        >
          <header className="flex items-center justify-between gap-2 bg-primary-600 px-4 py-3 text-white">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">{title}</h2>
              <p className="truncate text-xs text-white/80">{subtitle}</p>
            </div>
            <div className="flex items-center gap-1">
              {chat.messages.length ? (
                <button type="button" onClick={chat.reset} className="rounded-md p-1.5 hover:bg-white/15" aria-label="Start a new conversation" title="New conversation">
                  <RotateCcw className="h-4 w-4" />
                </button>
              ) : null}
              <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1.5 hover:bg-white/15" aria-label="Close assistant">
                <X className="h-5 w-5" />
              </button>
            </div>
          </header>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
            {chat.messages.length === 0 ? (
              <div className="space-y-3">
                <div className="rounded-2xl rounded-tl-sm bg-slate-100 px-3 py-2 text-sm text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                  {owner
                    ? 'Hi! Ask me how your business is doing — sales, money received, who owes you, stock — or how to do anything in Khatario.'
                    : mode === 'app'
                      ? 'Hi! Ask me how to do anything in Khatario — invoices, stock, GST returns, WhatsApp and more.'
                      : 'Namaste! I can answer questions about Khatario — GST billing, stock, WhatsApp reminders, pricing and the free trial. Hinglish chalega!'}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {starters.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void chat.send(s)}
                      className="rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700 transition hover:bg-primary-100 dark:border-primary-800 dark:bg-primary-950/40 dark:text-primary-200"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {chat.messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.key} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-primary-600 px-3 py-2 text-sm text-white">{m.content}</div>
                </div>
              ) : (
                <div key={m.key} className={m.insight?.length ? 'w-full' : 'max-w-[92%]'}>
                  {m.insight?.length ? (
                    <InsightCards cards={m.insight} />
                  ) : (
                  <div
                    className={`rounded-2xl rounded-tl-sm px-3 py-2 ${
                      m.error ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
                    }`}
                  >
                    {m.content ? (
                      <MessageContent text={m.content} />
                    ) : (
                      <span className="flex items-center gap-2 text-sm text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
                      </span>
                    )}
                  </div>
                  )}
                  {m.citations?.length ? (
                    <div className="mt-1 flex flex-wrap gap-1 pl-1">
                      {m.citations.map((c, i) =>
                        c.url ? (
                          <Link key={i} href={c.url} className="text-[11px] text-slate-500 underline-offset-2 hover:text-primary-600 hover:underline">
                            [{i + 1}] {c.title}
                          </Link>
                        ) : (
                          <span key={i} className="text-[11px] text-slate-500">
                            [{i + 1}] {c.title}
                          </span>
                        ),
                      )}
                    </div>
                  ) : null}
                  {m.action ? showAction(m, m.action) : null}
                  {m.quickReplies?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.quickReplies.map((q) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => void chat.send(q)}
                          className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:border-primary-300 hover:text-primary-700 dark:border-slate-600 dark:text-slate-200"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {m.messageId && !m.streaming && !m.error ? (
                    <div className="mt-1 flex items-center gap-1 pl-1 text-slate-400">
                      <button
                        type="button"
                        aria-label="Helpful"
                        onClick={() => void chat.sendFeedback(m.key, m.messageId!, 1)}
                        className={`rounded p-1 hover:text-emerald-600 ${m.feedback === 1 ? 'text-emerald-600' : ''}`}
                      >
                        <ThumbsUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Not helpful"
                        onClick={() => void chat.sendFeedback(m.key, m.messageId!, -1)}
                        className={`rounded p-1 hover:text-red-600 ${m.feedback === -1 ? 'text-red-600' : ''}`}
                      >
                        <ThumbsDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : null}
                </div>
              ),
            )}
          </div>

          <form onSubmit={submit} className="border-t border-slate-200 p-3 dark:border-slate-700">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                maxLength={1000}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder="Type your question…"
                aria-label="Your question"
                className="max-h-28 min-h-[40px] flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                data-testid="assistant-input"
              />
              <button
                type="submit"
                disabled={chat.busy || !input.trim()}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-600 text-white transition hover:bg-primary-700 disabled:opacity-40"
                aria-label="Send"
              >
                {chat.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-1.5 text-center text-[10px] text-slate-400">
              {owner
                ? 'Figures come straight from your books. Please don\u2019t share passwords or OTPs here.'
                : <>AI answers from Khatario&apos;s guides. Please don&apos;t share passwords or OTPs here.</>}
            </p>
          </form>
        </section>
      ) : null}
    </>
  );
}

export default AssistantWidget;

'use client';

import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { clsx } from 'clsx';

export interface QuickReply {
  id: string;
  title: string;
  shortcut: string | null;
  message: string;
}

export interface QuickReplyPickerHandle {
  /** Returns true when the key was used by the picker. */
  handleKey: (e: React.KeyboardEvent) => boolean;
}

interface QuickReplyPickerProps {
  businessId: string;
  /** Text typed after "/". */
  query: string;
  onPick: (reply: QuickReply) => void;
  onManage: () => void;
  onClose: () => void;
}

const cache = new Map<string, { at: number; replies: QuickReply[] }>();
const CACHE_MS = 60_000;

/** Fills {{name}}, {{first_name}}, {{phone}} and {{agent}} in a saved reply. */
export function fillQuickReply(
  message: string,
  vars: { name?: string | null; phone?: string | null; agent?: string | null },
): string {
  const name = vars.name?.trim() || '';
  const map: Record<string, string> = {
    name,
    first_name: name.split(/\s+/)[0] || '',
    phone: vars.phone?.trim() || '',
    agent: vars.agent?.trim() || '',
  };
  return message.replace(/\{\{\s*(name|first_name|phone|agent)\s*\}\}/gi, (_, k: string) => map[k.toLowerCase()] ?? '');
}

export const QuickReplyPicker = forwardRef<QuickReplyPickerHandle, QuickReplyPickerProps>(function QuickReplyPicker(
  { businessId, query, onPick, onManage, onClose },
  ref,
) {
  const [replies, setReplies] = useState<QuickReply[] | null>(() => cache.get(businessId)?.replies ?? null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const hit = cache.get(businessId);
    if (hit && Date.now() - hit.at < CACHE_MS) return;
    let cancelled = false;
    fetch(`/api/whatsapp/saved-replies?business_id=${encodeURIComponent(businessId)}`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : { replies: [] }))
      .then((data) => {
        const list = (data.replies || []) as QuickReply[];
        cache.set(businessId, { at: Date.now(), replies: list });
        if (!cancelled) setReplies(list);
      })
      .catch(() => {
        if (!cancelled) setReplies([]);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = replies ?? [];
    if (!q) return list.slice(0, 8);
    const scored = list
      .map((r) => {
        const shortcut = (r.shortcut || '').toLowerCase();
        const title = r.title.toLowerCase();
        const score = shortcut.startsWith(q) ? 0 : title.startsWith(q) ? 1 : shortcut.includes(q) || title.includes(q) ? 2 : r.message.toLowerCase().includes(q) ? 3 : 9;
        return { r, score };
      })
      .filter((x) => x.score < 9)
      .sort((a, b) => a.score - b.score);
    return scored.slice(0, 8).map((x) => x.r);
  }, [replies, query]);

  useEffect(() => setActive(0), [query]);

  useImperativeHandle(
    ref,
    () => ({
      handleKey: (e) => {
        if (e.key === 'Escape') {
          onClose();
          return true;
        }
        if (!matches.length) return false;
        if (e.key === 'ArrowDown') {
          setActive((i) => (i + 1) % matches.length);
          return true;
        }
        if (e.key === 'ArrowUp') {
          setActive((i) => (i - 1 + matches.length) % matches.length);
          return true;
        }
        if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
          onPick(matches[Math.min(active, matches.length - 1)]);
          return true;
        }
        return false;
      },
    }),
    [matches, active, onPick, onClose],
  );

  return (
    <div className="absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-1.5 text-xs text-gray-500">
        <span>Quick replies {query ? `matching “${query}”` : ''} · ↑↓ to choose, Enter to insert</span>
        <button type="button" onClick={onManage} className="inline-flex items-center gap-1 font-medium text-[#008069] hover:underline">
          <BookOpen className="h-3.5 w-3.5" /> Manage
        </button>
      </div>
      {replies === null ? (
        <p className="px-3 py-3 text-sm text-gray-500">Loading…</p>
      ) : matches.length === 0 ? (
        <p className="px-3 py-3 text-sm text-gray-500">
          {replies.length === 0 ? 'No saved replies yet. Use Manage to add one.' : 'No saved reply matches.'}
        </p>
      ) : (
        <ul className="max-h-64 overflow-y-auto py-1" role="listbox">
          {matches.map((r, i) => (
            <li key={r.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(r);
                }}
                onMouseEnter={() => setActive(i)}
                className={clsx('w-full px-3 py-2 text-left', i === active ? 'bg-[#f0f2f5]' : 'hover:bg-gray-50')}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-gray-900">{r.title}</span>
                  {r.shortcut && <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-500">/{r.shortcut}</span>}
                </div>
                <p className="line-clamp-1 text-xs text-gray-500">{r.message}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

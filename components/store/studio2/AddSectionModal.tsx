'use client';

import { useEffect, useMemo, useRef } from 'react';
import { X } from 'lucide-react';
import { clsx } from 'clsx';
import { useToastContext } from '@/contexts/ToastContext';
import { OP_ERROR_TEXT, addSection } from '@/lib/store/engine/editor/ops';
import { TREE_GROUPS, addSectionCards, type AddSectionCard } from '@/lib/store/engine/editor/tree';
import { useStudio2 } from './Studio2Editor';

export function AddSectionModal() {
  const { theme, templateKey, addSectionTarget, closeAddSection, apply, select, readOnly } = useStudio2();
  const toast = useToastContext();
  const dialogRef = useRef<HTMLDivElement>(null);
  const target = addSectionTarget;

  const categories = useMemo(
    () => (target ? addSectionCards(theme, templateKey, target.group) : []),
    [theme, templateKey, target],
  );

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAddSection();
    };
    document.addEventListener('keydown', onKey);
    dialogRef.current?.querySelector<HTMLButtonElement>('button[data-card]:not([aria-disabled])')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [target, closeAddSection]);

  if (!target) return null;
  const groupTitle = TREE_GROUPS.find((g) => g.group === target.group)?.title ?? '';

  const add = (card: AddSectionCard) => {
    if (card.reason || readOnly) return;
    let id: string | null = null;
    const err = apply(
      (t) => {
        const r = addSection(t, templateKey, target.group, card.type, target.index, card.presetIndex);
        if (r.ok && r.id) id = r.id;
        return r;
      },
      { mergeKey: null, immediate: true },
    );
    if (err) {
      toast.error(OP_ERROR_TEXT[err]);
      return;
    }
    if (id) select({ kind: 'section', ref: { group: target.group, id } }, { scroll: true });
    closeAddSection();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeAddSection();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio2-add-section-title"
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <div>
            <h2 id="studio2-add-section-title" className="text-base font-semibold text-gray-900">
              Add section
            </h2>
            <p className="text-xs text-gray-500">{groupTitle}</p>
          </div>
          <button
            type="button"
            onClick={closeAddSection}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          {categories.length === 0 && <p className="text-sm text-gray-500">No sections can be added here.</p>}
          {categories.map((cat) => (
            <section key={cat.category} className="mb-5 last:mb-0">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{cat.category}</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {cat.cards.map((card) => {
                  const off = !!card.reason || readOnly;
                  return (
                    <button
                      key={card.key}
                      type="button"
                      data-card
                      aria-disabled={off || undefined}
                      title={card.reasonText ?? undefined}
                      onClick={() => add(card)}
                      className={clsx(
                        'rounded-lg border px-3 py-2.5 text-left',
                        off
                          ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400'
                          : 'border-gray-200 text-gray-800 hover:border-blue-400 hover:bg-blue-50',
                      )}
                    >
                      <span className="block text-sm font-medium">{card.title}</span>
                      {card.reasonText && <span className="mt-0.5 block text-[11px] leading-snug">{card.reasonText}</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

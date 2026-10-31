'use client';

import { Trash2 } from 'lucide-react';
import { useToastContext } from '@/contexts/ToastContext';
import { OP_ERROR_TEXT, removePage, setPageMeta } from '@/lib/store/engine/editor/ops';
import { lengthCounter } from '@/lib/store/engine/editor/fields';
import { templateTitle } from '@/lib/store/engine/editor/tree';
import { PAGE_META_CAPS, pageHandle } from '@/lib/store/engine/shared';
import { useStudio2 } from './Studio2Editor';
import { FieldShell } from './fields/SettingField';
import { inputCls } from './fields/pickers';

const dangerBtn =
  'inline-flex items-center gap-1.5 rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40';

type MetaField = 'title' | 'seo_title' | 'seo_description';

/**
 * D22: the open custom page's title, SEO title and SEO description, and "Delete page". The handle is fixed.
 * Read-only (publishing or leaving, D50) disables every input and "Delete page" (M3 Minor 5).
 */
export function PageSettings({ pageKey }: { pageKey: string }) {
  const { theme, apply, switchTemplate, readOnly } = useStudio2();
  const toast = useToastContext();
  const page = theme.templates[pageKey];
  const handle = pageHandle(pageKey);
  if (!page || !handle) return null;
  const base = `s2-page-${handle}`;

  const set = (field: MetaField, value: string) => {
    if (readOnly) return;
    const err = apply((t) => setPageMeta(t, pageKey, { [field]: value }), { mergeKey: `page:${pageKey}:${field}`, immediate: false });
    if (err) toast.error(OP_ERROR_TEXT[err]);
  };

  const remove = () => {
    if (readOnly) return;
    if (!window.confirm(`Delete the page "${templateTitle(theme, pageKey)}"? You can undo this.`)) return;
    let removed = false;
    const err = apply(
      (t) => {
        const r = removePage(t, pageKey);
        removed = r.ok;
        return r;
      },
      { mergeKey: null, immediate: true },
    );
    if (err) {
      toast.error(OP_ERROR_TEXT[err]);
      return;
    }
    // apply also answers null when it refused the edit (the editor turned read-only during the confirm).
    if (!removed) return;
    switchTemplate('home');
  };

  return (
    <div>
      <div className="border-b border-gray-200 px-4 py-3">
        <h2 className="truncate text-sm font-semibold text-gray-900">Page settings</h2>
        <p className="truncate font-mono text-xs text-gray-500">/pages/{handle}</p>
      </div>
      <div className="space-y-4 p-4">
        <FieldShell label="Title" htmlFor={`${base}-title`} counter={lengthCounter(page.title ?? '', PAGE_META_CAPS.title)}>
          <input
            id={`${base}-title`}
            className={inputCls}
            value={page.title ?? ''}
            maxLength={PAGE_META_CAPS.title}
            placeholder={handle}
            disabled={readOnly}
            onChange={(e) => set('title', e.target.value)}
          />
        </FieldShell>
        <FieldShell
          label="SEO title"
          htmlFor={`${base}-seo-title`}
          info="Shown in search results and the browser tab"
          counter={lengthCounter(page.seo_title ?? '', PAGE_META_CAPS.seo_title)}
        >
          <input
            id={`${base}-seo-title`}
            className={inputCls}
            value={page.seo_title ?? ''}
            maxLength={PAGE_META_CAPS.seo_title}
            placeholder={page.title ?? handle}
            disabled={readOnly}
            onChange={(e) => set('seo_title', e.target.value)}
          />
        </FieldShell>
        <FieldShell
          label="SEO description"
          htmlFor={`${base}-seo-description`}
          counter={lengthCounter(page.seo_description ?? '', PAGE_META_CAPS.seo_description)}
        >
          <textarea
            id={`${base}-seo-description`}
            rows={4}
            className={inputCls}
            value={page.seo_description ?? ''}
            maxLength={PAGE_META_CAPS.seo_description}
            disabled={readOnly}
            onChange={(e) => set('seo_description', e.target.value)}
          />
        </FieldShell>
        <div className="border-t border-gray-100 pt-4">
          <button type="button" className={dangerBtn} onClick={remove} disabled={readOnly}>
            <Trash2 className="h-3.5 w-3.5" />
            Delete page
          </button>
        </div>
      </div>
    </div>
  );
}

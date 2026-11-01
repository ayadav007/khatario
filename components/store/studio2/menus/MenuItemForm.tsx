'use client';

import { useState } from 'react';
import { clsx } from 'clsx';
import { useToastContext } from '@/contexts/ToastContext';
import { OP_ERROR_TEXT, type OpResult } from '@/lib/store/engine/editor/ops';
import { findMenuItem, removeMenuItem, updateMenuItem } from '@/lib/store/engine/editor/menu-ops';
import { encodeImageUrl, lengthCounter } from '@/lib/store/engine/editor/fields';
import { categoryIdOfLink } from '@/lib/store/engine/menus';
import { ENGINE_LIMITS } from '@/lib/store/engine/shared';
import type { Menu, MenuItem, MenuPicture, ThemeData } from '@/lib/store/engine/types';
import { StoreImageField } from '@/components/store/admin/StoreImageField';
import { useStudio2 } from '../Studio2Editor';
import { FieldShell } from '../fields/SettingField';
import { LinkPicker, inputCls } from '../fields/pickers';
import { PanelHeader, RequiredTextField, actionBtn, dangerBtn } from '../panel-ui';

const LIMITS = ENGINE_LIMITS.menus;
const STRUCTURAL = { mergeKey: null, immediate: true } as const;

type Patch = Partial<Omit<MenuItem, 'id' | 'children'>>;

function itemsOf(t: ThemeData, menuId: string): MenuItem[] {
  const menus = Array.isArray(t.settings.menus) ? t.settings.menus : [];
  return menus.find((m) => m.id === menuId)?.items ?? [];
}

/**
 * One menu item: label and link for every item; the top-level-only choices (highlight, automatic categories,
 * picture) on top items. Text edits merge per field into one undo step; toggles are one step each.
 */
export function MenuItemForm({ menu, itemId }: { menu: Menu; itemId: string }) {
  const { apply, select, categories, pages } = useStudio2();
  const toast = useToastContext();
  const [confirmCategories, setConfirmCategories] = useState(false);
  const back = { label: menu.name, onClick: () => select({ kind: 'menu', menuId: menu.id, itemId: null }) };
  const found = findMenuItem(menu.items, itemId);
  if (!found) {
    return (
      <div>
        <PanelHeader title="Menu item" back={back} />
        <p className="p-4 text-sm text-gray-500">{OP_ERROR_TEXT.not_found}</p>
      </div>
    );
  }
  const { item, level } = found;
  const top = level === 1;
  const automatic = top && item.source === 'categories';
  const base = `s2-menu-${menu.id}-${item.id}`;

  const run = (fn: (t: ThemeData) => OpResult, opts: { mergeKey: string | null; immediate: boolean }) => {
    const err = apply(fn, opts);
    if (err) toast.error(OP_ERROR_TEXT[err]);
  };
  const typed = (patch: Patch, key: string) =>
    run((t) => updateMenuItem(t, menu.id, item.id, patch), { mergeKey: `menu:${menu.id}:${item.id}:${key}`, immediate: false });
  const toggled = (patch: Patch) => run((t) => updateMenuItem(t, menu.id, item.id, patch), STRUCTURAL);
  // The picture is read from the theme being edited, so merged keystrokes never work from a stale copy.
  const pictureEdit = (fn: (p: MenuPicture) => MenuPicture, key: string | null) =>
    run(
      (t) => {
        const current = findMenuItem(itemsOf(t, menu.id), item.id)?.item.picture;
        return updateMenuItem(t, menu.id, item.id, { picture: fn(current ?? { image: '', caption: '', link: '' }) });
      },
      key === null ? STRUCTURAL : { mergeKey: `menu:${menu.id}:${item.id}:${key}`, immediate: false },
    );

  // Automatic categories ignore children, so switching drops them (one undo step brings them back).
  const switchToCategories = () => {
    setConfirmCategories(false);
    run((t) => {
      const kids = findMenuItem(itemsOf(t, menu.id), item.id)?.item.children ?? [];
      let r = updateMenuItem(t, menu.id, item.id, { source: 'categories' });
      for (const kid of kids) {
        if (!r.ok) break;
        r = removeMenuItem(r.theme, menu.id, kid.id);
      }
      return r;
    }, STRUCTURAL);
  };
  const setSource = (source: 'links' | 'categories') => {
    if (source === (item.source ?? 'links')) return;
    if (source === 'categories' && (item.children ?? []).length > 0) {
      setConfirmCategories(true);
      return;
    }
    setConfirmCategories(false);
    toggled({ source });
  };

  // A picker link to a category the store no longer has (only once the category list has loaded).
  const catId = categoryIdOfLink(item.link);
  const goneCategory = catId !== null && categories.length > 0 && !categories.some((c) => c.id === catId);
  const picture = item.picture;

  return (
    <div>
      <PanelHeader title={item.label} subtitle={top ? 'Top item' : level === 2 ? 'Second level' : 'Third level'} back={back} />
      <div className="space-y-4 p-4">
        <RequiredTextField
          id={`${base}-label`}
          label="Label"
          value={item.label}
          max={LIMITS.label}
          emptyHint="An item needs a label"
          onChange={(v) => typed({ label: v }, 'label')}
        />
        <FieldShell label="Link" htmlFor={`${base}-link`} info={automatic ? 'No link opens All products' : undefined}>
          <LinkPicker id={`${base}-link`} value={item.link} categories={categories} pages={pages} onChange={(v) => typed({ link: v }, 'link')} />
          {goneCategory && <p className="text-[11px] font-medium text-red-600">This category no longer exists</p>}
        </FieldShell>

        {top && (
          <>
            <label className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-gray-700">Highlight</span>
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={item.highlight === true}
                onChange={(e) => toggled({ highlight: e.target.checked })}
              />
            </label>

            <FieldShell label="Shows">
              <div role="radiogroup" aria-label="Shows" className="flex flex-wrap gap-1.5">
                {(
                  [
                    ['links', 'Links'],
                    ['categories', 'All categories (automatic)'],
                  ] as const
                ).map(([value, text]) => {
                  const on = (item.source ?? 'links') === value;
                  return (
                    <label
                      key={value}
                      className={clsx(
                        'cursor-pointer rounded-md border px-2.5 py-1 text-xs',
                        on ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-50',
                      )}
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        name={`${base}-source`}
                        value={value}
                        checked={on}
                        onChange={() => setSource(value)}
                      />
                      {text}
                    </label>
                  );
                })}
              </div>
              {confirmCategories && (
                <div role="alert" className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-2.5">
                  <p className="text-xs text-amber-900">Its links will be removed.</p>
                  <div className="flex gap-2">
                    <button type="button" className={dangerBtn} onClick={switchToCategories}>
                      Remove links
                    </button>
                    <button type="button" className={actionBtn} onClick={() => setConfirmCategories(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </FieldShell>

            {automatic && (
              <label className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-gray-700">Show category photos</span>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={item.category_photos === true}
                  onChange={(e) => toggled({ category_photos: e.target.checked })}
                />
              </label>
            )}

            <div className="space-y-3 border-t border-gray-100 pt-4">
              <StoreImageField
                label="Picture"
                hint="Shown at the side of this item's dropdown"
                value={picture?.image ?? ''}
                uploadUrl="/api/settings/online-store/media"
                onChange={(url) => {
                  if (url === '') toggled({ picture: undefined });
                  else pictureEdit((p) => ({ ...p, image: encodeImageUrl(url) }), null);
                }}
              />
              {/* Caption and link are kept only with an image (the server drops a picture without one). */}
              {picture && picture.image !== '' && (
                <>
                  <FieldShell label="Caption" htmlFor={`${base}-caption`} counter={lengthCounter(picture.caption, LIMITS.caption)}>
                    <input
                      id={`${base}-caption`}
                      className={inputCls}
                      value={picture.caption}
                      maxLength={LIMITS.caption}
                      onChange={(e) => {
                        const caption = e.target.value;
                        pictureEdit((p) => ({ ...p, caption }), 'caption');
                      }}
                    />
                  </FieldShell>
                  <FieldShell label="Picture link" htmlFor={`${base}-picture-link`}>
                    <LinkPicker
                      id={`${base}-picture-link`}
                      value={picture.link}
                      categories={categories}
                      pages={pages}
                      onChange={(link) => pictureEdit((p) => ({ ...p, link }), 'picture-link')}
                    />
                  </FieldShell>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

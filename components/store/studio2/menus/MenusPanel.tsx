'use client';

import { useRef, useState } from 'react';
import { ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { OP_ERROR_TEXT } from '@/lib/store/engine/editor/ops';
import { addMenu, menuInUse, removeMenu, renameMenu } from '@/lib/store/engine/editor/menu-ops';
import { ENGINE_LIMITS } from '@/lib/store/engine/shared';
import type { Menu, MenuItem, ThemeData } from '@/lib/store/engine/types';
import { useStudio2 } from '../Studio2Editor';
import { useEdit } from '../SectionTree';
import { PanelHeader, actionBtn } from '../panel-ui';

const LIMITS = ENGINE_LIMITS.menus;

const countItems = (items: MenuItem[]): number => items.reduce((n, i) => n + 1 + countItems(i.children ?? []), 0);

/** Which of the Header and Footer use a menu (by setting or by default), for the delete message. */
function usedBy(theme: ThemeData, menuId: string): string | null {
  const header = menuInUse({ ...theme, footer_group: { ...theme.footer_group, sections: {} } }, menuId);
  const footer = menuInUse({ ...theme, header_group: { ...theme.header_group, sections: {} } }, menuId);
  if (header && footer) return 'the Header and Footer';
  return header ? 'the Header' : footer ? 'the Footer' : null;
}

/** The theme's menus: open, rename, delete (not while the Header or Footer uses it) and add. */
export function MenusPanel() {
  const { theme, select } = useStudio2();
  const edit = useEdit();
  const menus = Array.isArray(theme.settings.menus) ? theme.settings.menus : [];
  const full = menus.length >= LIMITS.menus;

  const add = () => {
    const id = edit.create((t) => addMenu(t, `Menu ${menus.length + 1}`));
    if (id) select({ kind: 'menu', menuId: id, itemId: null });
  };

  return (
    <div>
      <PanelHeader title="Menus" subtitle="The Header and Footer each show one menu" />
      <div className="space-y-3 p-4">
        {menus.length === 0 && <p className="text-sm text-gray-500">No menus yet.</p>}
        <ul className="space-y-2">
          {menus.map((m) => (
            <MenuRow key={m.id} menu={m} />
          ))}
        </ul>
        <button type="button" className={actionBtn} disabled={full} onClick={add}>
          <Plus className="h-3.5 w-3.5" />
          Add menu
        </button>
        {full && <p className="text-[11px] text-gray-500">{OP_ERROR_TEXT.menu_limit}</p>}
      </div>
    </div>
  );
}

function MenuRow({ menu }: { menu: Menu }) {
  const { theme, select } = useStudio2();
  const edit = useEdit();
  const [renaming, setRenaming] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const count = countItems(menu.items);

  const remove = () => {
    const who = usedBy(theme, menu.id);
    if (who) {
      setBlocked(`Used by ${who}. Pick another menu there first.`);
      return;
    }
    setBlocked(null);
    if (!window.confirm(`Delete ${menu.name}?`)) return;
    edit.run((t) => removeMenu(t, menu.id));
  };

  return (
    <li className="rounded-md border border-gray-200">
      <div className="flex items-center gap-1 pr-1">
        {renaming ? (
          <div className="min-w-0 flex-1 p-1.5">
            <RenameMenuInput menu={menu} onDone={() => setRenaming(false)} />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => select({ kind: 'menu', menuId: menu.id, itemId: null })}
            className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left hover:bg-gray-50"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-gray-800">{menu.name}</span>
              <span className="block text-[11px] text-gray-500">{count === 1 ? '1 item' : `${count} items`}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={() => setRenaming(true)}
          aria-label={`Rename ${menu.name}`}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={remove}
          aria-label={`Delete ${menu.name}`}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {blocked && (
        <p role="alert" className="border-t border-gray-100 px-3 py-2 text-xs text-red-700">
          {blocked}
        </p>
      )}
    </li>
  );
}

/** Renames on Enter or leaving the box; Escape or an empty name keeps the old one. */
function RenameMenuInput({ menu, onDone }: { menu: Menu; onDone(): void }) {
  const edit = useEdit();
  const [value, setValue] = useState(menu.name);
  const doneRef = useRef(false);

  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (commit && value.trim() !== '' && value.trim() !== menu.name) {
      edit.run((t) => renameMenu(t, menu.id, value));
    }
    onDone();
  };

  return (
    <input
      autoFocus
      aria-label="Menu name"
      value={value}
      maxLength={LIMITS.name}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      }}
      className="w-full rounded border border-blue-400 px-1.5 py-1 text-sm outline-none ring-2 ring-blue-100"
    />
  );
}

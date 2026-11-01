'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronRight, GripVertical, MoreVertical, Plus } from 'lucide-react';
import { clsx } from 'clsx';
import { useToastContext } from '@/contexts/ToastContext';
import { OP_ERROR_TEXT, type OpError, type OpResult } from '@/lib/store/engine/editor/ops';
import {
  addMenuItem,
  duplicateMenuItem,
  moveMenuItem,
  removeMenuItem,
  renameMenu,
  reorderMenuItem,
} from '@/lib/store/engine/editor/menu-ops';
import { ENGINE_LIMITS } from '@/lib/store/engine/shared';
import type { Menu, MenuItem, ThemeData } from '@/lib/store/engine/types';
import { useStudio2 } from '../Studio2Editor';
import { Dropdown, MenuItem as DropdownItem, useEdit, usePointerAndKeyboardSensors } from '../SectionTree';
import { PanelHeader, RequiredTextField } from '../panel-ui';

const LIMITS = ENGINE_LIMITS.menus;

const iconBtn =
  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-200 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

/** Why a menu action is off, when the reason is worth saying (an end of the list needs no words). */
function menuRefusalText(reason: OpError): string | undefined {
  if (reason === 'not_allowed_here') return 'All categories (automatic) fills its own list';
  return reason.startsWith('menu_') ? OP_ERROR_TEXT[reason] : undefined;
}

interface TreeApi {
  menuId: string;
  isOpen(id: string): boolean;
  setOpen(id: string, open: boolean): void;
}

const TreeContext = createContext<TreeApi | null>(null);

function useTree(): TreeApi {
  const api = useContext(TreeContext);
  if (!api) throw new Error('useTree must be used inside MenuEditor');
  return api;
}

/** One menu: its name and its items as an indented tree (drag within a level, ⋮ for the other moves). */
export function MenuEditor({ menu }: { menu: Menu }) {
  const { apply, select } = useStudio2();
  const toast = useToastContext();
  // Every item starts open; folding is the editor's own view state, not part of the theme.
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const setOpen = useCallback((id: string, open: boolean) => {
    setClosed((prev) => {
      if (prev.has(id) !== open) return prev;
      const next = new Set(prev);
      if (open) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const tree = useMemo<TreeApi>(() => ({ menuId: menu.id, isOpen: (id) => !closed.has(id), setOpen }), [menu.id, closed, setOpen]);

  return (
    <div>
      <PanelHeader title={menu.name} back={{ label: 'Menus', onClick: () => select({ kind: 'menus' }) }} />
      <div className="space-y-5 p-4">
        <RequiredTextField
          id={`s2-menu-${menu.id}-name`}
          label="Menu name"
          value={menu.name}
          max={LIMITS.name}
          emptyHint="A menu needs a name"
          onChange={(v) => {
            const err = apply((t) => renameMenu(t, menu.id, v), { mergeKey: `menu:${menu.id}:name`, immediate: false });
            if (err) toast.error(OP_ERROR_TEXT[err]);
          }}
        />
        <div className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Items</h3>
          <TreeContext.Provider value={tree}>
            <ItemList items={menu.items} parentId={null} level={1} />
          </TreeContext.Provider>
        </div>
      </div>
    </div>
  );
}

/** One level of the tree: its own sortable list, then "Add item". */
function ItemList({ items, parentId, level }: { items: MenuItem[]; parentId: string | null; level: number }) {
  const { readOnly, select } = useStudio2();
  const { menuId } = useTree();
  const edit = useEdit();
  const sensors = usePointerAndKeyboardSensors();
  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const full = items.length >= LIMITS.itemsPerLevel;

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const to = ids.indexOf(String(over.id));
    if (to >= 0) edit.run((t) => reorderMenuItem(t, menuId, String(active.id), to));
  };

  const add = () => {
    const id = edit.create((t) => addMenuItem(t, menuId, parentId));
    if (id) select({ kind: 'menu', menuId, itemId: id });
  };

  return (
    <div className={clsx(level > 1 && 'pl-5')}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={readOnly}>
          <ul>
            {items.map((item, index) => (
              <ItemRow key={item.id} item={item} index={index} siblings={items} level={level} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <button
        type="button"
        disabled={full}
        title={full ? OP_ERROR_TEXT.menu_item_limit : undefined}
        onClick={add}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        Add item
      </button>
    </div>
  );
}

interface RowAction {
  label: string;
  danger?: boolean;
  /** The op; dry-run against the current theme to decide whether the action is offered. */
  op(t: ThemeData): OpResult;
  run(): void;
}

function ItemRow({ item, index, siblings, level }: { item: MenuItem; index: number; siblings: MenuItem[]; level: number }) {
  const { theme, readOnly, select } = useStudio2();
  const { menuId, isOpen, setOpen } = useTree();
  const edit = useEdit();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: readOnly,
  });
  const automatic = level === 1 && item.source === 'categories';
  const kids = automatic ? [] : item.children ?? [];
  const open = kids.length > 0 && isOpen(item.id);
  const label = item.label || 'Untitled';

  const ops: RowAction[] = [
    {
      label: 'Add item under this',
      op: (t) => addMenuItem(t, menuId, item.id),
      run: () => {
        const id = edit.create((t) => addMenuItem(t, menuId, item.id));
        if (!id) return;
        setOpen(item.id, true);
        select({ kind: 'menu', menuId, itemId: id });
      },
    },
    ...(['up', 'down', 'in', 'out'] as const).map((dir) => ({
      label: `Move ${dir}`,
      op: (t: ThemeData) => moveMenuItem(t, menuId, item.id, dir),
      run: () => {
        // Moving in lands at the end of the item above: keep that item open so the moved row stays in sight.
        if (dir === 'in' && index > 0) setOpen(siblings[index - 1].id, true);
        edit.run((t) => moveMenuItem(t, menuId, item.id, dir));
      },
    })),
    {
      label: 'Duplicate',
      op: (t) => duplicateMenuItem(t, menuId, item.id),
      run: () => edit.run((t) => duplicateMenuItem(t, menuId, item.id)),
    },
    {
      label: 'Delete',
      danger: true,
      op: (t) => removeMenuItem(t, menuId, item.id),
      run: () => {
        const text = kids.length ? `Delete ${label} and the links under it?` : `Delete ${label}?`;
        if (window.confirm(text)) edit.run((t) => removeMenuItem(t, menuId, item.id));
      },
    },
  ];

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx('relative', isDragging && 'z-10 opacity-80')}
    >
      <div
        className={clsx(
          'group flex items-center gap-0.5 rounded-md pr-1 hover:bg-gray-50',
          isDragging && 'bg-white shadow-md ring-1 ring-gray-200',
        )}
      >
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          disabled={readOnly}
          className={clsx(iconBtn, 'cursor-grab touch-none active:cursor-grabbing')}
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>
        {kids.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen(item.id, !open)}
            aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
            aria-expanded={open}
            className={iconBtn}
          >
            {open ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
          </button>
        ) : (
          <span className="w-6 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          onClick={() => select({ kind: 'menu', menuId, itemId: item.id })}
          title={label}
          className="min-w-0 flex-1 truncate py-1.5 text-left text-sm text-gray-800"
        >
          {label}
          {automatic && <span className="ml-1.5 text-[11px] text-gray-500">All categories</span>}
        </button>
        <Dropdown
          disabled={readOnly}
          align="right"
          trigger={(p) => (
            <button type="button" {...p} aria-label={`More actions for ${label}`} className={iconBtn}>
              <MoreVertical className="h-4 w-4" aria-hidden />
            </button>
          )}
        >
          {(close) =>
            // Rendered only while the menu is open, so the dry runs cost nothing otherwise.
            ops.map((a) => {
              const r = a.op(theme);
              const reason = r.ok ? undefined : menuRefusalText(r.reason);
              return (
                <DropdownItem
                  key={a.label}
                  danger={a.danger}
                  disabled={!r.ok}
                  title={reason}
                  onSelect={() => {
                    close();
                    a.run();
                  }}
                >
                  <span className="block">{a.label}</span>
                  {reason && <span className="block text-[11px] text-gray-500">{reason}</span>}
                </DropdownItem>
              );
            })
          }
        </Dropdown>
      </div>
      {open && <ItemList items={kids} parentId={item.id} level={level + 1} />}
    </li>
  );
}

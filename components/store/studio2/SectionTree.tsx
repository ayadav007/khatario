'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronRight, Eye, EyeOff, GripVertical, MoreVertical, Palette, Plus } from 'lucide-react';
import { clsx } from 'clsx';
import { useToastContext } from '@/contexts/ToastContext';
import {
  OP_ERROR_TEXT,
  addBlock,
  duplicateBlock,
  duplicateSection,
  fillTemplate,
  getGroup,
  moveBlock,
  moveSection,
  removeBlock,
  removeSection,
  toggleBlock,
  toggleSection,
  updateSection,
  type GroupKey,
  type OpError,
  type OpResult,
  type SectionRef,
} from '@/lib/store/engine/editor/ops';
import {
  TREE_GROUPS,
  addBlockOptions,
  dragMove,
  groupRows,
  isEmptyClassicTemplate,
  templateTitle,
  type BlockRow,
  type SectionRow,
} from '@/lib/store/engine/editor/tree';
import { getSectionSchema } from '@/lib/store/engine/registry';
import { defaultTemplate } from '@/lib/store/engine/presets/templates';
import type { ThemeData } from '@/lib/store/engine/types';
import { useStudio2 } from './Studio2Editor';

const STRUCTURAL = { mergeKey: null, immediate: true } as const;

const iconBtn =
  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-200 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

// Eye-on shows on hover or focus (always on touch screens); a hidden row always shows eye-off.
const revealOnHover = 'opacity-0 focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100';

const sameRef = (a: SectionRef | null | undefined, b: SectionRef) => !!a && a.group === b.group && a.id === b.id;

function usePointerAndKeyboardSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

/** Runs an op that creates something and returns its new id (or shows the op error). */
function useEdit() {
  const { apply } = useStudio2();
  const toast = useToastContext();
  return useMemo(() => {
    const report = (err: OpError | null) => {
      if (err) toast.error(OP_ERROR_TEXT[err]);
      return err;
    };
    return {
      run(fn: (t: ThemeData) => OpResult) {
        return report(apply(fn, STRUCTURAL));
      },
      create(fn: (t: ThemeData) => OpResult): string | null {
        let id: string | null = null;
        const err = apply((t) => {
          const r = fn(t);
          if (r.ok && r.id) id = r.id;
          return r;
        }, STRUCTURAL);
        return report(err) ? null : id;
      },
    };
  }, [apply, toast]);
}

export function SectionTree() {
  const { select, selection, theme, templateKey } = useStudio2();
  return (
    <nav aria-label="Sections" className="py-2 text-sm">
      <div className="px-2">
        <button
          type="button"
          onClick={() => select({ kind: 'theme' })}
          className={clsx(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-medium text-gray-800 hover:bg-gray-100',
            selection?.kind === 'theme' && 'bg-blue-50 text-blue-800 hover:bg-blue-50',
          )}
        >
          <Palette className="h-4 w-4 text-gray-500" aria-hidden />
          Theme settings
        </button>
      </div>
      {TREE_GROUPS.map((g) =>
        g.group !== 'template' ? (
          <GroupTree key={g.group} group={g.group} title={g.title} />
        ) : isEmptyClassicTemplate(theme, templateKey) ? (
          <ClassicLayoutCard key={g.group} title={templateTitle(theme, templateKey)} />
        ) : (
          <GroupTree key={g.group} group={g.group} title={templateTitle(theme, templateKey)} />
        ),
      )}
    </nav>
  );
}

function GroupTree({ group, title }: { group: GroupKey; title: string }) {
  const { theme, templateKey, openAddSection, readOnly } = useStudio2();
  const edit = useEdit();
  const sensors = usePointerAndKeyboardSensors();
  const rows = useMemo(() => groupRows(theme, templateKey, group), [theme, templateKey, group]);
  // Section ids are unique across groups, and each group has its own DndContext.
  const sortIds = useMemo(() => rows.map((r) => r.id), [rows]);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const move = dragMove(rows, String(active.id), over ? String(over.id) : null);
    if (move) edit.run((t) => moveSection(t, templateKey, group, move.from, move.to));
  };

  return (
    <section className="mt-3 border-t border-gray-100 px-2 pt-3" aria-label={title}>
      <h3 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={sortIds} strategy={verticalListSortingStrategy} disabled={readOnly}>
          <ul>
            {rows.map((row) => (
              <SectionItem key={row.id} row={row} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <button
        type="button"
        disabled={readOnly}
        onClick={() => openAddSection(group, getGroup(theme, templateKey, group).order.length)}
        className="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="h-4 w-4" aria-hidden />
        Add section
      </button>
    </section>
  );
}

/** D15: an empty Product or Catalog template renders the classic page; offer the default layout instead. */
function ClassicLayoutCard({ title }: { title: string }) {
  const { templateKey, readOnly } = useStudio2();
  const edit = useEdit();
  const key = templateKey === 'catalog' ? 'catalog' : 'product';
  return (
    <section className="mt-3 border-t border-gray-100 px-2 pt-3" aria-label={title}>
      <h3 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      <div className="mx-2 my-3 flex flex-col items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-6 text-center">
        <p className="text-sm text-gray-700">This page uses the classic layout.</p>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => edit.run((t) => fillTemplate(t, key, defaultTemplate(key)))}
          className="inline-flex h-8 items-center rounded-md bg-gray-900 px-3 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Use the default layout
        </button>
      </div>
    </section>
  );
}

function SectionItem({ row }: { row: SectionRow }) {
  const { theme, templateKey, selection, select, hover, hovered, readOnly } = useStudio2();
  const edit = useEdit();
  const { ref } = row;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    disabled: readOnly || row.unknown,
  });
  // null: follow the selection (open while one of its blocks is selected); otherwise the user's choice.
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const [renaming, setRenaming] = useState(false);

  const schema = getSectionSchema(sectionType(theme, templateKey, ref));
  const hasBlocks = !row.unknown && (row.blocks.length > 0 || !!schema?.blocks?.length);
  const blockSelectedHere = selection?.kind === 'block' && sameRef(selection.ref, ref);
  const selectedBlockId = blockSelectedHere ? selection.blockId : null;
  useEffect(() => {
    if (selectedBlockId) setExpanded((e) => (e === false ? null : e));
  }, [selectedBlockId]);
  const open = hasBlocks && (expanded ?? blockSelectedHere);
  const selected = selection?.kind === 'section' && sameRef(selection.ref, ref);
  const isHovered = sameRef(hovered, ref);

  const remove = () => {
    if (!window.confirm(`Remove ${row.label}?`)) return;
    edit.run((t) => removeSection(t, templateKey, ref));
  };
  const duplicate = () => {
    const id = edit.create((t) => duplicateSection(t, templateKey, ref));
    if (id) select({ kind: 'section', ref: { group: ref.group, id } }, { scroll: true, afterSave: true });
  };

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx('relative', isDragging && 'z-10 opacity-80')}
    >
      <div
        onMouseEnter={() => hover(ref)}
        onMouseLeave={() => hover(null)}
        className={clsx(
          'group flex items-center gap-0.5 rounded-md pr-1',
          selected ? 'bg-blue-50' : isHovered ? 'bg-gray-100' : 'hover:bg-gray-50',
          isDragging && 'bg-white shadow-md ring-1 ring-gray-200',
        )}
      >
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          disabled={readOnly || row.unknown}
          className={clsx(iconBtn, 'cursor-grab touch-none active:cursor-grabbing')}
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>
        {hasBlocks ? (
          <button
            type="button"
            onClick={() => setExpanded(!open)}
            aria-label={open ? `Collapse ${row.label}` : `Expand ${row.label}`}
            aria-expanded={open}
            className={iconBtn}
          >
            {open ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
          </button>
        ) : (
          <span className="w-6 shrink-0" aria-hidden />
        )}
        {renaming ? (
          <RenameInput
            row={row}
            placeholder={schema?.name ?? row.label}
            onDone={() => setRenaming(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => select({ kind: 'section', ref }, { scroll: true })}
            aria-current={selected ? 'true' : undefined}
            title={row.label}
            className={clsx(
              'min-w-0 flex-1 truncate py-1.5 text-left',
              selected ? 'font-medium text-blue-800' : 'text-gray-800',
              row.hidden && 'opacity-50',
              row.unknown && 'italic text-gray-500',
            )}
          >
            {row.label}
          </button>
        )}
        {!row.unknown && (
          <button
            type="button"
            disabled={readOnly}
            onClick={() => edit.run((t) => toggleSection(t, templateKey, ref))}
            aria-label={row.hidden ? `Show ${row.label}` : `Hide ${row.label}`}
            className={clsx(iconBtn, !row.hidden && revealOnHover)}
          >
            {row.hidden ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
          </button>
        )}
        <RowMenu
          label={row.label}
          disabled={readOnly}
          items={
            row.unknown
              ? [{ label: 'Remove', danger: true, onSelect: remove }]
              : [
                  { label: 'Rename', onSelect: () => setRenaming(true) },
                  { label: 'Duplicate', onSelect: duplicate },
                  { label: 'Remove', danger: true, onSelect: remove },
                ]
          }
        />
      </div>
      {open && <BlockList sectionRef={ref} blocks={row.blocks} />}
    </li>
  );
}

function sectionType(theme: ThemeData, templateKey: string, ref: SectionRef): string {
  return getGroup(theme, templateKey, ref.group).sections[ref.id]?.type ?? '';
}

function RenameInput({ row, placeholder, onDone }: { row: SectionRow; placeholder: string; onDone(): void }) {
  const { theme, templateKey, apply } = useStudio2();
  const { ref } = row;
  const current = getGroup(theme, templateKey, ref.group).sections[ref.id]?.label ?? '';
  const [value, setValue] = useState(current);
  const doneRef = useRef(false);

  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (commit && value.trim() !== current) {
      apply((t) => updateSection(t, templateKey, ref, { label: value }), {
        mergeKey: `${ref.group}:${ref.id}:label`,
        immediate: false,
      });
    }
    onDone();
  };

  return (
    <input
      autoFocus
      aria-label="Section name"
      value={value}
      placeholder={placeholder}
      maxLength={40}
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
      className="min-w-0 flex-1 rounded border border-blue-400 px-1.5 py-1 text-sm outline-none ring-2 ring-blue-100"
    />
  );
}

function BlockList({ sectionRef, blocks }: { sectionRef: SectionRef; blocks: BlockRow[] }) {
  const { theme, templateKey, select, readOnly } = useStudio2();
  const edit = useEdit();
  const sensors = usePointerAndKeyboardSensors();
  const ids = useMemo(() => blocks.map((b) => b.id), [blocks]);
  const options = useMemo(() => addBlockOptions(theme, templateKey, sectionRef), [theme, templateKey, sectionRef]);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const move = dragMove(blocks, String(active.id), over ? String(over.id) : null);
    if (move) edit.run((t) => moveBlock(t, templateKey, sectionRef, move.from, move.to));
  };

  const add = (type: string) => {
    const id = edit.create((t) => {
      const count = getGroup(t, templateKey, sectionRef.group).sections[sectionRef.id]?.block_order.length ?? 0;
      return addBlock(t, templateKey, sectionRef, type, count);
    });
    if (id) select({ kind: 'block', ref: sectionRef, blockId: id }, { scroll: true });
  };

  return (
    <div className="pb-1 pl-7">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={readOnly}>
          <ul>
            {blocks.map((b) => (
              <BlockItem key={b.id} sectionRef={sectionRef} block={b} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {options.length > 0 && (
        <Dropdown
          disabled={readOnly}
          align="left"
          trigger={(p) => (
            <button
              type="button"
              {...p}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add block
            </button>
          )}
        >
          {(close) =>
            options.map((o) => (
              <MenuItem
                key={o.type}
                disabled={!!o.reason}
                title={o.reasonText ?? undefined}
                onSelect={() => {
                  close();
                  add(o.type);
                }}
              >
                <span className="block">{o.name}</span>
                {o.reasonText && <span className="block text-[11px] text-gray-500">{o.reasonText}</span>}
              </MenuItem>
            ))
          }
        </Dropdown>
      )}
    </div>
  );
}

function BlockItem({ sectionRef, block }: { sectionRef: SectionRef; block: BlockRow }) {
  const { templateKey, selection, select, readOnly } = useStudio2();
  const edit = useEdit();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
    disabled: readOnly,
  });
  const selected = selection?.kind === 'block' && sameRef(selection.ref, sectionRef) && selection.blockId === block.id;

  const remove = () => {
    if (!window.confirm(`Remove ${block.label}?`)) return;
    edit.run((t) => removeBlock(t, templateKey, sectionRef, block.id));
  };
  const duplicate = () => {
    const id = edit.create((t) => duplicateBlock(t, templateKey, sectionRef, block.id));
    if (id) select({ kind: 'block', ref: sectionRef, blockId: id }, { scroll: true });
  };

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx(
        'group relative flex items-center gap-0.5 rounded-md pr-1',
        selected ? 'bg-blue-50' : 'hover:bg-gray-50',
        isDragging && 'z-10 bg-white shadow-md ring-1 ring-gray-200',
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
        <GripVertical className="h-3.5 w-3.5" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => select({ kind: 'block', ref: sectionRef, blockId: block.id }, { scroll: true })}
        aria-current={selected ? 'true' : undefined}
        title={block.label}
        className={clsx(
          'min-w-0 flex-1 truncate py-1 text-left text-xs',
          selected ? 'font-medium text-blue-800' : 'text-gray-700',
          block.hidden && 'opacity-50',
          block.unknown && 'italic text-gray-500',
        )}
      >
        {block.label}
      </button>
      <button
        type="button"
        disabled={readOnly}
        onClick={() => edit.run((t) => toggleBlock(t, templateKey, sectionRef, block.id))}
        aria-label={block.hidden ? `Show ${block.label}` : `Hide ${block.label}`}
        className={clsx(iconBtn, !block.hidden && revealOnHover)}
      >
        {block.hidden ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
      </button>
      <RowMenu
        label={block.label}
        disabled={readOnly}
        items={
          block.unknown
            ? [{ label: 'Remove', danger: true, onSelect: remove }]
            : [
                { label: 'Duplicate', onSelect: duplicate },
                { label: 'Remove', danger: true, onSelect: remove },
              ]
        }
      />
    </li>
  );
}

interface RowMenuItem {
  label: string;
  danger?: boolean;
  onSelect(): void;
}

function RowMenu({ label, items, disabled }: { label: string; items: RowMenuItem[]; disabled: boolean }) {
  return (
    <Dropdown
      disabled={disabled}
      align="right"
      trigger={(p) => (
        <button type="button" {...p} aria-label={`More actions for ${label}`} className={iconBtn}>
          <MoreVertical className="h-4 w-4" aria-hidden />
        </button>
      )}
    >
      {(close) =>
        items.map((it) => (
          <MenuItem
            key={it.label}
            danger={it.danger}
            onSelect={() => {
              close();
              it.onSelect();
            }}
          >
            {it.label}
          </MenuItem>
        ))
      }
    </Dropdown>
  );
}

interface TriggerProps {
  onClick(): void;
  disabled: boolean;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
}

/** A small click-to-open menu that closes on outside click or Escape. */
function Dropdown({
  trigger,
  children,
  disabled,
  align,
}: {
  trigger(p: TriggerProps): ReactNode;
  children(close: () => void): ReactNode;
  disabled: boolean;
  align: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div ref={boxRef} className="relative">
      {trigger({ onClick: () => setOpen((o) => !o), disabled, 'aria-haspopup': 'menu', 'aria-expanded': open })}
      {open && (
        <div
          role="menu"
          className={clsx(
            'absolute top-full z-20 mt-1 min-w-[10rem] rounded-md border border-gray-200 bg-white py-1 shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  onSelect,
  danger,
  disabled,
  title,
}: {
  children: ReactNode;
  onSelect(): void;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-disabled={disabled || undefined}
      title={title}
      onClick={() => !disabled && onSelect()}
      className={clsx(
        'block w-full px-3 py-1.5 text-left text-sm',
        disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-gray-100',
        danger ? 'text-red-700' : 'text-gray-800',
      )}
    >
      {children}
    </button>
  );
}

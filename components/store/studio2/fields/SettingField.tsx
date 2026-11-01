'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';
import { clsx } from 'clsx';
import type { SettingSchema } from '@/lib/store/engine/schema-types';
import type { ColorScheme } from '@/lib/store/engine/types';
import { normaliseLineList, type LineItem } from '@/lib/store/engine/shared';
import {
  FONT_OPTIONS,
  HTML_MAX,
  ICON_OPTIONS,
  clampNumber,
  encodeImageUrl,
  lengthCounter,
  listLimit,
  parseHex,
  textRuleFor,
} from '@/lib/store/engine/editor/fields';
import { StoreImageField } from '@/components/store/admin/StoreImageField';
import { SimpleRichTextEditor } from '@/components/email/SimpleRichTextEditor';
import { CategoryList, CategorySelect, LinkPicker, ProductPicker, inputCls } from './pickers';
import { useStudio2 } from '../Studio2Editor';

export interface SettingFieldProps {
  schema: SettingSchema;
  /** The stored value, or the schema default. */
  value: unknown;
  onChange(value: unknown): void;
  /** Unique per form and setting, for label `htmlFor`. */
  fieldId: string;
  readOnly: boolean;
  categories: { id: string; name: string }[];
  /** The theme's custom pages, for link pickers. */
  pages?: { handle: string; title: string }[];
  colorSchemes: ColorScheme[];
  /** The preset fixes this setting (D29): the field is disabled and this text is its info line. */
  locked?: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function FieldShell({
  label,
  htmlFor,
  info,
  counter,
  children,
}: {
  label: string;
  htmlFor?: string;
  info?: string;
  counter?: { text: string; over: boolean } | null;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-xs font-medium text-gray-700">
            {label}
          </label>
        ) : (
          <span className="text-xs font-medium text-gray-700">{label}</span>
        )}
        {counter && (
          <span className={clsx('text-[11px] tabular-nums', counter.over ? 'text-red-600' : 'text-gray-400')}>{counter.text}</span>
        )}
      </div>
      {children}
      {info && (
        <p className="flex items-start gap-1 text-[11px] text-gray-500">
          <Info className="mt-px h-3 w-3 shrink-0" />
          {info}
        </p>
      )}
    </div>
  );
}

const noop = () => {};

export function SettingField(props: SettingFieldProps) {
  if (props.locked) {
    // A disabled fieldset disables every native control inside; edits are dropped as well.
    return (
      <fieldset disabled className="m-0 min-w-0 border-0 p-0 opacity-60" data-locked="true">
        <SettingField {...props} locked={undefined} schema={{ ...props.schema, info: props.locked }} onChange={noop} />
      </fieldset>
    );
  }
  const { schema, value, onChange, fieldId, readOnly, categories, pages, colorSchemes } = props;
  const shell = (children: ReactNode, opts: { counter?: { text: string; over: boolean } | null; info?: string; noFor?: boolean } = {}) => (
    <FieldShell label={schema.label} htmlFor={opts.noFor ? undefined : fieldId} info={opts.info ?? schema.info} counter={opts.counter}>
      {children}
    </FieldShell>
  );

  switch (schema.type) {
    case 'header':
      return <h4 className="border-t border-gray-100 pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{schema.label}</h4>;

    case 'text': {
      const rule = textRuleFor(schema);
      if (rule) {
        return shell(<CheckedTextInput id={fieldId} value={str(value)} valid={rule} placeholder="https://" onChange={onChange} />);
      }
      return shell(
        <input
          id={fieldId}
          className={inputCls}
          value={str(value)}
          maxLength={schema.max_length}
          onChange={(e) => onChange(e.target.value)}
        />,
        { counter: lengthCounter(value, schema.max_length) },
      );
    }

    case 'textarea':
      return shell(
        <textarea
          id={fieldId}
          rows={3}
          className={inputCls}
          value={str(value)}
          maxLength={schema.max_length}
          onChange={(e) => onChange(e.target.value)}
        />,
        { counter: lengthCounter(value, schema.max_length) },
      );

    case 'richtext':
      return shell(<RichTextInput value={str(value)} readOnly={readOnly} onChange={onChange} />, { noFor: true });

    case 'html': {
      const v = str(value);
      return shell(
        <textarea
          id={fieldId}
          rows={8}
          spellCheck={false}
          className={clsx(inputCls, 'font-mono text-xs')}
          value={v}
          maxLength={HTML_MAX}
          onChange={(e) => onChange(e.target.value)}
        />,
        {
          counter: { text: `${v.length.toLocaleString('en-IN')} chars · 20 KB max`, over: v.length > HTML_MAX },
          info: 'Scripts and unsafe tags are removed when saved',
        },
      );
    }

    case 'number':
    case 'range':
      return shell(<NumberInput id={fieldId} schema={schema} value={value} onChange={onChange} />);

    case 'checkbox':
      return (
        <div className="space-y-1.5">
          <label className="flex items-center justify-between gap-3 text-sm text-gray-800">
            <span className="text-xs font-medium text-gray-700">{schema.label}</span>
            <input type="checkbox" className="h-4 w-4" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          </label>
          {schema.info && (
            <p className="flex items-start gap-1 text-[11px] text-gray-500">
              <Info className="mt-px h-3 w-3 shrink-0" />
              {schema.info}
            </p>
          )}
        </div>
      );

    case 'select':
    case 'font':
    case 'icon': {
      const options = schema.type === 'font' ? FONT_OPTIONS : schema.type === 'icon' ? ICON_OPTIONS : schema.options ?? [];
      // A setting stored as a number (the card's name lines) lists its values as text and is written back as a number.
      const numeric = typeof schema.default === 'number';
      const v = numeric && typeof value === 'number' ? String(value) : str(value);
      return shell(
        <select id={fieldId} className={inputCls} value={v} onChange={(e) => onChange(numeric ? Number(e.target.value) : e.target.value)}>
          {!options.some((o) => o.value === v) && <option value={v}>{v ? v : 'Choose…'}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>,
      );
    }

    case 'radio':
      return shell(
        <div role="radiogroup" aria-label={schema.label} className="flex flex-wrap gap-1.5">
          {(schema.options ?? []).map((o) => (
            <label
              key={o.value}
              className={clsx(
                'cursor-pointer rounded-md border px-2.5 py-1 text-xs',
                value === o.value ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-50',
              )}
            >
              <input
                type="radio"
                className="sr-only"
                name={fieldId}
                value={o.value}
                checked={value === o.value}
                onChange={() => onChange(o.value)}
              />
              {o.label}
            </label>
          ))}
        </div>,
        { noFor: true },
      );

    case 'color':
      // A colour whose default is empty (none) can be cleared again.
      return shell(<ColorInput id={fieldId} value={str(value)} onChange={onChange} clearable={schema.default === ''} />);

    case 'color_scheme':
      // A scheme whose default is empty offers Default (clears the choice).
      return shell(<SchemePicker value={str(value)} schemes={colorSchemes} onChange={onChange} allowNone={schema.default === ''} />, {
        noFor: true,
      });

    case 'line_list':
      return shell(<LineListInput id={fieldId} schema={schema} value={value} onChange={onChange} />, { noFor: true });

    case 'image':
      // StoreImageField has its own label; the shell only adds the info line.
      return (
        <div className="space-y-1.5">
          <StoreImageField
            label={schema.label}
            value={str(value)}
            uploadUrl="/api/settings/online-store/media"
            allowVideo={schema.video === true}
            onChange={(url) => onChange(encodeImageUrl(url))}
          />
          {/* A photo picked before uploads were stored as files: the server never kept it. */}
          {str(value).startsWith('data:') && (
            <p className="text-[11px] font-medium text-red-600">This photo was not saved. Remove it and upload it again.</p>
          )}
          {schema.info && <p className="text-[11px] text-gray-500">{schema.info}</p>}
        </div>
      );

    case 'video_url':
      return shell(
        <CheckedTextInput
          id={fieldId}
          type="url"
          value={str(value)}
          valid={textRuleFor(schema) ?? (() => true)}
          placeholder="https://www.youtube.com/watch?v=…"
          onChange={onChange}
        />,
        { info: schema.info ?? 'A YouTube or Vimeo link' },
      );

    case 'url':
      return shell(<LinkPicker id={fieldId} value={str(value)} categories={categories} pages={pages} onChange={onChange} />);

    case 'product':
      return shell(
        <ProductPicker
          id={fieldId}
          value={str(value) ? [str(value)] : []}
          max={1}
          disabled={readOnly}
          onChange={(ids) => onChange(ids[0])}
        />,
      );

    case 'product_list':
      return shell(
        <ProductPicker id={fieldId} value={strList(value)} max={listLimit(schema)} disabled={readOnly} onChange={onChange} />,
        { info: schema.info ?? `Up to ${listLimit(schema)} products` },
      );

    case 'category':
      return shell(<CategorySelect id={fieldId} value={str(value)} categories={categories} onChange={onChange} />);

    case 'menu':
      return shell(<MenuSelect id={fieldId} value={str(value)} onChange={onChange} />);

    case 'category_list':
      return shell(<CategoryList value={strList(value)} categories={categories} max={listLimit(schema)} onChange={onChange} />, {
        noFor: true,
      });

    default:
      return null;
  }
}

/** The theme's menus by name, plus a way into the Menus editor. */
function MenuSelect({ id, value, onChange }: { id: string; value: string; onChange(v: string): void }) {
  const { theme, select } = useStudio2();
  const menus = Array.isArray(theme.settings.menus) ? theme.settings.menus : [];
  return (
    <div className="flex items-center gap-2">
      <select id={id} className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
        {!menus.some((m) => m.id === value) && <option value={value}>{value ? 'Missing menu' : 'Choose…'}</option>}
        {menus.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => select({ kind: 'menus' })}
        className="shrink-0 whitespace-nowrap text-xs font-medium text-blue-700 hover:underline"
      >
        Edit menus
      </button>
    </div>
  );
}

/**
 * A text box whose stored value changes only to a valid value (or '' when cleared), like LinkPicker's
 * custom URL: the server would drop anything else, so the field never shows a value that isn't kept.
 */
function CheckedTextInput({
  id,
  type,
  value,
  valid,
  placeholder,
  onChange,
}: {
  id: string;
  type?: 'url';
  value: string;
  valid(raw: string): boolean;
  placeholder?: string;
  onChange(v: string): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && draft.trim() !== '' && !valid(draft);
  return (
    <>
      <input
        id={id}
        type={type}
        className={clsx(inputCls, invalid && 'border-red-400')}
        value={draft ?? value}
        placeholder={placeholder}
        aria-invalid={invalid}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          if (text.trim() === '') onChange('');
          else if (valid(text)) onChange(text.trim());
        }}
        // A valid draft is already stored; an invalid one stays visible with its hint.
        onBlur={() => !invalid && setDraft(null)}
      />
      {invalid && <p className="text-xs text-red-600">Use a full https:// address</p>}
    </>
  );
}

/** SimpleRichTextEditor has no disabled prop: while read-only the wrapper is `inert` (no focus, no typing). */
function RichTextInput({ value, readOnly, onChange }: { value: string; readOnly: boolean; onChange(v: string): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // React 18 doesn't pass a boolean `inert` through, so set the attribute directly.
    if (readOnly) ref.current?.setAttribute('inert', '');
    else ref.current?.removeAttribute('inert');
  }, [readOnly]);
  return (
    <div ref={ref} className={clsx(readOnly && 'opacity-60')} aria-disabled={readOnly || undefined}>
      <SimpleRichTextEditor value={value} onChange={onChange} minHeightClass="min-h-[120px]" />
    </div>
  );
}

/** A slider plus a number box (range), or just the box (number). Commits only clamped values. */
function NumberInput({
  id,
  schema,
  value,
  onChange,
}: {
  id: string;
  schema: SettingSchema;
  value: unknown;
  onChange(v: unknown): void;
}) {
  const current = typeof value === 'number' ? value : undefined;
  const [draft, setDraft] = useState<string | null>(null);

  const commitText = (text: string, final: boolean) => {
    if (text.trim() === '') {
      // An optional number can be cleared; a range keeps its value.
      if (final && schema.type === 'number') onChange(undefined);
      if (final) setDraft(null);
      return;
    }
    const n = clampNumber(schema, Number(text));
    if (n === null) {
      if (final) setDraft(null);
      return;
    }
    // While typing, commit only a value already in range, so "1" on the way to "12" isn't clamped.
    if (final || n === Number(text)) onChange(n);
    if (final) setDraft(null);
  };

  const box = (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      className={schema.type === 'range' ? clsx(inputCls.replace('w-full', ''), 'w-20 shrink-0') : inputCls}
      min={schema.min}
      max={schema.max}
      step={schema.step ?? 'any'}
      value={draft ?? (current === undefined ? '' : String(current))}
      onChange={(e) => {
        setDraft(e.target.value);
        commitText(e.target.value, false);
      }}
      onBlur={(e) => commitText(e.target.value, true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commitText((e.target as HTMLInputElement).value, true);
      }}
    />
  );
  if (schema.type !== 'range') return box;
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        aria-label={schema.label}
        className="min-w-0 flex-1"
        min={schema.min}
        max={schema.max}
        step={schema.step ?? 1}
        value={current ?? schema.min ?? 0}
        onChange={(e) => {
          const n = clampNumber(schema, Number(e.target.value));
          if (n !== null) onChange(n);
        }}
      />
      {box}
    </div>
  );
}

/**
 * An ordered on/off list (`line_list`): one row per line with a switch and up / down arrows (disabled at the ends).
 * Every change writes the whole list. After a move, focus stays on the moved line's arrow (the other one at an end)
 * and the new position is announced.
 */
function LineListInput({
  id,
  schema,
  value,
  onChange,
}: {
  id: string;
  schema: SettingSchema;
  value: unknown;
  onChange(v: LineItem[]): void;
}) {
  const options = schema.options ?? [];
  const ids = options.map((o) => o.value);
  const defaults: LineItem[] = Array.isArray(schema.default) ? (schema.default as LineItem[]) : ids.map((x) => ({ id: x, on: true }));
  const lines = normaliseLineList(value, ids, defaults);
  const labelOf = (lineId: string) => options.find((o) => o.value === lineId)?.label ?? lineId;
  const arrows = useRef(new Map<string, HTMLButtonElement>());
  const [focus, setFocus] = useState<{ id: string; dir: 'up' | 'down' } | null>(null);
  const [said, setSaid] = useState('');
  const order = lines.map((l) => l.id).join(',');

  useEffect(() => {
    if (!focus) return;
    const own = arrows.current.get(`${focus.id}:${focus.dir}`);
    const other = arrows.current.get(`${focus.id}:${focus.dir === 'up' ? 'down' : 'up'}`);
    (own && !own.disabled ? own : other)?.focus();
    setFocus(null);
  }, [focus, order]);

  const move = (from: number, dir: 'up' | 'down') => {
    const to = dir === 'up' ? from - 1 : from + 1;
    if (to < 0 || to >= lines.length) return;
    const next = lines.slice();
    [next[from], next[to]] = [next[to], next[from]];
    onChange(next);
    setFocus({ id: lines[from].id, dir });
    setSaid(`${labelOf(lines[from].id)} moved to position ${to + 1} of ${lines.length}`);
  };

  return (
    <>
      <ul aria-label={schema.label} className="space-y-1">
        {lines.map((line, i) => {
          const label = labelOf(line.id);
          const switchId = `${id}-${line.id}`;
          const arrow = (dir: 'up' | 'down') => (
            <button
              type="button"
              ref={(el) => {
                if (el) arrows.current.set(`${line.id}:${dir}`, el);
                else arrows.current.delete(`${line.id}:${dir}`);
              }}
              aria-label={`Move ${label} ${dir}`}
              disabled={dir === 'up' ? i === 0 : i === lines.length - 1}
              onClick={() => move(i, dir)}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
            >
              {dir === 'up' ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
            </button>
          );
          return (
            <li key={line.id} className="flex items-center gap-2 rounded-md border border-gray-200 bg-white py-1 pl-2.5 pr-1">
              <input
                type="checkbox"
                role="switch"
                id={switchId}
                className="h-4 w-4 shrink-0"
                checked={line.on}
                onChange={(e) => onChange(lines.map((l) => (l.id === line.id ? { ...l, on: e.target.checked } : l)))}
              />
              <label htmlFor={switchId} className={clsx('min-w-0 flex-1 truncate text-sm', line.on ? 'text-gray-800' : 'text-gray-400')}>
                {label}
              </label>
              {arrow('up')}
              {arrow('down')}
            </li>
          );
        })}
      </ul>
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
    </>
  );
}

/** A swatch (always a valid colour) plus a hex box that commits only valid hex; `clearable` adds a Clear button. */
export function ColorInput({
  id,
  value,
  onChange,
  clearable = false,
}: {
  id: string;
  value: string;
  onChange(v: string): void;
  clearable?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const swatch = parseHex(value) ?? '#000000';
  const text = draft ?? value;
  const invalid = draft !== null && parseHex(draft) === null;
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label="Pick a colour"
        className="h-8 w-10 shrink-0 cursor-pointer rounded border border-gray-300 bg-white p-0.5"
        value={swatch}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
      />
      <input
        id={id}
        className={clsx(inputCls, 'font-mono', invalid && 'border-red-400')}
        value={text}
        placeholder={clearable ? 'None' : '#000000'}
        aria-invalid={invalid}
        maxLength={7}
        onChange={(e) => {
          setDraft(e.target.value);
          const hex = parseHex(e.target.value);
          if (hex) onChange(hex);
        }}
        onBlur={() => setDraft(null)}
      />
      {clearable && value ? (
        <button
          type="button"
          onClick={() => {
            setDraft(null);
            onChange('');
          }}
          className="shrink-0 text-xs font-medium text-gray-600 hover:text-gray-900 hover:underline"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}

/** Swatches of the theme's colour schemes; `allowNone` adds "Default" (clears the choice). */
export function SchemePicker({
  value,
  schemes,
  onChange,
  allowNone,
  custom,
  onCustom,
}: {
  value: string;
  schemes: ColorScheme[];
  onChange(v: string): void;
  allowNone?: boolean;
  /** The section's own colours when it uses them (the Custom tile is then selected). */
  custom?: Omit<ColorScheme, 'id' | 'name'> | null;
  /** Shows a Custom tile; called when it is picked. */
  onCustom?: () => void;
}) {
  return (
    <div role="radiogroup" aria-label="Colour scheme" className="grid grid-cols-3 gap-1.5">
      {allowNone && (
        <button
          type="button"
          role="radio"
          aria-checked={!value && !custom}
          onClick={() => onChange('')}
          className={clsx(
            'flex h-14 items-center justify-center rounded-md border text-xs text-gray-600',
            !value && !custom ? 'border-gray-900 ring-1 ring-gray-900' : 'border-gray-300 hover:border-gray-400',
          )}
        >
          Default
        </button>
      )}
      {schemes.map((s, i) => (
        <button
          key={s.id}
          type="button"
          role="radio"
          aria-checked={value === s.id}
          title={i === 0 ? `${s.name}: the theme colours` : s.name}
          onClick={() => onChange(s.id)}
          className={clsx(
            'flex h-14 flex-col items-start justify-between overflow-hidden rounded-md border p-1.5 text-left',
            value === s.id ? 'border-gray-900 ring-1 ring-gray-900' : 'border-gray-300 hover:border-gray-400',
          )}
          style={{ background: s.background, color: s.text }}
        >
          <span className="text-sm font-semibold leading-none">Aa</span>
          <span className="flex w-full items-center justify-between gap-1">
            <span className="truncate text-[10px]">{i === 0 ? `${s.name} · theme` : s.name}</span>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.button }} />
          </span>
        </button>
      ))}
      {onCustom && (
        <button
          type="button"
          role="radio"
          aria-checked={!!custom}
          title="This section's own colours"
          onClick={onCustom}
          className={clsx(
            'flex h-14 flex-col items-start justify-between overflow-hidden rounded-md border p-1.5 text-left',
            custom ? 'border-gray-900 ring-1 ring-gray-900' : 'border-dashed border-gray-400 hover:border-gray-500',
          )}
          style={custom ? { background: custom.background, color: custom.text } : undefined}
        >
          <span className="text-sm font-semibold leading-none">Aa</span>
          <span className="flex w-full items-center justify-between gap-1">
            <span className="truncate text-[10px]">Custom</span>
            {custom && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: custom.button }} />}
          </span>
        </button>
      )}
    </div>
  );
}

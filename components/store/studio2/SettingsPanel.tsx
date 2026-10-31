'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Copy, Trash2 } from 'lucide-react';
import { useToastContext } from '@/contexts/ToastContext';
import {
  OP_ERROR_TEXT,
  duplicateBlock,
  duplicateSection,
  getGroup,
  removeBlock,
  removeSection,
  setBlockSetting,
  setSchemeColor,
  setSectionSetting,
  setThemeSetting,
  updateSection,
  type OpResult,
  type SectionRef,
} from '@/lib/store/engine/editor/ops';
import {
  SCHEME_COLOR_FIELDS,
  lengthCounter,
  schemeMergeKey,
  settingMergeKey,
  settingValue,
  themeSettingValue,
  visibleSettings,
  type FieldTarget,
  type FormScope,
} from '@/lib/store/engine/editor/fields';
import { blockLabel, isEditableSection, sectionLabel } from '@/lib/store/engine/editor/tree';
import { getSectionSchema } from '@/lib/store/engine/registry';
import { THEME_SETTINGS_SCHEMA, lockedThemeSettings } from '@/lib/store/engine/theme-settings-schema';
import { pageHandle } from '@/lib/store/engine/shared';
import type { SettingSchema } from '@/lib/store/engine/schema-types';
import type { ColorScheme, Section, ThemeData, ThemePreset } from '@/lib/store/engine/types';
import { SECTION_CSS_MAX } from '@/lib/store/studio-sections';
import { useStudio2 } from './Studio2Editor';
import { ColorInput, FieldShell, SchemePicker, SettingField } from './fields/SettingField';
import { inputCls } from './fields/pickers';
import { PageSettings } from './PageSettings';

const STRUCTURAL = { mergeKey: null, immediate: true } as const;
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

const actionBtn =
  'inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40';
const dangerBtn =
  'inline-flex items-center gap-1.5 rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40';

export function SettingsPanel({ preset }: { preset?: ThemePreset } = {}) {
  const { theme, templateKey, selection, readOnly } = useStudio2();

  // D22: an open custom page with nothing selected shows its page settings.
  let body: ReactNode = !selection && pageHandle(templateKey) ? <PageSettings key={templateKey} pageKey={templateKey} /> : <Empty />;
  if (selection?.kind === 'theme') {
    body = <ThemePanel preset={preset} />;
  } else if (selection && (selection.kind === 'section' || selection.kind === 'block')) {
    // The Menus editor (kind 'menus' / 'menu') has its own panel.
    const g = getGroup(theme, templateKey, selection.ref.group);
    const section = hasOwn(g.sections, selection.ref.id) ? g.sections[selection.ref.id] : null;
    const key = `${selection.ref.group}:${selection.ref.id}`;
    if (section && selection.kind === 'section') {
      body = <SectionPanel key={key} sref={selection.ref} section={section} />;
    } else if (section && selection.kind === 'block' && hasOwn(section.blocks, selection.blockId)) {
      const blockKey = `${key}:${selection.blockId}`;
      body = <BlockPanel key={blockKey} sref={selection.ref} section={section} blockId={selection.blockId} />;
    }
  }

  // A disabled fieldset disables every native control inside while the editor is read-only.
  return (
    <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
      {body}
    </fieldset>
  );
}

function Empty() {
  return <div className="p-4 text-sm text-gray-500">Select a section to edit it.</div>;
}

function useActions() {
  const { apply } = useStudio2();
  const toast = useToastContext();
  return {
    run(fn: (t: ThemeData) => OpResult): string | null {
      let id: string | null = null;
      const err = apply((t) => {
        const r = fn(t);
        if (r.ok && r.id) id = r.id;
        return r;
      }, STRUCTURAL);
      if (err) {
        toast.error(OP_ERROR_TEXT[err]);
        return null;
      }
      return id;
    },
  };
}

function PanelHeader({ title, subtitle, back }: { title: string; subtitle?: string; back?: { label: string; onClick(): void } }) {
  return (
    <div className="border-b border-gray-200 px-4 py-3">
      {back && (
        <button type="button" onClick={back.onClick} className="mb-1 inline-flex items-center gap-0.5 text-xs text-gray-500 hover:text-gray-800">
          <ChevronLeft className="h-3.5 w-3.5" />
          {back.label}
        </button>
      )}
      <h2 className="truncate text-sm font-semibold text-gray-900">{title}</h2>
      {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
    </div>
  );
}

/** One generated field per visible setting, each edit merged under its own key. */
function SettingsForm({
  schemas,
  scope,
  target,
  values,
  onSet,
  locked,
}: {
  schemas: SettingSchema[];
  scope: FormScope;
  target: FieldTarget;
  values: (s: SettingSchema) => unknown;
  onSet: (key: string, value: unknown) => (t: ThemeData) => OpResult | ThemeData;
  /** Setting id to the text shown under it when the preset fixes it (theme settings only). */
  locked?: Readonly<Record<string, string>>;
}) {
  const { apply, readOnly, categories, pages, theme } = useStudio2();
  const toast = useToastContext();
  const prefix = settingMergeKey(target, '').replace(/[^a-zA-Z0-9_-]/g, '-');
  const fields = visibleSettings(schemas, scope);
  if (fields.length === 0) return <p className="text-sm text-gray-500">This item has no settings.</p>;
  return (
    <div className="space-y-4">
      {fields.map((s) => {
        const lockText = locked && hasOwn(locked, s.id) ? locked[s.id] : undefined;
        return (
          <SettingField
            key={s.id}
            schema={s}
            // A locked toggle is always on (Quick's phone kit), whatever the stored value says.
            value={lockText && s.type === 'checkbox' ? true : values(s)}
            locked={lockText}
            fieldId={`s2-${prefix}${s.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
            readOnly={readOnly}
            categories={categories}
            pages={pages}
            colorSchemes={theme.settings.color_schemes}
            onChange={(v) => {
              const err = apply(onSet(s.id, v), { mergeKey: settingMergeKey(target, s.id), immediate: false });
              if (err) toast.error(OP_ERROR_TEXT[err]);
            }}
          />
        );
      })}
    </div>
  );
}

function SectionPanel({ sref, section }: { sref: SectionRef; section: Section }) {
  const { templateKey, select } = useStudio2();
  const actions = useActions();
  const schema = getSectionSchema(section.type);

  const remove = () => {
    if (!window.confirm(`Remove ${sectionLabel(section)}?`)) return;
    actions.run((t) => removeSection(t, templateKey, sref));
  };

  if (!schema || !isEditableSection(section)) {
    return (
      <div>
        <PanelHeader title={sectionLabel(section)} />
        <div className="space-y-3 p-4">
          <p className="text-sm text-gray-700">This section type isn&apos;t available any more. You can remove it.</p>
          <button type="button" className={dangerBtn} onClick={remove}>
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
        </div>
      </div>
    );
  }

  const duplicate = () => {
    const id = actions.run((t) => duplicateSection(t, templateKey, sref));
    if (id) select({ kind: 'section', ref: { group: sref.group, id } }, { scroll: true, afterSave: true });
  };

  return (
    <div>
      <PanelHeader title={sectionLabel(section)} subtitle={section.label ? schema.name : undefined} />
      <div className="space-y-5 p-4">
        <SettingsForm
          schemas={schema.settings}
          scope={{ kind: 'section', type: section.type }}
          target={{ kind: 'section', ref: sref }}
          values={(s) => settingValue(section.settings, s)}
          onSet={(key, value) => (t) => setSectionSetting(t, templateKey, sref, key, value)}
        />
        <SectionColours sref={sref} section={section} />
        <Advanced sref={sref} section={section} />
        <div className="flex gap-2 border-t border-gray-100 pt-4">
          <button type="button" className={actionBtn} onClick={duplicate}>
            <Copy className="h-3.5 w-3.5" />
            Duplicate
          </button>
          <button type="button" className={dangerBtn} onClick={remove}>
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The section's colour scheme, out in the open: the scheme tiles, and the chosen scheme's own colours (scheme 1,
 * the theme colours, for Default) editable in place. A scheme is shared, so the note says what else changes.
 */
function SectionColours({ sref, section }: { sref: SectionRef; section: Section }) {
  const { apply, templateKey, theme } = useStudio2();
  const toast = useToastContext();
  const [editing, setEditing] = useState(false);
  const schemes = theme.settings.color_schemes;
  const chosen = schemes.find((c) => c.id === section.color_scheme) ?? null;
  const shown = chosen ?? schemes[0];
  const custom = section.custom_colors && Object.keys(section.custom_colors).length ? section.custom_colors : null;
  const patch = (p: Parameters<typeof updateSection>[3], key: string, immediate: boolean) => {
    const err = apply((t) => updateSection(t, templateKey, sref, p), {
      mergeKey: settingMergeKey({ kind: 'section', ref: sref }, key),
      immediate,
    });
    if (err) toast.error(OP_ERROR_TEXT[err]);
  };
  // A scheme tile (or Default) replaces any custom colours; Custom starts from the colours the section shows now.
  const setScheme = (value: string) => patch({ color_scheme: value, custom_colors: undefined }, 'color_scheme', true);
  const startCustom = () => {
    if (!shown) return;
    const { id: _id, name: _name, ...colors } = shown;
    patch({ custom_colors: { ...colors, ...(custom ?? {}) } }, 'custom_colors', true);
  };
  const setCustom = (field: (typeof SCHEME_COLOR_FIELDS)[number]['key'], hex: string) =>
    patch({ custom_colors: { ...(custom ?? {}), [field]: hex } }, `custom_colors.${field}`, false);
  if (!shown) return null;
  return (
    <div className="space-y-2 border-t border-gray-100 pt-4">
      <FieldShell label="Colours">
        <SchemePicker
          allowNone
          value={custom ? '' : section.color_scheme ?? ''}
          schemes={schemes}
          onChange={setScheme}
          custom={custom ? { ...shown, ...custom } : null}
          onCustom={startCustom}
        />
      </FieldShell>
      {custom ? (
        <div className="space-y-3 rounded-md border border-gray-200 p-3">
          <p className="text-[11px] text-gray-500">This section&apos;s own colours. Type a hex code or pick a colour.</p>
          {SCHEME_COLOR_FIELDS.map((f) => {
            const id = `s2-custom-${sref.group}-${sref.id}-${f.key}`;
            return (
              <FieldShell key={f.key} label={f.label} htmlFor={id}>
                <ColorInput id={id} value={custom[f.key] ?? shown[f.key]} onChange={(hex) => setCustom(f.key, hex)} />
              </FieldShell>
            );
          })}
        </div>
      ) : null}
      <p className="text-[11px] text-gray-500">
        Default keeps the theme style&apos;s own look. A scheme paints the whole section in its colours; “{schemes[0]?.name} · theme”
        is the theme colours. Custom sets this section&apos;s colours only.
      </p>
      {!custom && <button
        type="button"
        aria-expanded={editing}
        onClick={() => setEditing((o) => !o)}
        className="inline-flex items-center gap-1 text-xs font-medium text-gray-700 hover:text-gray-900"
      >
        {editing ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {chosen ? `Edit “${chosen.name}” colours` : 'Edit theme colours'}
      </button>}
      {editing && !custom && (
        <div className="space-y-3 rounded-md border border-gray-200 p-3">
          <p className="text-[11px] text-gray-500">
            {chosen ? `Changes every section that uses “${chosen.name}”.` : 'Changes the whole store and every section on Default.'}
          </p>
          <SchemeColorFields scheme={shown} apply={apply} />
        </div>
      )}
    </div>
  );
}

function Advanced({ sref, section }: { sref: SectionRef; section: Section }) {
  const { apply, templateKey } = useStudio2();
  const toast = useToastContext();
  const [open, setOpen] = useState(false);
  const base = `s2-adv-${sref.group}-${sref.id}`;
  const set = (key: 'css_class' | 'custom_css', value: string) => {
    const err = apply((t) => updateSection(t, templateKey, sref, { [key]: value }), {
      mergeKey: settingMergeKey({ kind: 'section', ref: sref }, key),
      immediate: false,
    });
    if (err) toast.error(OP_ERROR_TEXT[err]);
  };

  return (
    <div className="border-t border-gray-100 pt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-800"
      >
        Advanced
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {open && (
        <div className="mt-3 space-y-4">
          <FieldShell label="CSS class" htmlFor={`${base}-class`}>
            <input
              id={`${base}-class`}
              className={`${inputCls} font-mono`}
              value={section.css_class ?? ''}
              placeholder="my-section"
              onChange={(e) => set('css_class', e.target.value)}
            />
          </FieldShell>
          <FieldShell
            label="Custom CSS"
            htmlFor={`${base}-css`}
            info="Scoped to this section"
            counter={lengthCounter(section.custom_css ?? '', SECTION_CSS_MAX)}
          >
            <textarea
              id={`${base}-css`}
              rows={5}
              spellCheck={false}
              className={`${inputCls} font-mono text-xs`}
              value={section.custom_css ?? ''}
              maxLength={SECTION_CSS_MAX}
              placeholder="h2 { letter-spacing: 0.02em; }"
              onChange={(e) => set('custom_css', e.target.value)}
            />
          </FieldShell>
        </div>
      )}
    </div>
  );
}

function BlockPanel({ sref, section, blockId }: { sref: SectionRef; section: Section; blockId: string }) {
  const { templateKey, select } = useStudio2();
  const actions = useActions();
  const block = section.blocks[blockId];
  const bs = getSectionSchema(section.type)?.blocks?.find((b) => b.type === block.type);
  const label = blockLabel(section.type, block);
  const back = { label: sectionLabel(section), onClick: () => select({ kind: 'section', ref: sref }) };

  const remove = () => {
    if (!window.confirm(`Remove ${label}?`)) return;
    actions.run((t) => removeBlock(t, templateKey, sref, blockId));
  };

  if (!bs) {
    return (
      <div>
        <PanelHeader title={label} back={back} />
        <div className="space-y-3 p-4">
          <p className="text-sm text-gray-700">This block type isn&apos;t available any more. You can remove it.</p>
          <button type="button" className={dangerBtn} onClick={remove}>
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
        </div>
      </div>
    );
  }

  const duplicate = () => {
    const id = actions.run((t) => duplicateBlock(t, templateKey, sref, blockId));
    if (id) select({ kind: 'block', ref: sref, blockId: id }, { scroll: true });
  };

  return (
    <div>
      <PanelHeader title={label} back={back} />
      <div className="space-y-5 p-4">
        <SettingsForm
          schemas={bs.settings}
          scope={{ kind: 'block' }}
          target={{ kind: 'block', ref: sref, blockId }}
          values={(s) => settingValue(block.settings, s)}
          onSet={(key, value) => (t) => setBlockSetting(t, templateKey, sref, blockId, key, value)}
        />
        <div className="flex gap-2 border-t border-gray-100 pt-4">
          <button type="button" className={actionBtn} onClick={duplicate}>
            <Copy className="h-3.5 w-3.5" />
            Duplicate
          </button>
          <button type="button" className={dangerBtn} onClick={remove}>
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

function ThemePanel({ preset }: { preset?: ThemePreset }) {
  const { theme, apply } = useStudio2();
  return (
    <div>
      <PanelHeader title="Theme settings" subtitle="Applies to the whole store" />
      <div className="space-y-6 p-4">
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Colour schemes</h3>
          <p className="text-[11px] text-gray-500">
            The first scheme is the store&apos;s own colours. Each section picks a scheme under Colours.
          </p>
          {theme.settings.color_schemes.map((scheme, i) => (
            <SchemeEditor key={scheme.id} schemeId={scheme.id} apply={apply} defaultOpen={i === 0} />
          ))}
        </div>
        <div className="border-t border-gray-100 pt-4">
          <SettingsForm
            schemas={THEME_SETTINGS_SCHEMA}
            scope={{ kind: 'theme' }}
            target={{ kind: 'theme' }}
            values={(s) => themeSettingValue(theme.settings, s)}
            onSet={(key, value) => (t) => setThemeSetting(t, key, value)}
            locked={lockedThemeSettings(preset)}
          />
        </div>
      </div>
    </div>
  );
}

function SchemeEditor({
  schemeId,
  apply,
  defaultOpen = false,
}: {
  schemeId: string;
  apply: ReturnType<typeof useStudio2>['apply'];
  defaultOpen?: boolean;
}) {
  const { theme } = useStudio2();
  const [open, setOpen] = useState(defaultOpen);
  const scheme = theme.settings.color_schemes.find((s) => s.id === schemeId);
  if (!scheme) return null;
  return (
    <div className="rounded-md border border-gray-200">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
      >
        <span className="flex shrink-0 overflow-hidden rounded border border-gray-200">
          {SCHEME_COLOR_FIELDS.slice(0, 4).map((f) => (
            <span key={f.key} className="h-4 w-3" style={{ background: scheme[f.key] }} />
          ))}
        </span>
        <span className="min-w-0 flex-1 truncate">{scheme.name}</span>
        {open ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
      </button>
      {open && (
        <div className="space-y-3 border-t border-gray-100 p-3">
          <SchemeColorFields scheme={scheme} apply={apply} />
        </div>
      )}
    </div>
  );
}

/** A scheme's seven colours, each with a picker. */
function SchemeColorFields({ scheme, apply }: { scheme: ColorScheme; apply: ReturnType<typeof useStudio2>['apply'] }) {
  return (
    <>
      {SCHEME_COLOR_FIELDS.map((f) => {
        const id = `s2-scheme-${scheme.id}-${f.key}`;
        return (
          <FieldShell key={f.key} label={f.label} htmlFor={id}>
            <ColorInput
              id={id}
              value={scheme[f.key]}
              onChange={(hex) => apply((t) => setSchemeColor(t, scheme.id, f.key, hex), { mergeKey: schemeMergeKey(scheme.id, f.key), immediate: false })}
            />
          </FieldShell>
        );
      })}
    </>
  );
}

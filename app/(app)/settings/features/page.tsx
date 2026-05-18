'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Layout, Moon, Palette } from 'lucide-react';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import {
  DEFAULT_PORTAL_THEME,
  PORTAL_FONT_PRESETS,
  parseHexColorInput,
  type PortalFontPreset,
  type PortalTheme,
} from '@/lib/portal-theme';

const PRESET_PRIMARY: { label: string; hex: string }[] = [
  { label: 'Teal', hex: '#0d9488' },
  { label: 'Blue', hex: '#2563eb' },
  { label: 'Indigo', hex: '#4f46e5' },
  { label: 'Violet', hex: '#7c3aed' },
  { label: 'Rose', hex: '#e11d48' },
  { label: 'Amber', hex: '#d97706' },
];

const PRESET_ACCENT: { label: string; hex: string }[] = [
  { label: 'Teal', hex: '#00796b' },
  { label: 'Blue', hex: '#0369a1' },
  { label: 'Slate', hex: '#475569' },
  { label: 'Emerald', hex: '#047857' },
  { label: 'Orange', hex: '#c2410c' },
  { label: 'Violet', hex: '#6d28d9' },
];

const FONT_LABELS: Record<PortalFontPreset, string> = {
  inter: 'Inter',
  system: 'System UI',
  dm_sans: 'DM Sans',
  source_sans: 'Source Sans 3',
};

function ColorField({
  label,
  description,
  value,
  draft,
  onDraftChange,
  onPickerChange,
  onHexBlur,
  disabled,
  presets,
}: {
  label: string;
  description?: string;
  value: string;
  draft: string;
  onDraftChange: (v: string) => void;
  onPickerChange: (v: string) => void;
  onHexBlur: () => void;
  disabled: boolean;
  presets: { label: string; hex: string }[];
}) {
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-text-primary">{label}</p>
      {description && <p className="mb-2 text-xs text-text-secondary">{description}</p>}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="color"
            value={value}
            onChange={(e) => onPickerChange(e.target.value)}
            disabled={disabled}
            className="h-11 w-16 cursor-pointer rounded border border-border bg-surface disabled:opacity-50"
            aria-label={`${label} — color picker`}
          />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-muted">Hex</label>
            <input
              type="text"
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onBlur={onHexBlur}
              disabled={disabled}
              spellCheck={false}
              placeholder="#0d9488 or #0d8"
              className="input w-40 max-w-full py-2 font-mono text-sm uppercase"
              aria-label={`${label} — hex code`}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-text-muted">Quick:</span>
          {presets.map((p) => (
            <button
              key={`${label}-${p.hex}`}
              type="button"
              disabled={disabled}
              title={p.label}
              onClick={() => onPickerChange(p.hex)}
              className="h-7 w-7 rounded-full border-2 border-border shadow-sm transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:pointer-events-none disabled:opacity-50"
              style={{ backgroundColor: p.hex }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function UIFeaturesSettingsPage() {
  const { portalTheme, refresh, permissions } = useAuth();
  const toast = useToastContext();
  const canModify = permissions?.settings?.can_modify ?? false;

  const [primaryHex, setPrimaryHex] = useState(DEFAULT_PORTAL_THEME.primary_hex);
  const [primaryDraft, setPrimaryDraft] = useState(DEFAULT_PORTAL_THEME.primary_hex);
  const [accentHex, setAccentHex] = useState(DEFAULT_PORTAL_THEME.accent_hex);
  const [accentDraft, setAccentDraft] = useState(DEFAULT_PORTAL_THEME.accent_hex);
  const [fontPreset, setFontPreset] = useState<PortalFontPreset>(DEFAULT_PORTAL_THEME.font_preset);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (portalTheme) {
      setPrimaryHex(portalTheme.primary_hex);
      setPrimaryDraft(portalTheme.primary_hex);
      setAccentHex(portalTheme.accent_hex);
      setAccentDraft(portalTheme.accent_hex);
      setFontPreset(portalTheme.font_preset);
    }
  }, [portalTheme]);

  const commitPrimaryDraft = useCallback(() => {
    const p = parseHexColorInput(primaryDraft);
    if (p) {
      setPrimaryHex(p);
      setPrimaryDraft(p);
    } else {
      toast.error('Primary: use #RGB or #RRGGBB (e.g. #e11 or #e11d48)');
      setPrimaryDraft(primaryHex);
    }
  }, [primaryDraft, primaryHex, toast]);

  const commitAccentDraft = useCallback(() => {
    const p = parseHexColorInput(accentDraft);
    if (p) {
      setAccentHex(p);
      setAccentDraft(p);
    } else {
      toast.error('Accent: use #RGB or #RRGGBB');
      setAccentDraft(accentHex);
    }
  }, [accentDraft, accentHex, toast]);

  const save = useCallback(async () => {
    if (!canModify) return;
    const pPrimary = parseHexColorInput(primaryDraft) ?? primaryHex;
    const pAccent = parseHexColorInput(accentDraft) ?? accentHex;
    if (!parseHexColorInput(primaryDraft)) {
      toast.error('Fix primary hex before saving');
      return;
    }
    if (!parseHexColorInput(accentDraft)) {
      toast.error('Fix accent hex before saving');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/settings/portal-theme', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          portal_theme: {
            primary_hex: pPrimary,
            accent_hex: pAccent,
            font_preset: fontPreset,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === 'string' ? data.error : 'Could not save theme');
        return;
      }
      setPrimaryHex(pPrimary);
      setPrimaryDraft(pPrimary);
      setAccentHex(pAccent);
      setAccentDraft(pAccent);
      toast.success('Portal appearance saved for your organization');
      await refresh();
    } catch {
      toast.error('Could not save theme');
    } finally {
      setSaving(false);
    }
  }, [canModify, primaryDraft, accentDraft, primaryHex, accentHex, fontPreset, refresh, toast]);

  const resetOrgTheme = useCallback(async () => {
    if (!canModify) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings/portal-theme', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ reset: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === 'string' ? data.error : 'Could not reset theme');
        return;
      }
      const pt = data.portalTheme as PortalTheme | undefined;
      if (pt) {
        setPrimaryHex(pt.primary_hex);
        setPrimaryDraft(pt.primary_hex);
        setAccentHex(pt.accent_hex);
        setAccentDraft(pt.accent_hex);
        setFontPreset(pt.font_preset);
      }
      toast.success('Reset to default appearance');
      await refresh();
    } catch {
      toast.error('Could not reset theme');
    } finally {
      setSaving(false);
    }
  }, [canModify, refresh, toast]);

  return (
    <div className={`${SETTINGS_CONTENT_WIDTH} space-y-8`}>
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Link href="/settings" className="transition hover:text-primary-600">
          Settings
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-text-muted">Module settings</span>
        <ChevronRight className="h-4 w-4" />
        <span className="font-medium text-text-primary">UI features</span>
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-slate-100 p-3 dark:bg-slate-800/40">
            <Layout className="h-6 w-6 text-primary-600 dark:text-primary-300" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">UI features</h1>
            <p className="mt-1 max-w-3xl text-text-secondary">
              Personal color scheme (this device) and organization-wide portal branding for everyone in your business.
            </p>
          </div>
        </div>
      </div>

      <Card className="p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
              <Moon className="h-5 w-5 text-slate-600 dark:text-slate-300" />
            </div>
            <div>
              <h2 className="font-semibold text-text-primary">Color scheme (this device)</h2>
              <p className="mt-0.5 text-sm text-text-secondary">
                Light or dark mode is stored only in this browser. You can use the same control in the top bar.
              </p>
            </div>
          </div>
          <ThemeToggle showLabel className="self-start rounded-xl border border-border bg-surface px-4 py-2.5 sm:self-center" />
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-50 dark:bg-slate-800/35">
            <Palette className="h-5 w-5 text-primary-600 dark:text-primary-300" />
          </div>
          <div className="min-w-0 flex-1 space-y-6">
            <div>
              <h2 className="font-semibold text-text-primary">Organization portal appearance</h2>
              <p className="mt-0.5 text-sm text-text-secondary">
                Primary drives navigation and main actions. Accent is used for secondary actions and highlights (e.g.
                dashboard receivables). Use the picker or type a hex code (#RGB or #RRGGBB).
              </p>
            </div>

            {!canModify && (
              <p className="text-sm text-amber-800 dark:text-amber-200/90">
                You can view these options, but only users with permission to change settings can save them.
              </p>
            )}

            <ColorField
              label="Primary color"
              description="Main brand: sidebar active states, primary buttons, links."
              value={primaryHex}
              draft={primaryDraft}
              onDraftChange={setPrimaryDraft}
              onPickerChange={(v) => {
                setPrimaryHex(v);
                setPrimaryDraft(v);
              }}
              onHexBlur={commitPrimaryDraft}
              disabled={!canModify}
              presets={PRESET_PRIMARY}
            />

            <ColorField
              label="Accent color"
              description="Secondary brand: alternate buttons, KPI wells, receivables/payables “current” rows."
              value={accentHex}
              draft={accentDraft}
              onDraftChange={setAccentDraft}
              onPickerChange={(v) => {
                setAccentHex(v);
                setAccentDraft(v);
              }}
              onHexBlur={commitAccentDraft}
              disabled={!canModify}
              presets={PRESET_ACCENT}
            />

            <div>
              <label htmlFor="portal-font" className="mb-2 block text-sm font-medium text-text-primary">
                Font
              </label>
              <select
                id="portal-font"
                value={fontPreset}
                onChange={(e) => setFontPreset(e.target.value as PortalFontPreset)}
                disabled={!canModify}
                className="input max-w-md py-2"
              >
                {PORTAL_FONT_PRESETS.map((k) => (
                  <option key={k} value={k}>
                    {FONT_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button type="button" disabled={!canModify || saving} onClick={save}>
                {saving ? 'Saving…' : 'Save for organization'}
              </Button>
              <Button type="button" variant="outline" disabled={!canModify || saving} onClick={resetOrgTheme}>
                Reset to defaults
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default withPageAuth('settings', 'read', UIFeaturesSettingsPage);

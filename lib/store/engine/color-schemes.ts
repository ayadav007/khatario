import type { ColorScheme } from './types';
import { isHexColor } from './settings';

export const DEFAULT_COLOR_SCHEMES: ColorScheme[] = [
  { id: 'scheme-1', name: 'Light', background: '#ffffff', text: '#111827', accent: '#2563eb', button: '#2563eb', button_text: '#ffffff', border: '#e5e7eb', card: '#ffffff' },
  { id: 'scheme-2', name: 'Soft (tinted)', background: '#f3f4f6', text: '#111827', accent: '#2563eb', button: '#111827', button_text: '#ffffff', border: '#d1d5db', card: '#ffffff' },
  { id: 'scheme-3', name: 'Dark', background: '#111827', text: '#f9fafb', accent: '#60a5fa', button: '#60a5fa', button_text: '#111827', border: '#374151', card: '#1f2937' },
  { id: 'scheme-4', name: 'Accent', background: '#2563eb', text: '#ffffff', accent: '#ffffff', button: '#ffffff', button_text: '#2563eb', border: '#3b82f6', card: '#1d4ed8' },
  { id: 'scheme-5', name: 'Cream', background: '#faf5eb', text: '#3b2f23', accent: '#b45309', button: '#b45309', button_text: '#ffffff', border: '#e7dcc8', card: '#fffaf0' },
  { id: 'scheme-6', name: 'Ink', background: '#000000', text: '#ffffff', accent: '#fbbf24', button: '#fbbf24', button_text: '#000000', border: '#262626', card: '#0a0a0a' },
];

const COLOR_FIELDS = ['background', 'text', 'accent', 'button', 'button_text', 'border', 'card'] as const;

export function sanitizeColorSchemes(raw: unknown, accent?: string): ColorScheme[] {
  const list = Array.isArray(raw) ? raw.slice(0, DEFAULT_COLOR_SCHEMES.length) : [];
  const count = list.length || DEFAULT_COLOR_SCHEMES.length;
  const out: ColorScheme[] = [];
  for (let i = 0; i < count; i++) {
    const base = DEFAULT_COLOR_SCHEMES[i];
    const item = list[i] && typeof list[i] === 'object' ? (list[i] as Record<string, unknown>) : {};
    const scheme: ColorScheme = { ...base };
    if (typeof item.name === 'string' && item.name.trim()) scheme.name = item.name.trim().slice(0, 40);
    for (const f of COLOR_FIELDS) {
      const v = item[f];
      if (typeof v === 'string' && v !== '' && isHexColor(v)) scheme[f] = v;
    }
    out.push(scheme);
  }
  if (accent && isHexColor(accent)) {
    out[0] = { ...out[0], accent, button: accent };
  }
  return out;
}

export function schemeCssVars(scheme: ColorScheme, isPrimary: boolean): Record<string, string> {
  const vars: Record<string, string> = {
    '--c-bg': scheme.background,
    '--c-text': scheme.text,
    '--c-accent': scheme.accent,
    '--c-btn': scheme.button,
    '--c-btn-text': scheme.button_text,
    '--c-border': scheme.border,
    '--c-card': scheme.card,
  };
  if (isPrimary) vars['--primary'] = scheme.accent;
  return vars;
}

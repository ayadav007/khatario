import type { CSSProperties } from 'react';

type Palette = Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900, string>;

/** Brand colour presets. "teal" is the product default and applies no overrides. */
export const BRAND_PALETTES: Record<string, { label: string; palette: Palette | null }> = {
  teal: { label: 'Khatario teal (default)', palette: null },
  emerald: {
    label: 'Emerald',
    palette: { 50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399', 500: '#10b981', 600: '#059669', 700: '#047857', 800: '#065f46', 900: '#064e3b' },
  },
  blue: {
    label: 'Blue',
    palette: { 50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd', 400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8', 800: '#1e40af', 900: '#1e3a8a' },
  },
  indigo: {
    label: 'Indigo',
    palette: { 50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc', 400: '#818cf8', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca', 800: '#3730a3', 900: '#312e81' },
  },
  violet: {
    label: 'Violet',
    palette: { 50: '#f5f3ff', 100: '#ede9fe', 200: '#ddd6fe', 300: '#c4b5fd', 400: '#a78bfa', 500: '#8b5cf6', 600: '#7c3aed', 700: '#6d28d9', 800: '#5b21b6', 900: '#4c1d95' },
  },
  rose: {
    label: 'Rose',
    palette: { 50: '#fff1f2', 100: '#ffe4e6', 200: '#fecdd3', 300: '#fda4af', 400: '#fb7185', 500: '#f43f5e', 600: '#e11d48', 700: '#be123c', 800: '#9f1239', 900: '#881337' },
  },
  orange: {
    label: 'Orange',
    palette: { 50: '#fff7ed', 100: '#ffedd5', 200: '#fed7aa', 300: '#fdba74', 400: '#fb923c', 500: '#f97316', 600: '#ea580c', 700: '#c2410c', 800: '#9a3412', 900: '#7c2d12' },
  },
  slate: {
    label: 'Graphite',
    palette: { 50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8', 500: '#64748b', 600: '#334155', 700: '#1e293b', 800: '#0f172a', 900: '#020617' },
  },
};

export const HEADING_FONTS: Record<string, { label: string; stack: string | null }> = {
  default: { label: 'Inter (default)', stack: null },
  serif: { label: 'Serif (Georgia)', stack: 'Georgia, Cambria, "Times New Roman", serif' },
  rounded: { label: 'Rounded', stack: 'ui-rounded, "SF Pro Rounded", "Nunito", var(--font-inter), sans-serif' },
  mono: { label: 'Monospace', stack: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
};

export const BRAND_COLOR_OPTIONS = Object.entries(BRAND_PALETTES).map(([value, p]) => ({ value, label: p.label }));
export const HEADING_FONT_OPTIONS = Object.entries(HEADING_FONTS).map(([value, f]) => ({ value, label: f.label }));

/** CSS custom properties for the page wrapper; Tailwind `primary-*` reads these variables. */
export function brandStyle(brandColor?: string, headingFont?: string): CSSProperties {
  const style: Record<string, string> = {};
  const palette = brandColor ? BRAND_PALETTES[brandColor]?.palette : null;
  if (palette) {
    for (const [shade, hex] of Object.entries(palette)) style[`--color-primary-${shade}`] = hex;
  }
  const stack = headingFont ? HEADING_FONTS[headingFont]?.stack : null;
  if (stack) style['--mb-heading-font'] = stack;
  return style as CSSProperties;
}

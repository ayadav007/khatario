import type { ThemeData, ThemePreset } from '../types';
import { studioPreset } from './studio';
import { blankPreset } from './blank';

export interface PresetContext {
  businessName: string;
  tagline: string;
  accent?: string;
  logoUrl?: string;
  heroUrl?: string;
}

export function presetTheme(preset: ThemePreset, ctx: PresetContext): ThemeData {
  switch (preset) {
    case 'blank':
      return blankPreset(ctx);
    // quick, grocery and khatario get their own presets in M4; until then they start from studio.
    case 'quick':
    case 'grocery':
    case 'khatario':
    case 'studio':
    default:
      return studioPreset(ctx);
  }
}

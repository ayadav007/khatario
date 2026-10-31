import type { ThemeData, ThemePreset } from '../types';
import { studioPreset } from './studio';
import { blankPreset } from './blank';
import { quickPreset } from './quick';
import { groceryPreset } from './grocery';
import { khatarioPreset } from './khatario';

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
    case 'quick':
      return quickPreset(ctx);
    case 'grocery':
      return groceryPreset(ctx);
    case 'khatario':
      return khatarioPreset(ctx);
    case 'studio':
    default:
      return studioPreset(ctx);
  }
}

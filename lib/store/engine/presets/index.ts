import type { ThemeData, ThemePreset } from '../types';
import { studioPreset } from './studio';
import { blankPreset } from './blank';
import { quickPreset } from './quick';
import { groceryPreset } from './grocery';
import { khatarioPreset } from './khatario';
import { convertLegacyMenus } from '../menus-sanitize';

export interface PresetContext {
  businessName: string;
  tagline: string;
  accent?: string;
  logoUrl?: string;
  heroUrl?: string;
}

function buildPreset(preset: ThemePreset, ctx: PresetContext): ThemeData {
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

/**
 * A preset's theme. The preset files still lay out the header and footer links as `menu_link` / `link_column` blocks;
 * they become the `main` and `footer` menus here, so every preset is already what `sanitizeThemeData` keeps.
 */
export function presetTheme(preset: ThemePreset, ctx: PresetContext): ThemeData {
  return convertLegacyMenus(buildPreset(preset, ctx) as unknown as Record<string, unknown>) as unknown as ThemeData;
}

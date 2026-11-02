import type { ThemeData, ThemePreset } from '../types';
import { studioPreset } from './studio';
import { blankPreset } from './blank';
import { quickPreset } from './quick';
import { groceryPreset } from './grocery';
import { khatarioPreset } from './khatario';
import { heritagePreset } from './heritage';
import { dropPreset } from './drop';
import { convertLegacyMenus } from '../menus-sanitize';
import { convertLegacyHeroSections } from '../hero-convert';

export interface PresetContext {
  businessName: string;
  tagline: string;
  /** Only a migrated store's own colour; an added theme leaves it out and starts in the preset's own colours. */
  accent?: string;
  logoUrl?: string;
  heroUrl?: string;
  /** Replacements for a preset's own sample pictures, by name (Heritage's hero-1, gallery-2, story…); demo stores use it. */
  images?: Record<string, string>;
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
    case 'heritage':
      return heritagePreset(ctx);
    case 'drop':
      return dropPreset(ctx);
    case 'studio':
    default:
      return studioPreset(ctx);
  }
}

/**
 * A preset's theme. The preset files still lay out the header and footer links as `menu_link` / `link_column` blocks;
 * they become the `main` and `footer` menus here, so every preset is already what `sanitizeThemeData` keeps. Old Image
 * banner settings become Hero banner blocks the same way.
 */
export function presetTheme(preset: ThemePreset, ctx: PresetContext): ThemeData {
  return convertLegacyHeroSections(convertLegacyMenus(buildPreset(preset, ctx) as unknown as Record<string, unknown>)) as unknown as ThemeData;
}

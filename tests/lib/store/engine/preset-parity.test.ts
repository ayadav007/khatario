import fs from 'fs';
import path from 'path';
import { presetTheme } from '@/lib/store/engine/presets';
import { PAGE_STARTERS } from '@/lib/store/engine/presets/templates';
import { sanitizeThemeData } from '@/lib/store/engine/sanitize';
import { convertLegacyTextSections } from '@/lib/store/engine/text-sections-convert';
import type { ThemePreset } from '@/lib/store/engine/types';

// The fixtures were captured before Image with text and Rich text became block-based. Loading one converts its text
// sections to blocks and adds the style defaults, so it must equal what the rewritten preset produces now.

const CTX = { businessName: 'Fixture Store', tagline: 'Fixture tagline', accent: '#b94717' };
const FIXTURES = path.join(__dirname, 'fixtures', 'presets-before');
const load = (name: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));

type Raw = Record<string, any>;

/** Template section ids are random per call; rename them by position (s0, s1, ...) so two themes compare. */
function normaliseIds(theme: Raw): Raw {
  const out: Raw = JSON.parse(JSON.stringify(theme));
  for (const tpl of Object.values<Raw>(out.templates ?? {})) {
    const sections: Raw = {};
    tpl.order = (tpl.order as string[]).map((id, i) => {
      sections[`s${i}`] = tpl.sections[id];
      return `s${i}`;
    });
    tpl.sections = sections;
  }
  return out;
}

const sectionsOf = (tpl: Raw): Raw[] => (tpl.order as string[]).map((id) => tpl.sections[id]);

/** A theme holding `sections` in order on one custom page. */
function wrapSections(sections: Raw[]): Raw {
  const order = sections.map((_, i) => `s${i}`);
  return { templates: { 'page.fixture': { order, sections: Object.fromEntries(order.map((id, i) => [id, sections[i]])) } } };
}

describe('preset parity', () => {
  it.each(['studio', 'quick', 'grocery', 'khatario', 'blank'] as ThemePreset[])(
    "%s: converting yesterday's preset equals today's preset",
    (preset) => {
      const now = normaliseIds(sanitizeThemeData(presetTheme(preset, CTX)));
      const before = normaliseIds(sanitizeThemeData(load(preset)));
      expect(before).toEqual(now);
    },
  );

  it('the id normalisation does not hide a changed section', () => {
    const a = normaliseIds(sanitizeThemeData(presetTheme('khatario', CTX)));
    const b = normaliseIds(sanitizeThemeData(presetTheme('khatario', CTX)));
    expect(a).toEqual(b);
    b.templates.home.sections.s0.type = 'something-else';
    expect(a).not.toEqual(b);
  });

  it.each(['about', 'sale', 'contact', 'blank'] as const)('starter %s matches its converted fixture', (name) => {
    const fixture = load(`starter-${name}`).sections as Raw[];
    const converted = sanitizeThemeData(convertLegacyTextSections(wrapSections(fixture)));
    const now = sanitizeThemeData(wrapSections(sectionsOf(PAGE_STARTERS[name].build() as unknown as Raw)));
    expect(sectionsOf(converted.templates['page.fixture'])).toEqual(sectionsOf(now.templates['page.fixture']));
  });
});

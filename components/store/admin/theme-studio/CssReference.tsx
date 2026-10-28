'use client';

import type { StudioSectionType } from './studio-map';

/** Class names Studio sections promise to keep, so merchant CSS keeps working across theme updates. */
const SECTION_CLASSES: Record<StudioSectionType, Array<[string, string]>> = {
  announcement: [['.announce', 'the bar'], ['.announceMain', 'main message']],
  header: [['.header', 'logo row'], ['.logo', 'store name and logo'], ['.search', 'search box'], ['.nav', 'menu row'], ['.nav .on', 'current menu link']],
  hero: [['.hero', 'whole hero'], ['.heroCopy h1', 'heading'], ['.heroCopy p', 'description'], ['.st-btn', 'button'], ['.eyebrow', 'small label'], ['.heroImg', 'image area'], ['.heroDots', 'slide dots']],
  categories: [['.catGrid', 'tile grid'], ['.cat', 'one tile'], ['.cat b', 'category name']],
  products: [['.productGrid', 'the grid or row'], ['.product', 'one card'], ['.pimg', 'card image'], ['.pname', 'product name'], ['.price', 'price'], ['.price del', 'MRP'], ['.badges em', 'badges'], ['.prating', 'rating'], ['.addBtn', 'Add button']],
  banner: [['.banner', 'banner box'], ['.banner h2', 'title'], ['.banner p', 'text'], ['.st-btn', 'button']],
  testimonials: [['.quotes', 'quote grid'], ['.quotes blockquote', 'one quote'], ['.quotes b', 'customer name']],
  usp: [['.uspGrid', 'badge row'], ['.uspItem', 'one badge'], ['.uspIcon', 'icon circle'], ['.uspItem b', 'title'], ['.uspItem small', 'text']],
  marquee: [['.marquee', 'the strip'], ['.marqueeRun span', 'one message']],
  footer: [['.st-footer', 'footer'], ['.footerBrand b', 'brand name'], ['.footerLinks', 'links']],
  richtext: [['.rich', 'block'], ['.rich h2', 'heading'], ['.rich p', 'text']],
};

const VARIABLES: Array<[string, string]> = [
  ['--primary', 'brand colour'],
  ['--on-primary', 'text on brand colour'],
  ['--paper', 'page background'],
  ['--text', 'text colour'],
  ['--st-card', 'card background'],
  ['--st-soft', 'soft panel background'],
  ['--st-line', 'borders'],
  ['--st-muted', 'secondary text'],
];

const SECTION_EXAMPLES: Array<[string, string]> = [
  ['Pill buttons', '.st-btn, .addBtn { border-radius: 999px; }'],
  ['Gradient background', '& { background: linear-gradient(135deg, #fde68a, #f9a8d4); }'],
  ['Bigger heading', 'h1, h2 { font-size: 44px; letter-spacing: -1px; }'],
  ['Hide on phones', '@container store (max-width: 640px) {\n  & { display: none; }\n}'],
];

const STORE_EXAMPLES: Array<[string, string]> = [
  ['Accent colour', '.st-root .st-sec { --primary: #7c3aed; }'],
  ['Pill buttons everywhere', '.st-root .st-btn, .st-root .addBtn { border-radius: 999px; }'],
  ['Rounder cards', '.st-root .product { border-radius: 16px; }'],
  ['Style one tagged section', '.st-root .festive-banner .banner { border: 2px dashed var(--primary); }'],
];

/** Class, variable and example list shown under a Custom CSS box; clicking an example appends it. */
export function CssReference({
  type,
  onInsert,
}: {
  /** Section being edited; omitted for the store-wide box, which lists every section. */
  type?: StudioSectionType;
  onInsert: (snippet: string) => void;
}) {
  const types = type ? [type] : (Object.keys(SECTION_CLASSES) as StudioSectionType[]);
  const examples = type ? SECTION_EXAMPLES : STORE_EXAMPLES;
  return (
    <details className="cssRef">
      <summary>Class names and examples</summary>
      <div className="cssRefBody">
        <b>Examples (click to add)</b>
        <div className="cssExamples">
          {examples.map(([label, code]) => (
            <button type="button" key={label} onClick={() => onInsert(code)} title={code}>
              {label}
            </button>
          ))}
        </div>
        {types.map((t) => (
          <div key={t}>
            <b>{type ? 'Classes in this section' : t}</b>
            <ul>
              {SECTION_CLASSES[t].map(([cls, what]) => (
                <li key={cls}>
                  <code>{cls}</code> {what}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <b>Colour variables</b>
        <ul>
          {VARIABLES.map(([name, what]) => (
            <li key={name}>
              <code>{name}</code> {what}
            </li>
          ))}
        </ul>
        {type ? (
          <p>
            Rules only reach this section. <code>&amp;</code> is the section box itself. Use{' '}
            <code>@container store (max-width: 640px)</code> for phone-only rules so the Mobile preview shows them.
          </p>
        ) : (
          <p>
            Start selectors with <code>.st-root</code> so they win over the theme. Each section can be targeted as{' '}
            <code>#section-ID</code>, by <code>[data-section-type=&quot;banner&quot;]</code>, or by the class names you give it
            under Advanced. Colour variables are set on the store itself, so change them on{' '}
            <code>.st-root .st-sec</code> (every section) rather than on <code>.st-root</code>.
          </p>
        )}
      </div>
    </details>
  );
}

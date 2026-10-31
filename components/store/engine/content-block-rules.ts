// Styles for the content blocks Image with text and Rich text are built from (see sections/ContentBlocks.tsx).
// Appended to the engine stylesheet (THEME_RULES) in EngineShell. Every rule is scoped under the engine root.

const R = '.st-root.eng-root';

export const CONTENT_BLOCK_RULES =
  // Each block spaces itself with a bottom margin; a paragraph inside a text block adds none of its own, so
  // the gap before the next block is one margin, not two.
  `${R} .eng-cb{margin:0 0 12px}` +
  `${R} .eng-cb:last-child{margin-bottom:0}` +
  `${R} .eng-cb-text p:last-child{margin-bottom:0}` +
  `${R} .eng-cb-heading{font-weight:700;line-height:1.15;overflow-wrap:anywhere}` +
  `${R} .eng-cb-size-small{font-size:clamp(18px,3cqi,24px)}` +
  `${R} .eng-cb-size-medium{font-size:clamp(22px,3.4cqi,32px)}` +
  `${R} .eng-cb-size-large{font-size:clamp(28px,5cqi,44px)}` +
  // Image with text keeps the heading size its stores had before blocks (the old .eng-heroTitle): medium is that size.
  `${R} .hero .heroCopy .eng-cb-heading{margin-top:12px}` +
  `${R} .hero .heroCopy .eng-cb-size-small{font-size:clamp(20px,4cqi,30px);line-height:1.1}` +
  `${R} .hero .heroCopy .eng-cb-size-medium{font-size:clamp(24px,5cqi,40px);line-height:1.1}` +
  `${R} .hero .heroCopy .eng-cb-size-large{font-size:clamp(30px,6.5cqi,52px);line-height:1.1}` +
  `${R} .eng-cb-quote{padding:2px 0 2px 16px;border-left:3px solid var(--c-accent,var(--primary));font-style:italic;font-size:1.15em;line-height:1.5;overflow-wrap:anywhere}` +
  `${R} .eng-cb-quote p{margin:0}` +
  `${R} .eng-cb-quote footer{margin-top:6px;font-size:.8em;font-style:normal;opacity:.7}` +
  `${R} .eng-cb-check{display:flex;align-items:flex-start;gap:12px;text-align:left}` +
  `${R} .eng-cb-tick{flex:0 0 auto;width:22px;height:22px;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;background:var(--c-accent,var(--primary));color:var(--c-bg,#fff);font-size:13px;font-weight:700}` +
  `${R} .eng-cb-check div{min-width:0;overflow-wrap:anywhere}` +
  `${R} .eng-cb-check b{display:block}` +
  `${R} .eng-cb-check span:not(.eng-cb-tick){display:block;opacity:.75}` +
  `${R} .eng-cb-buttons{display:flex;flex-wrap:wrap;gap:12px}` +
  `${R} .eng-cta[data-style=outline]{background:transparent;color:var(--c-btn,var(--primary));border:1px solid var(--c-btn,var(--primary))}` +
  `${R} .eng-cb-highlight{position:absolute;left:16px;right:16px;bottom:16px;z-index:1;display:flex;flex-direction:column;gap:4px;padding:14px 16px;border-radius:var(--btn-radius,10px);background:var(--c-card,var(--st-card,#fff));border:1px solid var(--c-border,rgba(0,0,0,.1));box-shadow:0 6px 18px rgba(0,0,0,.12);margin:0;overflow-wrap:anywhere}` +
  `${R} .eng-cb-highlight .eyebrow{margin:0}` +
  `${R} .eng-cb-highlight span{opacity:.75;font-size:.9em}` +
  '@container store (min-width:641px){' +
  `${R} .hero.image-text .eng-cb-highlight{right:auto;left:16px;max-width:min(260px,70%)}` +
  `${R} .hero.text-image .eng-cb-highlight{left:auto;right:16px;max-width:min(260px,70%)}` +
  '}' +
  // On phones the image stacks above the copy; the card stacks under the image instead of overlapping it.
  '@container store (max-width:640px){' +
  `${R} .hero .heroImg:has(.eng-cb-highlight){display:flex;flex-direction:column;min-height:0}` +
  `${R} .hero .heroImg:has(.eng-cb-highlight) .heroSlideImg{position:relative;inset:auto;flex:0 0 auto;height:240px}` +
  `${R} .eng-cb-highlight{position:static;margin:12px 16px 16px;max-width:none}` +
  '}' +
  // Narrow image: the hero is a grid, so the width is the grid column (wide screens only; narrower ones stack or split evenly).
  `${R} .eng-iwt-narrow .heroImg{flex-basis:40%}` +
  '@container store (min-width:901px){' +
  `${R} .hero.eng-iwt-narrow.image-text{grid-template-columns:40% 60%}` +
  `${R} .hero.eng-iwt-narrow.text-image{grid-template-columns:60% 40%}` +
  '}' +
  // .heroCopy is a column with align-items:flex-start, so centring needs the items centred, and block text stretched
  // to the column's width (its own max-width, 460px for paragraphs, still centres it through the auto margins).
  `${R} .eng-iwt-center .heroCopy{text-align:center;align-items:center}` +
  `${R} .eng-iwt-center .heroCopy :is(.eng-cb-text,.eng-cb-quote){align-self:stretch}` +
  `${R} .eng-iwt-center .heroCopy .eng-cb-text p{margin-left:auto;margin-right:auto}` +
  `${R} .eng-iwt-center .eng-cb-quote{border-left:0;padding-left:0}` +
  `${R} .eng-iwt-center .eng-cb-buttons{justify-content:center}`;

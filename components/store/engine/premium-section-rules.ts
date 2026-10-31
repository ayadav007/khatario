// Styles for the premium sections (Collage, and the ones that follow). Appended to the engine stylesheet in
// EngineShell, after the content block rules. Every rule is scoped under the engine root.

const R = '.st-root.eng-root';

export const PREMIUM_SECTION_RULES =
  // Collage, phone first: the text stacks above the tiles, two tiles per row (a lone tile fills the row).
  `${R} .eng-collage{display:grid;grid-template-columns:minmax(0,1fr);gap:24px;align-items:center}` +
  `${R} .eng-collage-text{min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:16px}` +
  `${R} .eng-collage-text .eyebrow,${R} .eng-collage-heading,${R} .eng-collage-body{margin:0}` +
  `${R} .eng-collage-heading{font-weight:700;line-height:1.1;font-size:clamp(28px,4.4cqi,48px);overflow-wrap:anywhere}` +
  `${R} .eng-collage-body p:last-child{margin-bottom:0}` +
  `${R} .eng-collage-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;min-width:0}` +
  `${R} .eng-collage-grid[data-count="1"]{grid-template-columns:minmax(0,1fr)}` +
  `${R} .eng-collage-tile{position:relative;display:block;overflow:hidden;min-width:0;border-radius:var(--card-radius,var(--btn-radius,10px));background:color-mix(in srgb,currentColor 8%,transparent);color:#fff;text-decoration:none}` +
  `${R} .eng-collage--portrait .eng-collage-tile{aspect-ratio:3/4}` +
  `${R} .eng-collage--square .eng-collage-tile{aspect-ratio:1/1}` +
  `${R} .eng-collage-media{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:transform .4s ease}` +
  `${R} a.eng-collage-tile:hover .eng-collage-media{transform:scale(1.04)}` +
  `${R} .eng-collage-cap{position:absolute;left:0;right:0;bottom:0;z-index:1;display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:2px 12px;padding:28px 14px 12px;background:linear-gradient(to top,rgba(0,0,0,.6),transparent);overflow-wrap:anywhere}` +
  `${R} .eng-collage-cap b{font-weight:600}` +
  `${R} .eng-collage-cap span{font-size:.9em;opacity:.9}` +
  // On a phone only three tiles get a large first tile: it spans the row, the other two sit under it.
  '@container store (max-width:640px){' +
  `${R} .eng-collage--feature .eng-collage-grid[data-count="3"] .eng-collage-tile:first-child{grid-column:span 2}` +
  '}' +
  // Wide screens: text column and tiles side by side, 6 of 12 columns each; the first tile large.
  '@container store (min-width:641px){' +
  `${R} .eng-collage{grid-template-columns:repeat(2,minmax(0,1fr));gap:clamp(24px,4cqi,56px)}` +
  `${R} .eng-collage--text-right .eng-collage-text{order:2}` +
  `${R} .eng-collage--text-only,${R} .eng-collage--tiles{grid-template-columns:minmax(0,1fr)}` +
  `${R} .eng-collage-grid{gap:clamp(10px,1.6cqi,20px)}` +
  // Tiles only: one flat row across the full width (nothing is featured).
  `${R} .eng-collage--tiles .eng-collage-grid{grid-template-columns:repeat(4,minmax(0,1fr))}` +
  `${R} .eng-collage--tiles .eng-collage-grid[data-count="1"]{grid-template-columns:minmax(0,1fr)}` +
  `${R} .eng-collage--tiles .eng-collage-grid[data-count="2"]{grid-template-columns:repeat(2,minmax(0,1fr))}` +
  `${R} .eng-collage--tiles .eng-collage-grid[data-count="3"]{grid-template-columns:repeat(3,minmax(0,1fr))}` +
  // First tile large: it spans every row of the tiles beside it, and the grid keeps the tile shape so each small tile does too.
  `${R} .eng-collage--feature:not(.eng-collage--tiles) .eng-collage-grid{grid-template-rows:repeat(2,minmax(0,1fr))}` +
  `${R} .eng-collage--feature:not(.eng-collage--tiles).eng-collage--portrait .eng-collage-grid{aspect-ratio:3/4}` +
  `${R} .eng-collage--feature:not(.eng-collage--tiles).eng-collage--square .eng-collage-grid{aspect-ratio:1/1}` +
  `${R} .eng-collage--feature:not(.eng-collage--tiles) .eng-collage-tile{aspect-ratio:auto;height:100%}` +
  `${R} .eng-collage--feature:not(.eng-collage--tiles) .eng-collage-tile:first-child{grid-row:span 2}` +
  `${R} .eng-collage--feature:not(.eng-collage--tiles) .eng-collage-grid[data-count="2"] .eng-collage-tile{grid-row:span 2}` +
  `${R} .eng-collage--feature:not(.eng-collage--tiles) .eng-collage-grid[data-count="4"]{grid-template-columns:2fr 1fr;grid-template-rows:repeat(3,minmax(0,1fr))}` +
  `${R} .eng-collage--feature:not(.eng-collage--tiles) .eng-collage-grid[data-count="4"] .eng-collage-tile:first-child{grid-row:span 3}` +
  '}';

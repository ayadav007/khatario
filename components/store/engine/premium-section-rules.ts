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
  `${R} .eng-collage-tile{position:relative;display:block;overflow:hidden;min-width:0;border-radius:var(--card-radius,var(--btn-radius,10px));background:#2b2b2b;color:#fff;text-decoration:none}` +
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
  // Two tiles: side by side, the first twice the width of the second, both keeping the tile shape and sitting on the same baseline.
  `${R} .eng-collage--feature:not(.eng-collage--tiles) .eng-collage-grid[data-count="2"]{grid-template-columns:2fr 1fr;grid-template-rows:none;aspect-ratio:auto;align-items:end}` +
  `${R} .eng-collage--feature:not(.eng-collage--tiles).eng-collage--portrait .eng-collage-grid[data-count="2"] .eng-collage-tile{aspect-ratio:3/4;height:auto}` +
  `${R} .eng-collage--feature:not(.eng-collage--tiles).eng-collage--square .eng-collage-grid[data-count="2"] .eng-collage-tile{aspect-ratio:1/1;height:auto}` +
  `${R} .eng-collage--feature:not(.eng-collage--tiles) .eng-collage-grid[data-count="2"] .eng-collage-tile:first-child{grid-row:auto}` +
  `${R} .eng-collage--feature:not(.eng-collage--tiles) .eng-collage-grid[data-count="4"]{grid-template-columns:2fr 1fr;grid-template-rows:repeat(3,minmax(0,1fr))}` +
  `${R} .eng-collage--feature:not(.eng-collage--tiles) .eng-collage-grid[data-count="4"] .eng-collage-tile:first-child{grid-row:span 3}` +
  '}' +
  // Shop the look, phone first: the photo, then the list under it. Pins and the open card sit on the photo.
  `${R} .eng-look-sec{display:flex;flex-direction:column;gap:24px}` +
  `${R} .eng-look-head{display:flex;flex-direction:column;align-items:flex-start;gap:12px;max-width:640px}` +
  `${R} .eng-look-head .eyebrow,${R} .eng-look-heading,${R} .eng-look-text{margin:0}` +
  `${R} .eng-look-heading{font-weight:700;line-height:1.1;font-size:clamp(28px,4.4cqi,48px);overflow-wrap:anywhere}` +
  `${R} .eng-look{display:grid;grid-template-columns:minmax(0,1fr);gap:24px;align-items:start}` +
  `${R} .eng-look--no-list{max-width:720px;margin-inline:auto;width:100%}` +
  `${R} .eng-look-photo{position:relative;min-width:0}` +
  `${R} .eng-look-img{display:block;width:100%;height:auto;border-radius:var(--card-radius,var(--btn-radius,10px))}` +
  `${R} .eng-look-pin{position:absolute;z-index:2;display:flex;align-items:center;justify-content:center;width:28px;height:28px;margin:-14px 0 0 -14px;padding:0;border-radius:50%;border:2px solid var(--c-btn-text,#fff);background:var(--c-btn,var(--primary,#7a0c1e));color:var(--c-btn-text,var(--on-primary,#fff));font:inherit;font-size:12px;font-weight:700;line-height:1;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3);transition:transform .15s ease}` +
  `${R} .eng-look-pin::after{content:"";position:absolute;inset:-8px}` +
  `${R} .eng-look-pin[aria-expanded="true"]{transform:scale(1.14)}` +
  `${R} .eng-look-pin:focus-visible{outline:2px solid var(--c-text,#1c1c18);outline-offset:3px}` +
  `${R} .eng-look-card{position:absolute;z-index:3;display:flex;flex-direction:column;gap:10px;width:min(230px,88%);padding:10px;border-radius:var(--card-radius,var(--btn-radius,10px));background:var(--c-card,#fff);color:var(--c-text,inherit);border:1px solid var(--c-border,rgba(0,0,0,.1));box-shadow:0 10px 30px rgba(0,0,0,.18);text-align:left}` +
  `${R} .eng-look-card[data-v="below"]{margin-top:22px}` +
  `${R} .eng-look-card[data-v="above"]{margin-bottom:22px}` +
  `${R} .eng-look-card[data-h="center"]{transform:translateX(-50%)}` +
  `${R} .eng-look-card[data-h="start"]{transform:translateX(-14px)}` +
  `${R} .eng-look-card[data-h="end"]{transform:translateX(calc(-100% + 14px))}` +
  `${R} .eng-look-line{display:flex;align-items:center;gap:12px;min-width:0}` +
  `${R} .eng-look-thumb{flex:0 0 auto;width:56px;height:56px;object-fit:cover;border-radius:6px;background:color-mix(in srgb,var(--c-text,#000) 8%,transparent)}` +
  `${R} .eng-look-info{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}` +
  `${R} .eng-look-name{font-weight:600;overflow-wrap:anywhere}` +
  `${R} .eng-look-price{font-size:.95em;opacity:.85}` +
  `${R} .eng-look-btn{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;padding:9px 14px;border-radius:var(--btn-radius,8px);border:1px solid var(--c-btn,var(--primary,#7a0c1e));background:var(--c-btn,var(--primary,#7a0c1e));color:var(--c-btn-text,var(--on-primary,#fff));font:inherit;font-weight:600;line-height:1.2;text-align:center;text-decoration:none;white-space:nowrap;cursor:pointer}` +
  `${R} .eng-look-btn--ghost{background:transparent;color:var(--c-btn,var(--primary,#7a0c1e))}` +
  `${R} .eng-look-btn:focus-visible{outline:2px solid var(--c-text,#1c1c18);outline-offset:2px}` +
  `${R} .eng-look-soldout{font-size:.9em;font-weight:600;opacity:.65;text-align:center}` +
  `${R} .eng-look-list{display:flex;flex-direction:column;gap:14px;min-width:0}` +
  `${R} .eng-look-list-heading{margin:0;font-weight:700;font-size:1.2em}` +
  `${R} .eng-look-rows{display:flex;flex-direction:column;gap:12px;margin:0;padding:0;list-style:none}` +
  `${R} .eng-look-row{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding-bottom:12px;border-bottom:1px solid var(--c-border,rgba(0,0,0,.1))}` +
  `${R} .eng-look-num{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:var(--c-btn,var(--primary,#7a0c1e));color:var(--c-btn-text,var(--on-primary,#fff));font-size:12px;font-weight:700}` +
  `${R} .eng-look-row .eng-look-info{flex:1 1 120px}` +
  `${R} .eng-look-row .eng-look-btn,${R} .eng-look-row .eng-look-soldout{flex:0 0 auto}` +
  `${R} .eng-look-all{width:100%}` +
  `${R} .eng-look-empty{margin:0;padding:12px 14px;font-size:13px;text-align:center;color:var(--st-muted,#6b7280);border:1px dashed var(--c-border,rgba(0,0,0,.2));border-radius:8px}` +
  `.st-root.eng-root:not(.eng-editor) .eng-look-empty{display:none}` +
  // Wide screens: photo 7 of 12 columns, list 5; image-right swaps them.
  '@container store (min-width:641px){' +
  `${R} .eng-look{grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:clamp(24px,4cqi,56px)}` +
  `${R} .eng-look--right .eng-look-photo{order:2}` +
  `${R} .eng-look--no-list{grid-template-columns:minmax(0,1fr)}` +
  `${R} .eng-look--no-photo{grid-template-columns:minmax(0,1fr);max-width:560px}` +
  '}' +
  // Image gallery. --eng-cols (2-6) and --eng-gap (px) come inline from the renderer.
  `${R} .eng-gallery{display:flex;flex-direction:column;gap:24px}` +
  `${R} .eng-gallery-head{display:flex;flex-direction:column;align-items:flex-start;gap:12px;max-width:640px}` +
  `${R} .eng-gallery-head .eyebrow,${R} .eng-gallery-heading{margin:0}` +
  `${R} .eng-gallery-heading{font-weight:700;line-height:1.1;font-size:clamp(28px,4.4cqi,48px);overflow-wrap:anywhere}` +
  `${R} .eng-gallery-list{margin:0;padding:0;list-style:none;min-width:0}` +
  `${R} .eng-gallery--grid .eng-gallery-list{display:grid;grid-template-columns:repeat(var(--eng-cols),minmax(0,1fr));gap:var(--eng-gap)}` +
  `${R} .eng-gallery--masonry .eng-gallery-list{columns:var(--eng-cols);column-gap:var(--eng-gap)}` +
  `${R} .eng-gallery--masonry .eng-gallery-item{break-inside:avoid;margin-bottom:var(--eng-gap)}` +
  `${R} .eng-gallery--strip .eng-gallery-list{display:flex;gap:var(--eng-gap);overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch}` +
  `${R} .eng-gallery--strip .eng-gallery-item{flex:0 0 calc(100%/var(--eng-cols));min-width:0;scroll-snap-align:start}` +
  `${R} .eng-gallery-item{min-width:0}` +
  `${R} .eng-gallery-link{display:block;color:inherit;text-decoration:none}` +
  `${R} .eng-gallery-link:focus-visible{outline:2px solid var(--c-text,#1c1c18);outline-offset:2px}` +
  `${R} .eng-gallery-fig{position:relative;overflow:hidden;margin:0;border-radius:var(--card-radius,var(--btn-radius,10px));background:#2b2b2b;color:#fff}` +
  `${R} .eng-gallery-media{display:block;width:100%;height:auto;object-fit:cover}` +
  `${R} .eng-gallery--square .eng-gallery-media{aspect-ratio:1/1}` +
  `${R} .eng-gallery--portrait .eng-gallery-media{aspect-ratio:3/4}` +
  `${R} .eng-gallery-cap{position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;gap:2px;padding:28px 12px 10px;background:linear-gradient(to top,rgba(0,0,0,.6),transparent);overflow-wrap:anywhere;opacity:0;transition:opacity .25s ease}` +
  `${R} .eng-gallery-cap b{font-weight:600}` +
  `${R} .eng-gallery-cap span{font-size:.9em;opacity:.9}` +
  `${R} .eng-gallery-item:hover .eng-gallery-cap,${R} .eng-gallery-item:focus-within .eng-gallery-cap{opacity:1}` +
  `${R} .eng-gallery--hover-none .eng-gallery-cap{display:none}` +
  // Touch screens cannot hover: captions are always visible (unless the gallery shows none).
  `@media (hover:none){${R} .eng-gallery-cap{opacity:1}}` +
  // Phones: two columns (!important beats the inline variable); the strip shows about two cards with the next one peeking, whatever its columns.
  `@container store (max-width:640px){${R} .eng-gallery:not(.eng-gallery--strip){--eng-cols:2!important}` +
  `${R} .eng-gallery--strip .eng-gallery-item{flex:0 0 calc(100%/2.2)}}` +
  // Side gutters, as .st-section has them (38 / 22 / 14 px, centred at 1240px on wide Studio-based stores), so these
  // sections line up with the rest of the page instead of touching the store's edges; Full width drops them (last, so
  // it wins the equal-specificity rules above).
  `${R} :is(.eng-collage,.eng-look-sec,.eng-gallery){padding-inline:38px}` +
  `@container store (max-width:900px){${R} :is(.eng-collage,.eng-look-sec,.eng-gallery){padding-inline:22px}}` +
  `@container store (max-width:640px){${R} :is(.eng-collage,.eng-look-sec,.eng-gallery){padding-inline:14px}}` +
  `@container store (min-width:1320px){${R}.store-studio :is(.eng-collage,.eng-look-sec,.eng-gallery){padding-inline:calc((100cqw - 1240px) / 2)}}` +
  `${R} .eng-sec--full :is(.eng-collage,.eng-look-sec,.eng-gallery){padding-inline:0}`;

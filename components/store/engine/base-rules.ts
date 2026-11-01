// Client-safe, import-free: the first rules of EngineShell's engine stylesheet (THEME_RULES), shared with the Studio 2
// card design gallery so its tiles take the same heading font, button radius, button colours and section lines.

// Theme fonts on headings and the theme's button radius over the Studio defaults.
export const ENGINE_BASE_RULES =
  '.st-root.eng-root.store-studio :is(h1,h2,h3,.logo b){font-family:var(--font-heading)}' +
  '.st-root.eng-root.store-studio :is(.st-btn,.addBtn){border-radius:var(--btn-radius)}' +
  // Buttons follow the section's colour scheme (button / button text), else the store's primary colour.
  '.st-root.eng-root .st-btn{background:var(--c-btn,var(--primary));color:var(--c-btn-text,var(--on-primary))}' +
  '.st-root.eng-root .addBtn:not(:disabled){border-color:var(--c-btn,var(--primary));color:var(--c-btn,var(--primary))}' +
  '.st-root.eng-root .addBtn:not(:disabled):hover{background:var(--c-btn,var(--primary));color:var(--c-btn-text,var(--on-primary))}' +
  '.st-root.eng-root .stepper{background:var(--c-btn,var(--primary));color:var(--c-btn-text,var(--on-primary))}' +
  // Muted text and hairlines come from the section's own text colour: declared once on .st-root they would keep the
  // theme's text colour, so a dark section's secondary text stayed dark grey. Shared components' fixed Tailwind greys
  // (catalog filters, product page) follow the section's text, muted text, card and line colours too.
  '.st-root.eng-root .eng-sec{--st-line:var(--c-border,color-mix(in srgb,var(--text) 14%,transparent));--st-muted:color-mix(in srgb,var(--text) 62%,transparent);--qk-card:var(--st-card)}';

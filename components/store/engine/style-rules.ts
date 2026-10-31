// The theme's Style group (label style, frame style, texture): one rule set per root class from
// lib/store/engine/root-class.ts. Appended to the engine stylesheet (THEME_RULES) in EngineShell.
// Textures draw in the section's own text colour (currentColor) at low strength, so they read on light and dark schemes.

const R = '.st-root.eng-root';
const ink = 'color-mix(in srgb,currentColor 10%,transparent)';

export const STYLE_RULES =
  // Spaced capitals on small labels, badges, the add-to-cart button, buttons and header menu links.
  `${R}.eng-labels-caps :is(.eyebrow,.badges em,.addBtn,.st-btn,.nav a){text-transform:uppercase;letter-spacing:.12em}` +
  // A thin accent border, with a faint inner line, on cards and images. Product cards are article.g-surface (the
  // theme's card style uses the same selector); .product is the Studio-markup card.
  `${R}.eng-frame-accent :is(.product,main article.g-surface,.heroImg,.eng-promo,.eng-collection-img){border:1px solid var(--c-accent,var(--primary));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--c-accent,var(--primary)) 25%,transparent)}` +
  // Textures sit on each section (.eng-sec), over the section's background colour.
  `${R}.eng-texture-dots .eng-sec{background-image:radial-gradient(${ink} .75px,transparent .75px);background-size:16px 16px}` +
  `${R}.eng-texture-linen .eng-sec{background-image:repeating-linear-gradient(0deg,${ink} 0 1px,transparent 1px 3px),repeating-linear-gradient(90deg,${ink} 0 1px,transparent 1px 3px)}` +
  `${R}.eng-texture-grid .eng-sec{background-image:linear-gradient(${ink} 1px,transparent 1px),linear-gradient(90deg,${ink} 1px,transparent 1px);background-size:24px 24px}`;

import fs from 'fs';

const css = fs.readFileSync('components/store/engine/slideshow.css', 'utf8');

describe('slideshow over the photo without any picture (noImg)', () => {
  it('draws the words in the section colours, not white', () => {
    expect(css).toContain('.st-root.eng-root.eng-root .hero.full.noImg .heroCopy:not(.customText){color:var(--text)}');
    expect(css).toContain('.st-root.eng-root.eng-root .hero.full.noImg .heroCopy:not(.customText) p{color:var(--st-muted)}');
    expect(css).toContain('.st-root.eng-root.eng-root .hero.full.noImg .heroCopy:not(.customText) .eyebrow{color:var(--primary)}');
  });

  it('gives its buttons the theme button colours instead of the white button made for photos', () => {
    expect(css).toContain(
      '.st-root.eng-root.eng-root .hero.full.noImg .heroCopy .st-btn:not([data-style=outline]){background:var(--c-btn,var(--primary));color:var(--c-btn-text,var(--on-primary))}',
    );
    expect(css).toContain(
      '.st-root.eng-root.eng-root .hero.full.noImg .heroCopy.hs-look:not(.hs-box):not(.customText) .st-btn.eng-cta[data-style=outline]{color:var(--c-btn,var(--primary));border-color:var(--c-btn,var(--primary))}',
    );
  });
});

import { ctaTarget } from '@/lib/store/engine/links';
import type { EngineSectionProps } from '../registry';
import { blockSettings, str, withDefaults } from './shared';

/** A row of logos; each optionally links out. */
export function LogoList({ section }: EngineSectionProps) {
  const heading = str(withDefaults(section).heading);
  const logos: { image: string; alt: string; href: string | null }[] = [];
  for (const id of section.block_order ?? []) {
    const block = section.blocks?.[id];
    if (!block || block.disabled || block.type !== 'logo') continue;
    const b = blockSettings(section.type, block);
    if (!b || !str(b.image)) continue;
    const t = ctaTarget(b.link);
    const href = t.kind === 'internal' || t.kind === 'external' ? t.href : t.kind === 'anchor' ? `#${t.id}` : null;
    logos.push({ image: str(b.image), alt: str(b.alt), href });
  }
  if (logos.length === 0) return null;
  return (
    <div className="eng-logos">
      {heading ? <h2>{heading}</h2> : null}
      <ul>
        {logos.map((l, i) => (
          <li key={i}>
            {l.href ? (
              <a href={l.href} {...(l.href.startsWith('https:') ? { rel: 'noopener noreferrer' } : {})}>
                <img src={l.image} alt={l.alt} loading="lazy" />
              </a>
            ) : (
              <img src={l.image} alt={l.alt} loading="lazy" />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

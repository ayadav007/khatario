import type { EngineSectionProps } from '../registry';
import { blockSettings, str, withDefaults } from './shared';

/** Questions as native details elements (work without JavaScript); answers are sanitised rich text. */
export function Faq({ section }: EngineSectionProps) {
  const heading = str(withDefaults(section).heading);
  const items: { q: string; a: string }[] = [];
  for (const id of section.block_order ?? []) {
    const block = section.blocks?.[id];
    if (!block || block.disabled || block.type !== 'question') continue;
    const b = blockSettings(section.type, block);
    if (!b || !str(b.question)) continue;
    items.push({ q: str(b.question), a: str(b.answer) });
  }
  if (items.length === 0) return null;
  return (
    <div className="eng-faq">
      {heading ? <h2>{heading}</h2> : null}
      {items.map((it, i) => (
        <details key={i}>
          <summary>{it.q}</summary>
          {it.a ? <div className="eng-rt" dangerouslySetInnerHTML={{ __html: it.a }} /> : null}
        </details>
      ))}
    </div>
  );
}

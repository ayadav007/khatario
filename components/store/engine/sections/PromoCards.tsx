import type { EngineSectionProps } from '../registry';
import { EnginePromoCards, type EnginePromoCard } from '../EngineViews';
import { blockSettings, str, withDefaults } from './shared';

/** Category banners: up to four cards; a card with neither a heading nor an image is skipped. */
export function PromoCards({ section }: EngineSectionProps) {
  const v = withDefaults(section);
  const cards: EnginePromoCard[] = [];
  for (const id of section.block_order ?? []) {
    const block = section.blocks?.[id];
    if (!block || block.disabled || block.type !== 'card') continue;
    const b = blockSettings(section.type, block);
    if (!b) continue;
    const card: EnginePromoCard = {
      id,
      eyebrow: str(b.eyebrow),
      heading: str(b.heading),
      text: str(b.text),
      buttonText: str(b.button_text),
      link: str(b.link),
      image: str(b.image),
    };
    if (!card.heading && !card.image) continue;
    cards.push(card);
  }
  if (cards.length === 0) return null;
  const columns = typeof v.columns === 'number' ? Math.min(4, Math.max(1, Math.round(v.columns))) : 2;
  return (
    <EnginePromoCards
      heading={str(v.heading)}
      style={v.style === 'overlay' ? 'overlay' : 'split'}
      columns={columns}
      cards={cards}
    />
  );
}

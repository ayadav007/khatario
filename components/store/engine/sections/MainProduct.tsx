import type { EngineSectionProps } from '../registry';
import { EngineMainProduct } from '../product/ProductBlocks';
import type { ProductBlockProps } from '../product/product-blocks';
import { blockSettings, str, withDefaults } from './shared';

/**
 * `main-product` (D17): settings and enabled blocks, in the merchant's order, mapped on the server
 * (richtext sanitised here); the product itself comes from `EngineProductProvider` in the browser.
 */
export function MainProduct({ section, route }: EngineSectionProps) {
  // Outside a product route (no provider) there is no product to show.
  if (!route?.productId) return null;
  const s = withDefaults(section);
  const blocks: ProductBlockProps[] = [];
  for (const id of section.block_order) {
    const block = section.blocks[id];
    if (!block || block.disabled) continue;
    const settings = blockSettings(section.type, block);
    if (settings) blocks.push({ id, type: block.type, settings });
  }
  return (
    <EngineMainProduct
      blocks={blocks}
      galleryPosition={str(s.gallery_position) === 'right' ? 'right' : 'left'}
      thumbs={str(s.thumbs) === 'bottom' ? 'bottom' : 'side'}
      stickyInfo={s.sticky_info !== false}
    />
  );
}

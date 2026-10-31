import { shopTheLookItems } from '@/lib/store/engine/shop-the-look-map';
import type { EngineSectionProps } from '../registry';
import { ShopTheLookClient } from './ShopTheLookClient';
import { blockSettings, str, withDefaults } from './shared';

/** A styled photo with numbered product hotspots, and the same products listed beside it. */
export function ShopTheLook({ section, data }: EngineSectionProps) {
  const v = withDefaults(section);
  const image = str(v.image).trim();
  const items = shopTheLookItems(section, data ?? {}, (b) => blockSettings(section.type, b));
  if (!image && items.length === 0) return null;

  const eyebrow = str(v.eyebrow);
  const heading = str(v.heading);
  const text = str(v.text);

  return (
    <div className="eng-look-sec">
      {eyebrow || heading || text ? (
        <div className="eng-look-head">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          {heading ? <h2 className="eng-look-heading">{heading}</h2> : null}
          {text ? <p className="eng-look-text">{text}</p> : null}
        </div>
      ) : null}
      <ShopTheLookClient
        image={image}
        imageSide={str(v.image_side) === 'right' ? 'right' : 'left'}
        items={items}
        showList={v.show_list !== false}
        showAddAll={v.show_add_all === true}
        listHeading={str(v.list_heading)}
      />
      {/* Always rendered; the stylesheet hides it outside the editor (the root carries `eng-editor` there). */}
      {image && items.length === 0 ? <p className="eng-look-empty">Add a hotspot and pick a product</p> : null}
    </div>
  );
}

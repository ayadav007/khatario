import { pickMenu, resolveMenu } from '@/lib/store/engine/menus';
import type { EngineSectionProps } from '../registry';
import { EngineHeader } from '../EngineViews';
import { menuCategories, str, withDefaults } from './shared';

export function Header({ section, data, store, theme }: EngineSectionProps) {
  const v = withDefaults(section);
  const items = resolveMenu(pickMenu(theme.settings.menus ?? [], v.menu, 'main'), menuCategories(data));
  // Quick's pills: an item with children opens the side panel at that item.
  const links = items.map((i) => ({
    label: i.label,
    href: i.href,
    highlight: i.highlight,
    itemId: i.id,
    hasChildren: i.kind !== 'link',
  }));
  return (
    <EngineHeader
      s={{
        logo: store.name,
        tagline: str(v.delivery_eta),
        showSearch: v.show_search !== false,
        showAccount: v.show_account !== false,
        showCart: v.show_cart !== false,
        showCartCount: v.show_cart_count !== false,
        iconsPosition: v.icons_position === 'left' ? 'left' : 'right',
      }}
      logoUrl={str(v.logo_url) || theme.settings.logo_url || store.logo_url || null}
      menu={{ items, layout: v.menu_layout === 'inline' ? 'inline' : 'below', caps: v.menu_caps === true }}
      subdomain={store.store_subdomain}
      searchPlaceholder={str(v.search_placeholder) || 'Search products'}
      chips={
        v.show_category_chips === true && data?.categories?.length
          ? data.categories.map((c) => ({ id: c.id, name: c.name }))
          : undefined
      }
      quick={{
        name: store.name,
        eta: str(v.delivery_eta),
        links,
        categories: (data?.categories ?? []).map((c) => ({ id: c.id, name: c.name })),
        showSearch: v.show_search !== false,
        showAccount: v.show_account !== false,
        showCart: v.show_cart !== false,
      }}
    />
  );
}

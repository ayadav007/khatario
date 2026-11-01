import { pickMenu, resolveMenu } from '@/lib/store/engine/menus';
import { headerLayoutClasses, logoWidthStyle } from '@/lib/store/engine/header-layout';
import type { EngineSectionProps } from '../registry';
import { EngineHeader } from '../EngineViews';
import { menuCategories, str, withDefaults } from './shared';

/** A logo width setting in pixels, clamped to its range; anything else is 0 (automatic). */
function logoWidth(v: unknown, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.round(v))) : 0;
}

export function Header({ section, data, store, theme }: EngineSectionProps) {
  const v = withDefaults(section);
  const items = resolveMenu(pickMenu(theme.settings.menus ?? [], v.menu, 'main'), menuCategories(data));
  const menuLayout = v.menu_layout === 'inline' ? 'inline' : 'below';
  // Quick's pills: an item with children opens the side panel at that item.
  const links = items.map((i) => ({
    label: i.label,
    href: i.href,
    highlight: i.highlight,
    itemId: i.id,
    hasChildren: i.kind !== 'link',
  }));
  const layoutClass = headerLayoutClasses({
    logoPosition: v.logo_position === 'center' ? 'center' : 'left',
    logoPositionMobile: v.logo_position_mobile === 'center' ? 'center' : 'left',
    menuLayout,
    separator: v.separator !== false,
  });
  const logoStyle = logoWidthStyle(logoWidth(v.logo_width, 300), logoWidth(v.logo_width_mobile, 200));
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
      menu={{ items, layout: menuLayout, caps: v.menu_caps === true }}
      layoutClass={layoutClass}
      logoStyle={logoStyle}
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

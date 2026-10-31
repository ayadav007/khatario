import type { EngineSectionProps } from '../registry';
import { EngineHeader } from '../EngineViews';
import { str, withDefaults } from './shared';

export function Header({ section, data, store, theme }: EngineSectionProps) {
  const v = withDefaults(section);
  // Real menus arrive with the menu components (Tasks 4 and 5); until then the header shows no links.
  const links: { label: string; href: string; highlight: boolean }[] = [];
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
        showNav: links.length > 0,
        highlightLink: links.find((l) => l.highlight)?.label,
      }}
      logoUrl={str(v.logo_url) || theme.settings.logo_url || store.logo_url || null}
      nav={links.map((l) => ({ label: l.label, href: l.href }))}
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

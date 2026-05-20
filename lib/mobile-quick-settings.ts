/**
 * Mobile top bar: contextual settings (sheet) or fallback Settings hub link.
 */

import {
  getModuleSettingsMenu,
  type ModuleSettingsIconKind,
  type ModuleSettingsMenu,
} from '@/lib/module-settings';

export type MobileQuickSettingsKind = ModuleSettingsIconKind;

export function getMobileQuickSettings(pathname: string | null): {
  href: string;
  ariaLabel: string;
  kind: MobileQuickSettingsKind;
  /** When set, TopBar opens a module settings sheet instead of navigating directly. */
  moduleMenu: ModuleSettingsMenu | null;
} {
  const menu = getModuleSettingsMenu(pathname);

  if (menu) {
    return {
      href: menu.entries[0]?.href ?? '/settings',
      ariaLabel: menu.ariaLabel,
      kind: menu.iconKind,
      moduleMenu: menu,
    };
  }

  return {
    href: '/settings',
    ariaLabel: 'Settings',
    kind: 'app',
    moduleMenu: null,
  };
}

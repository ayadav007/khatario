/**
 * Settings page access by enabled platform module (billing | hr | connect | crm).
 * Built from settings-module-registry — shared routes allow any module that lists them.
 */

import type { PlatformModule } from '@/lib/platform-modules';
import {
  SETTINGS_BY_PLATFORM_MODULE,
  SETTINGS_MODULE_ORDER,
} from '@/lib/settings-module-registry';

const ALWAYS_ALLOWED_PREFIXES = ['/settings/help'];

function normalizeSettingsPath(pathname: string): string {
  return pathname.split('?')[0].split('#')[0];
}

function buildPathToModulesMap(): Map<string, PlatformModule[]> {
  const counts = new Map<string, Set<PlatformModule>>();

  for (const mod of SETTINGS_MODULE_ORDER) {
    for (const group of SETTINGS_BY_PLATFORM_MODULE[mod].groups) {
      for (const link of group.links) {
        const path = normalizeSettingsPath(link.href);
        if (!counts.has(path)) counts.set(path, new Set());
        counts.get(path)!.add(mod);
      }
    }
  }

  const map = new Map<string, PlatformModule[]>();
  for (const [path, mods] of counts) {
    map.set(path, Array.from(mods));
  }
  return map;
}

const PATH_TO_MODULES = buildPathToModulesMap();

const SORTED_REGISTRY_PATHS = Array.from(PATH_TO_MODULES.keys()).sort(
  (a, b) => b.length - a.length,
);

/**
 * Modules that include this settings path in the registry.
 * `null` = no module restriction (hub, help, or unknown nested route).
 */
export function requiredModulesForSettingsPath(pathname: string): PlatformModule[] | null {
  const path = normalizeSettingsPath(pathname);

  if (path === '/settings') {
    return null;
  }

  if (ALWAYS_ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return null;
  }

  for (const registered of SORTED_REGISTRY_PATHS) {
    if (path === registered || path.startsWith(`${registered}/`)) {
      return PATH_TO_MODULES.get(registered) ?? null;
    }
  }

  // Nested settings routes not explicitly listed (e.g. /settings/branches/new)
  if (path.startsWith('/settings/')) {
    const segments = path.split('/').filter(Boolean);
    if (segments.length >= 2) {
      const parent = `/${segments.slice(0, 2).join('/')}`;
      for (const registered of SORTED_REGISTRY_PATHS) {
        if (parent === registered || parent.startsWith(`${registered}/`)) {
          return PATH_TO_MODULES.get(registered) ?? null;
        }
      }
    }
  }

  return null;
}

export function canAccessSettingsPath(
  pathname: string,
  enabledModules: PlatformModule[],
): boolean {
  const required = requiredModulesForSettingsPath(pathname);
  if (!required || required.length === 0) {
    return true;
  }

  const enabled =
    enabledModules.length > 0 ? enabledModules : (['billing'] as PlatformModule[]);

  return required.some((mod) => enabled.includes(mod));
}

export function settingsPathDeniedRedirect(
  enabledModules: PlatformModule[],
): string {
  const enabled =
    enabledModules.length > 0 ? enabledModules : (['billing'] as PlatformModule[]);

  if (enabled.includes('hr') && !enabled.includes('billing')) {
    return '/settings';
  }
  return '/settings';
}

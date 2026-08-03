/**
 * Settings hub — re-exports from module registry (hub + sidebar share one source).
 * @see lib/settings-module-registry.ts
 */

export type {
  SettingsHubLink,
  SettingsHubColumn,
  SettingsHubSection,
} from '@/lib/settings-module-registry';

export {
  buildSettingsHubSections,
  buildSettingsSidebarBlocks,
  getEnabledSettingsModuleDefinitions,
  SETTINGS_BY_PLATFORM_MODULE,
  SETTINGS_MODULE_ORDER,
} from '@/lib/settings-module-registry';

/** @deprecated Use buildSettingsHubSections(enabledModules) — kept for type-only imports. */
export const SETTINGS_HUB_SECTIONS: import('@/lib/settings-module-registry').SettingsHubSection[] =
  [];

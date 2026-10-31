// Server-only. Grocery and Khatario home mapping (D28). Pure.
import type { StoreTheme } from '@/lib/store/store-theme';
import type { Template } from './types';
import type { MigrationContext } from './migrate';

/** Stub until M4 Task 6 maps the Grocery and Khatario homes. */
export function migratePackHome(_t: StoreTheme, _ctx: MigrationContext): { home: Template; warnings: string[] } {
  return { home: { order: [], sections: {} }, warnings: ['pack home not migrated yet'] };
}

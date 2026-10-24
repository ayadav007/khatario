/**
 * Per-user mobile bottom navigation.
 * Home (or Chats for a Connect agent) stays first. More stays last.
 * The user picks 4 tabs (2 middle) or 5 tabs (3 middle) from shortcuts their modules allow.
 * Flutter mirrors this in `phone/lib/shell/mobile_nav.dart`.
 */

export const MIDDLE_NAV_IDS = [
  'invoices',
  'items',
  'parties',
  'chats',
  'contacts',
  'orders',
  'team',
  'attendance',
] as const;

export type MiddleNavId = (typeof MIDDLE_NAV_IDS)[number];

export type MobileNavSlotCount = 4 | 5;

export type MobileNavPrefs = {
  slotCount: MobileNavSlotCount;
  middle: MiddleNavId[];
};

export type MobileNavContext = {
  modules: string[];
  isConnectAgent: boolean;
  canViewInvoices: boolean;
};

export const MIDDLE_NAV_LABELS: Record<MiddleNavId, string> = {
  invoices: 'Invoices',
  items: 'Items',
  parties: 'Parties',
  chats: 'Chats',
  contacts: 'Contacts',
  orders: 'Orders',
  team: 'Team',
  attendance: 'Attendance',
};

export const MIDDLE_NAV_HREFS: Record<MiddleNavId, string> = {
  invoices: '/invoices',
  items: '/items',
  parties: '/customers',
  chats: '/whatsapp/conversations',
  contacts: '/whatsapp/contacts',
  orders: '/orders',
  team: '/employees',
  attendance: '/employees/attendance',
};

function moduleFlags(modules: string[]) {
  const hasHr = modules.includes('hr');
  const hasConnect = modules.includes('connect');
  const hasBilling = modules.includes('billing') || (!hasHr && !hasConnect);
  return { hasHr, hasConnect, hasBilling };
}

export function isMiddleNavId(value: unknown): value is MiddleNavId {
  return typeof value === 'string' && (MIDDLE_NAV_IDS as readonly string[]).includes(value);
}

/** Shortcuts this account may place between the pinned ends. */
export function allowedMiddleIds(ctx: MobileNavContext): MiddleNavId[] {
  if (ctx.isConnectAgent) {
    const ids: MiddleNavId[] = ['contacts'];
    if (ctx.canViewInvoices) ids.push('orders');
    ids.push('parties');
    return ids;
  }
  const { hasHr, hasConnect, hasBilling } = moduleFlags(ctx.modules);
  const ids: MiddleNavId[] = [];
  if (hasBilling) ids.push('invoices', 'items', 'parties');
  if (hasHr) ids.push('team', 'attendance');
  if (hasConnect) ids.push('chats', 'contacts');
  return ids;
}

/** The layout used when the user has not chosen a bar. Matches the previous fixed rules. */
export function defaultMiddleIds(ctx: MobileNavContext): MiddleNavId[] {
  if (ctx.isConnectAgent) {
    return ctx.canViewInvoices ? ['contacts', 'orders'] : ['contacts', 'parties'];
  }
  const { hasHr, hasConnect, hasBilling } = moduleFlags(ctx.modules);
  if (hasHr && !hasBilling) return ['team', 'attendance'];
  if (hasConnect && !hasBilling) return ['chats', 'contacts'];
  if (hasConnect && hasBilling) return ['invoices', 'chats', 'parties'];
  return ['invoices', 'items', 'parties'];
}

export function parseMobileNavPrefs(raw: unknown): MobileNavPrefs | null {
  if (!raw || typeof raw !== 'object') return null;
  const slotCount = (raw as { slotCount?: unknown }).slotCount;
  const middle = (raw as { middle?: unknown }).middle;
  if (slotCount !== 4 && slotCount !== 5) return null;
  if (!Array.isArray(middle)) return null;
  const ids = middle.filter(isMiddleNavId);
  if (ids.length !== middle.length) return null;
  return { slotCount, middle: ids };
}

function fillMiddle(need: number, allowed: MiddleNavId[], preferred: MiddleNavId[], defaults: MiddleNavId[]): MiddleNavId[] {
  const allowedSet = new Set(allowed);
  const picked: MiddleNavId[] = [];
  const push = (id: MiddleNavId) => {
    if (picked.length >= need) return;
    if (!allowedSet.has(id) || picked.includes(id)) return;
    picked.push(id);
  };
  for (const id of preferred) push(id);
  for (const id of defaults) push(id);
  for (const id of allowed) push(id);
  return picked;
}

/** What the bar should show. Drops shortcuts the account can no longer open and fills gaps from the default. */
export function displayedMiddle(ctx: MobileNavContext, raw: unknown): MiddleNavId[] {
  const allowed = allowedMiddleIds(ctx);
  const defaults = defaultMiddleIds(ctx).filter((id) => allowed.includes(id));
  const parsed = parseMobileNavPrefs(raw);
  if (!parsed || allowed.length === 0) return defaults.slice(0, 3);
  const need = Math.min(parsed.slotCount === 4 ? 2 : 3, allowed.length);
  return fillMiddle(need, allowed, parsed.middle, defaults);
}

export function validateMobileNavPrefs(
  ctx: MobileNavContext,
  input: { slotCount?: unknown; middle?: unknown },
): { ok: true; prefs: MobileNavPrefs } | { ok: false; error: string } {
  const slotCount = input.slotCount;
  if (slotCount !== 4 && slotCount !== 5) {
    return { ok: false, error: 'Choose 4 or 5 tabs.' };
  }
  const need = slotCount - 2;
  const allowed = allowedMiddleIds(ctx);
  if (need > allowed.length) {
    return {
      ok: false,
      error: `This account can use ${allowed.length + 2} tabs. Choose 4.`,
    };
  }
  if (!Array.isArray(input.middle) || input.middle.length !== need) {
    return { ok: false, error: slotCount === 4 ? 'Pick 2 shortcuts.' : 'Pick 3 shortcuts.' };
  }
  const seen = new Set<MiddleNavId>();
  for (const id of input.middle) {
    if (!isMiddleNavId(id) || !allowed.includes(id) || seen.has(id)) {
      return { ok: false, error: 'One of those shortcuts is not available on this account.' };
    }
    seen.add(id);
  }
  return { ok: true, prefs: { slotCount, middle: input.middle } };
}

/** First pinned tab. Connect agents open Chats; everyone else opens Home. */
export function pinnedFirstId(ctx: MobileNavContext): 'home' | 'chats' {
  return ctx.isConnectAgent ? 'chats' : 'home';
}

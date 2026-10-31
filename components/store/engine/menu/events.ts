// Shared by the store's menu bar and the editor bridge, so the bridge does not pull in the menu component and its CSS.

/** The editor asks the preview to hold a top item's dropdown open (`itemId: null` releases it). */
export const MENU_HOLD_EVENT = 'kh-menu-hold';

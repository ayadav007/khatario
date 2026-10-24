/**
 * What to do when a service worker takes control of the page.
 *
 * - First install (the page loaded without a controller): nothing changed for
 *   this page, so never reload; reloading here wiped half-typed login forms.
 * - Platform admin pages manage their own worker and never auto-reload.
 * - Otherwise a new deploy is live: tell the user and let them refresh, or
 *   pick it up on their next navigation, instead of reloading mid-task.
 */
export type ControllerChangeAction = 'ignore' | 'update-available';

export function decideOnControllerChange(input: {
  hadControllerAtLoad: boolean;
  pathname: string;
}): ControllerChangeAction {
  if (!input.hadControllerAtLoad) return 'ignore';
  if (input.pathname.startsWith('/admin')) return 'ignore';
  return 'update-available';
}

/** A pending update is applied with a full load only when the user moves to another page. */
export function shouldReloadOnNavigation(input: {
  updatePending: boolean;
  previousPathname: string | null;
  pathname: string;
}): boolean {
  if (!input.updatePending) return false;
  if (input.previousPathname === null) return false;
  if (input.pathname.startsWith('/admin')) return false;
  return input.previousPathname !== input.pathname;
}

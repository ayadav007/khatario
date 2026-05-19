/**
 * Production mobile: TopBar already shows the route title — hide duplicate
 * in-page back arrow + heading on composer/form screens.
 */
export function hideMobileDuplicatePageChrome(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** Dispatched on transition offline → online (after NetworkStatusProvider confirms reconnect). */
export const NETWORK_RECONNECT_EVENT = 'khatario:network-reconnect';

export function dispatchNetworkReconnect(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(NETWORK_RECONNECT_EVENT));
}

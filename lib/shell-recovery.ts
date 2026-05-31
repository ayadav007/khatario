const RECOVERY_KEY = 'khatario_shell_recovery_at';

/** Unregister SW and hard-reload when a stale cached bundle breaks the App Router. */
export async function recoverFromStaleShell(): Promise<void> {
  if (typeof window === 'undefined') return;

  const last = Number(sessionStorage.getItem(RECOVERY_KEY) ?? '0');
  if (Date.now() - last < 5000) return;
  sessionStorage.setItem(RECOVERY_KEY, String(Date.now()));

  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  }

  window.location.reload();
}

export function isStaleChunkError(message: string): boolean {
  return (
    message.includes('Loading chunk') ||
    message.includes('ChunkLoadError') ||
    message.includes('Failed to fetch dynamically imported module')
  );
}

/** Remove bottom nav nodes portaled to body by a prior broken mobile build. */
export function removeOrphanedBottomNavPortals(): void {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('body > nav[data-mobile-bottom-nav]').forEach((el) => {
    el.remove();
  });
}

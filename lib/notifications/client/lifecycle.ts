import { isCapacitorNative } from '@/lib/capacitor/platform';

export type LifecycleSignal = 'online' | 'offline' | 'visible' | 'hidden' | 'resume';

export interface LifecycleSource {
  isVisible(): boolean;
  isOnline(): boolean;
  subscribe(handler: (signal: LifecycleSignal) => void): () => void;
}

/**
 * Browser and Capacitor WebView signals. Android suspends the WebView in the background, so a
 * stream can look open after resume while its socket is long gone; `resume` forces a reconnect.
 * Uses the @capacitor/app plugin already shipped in the APK (no native change).
 */
export function browserLifecycle(): LifecycleSource {
  return {
    isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
    isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    subscribe(handler) {
      if (typeof window === 'undefined') return () => {};
      const onOnline = () => handler('online');
      const onOffline = () => handler('offline');
      const onVisibility = () => handler(document.visibilityState === 'hidden' ? 'hidden' : 'visible');
      const onPageShow = (e: PageTransitionEvent) => {
        if (e.persisted) handler('resume');
      };
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
      window.addEventListener('pageshow', onPageShow);
      document.addEventListener('visibilitychange', onVisibility);

      let removed = false;
      let removeNative: (() => void) | undefined;
      if (isCapacitorNative()) {
        void import('@capacitor/app')
          .then(({ App }) =>
            Promise.all([
              App.addListener('resume', () => handler('resume')),
              App.addListener('pause', () => handler('hidden')),
            ])
          )
          .then((handles) => {
            const remove = () => handles.forEach((h) => void h.remove());
            if (removed) remove();
            else removeNative = remove;
          })
          .catch(() => {
            /* plugin unavailable: visibilitychange still fires in the WebView */
          });
      }

      return () => {
        removed = true;
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
        window.removeEventListener('pageshow', onPageShow);
        document.removeEventListener('visibilitychange', onVisibility);
        removeNative?.();
      };
    },
  };
}

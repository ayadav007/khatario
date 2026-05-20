export type MobileBackInterceptResult = 'handled' | 'pass';

type MobileBackInterceptor = () => MobileBackInterceptResult;

const interceptors = new Set<MobileBackInterceptor>();

export function registerMobileBackInterceptor(fn: MobileBackInterceptor): () => void {
  interceptors.add(fn);
  return () => {
    interceptors.delete(fn);
  };
}

export function runMobileBackInterceptors(): boolean {
  for (const fn of interceptors) {
    if (fn() === 'handled') return true;
  }
  return false;
}

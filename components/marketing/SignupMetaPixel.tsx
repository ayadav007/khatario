'use client';

type FbqStub = {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[];
  push: FbqStub;
  loaded: boolean;
  version: string;
};

function installFbq(): FbqStub {
  const win = window as Window & { fbq?: FbqStub; _fbq?: FbqStub };
  if (win.fbq) return win.fbq;
  const stub = function (this: FbqStub, ...args: unknown[]) {
    if (stub.callMethod) stub.callMethod.apply(stub, args);
    else stub.queue.push(args);
  } as FbqStub;
  stub.queue = [];
  stub.push = stub;
  stub.loaded = true;
  stub.version = '2.0';
  win.fbq = stub;
  if (!win._fbq) win._fbq = stub;
  return stub;
}

function loadPixelScript(): Promise<void> {
  if (document.querySelector('script[data-khatario-pixel="1"]')) return Promise.resolve();
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    script.dataset.khatarioPixel = '1';
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
}

/** Fires CompleteRegistration when a signup succeeds. Does nothing when no pixel id is saved. */
export async function trackSignupComplete(): Promise<void> {
  try {
    const res = await fetch('/api/public/meta-pixel');
    const data = (await res.json()) as { pixel_id?: string | null };
    const pixelId = data.pixel_id?.trim();
    if (!pixelId) return;
    const fbq = installFbq();
    await loadPixelScript();
    fbq('init', pixelId);
    fbq('track', 'CompleteRegistration');
    await new Promise((resolve) => setTimeout(resolve, 400));
  } catch {
    // Signup must continue if the pixel cannot load.
  }
}

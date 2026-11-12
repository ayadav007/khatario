'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  base64ToBytes,
  decryptWaMedia,
  parseWaMediaRefUrl,
  waMediaDownloadUrl,
  type WaMediaRef,
} from '@/lib/whatsapp/media-ref';

/** Decrypting in the browser holds the whole file in memory; bigger files stream through the server. */
const MAX_BROWSER_DECRYPT_BYTES = 64 * 1024 * 1024;
/** Photos, stickers and voice notes load on their own; videos and files this big wait for a tap. */
const AUTO_LOAD_BYTES = 5 * 1024 * 1024;
const CACHE_NAME = 'wa-media-v1';

export type WaMediaState = 'idle' | 'loading' | 'ready';

export interface WaMedia {
  /** What to put in src/href; undefined until loaded. */
  src: string | undefined;
  state: WaMediaState;
  /** Ref behind a WhatsApp media link; null for kept files and old inline media. */
  ref: WaMediaRef | null;
  /** Start loading media that waits for a tap. */
  load: () => void;
}

async function cacheGet(key: string): Promise<Blob | null> {
  try {
    if (typeof caches === 'undefined') return null;
    const hit = await (await caches.open(CACHE_NAME)).match(key);
    return hit ? await hit.blob() : null;
  } catch {
    return null;
  }
}

async function cachePut(key: string, blob: Blob): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    await (await caches.open(CACHE_NAME)).put(key, new Response(blob, { headers: { 'Content-Type': blob.type } }));
  } catch {
    /* storage full or blocked: the file still shows, it just is not kept */
  }
}

/** Fetches WhatsApp's encrypted copy and decrypts it on this device. */
async function decryptInBrowser(ref: WaMediaRef): Promise<Blob> {
  const from = waMediaDownloadUrl(ref);
  if (!from || !ref.k) throw new Error('not a WhatsApp file');
  const res = await fetch(from, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new Error(`WhatsApp returned ${res.status}`);
  const encrypted = new Uint8Array(await res.arrayBuffer());
  const plain = await decryptWaMedia(encrypted, base64ToBytes(ref.k), ref.t);
  return new Blob([plain as BlobPart], { type: ref.m.split(';')[0].trim() || 'application/octet-stream' });
}

/**
 * Source for a message's media. WhatsApp links are fetched from WhatsApp and decrypted here, and
 * kept in this browser's cache; if that fails the server link (which streams the file) is used.
 * Any other media URL is returned as it is.
 */
export function useWaMedia(mediaUrl: string | null | undefined): WaMedia {
  const parsed = parseWaMediaRefUrl(mediaUrl);
  const ref = parsed?.ref ?? null;
  const auto = !!ref && (ref.t === 'image' || ref.t === 'sticker' || ref.t === 'audio' || (!!ref.n && ref.n <= AUTO_LOAD_BYTES));

  const [wanted, setWanted] = useState(auto);
  const [src, setSrc] = useState<string | undefined>(ref ? undefined : mediaUrl || undefined);
  const objectUrl = useRef<string | null>(null);

  useEffect(() => {
    setWanted(auto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaUrl]);

  useEffect(() => {
    if (!ref || !mediaUrl) {
      setSrc(mediaUrl || undefined);
      return;
    }
    setSrc(undefined);
    if (!wanted) return;

    let cancelled = false;
    const show = (blob: Blob) => {
      if (cancelled) return;
      const url = URL.createObjectURL(blob);
      objectUrl.current = url;
      setSrc(url);
    };

    (async () => {
      // Cloud API files need the business's token, and very large files would not fit in memory.
      const browserCanDecrypt = ref.src === 'wa' && (!ref.n || ref.n <= MAX_BROWSER_DECRYPT_BYTES);
      if (!browserCanDecrypt) {
        if (!cancelled) setSrc(mediaUrl);
        return;
      }
      const cached = await cacheGet(mediaUrl);
      if (cached) return show(cached);
      try {
        const blob = await decryptInBrowser(ref);
        await cachePut(mediaUrl, blob);
        show(blob);
      } catch {
        // Blocked, expired or altered: let the server try (it can also report that the file is gone).
        if (!cancelled) setSrc(mediaUrl);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl.current) {
        URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaUrl, wanted]);

  const load = useCallback(() => setWanted(true), []);
  const state: WaMediaState = src ? 'ready' : wanted ? 'loading' : 'idle';
  return { src, state, ref, load };
}

export function formatMediaSize(bytes: number | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

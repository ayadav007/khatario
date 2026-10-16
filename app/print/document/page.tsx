'use client';

/**
 * Print page for Khatario for Windows' silent A4 printing (desktop/src-tauri/src/page_print.rs).
 * Loads a bill's print HTML from a preview endpoint (`{ html }`), makes it the whole page, waits for
 * fonts and images, then sets the title the desktop app waits for before printing.
 *
 * Only same-site `/api/.../preview` endpoints are loaded.
 */

import { useEffect } from 'react';
import { isAllowedPrintSource } from '@/lib/print/print-source';

export const dynamic = 'force-dynamic';

const READY = 'khatario-print-ready';
const FAILED = 'khatario-print-failed';

async function waitForImages(doc: Document) {
  await Promise.all(
    Array.from(doc.images)
      .filter((img) => !img.complete)
      .map(
        (img) =>
          new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          })
      )
  );
}

export default function PrintDocumentPage() {
  useEffect(() => {
    const src = new URLSearchParams(window.location.search).get('src');
    if (!isAllowedPrintSource(src)) {
      document.title = FAILED;
      return;
    }
    (async () => {
      try {
        const res = await fetch(src, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { html } = (await res.json()) as { html?: string };
        if (!html) throw new Error('empty');
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        // Scripts in the bill HTML are not run; it is a static print layout.
        parsed.querySelectorAll('script').forEach((s) => s.remove());
        document.replaceChild(document.adoptNode(parsed.documentElement), document.documentElement);
        await Promise.race([
          Promise.all([document.fonts?.ready, waitForImages(document)]),
          new Promise((resolve) => setTimeout(resolve, 8000)),
        ]);
        document.title = READY;
      } catch {
        document.title = FAILED;
      }
    })();
  }, []);

  return <p style={{ fontFamily: 'sans-serif', padding: 24 }}>Preparing the bill for printing…</p>;
}

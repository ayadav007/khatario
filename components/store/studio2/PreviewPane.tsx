'use client';

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Loader2 } from 'lucide-react';
import {
  parsePreviewMessage,
  storeOriginFromPreviewUrl,
  type EditorToPreview,
  type PreviewToEditor,
} from '@/lib/store/engine/editor/bridge';
import { editorFrameSrc } from '@/lib/store/engine/editor/shell';
import { previewLink } from './api';

/** Editor tokens live 2 h; a new link is fetched well before that. */
const TOKEN_REFRESH_MS = 100 * 60 * 1000;

export type Device = 'desktop' | 'phone';

interface Props {
  themeId: string;
  businessId: string;
  device: Device;
  /** Storefront path of the template being edited; null while there is nothing to show. */
  path: string | null;
  /** Shown instead of the frame when `path` is null (a spinner when this is null too). */
  emptyText: string | null;
  /** Changing it reloads the frame (the page switched between the classic and the engine layout). */
  reloadKey: number;
  /** Set by the pane: posts a message to the preview, or does nothing before it is framed. */
  postRef: MutableRefObject<((msg: EditorToPreview) => void) | null>;
  onMessage(msg: PreviewToEditor): void;
}

export function PreviewPane({ themeId, businessId, device, path, emptyText, reloadKey, postRef, onMessage }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const originRef = useRef<string | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch the editor link for this page now and again every 100 minutes.
  useEffect(() => {
    setSrc(null);
    setError(null);
    if (path === null) return;
    let cancelled = false;
    const load = async () => {
      try {
        const url = await previewLink(businessId, themeId, 'editor', path);
        const next = editorFrameSrc(url);
        const origin = storeOriginFromPreviewUrl(url);
        if (!next || !origin) throw new Error('Failed to create preview link');
        if (cancelled) return;
        originRef.current = origin;
        setSrc(next);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to create preview link');
      }
    };
    void load();
    const timer = setInterval(() => void load(), TOKEN_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [businessId, themeId, path]);

  const post = useCallback((msg: EditorToPreview) => {
    const win = iframeRef.current?.contentWindow;
    const origin = originRef.current;
    if (win && origin) win.postMessage(msg, origin);
  }, []);

  useEffect(() => {
    postRef.current = post;
    return () => {
      if (postRef.current === post) postRef.current = null;
    };
  }, [post, postRef]);

  useEffect(() => {
    const onWindowMessage = (e: MessageEvent) => {
      const win = iframeRef.current?.contentWindow;
      if (!originRef.current || e.origin !== originRef.current) return;
      if (!win || e.source !== win) return;
      const msg = parsePreviewMessage(e.data);
      if (msg) onMessageRef.current(msg);
    };
    window.addEventListener('message', onWindowMessage);
    return () => window.removeEventListener('message', onWindowMessage);
  }, []);

  return (
    <div className="flex h-full min-w-0 flex-1 justify-center overflow-hidden bg-gray-100">
      <div
        className={
          device === 'phone'
            ? 'my-4 h-[calc(100%-2rem)] w-[390px] overflow-hidden rounded-2xl border border-gray-300 bg-white shadow-sm'
            : 'h-full w-full bg-white'
        }
      >
        {src ? (
          <iframe key={reloadKey} ref={iframeRef} src={src} title="Store preview" className="h-full w-full border-0" />
        ) : path === null && emptyText ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-gray-600">{emptyText}</div>
        ) : error ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-red-600">{error}</div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        )}
      </div>
    </div>
  );
}

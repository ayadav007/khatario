'use client';

import { useCallback, useEffect, useRef, useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import {
  BRIDGE_SOURCE,
  acceptEditorMessage,
  appOriginsForStoreHost,
  type PreviewToEditor,
} from '@/lib/store/engine/editor/bridge';
import type { GroupKey, SectionRef } from '@/lib/store/engine/editor/ops';
import { insertionPoints } from '@/lib/store/engine/editor/overlay';
import { ID_RE } from '@/lib/store/engine/shared';

const ACCENT = 'var(--primary, #2563eb)';
const READY_EVERY_MS = 500;
/** Our own controls inside the preview; the click guard lets them through. */
const UI_ATTR = 'data-kh-editor-ui';

type Box = { key: string; ref: SectionRef; name: string; top: number; left: number; width: number; height: number };
/** A "+" in the preview; `after` is the section just above it (null for the top of the template). */
type AddPoint = { after: string | null; y: number };
type Layout = { boxes: Box[]; adds: AddPoint[]; addX: number };

const GROUPS: readonly GroupKey[] = ['header', 'template', 'footer'];

function refOf(el: Element): SectionRef | null {
  const id = el.getAttribute('data-section-id');
  const group = el.getAttribute('data-section-group') as GroupKey | null;
  if (!id || !ID_RE.test(id) || !group || !GROUPS.includes(group)) return null;
  return { group, id };
}

const keyOf = (ref: SectionRef | null) => (ref ? `${ref.group}:${ref.id}` : '');

function sameLayout(a: Layout, b: Layout): boolean {
  if (a.addX !== b.addX || a.boxes.length !== b.boxes.length || a.adds.length !== b.adds.length) return false;
  for (let i = 0; i < a.boxes.length; i++) {
    const x = a.boxes[i];
    const y = b.boxes[i];
    if (x.key !== y.key || x.name !== y.name || x.top !== y.top || x.left !== y.left || x.width !== y.width || x.height !== y.height) {
      return false;
    }
  }
  for (let i = 0; i < a.adds.length; i++) {
    if (a.adds[i].after !== b.adds[i].after || a.adds[i].y !== b.adds[i].y) return false;
  }
  return true;
}

function sectionEl(ref: SectionRef): HTMLElement | null {
  // Ids and groups come from the strict parser (or refOf), so they are safe inside the selector.
  return document.querySelector<HTMLElement>(`[data-section-group="${ref.group}"][data-section-id="${ref.id}"]`);
}

/**
 * Storefront side of the Studio 2 editor (editor mode only): outlines sections, turns clicks into
 * selections, shows "+" insertion points and refreshes the page from the server when the editor saved.
 * Messages are accepted only from the app origins for this store host and only from `window.parent`.
 */
export function EditorBridge({ templateKey }: { templateKey: string }) {
  const templateRef = useRef(templateKey);
  templateRef.current = templateKey;
  const router = useRouter();
  const layerRef = useRef<HTMLDivElement>(null);
  const originsRef = useRef<string[]>([]);
  const parentOriginRef = useRef<string | null>(null);
  const [selected, setSelected] = useState<SectionRef | null>(null);
  const [hovered, setHovered] = useState<SectionRef | null>(null);
  const hoveredKeyRef = useRef('');
  const [layout, setLayout] = useState<Layout>({ boxes: [], adds: [], addX: 0 });

  const [refreshing, startRefresh] = useTransition();
  const [refreshCount, setRefreshCount] = useState(0);
  const pendingRev = useRef<number | null>(null);
  const savedScrollY = useRef(0);

  const post = useCallback((msg: PreviewToEditor) => {
    if (typeof window === 'undefined' || window.parent === window) return;
    const matched = parentOriginRef.current;
    // Before the editor's first message we do not know which allowed origin it is on; postMessage with
    // a target origin only delivers to that origin, so posting to each allowed one is still exact.
    for (const origin of matched ? [matched] : originsRef.current) window.parent.postMessage(msg, origin);
  }, []);

  // Overlay geometry, relative to the overlay layer so it works whatever its containing block is.
  const frame = useRef(0);
  const observer = useRef<ResizeObserver | null>(null);
  const measure = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const layer = layerRef.current;
      if (!layer) return;
      const origin = layer.getBoundingClientRect();
      const root = layer.closest('.eng-root');
      const rootRect = (root ?? document.documentElement).getBoundingClientRect();
      const boxes: Box[] = [];
      const template: { id: string; index: number; top: number; bottom: number }[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-section-id]'))) {
        const ref = refOf(el);
        if (!ref) continue;
        observer.current?.observe(el);
        const r = el.getBoundingClientRect();
        const top = r.top - origin.top;
        boxes.push({
          key: keyOf(ref),
          ref,
          name: el.getAttribute('data-section-name') || el.getAttribute('data-section-type') || '',
          top,
          left: r.left - origin.left,
          width: r.width,
          height: r.height,
        });
        const index = Number(el.getAttribute('data-section-index'));
        if (ref.group === 'template' && Number.isInteger(index) && index >= 0) {
          template.push({ id: ref.id, index, top, bottom: top + r.height });
        }
      }
      const main = layer.closest('main');
      const emptyTop = main ? main.getBoundingClientRect().top - origin.top : 0;
      // insertionPoints returns one point above the first section, one between each pair and one below
      // the last, in page order: point k sits under the k-th rendered template section.
      const next: Layout = {
        boxes,
        adds: insertionPoints(template, emptyTop).map((p, k) => ({ after: k === 0 ? null : template[k - 1].id, y: p.y })),
        addX: rootRect.left + rootRect.width / 2 - origin.left,
      };
      // Scroll and resize fire often; only re-render the overlay when something moved.
      setLayout((prev) => (sameLayout(prev, next) ? prev : next));
    });
  }, []);

  useEffect(() => {
    observer.current = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
    const root = layerRef.current?.closest('.eng-root');
    if (root) observer.current?.observe(root);
    measure();
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      observer.current?.disconnect();
      observer.current = null;
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [measure]);

  // Handshake and editor messages.
  useEffect(() => {
    originsRef.current = appOriginsForStoreHost(window.location.protocol as 'http:' | 'https:', window.location.host);
    const framed = window.parent !== window;
    let readyTimer: ReturnType<typeof setInterval> | null = null;
    if (framed && originsRef.current.length > 0) {
      post({ source: BRIDGE_SOURCE, type: 'ready', template: templateRef.current, rev: null });
      readyTimer = setInterval(() => {
        if (!parentOriginRef.current) post({ source: BRIDGE_SOURCE, type: 'ready', template: templateRef.current, rev: null });
      }, READY_EVERY_MS);
    }

    const onMessage = (e: MessageEvent) => {
      const accepted = acceptEditorMessage(
        { origin: e.origin, source: e.source, data: e.data },
        { parent: framed ? window.parent : null, allowed: originsRef.current, locked: parentOriginRef.current },
      );
      if (!accepted) return;
      const { msg } = accepted;
      if (!parentOriginRef.current) {
        parentOriginRef.current = accepted.lock;
        if (readyTimer) clearInterval(readyTimer);
        readyTimer = null;
      }
      switch (msg.type) {
        case 'select':
          // Sent for another template (the editor switched while this frame was still up): not ours.
          if (msg.template !== templateRef.current) break;
          setSelected(msg.ref);
          break;
        case 'hover':
          hoveredKeyRef.current = keyOf(msg.ref);
          setHovered(msg.ref);
          break;
        case 'scroll-to':
          if (msg.template !== templateRef.current) break;
          sectionEl(msg.ref)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          break;
        case 'refresh':
          pendingRev.current = msg.rev;
          savedScrollY.current = window.scrollY;
          startRefresh(() => {
            setRefreshCount((c) => c + 1);
            router.refresh();
          });
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      if (readyTimer) clearInterval(readyTimer);
    };
  }, [post, router]);

  // After a refresh. router.refresh() returns nothing to await in Next 14, so it runs in a transition
  // with a render counter: this effect sees the counter's commit only once the refreshed server tree
  // has committed too (isPending false), i.e. the new sections are in the DOM. Then the scroll position
  // is put back, the overlay re-measured, and the editor told which rev is now showing.
  useEffect(() => {
    if (refreshing || pendingRev.current === null) return;
    const rev = pendingRev.current;
    pendingRev.current = null;
    window.scrollTo(0, savedScrollY.current);
    measure();
    post({ source: BRIDGE_SOURCE, type: 'ready', template: templateRef.current, rev });
  }, [refreshing, refreshCount, measure, post]);

  // Clicks select sections and never navigate; hover outlines.
  useEffect(() => {
    const isOurUi = (t: EventTarget | null) => t instanceof Element && !!t.closest(`[${UI_ATTR}]`);
    const onClick = (e: MouseEvent) => {
      if (isOurUi(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.type !== 'click') return;
      const sec = e.target instanceof Element ? e.target.closest('[data-section-id]') : null;
      const ref = sec ? refOf(sec) : null;
      if (!ref) return;
      setSelected(ref);
      post({ source: BRIDGE_SOURCE, type: 'select', template: templateRef.current, ref });
    };
    const onSubmit = (e: Event) => e.preventDefault();
    const setHover = (ref: SectionRef | null) => {
      const key = keyOf(ref);
      if (key === hoveredKeyRef.current) return;
      hoveredKeyRef.current = key;
      setHovered(ref);
      post({ source: BRIDGE_SOURCE, type: 'hover', ref });
    };
    const onOver = (e: MouseEvent) => {
      if (isOurUi(e.target)) return;
      const sec = e.target instanceof Element ? e.target.closest('[data-section-id]') : null;
      setHover(sec ? refOf(sec) : null);
    };
    const onLeave = () => setHover(null);
    window.addEventListener('click', onClick, true);
    window.addEventListener('auxclick', onClick, true);
    window.addEventListener('submit', onSubmit, true);
    document.addEventListener('mouseover', onOver, true);
    document.documentElement.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('auxclick', onClick, true);
      window.removeEventListener('submit', onSubmit, true);
      document.removeEventListener('mouseover', onOver, true);
      document.documentElement.removeEventListener('mouseleave', onLeave);
    };
  }, [post]);

  useEffect(() => {
    measure();
  }, [selected, hovered, measure]);

  const selectedKey = keyOf(selected);
  const hoveredKey = keyOf(hovered);
  const layerStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    pointerEvents: 'none',
    zIndex: 2147483000,
  };

  return (
    <div ref={layerRef} style={layerStyle} data-editor-template={templateKey}>
      {layout.boxes
        .filter((b) => b.key === selectedKey || b.key === hoveredKey)
        .map((b) => {
          const isSelected = b.key === selectedKey;
          return (
            <div
              key={b.key}
              style={{
                position: 'absolute',
                top: b.top,
                left: b.left,
                width: b.width,
                height: Math.max(b.height, 2),
                border: `2px ${isSelected ? 'solid' : 'dashed'} ${ACCENT}`,
                boxSizing: 'border-box',
                pointerEvents: 'none',
              }}
            >
              {b.name ? (
                <span
                  style={{
                    position: 'absolute',
                    left: -2,
                    top: b.top >= 20 ? -20 : 0,
                    background: ACCENT,
                    color: '#fff',
                    font: '600 11px/16px system-ui, sans-serif',
                    padding: '2px 6px',
                    borderRadius: 3,
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                  }}
                >
                  {b.name}
                </span>
              ) : null}
            </div>
          );
        })}
      {layout.adds.map((p) => (
        <button
          key={`add-${p.after ?? ''}`}
          type="button"
          {...{ [UI_ATTR]: '' }}
          aria-label="Add section here"
          title="Add section here"
          onClick={() => post({ source: BRIDGE_SOURCE, type: 'add-at', template: templateRef.current, after: p.after })}
          style={{
            position: 'absolute',
            top: p.y - 12,
            left: layout.addX - 12,
            width: 24,
            height: 24,
            borderRadius: 12,
            border: '2px solid #fff',
            background: ACCENT,
            color: '#fff',
            font: '700 16px/1 system-ui, sans-serif',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            cursor: 'pointer',
            boxShadow: '0 1px 4px rgba(0,0,0,.25)',
            pointerEvents: 'auto',
          }}
        >
          +
        </button>
      ))}
    </div>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { clsx } from 'clsx';
import { applyCardDesign } from '@/lib/store/engine/editor/ops';
import {
  CARD_DESIGNS,
  CARD_DESIGN_IDS,
  CARD_DESIGN_LABELS,
  cloneProductCard,
  isCardDesignEdited,
  sanitizeProductCard,
  type CardDesignId,
  type ResolvedCardLook,
} from '@/lib/store/engine/product-card';
import { PRESET_CARD_FIELDS } from '@/lib/store/engine/card-look';
import { engineRootClass, engineRootStyle } from '@/lib/store/engine/root-class';
import type { ThemePreset } from '@/lib/store/engine/types';
import { StudioAddButton, StudioProductTile } from '@/components/store/studio-theme/StudioSections';
import { ENGINE_BASE_RULES } from '@/components/store/engine/base-rules';
import { STYLE_RULES } from '@/components/store/engine/style-rules';
// The storefront's tile layers (EngineShell loads the same ones; Quick's comes with QuickChrome), each scoped to the
// store root or to Quick's own qk-* classes.
import '@/components/store/phone-kit.css';
import '@/components/store/quick-theme/quick-theme.css';
import '@/components/store/engine/presets/quick.css';
import '@/components/store/engine/presets/grocery.css';
import '@/components/store/engine/presets/khatario.css';
import { fetchCardSampleItem, type CardSampleItem } from './api';
import { useStudio2 } from './Studio2Editor';

type GalleryId = CardDesignId | 'theme';
const GALLERY_IDS: readonly GalleryId[] = ['theme', ...CARD_DESIGN_IDS];
const REPLACE_TEXT = 'Your card settings will be replaced.';
/** One tile per grid on every width (the grid's columns come from --columns, or --mcols on phones). */
const GRID_ONE = { '--columns': 1, '--mcols': 1 } as CSSProperties;

/** EngineShell's base rules and the theme's Style rules (frame, labels, texture), which target the tile too. */
const TILE_RULES = ENGINE_BASE_RULES + STYLE_RULES;

/** Drawn when the store has no product with a photo (or the list could not be read): the card's photo placeholder. */
const BUILT_IN_SAMPLE = {
  name: 'Sample product',
  price: 449,
  mrp: 599 as number | null,
  unit: '500 g',
  image: null as string | null,
  brand: 'Your brand' as string | null,
  tagline: 'Handpicked for you' as string | null,
  rating: 4.5,
  ratingCount: 128,
};

// One look-up per business per editor visit: the gallery can open many times.
let sampleCache: { key: string; item: Promise<CardSampleItem | null> } | null = null;

function loadSample(key: string): Promise<CardSampleItem | null> {
  if (!sampleCache || sampleCache.key !== key) {
    const entry = { key, item: fetchCardSampleItem().catch(() => null) };
    sampleCache = entry;
    // A failed look-up is tried again next time.
    void entry.item.then((item) => {
      if (!item && sampleCache === entry) sampleCache = null;
    });
  }
  return sampleCache.item;
}

/** The look a gallery tile draws: the design exactly as picking it would write it (Theme's own: today's tile). */
function tileLook(id: CardDesignId): ResolvedCardLook {
  return { ...cloneProductCard(CARD_DESIGNS[id]), show_badges: true };
}

/**
 * Choose a card design: Theme's own and the ten designs, each drawn with the storefront's own tile component inside a
 * store root (the theme's root classes, colours, fonts and button radius) using the store's first product with a photo,
 * else a built-in sample. "Use this design" writes the design over the store's card (applyCardDesign, one undo step),
 * asking first when the current settings were edited.
 */
export function CardDesignGallery({ preset, onClose }: { preset?: ThemePreset; onClose(): void }) {
  const { theme, apply, readOnly } = useStudio2();
  const businessId = useAuth().business?.id ?? '';
  const settings = theme.settings;
  const current = useMemo(() => sanitizeProductCard(settings.product_card), [settings.product_card]);
  const edited = isCardDesignEdited(current);
  const [selected, setSelected] = useState<GalleryId>(current.design);
  const [sample, setSample] = useState<CardSampleItem | null | undefined>(undefined);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    let alive = true;
    void loadSample(businessId).then((item) => alive && setSample(item));
    return () => {
      alive = false;
    };
  }, [businessId]);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The drawn cards are inert, so only the dialog's own controls take focus.
    const focusable = () =>
      Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []).filter((el) => !el.closest('[inert]'));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      // Keep Tab and Shift+Tab inside the dialog.
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = dialogRef.current.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    (dialogRef.current?.querySelector<HTMLElement>('button[aria-pressed="true"]') ?? focusable()[0])?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  // The tiles appear once the product is looked up: focus moves to the selected one (from Close, where it started).
  const loaded = sample !== undefined;
  useEffect(() => {
    if (!loaded) return;
    const closeBtn = dialogRef.current?.querySelector<HTMLElement>('button[aria-label="Close"]');
    if (document.activeElement === closeBtn) dialogRef.current?.querySelector<HTMLElement>('button[aria-pressed="true"]')?.focus();
  }, [loaded]);

  const root = engineRootClass({
    preset: preset ?? 'studio',
    phoneKit: settings.phone_kit === true,
    editor: false,
    schemeBackground: settings.color_schemes?.[0]?.background,
    style: { label_style: settings.label_style, frame_style: settings.frame_style, texture: settings.texture },
    headingFont: settings.font_heading,
  });
  const rootStyle = useMemo(() => engineRootStyle(settings), [settings]);
  const themeLines = PRESET_CARD_FIELDS[preset ?? 'studio'] ?? PRESET_CARD_FIELDS.studio;

  const use = () => {
    if (readOnly) return;
    if (selected === current.design && !edited) {
      onClose();
      return;
    }
    if (edited && !window.confirm(`${REPLACE_TEXT} Use ${CARD_DESIGN_LABELS[selected]}?`)) return;
    apply((t) => applyCardDesign(t, selected), { mergeKey: null, immediate: true });
    onClose();
  };

  // A store product shows only what it has (no made-up rating); the built-in sample shows every line.
  const product = sample ? { ...sample, rating: 0, ratingCount: 0 } : BUILT_IN_SAMPLE;
  const images = product.image ? [product.image] : [];

  const tile = (id: GalleryId) => {
    const common = {
      name: product.name,
      unit: product.unit,
      price: product.price,
      mrp: product.mrp,
      image: product.image,
      rating: product.rating,
      ratingCount: product.ratingCount,
    };
    if (id === 'theme') {
      return (
        <StudioProductTile
          {...common}
          tagline={themeLines.tagline ? product.tagline : null}
          add={<StudioAddButton label={root.quick ? 'ADD' : 'Add'} />}
        />
      );
    }
    return (
      <StudioProductTile
        {...common}
        brand={product.brand}
        tagline={product.tagline}
        images={images}
        placeholderLogo={settings.logo_url || null}
        card={{ look: tileLook(id), schemes: settings.color_schemes ?? [] }}
        actions={{ inCart: 0, hasOptions: false, canInc: true }}
      />
    );
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio2-card-gallery-title"
        aria-describedby="studio2-card-gallery-note"
        className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-xl bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <div>
            <h2 id="studio2-card-gallery-title" className="text-base font-semibold text-gray-900">
              Choose a card design
            </h2>
            <p id="studio2-card-gallery-note" className="text-xs text-gray-500">
              {sample
                ? `Shown with ${sample.name}. Picking a design fills in every card setting; you can change any of them after.`
                : 'Shown with a sample product. Picking a design fills in every card setting; you can change any of them after.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {sample === undefined ? (
            <div className="flex h-48 items-center justify-center text-sm text-gray-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              Loading a product…
            </div>
          ) : (
            // One store root around the grid, so its width (not each tile's) picks the desktop or phone look.
            <div className={root.className} style={rootStyle} data-card={settings.card_style}>
              <style dangerouslySetInnerHTML={{ __html: TILE_RULES }} />
              <div className="eng-sec grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-4">
                {GALLERY_IDS.map((id) => {
                  const isSelected = selected === id;
                  const isCurrent = current.design === id;
                  const wide = id !== 'theme' && CARD_DESIGNS[id].layout === 'row';
                  return (
                    <div
                      key={id}
                      className={clsx(
                        'flex min-w-0 flex-col overflow-hidden rounded-lg border-2 bg-white',
                        wide && 'col-span-2',
                        isSelected ? 'border-blue-600 ring-2 ring-blue-200' : 'border-gray-200',
                      )}
                    >
                      {/* The card is a picture of the design: clicking it picks the tile; its own controls are inert. */}
                      <div
                        className="cursor-pointer p-3"
                        style={{ background: rootStyle.backgroundColor as string | undefined }}
                        onClick={() => setSelected(id)}
                      >
                        {/* A one-column product grid, as a product section draws it with its default (bordered) card style.
                            The List card spans two tiles and fills them, as the store gives it a full phone row or a 300px+ column. */}
                        <div
                          aria-hidden="true"
                          ref={(el) => el?.setAttribute('inert', '')}
                          className="productGrid pointer-events-none"
                          style={GRID_ONE}
                        >
                          {tile(id)}
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setSelected(id)}
                        className={clsx(
                          'flex items-center gap-1.5 border-t border-gray-200 px-3 py-2 text-left text-sm font-medium',
                          isSelected ? 'bg-blue-50 text-blue-900' : 'text-gray-800 hover:bg-gray-50',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{CARD_DESIGN_LABELS[id]}</span>
                        {isCurrent && (
                          <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-700">
                            {edited ? 'Current · Edited' : 'Current'}
                          </span>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
          {edited ? <p className="mr-auto text-xs text-gray-500">{REPLACE_TEXT}</p> : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={use}
            disabled={readOnly}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Use this design
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

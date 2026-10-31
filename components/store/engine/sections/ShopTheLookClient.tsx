'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useStore } from '@/lib/store/store-context';
import { engineProductHref } from '@/lib/store/engine/links';
import { addableProducts, lookTotal, type LookItem } from '@/lib/store/engine/shop-the-look-map';
import { rupees } from '@/components/store/studio-theme/StudioSections';
import { useFollowLink } from '../EngineViews';

const ADDED_MS = 1600;
const ADD_ALL = '__all__';

const addable = (i: LookItem): boolean => !i.soldOut && !i.hasOptions;
const photoOf = (i: LookItem): string => i.product.image_url || i.product.images?.[0] || '';

/**
 * Shop the look: a photo with numbered pins, each opening a small product card (one at a time; Esc or a click
 * outside closes it), and the same products listed beside the photo with an optional "Add all to bag".
 */
export function ShopTheLookClient({
  image,
  imageSide,
  items,
  showList,
  showAddAll,
  listHeading,
}: {
  image: string;
  imageSide: 'left' | 'right';
  items: LookItem[];
  showList: boolean;
  showAddAll: boolean;
  listHeading: string;
}) {
  const { addToCart } = useStore();
  const follow = useFollowLink();
  const cardId = useId();
  const [openId, setOpenId] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const pinRefs = useRef(new Map<string, HTMLButtonElement>());
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (addedTimer.current) clearTimeout(addedTimer.current);
    },
    [],
  );

  // Esc closes the open card and hands focus back to its pin; a press anywhere but a pin or a card closes it too.
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      pinRefs.current.get(openId)?.focus();
      setOpenId(null);
    };
    const onPress = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('.eng-look-pin,.eng-look-card')) return;
      setOpenId(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
    };
  }, [openId]);

  const flash = useCallback((key: string) => {
    setAdded(key);
    if (addedTimer.current) clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => setAdded(null), ADDED_MS);
  }, []);

  // Built exactly as StoreProductCard builds it.
  const put = useCallback(
    (p: LookItem['product']) =>
      addToCart({
        itemId: p.id,
        name: p.name,
        price: p.selling_price,
        quantity: 1,
        imageUrl: p.image_url ?? undefined,
        unit: p.unit,
        maxStock: p.current_stock,
        taxRate: p.tax_rate,
        mrp: p.mrp != null && p.mrp > p.selling_price ? p.mrp : undefined,
      }),
    [addToCart],
  );

  const addOne = (i: LookItem) => {
    put(i.product);
    flash(i.id);
  };
  const addAll = () => {
    for (const p of addableProducts(items)) put(p);
    flash(ADD_ALL);
  };

  const hasAddable = items.some(addable);
  const listShown = items.length > 0 && (showList || (showAddAll && hasAddable));

  const action = (i: LookItem) => {
    if (i.soldOut) return <span className="eng-look-soldout">Sold out</span>;
    if (i.hasOptions) {
      const href = engineProductHref('', i.product.id);
      return (
        <a
          className="eng-look-btn eng-look-btn--ghost"
          href={href}
          onClick={(e) => {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            follow(href);
          }}
        >
          Choose options
        </a>
      );
    }
    return (
      <button type="button" className="eng-look-btn" onClick={() => addOne(i)}>
        {added === i.id ? 'Added' : 'Add to bag'}
      </button>
    );
  };

  const open = items.find((i) => i.id === openId) ?? null;
  const classes = ['eng-look', imageSide === 'right' ? 'eng-look--right' : '', !listShown ? 'eng-look--no-list' : '', !image ? 'eng-look--no-photo' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      {image ? (
        <div className="eng-look-photo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="eng-look-img" src={image} alt="" loading="lazy" />
          {items.map((i) => (
            <button
              key={i.id}
              ref={(el) => {
                if (el) pinRefs.current.set(i.id, el);
                else pinRefs.current.delete(i.id);
              }}
              type="button"
              className="eng-look-pin"
              style={{ left: `${i.x}%`, top: `${i.y}%` }}
              aria-label={i.label}
              aria-expanded={openId === i.id}
              aria-controls={openId === i.id ? cardId : undefined}
              onClick={() => setOpenId(openId === i.id ? null : i.id)}
            >
              {i.n}
            </button>
          ))}
          {open ? (
            <div
              id={cardId}
              className="eng-look-card"
              role="group"
              aria-label={open.label}
              data-h={open.x < 30 ? 'start' : open.x > 70 ? 'end' : 'center'}
              data-v={open.y > 55 ? 'above' : 'below'}
              style={open.y > 55 ? { left: `${open.x}%`, bottom: `${100 - open.y}%` } : { left: `${open.x}%`, top: `${open.y}%` }}
            >
              <div className="eng-look-line">
                {photoOf(open) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="eng-look-thumb" src={photoOf(open)} alt="" loading="lazy" />
                ) : null}
                <div className="eng-look-info">
                  <span className="eng-look-name">{open.label}</span>
                  <span className="eng-look-price">{rupees(open.product.selling_price)}</span>
                </div>
              </div>
              {action(open)}
            </div>
          ) : null}
        </div>
      ) : null}
      {listShown ? (
        <div className="eng-look-list">
          {showList ? (
            <>
              {listHeading ? <h3 className="eng-look-list-heading">{listHeading}</h3> : null}
              <ol className="eng-look-rows">
                {items.map((i) => (
                  <li key={i.id} className="eng-look-row">
                    <span className="eng-look-num" aria-hidden="true">
                      {i.n}
                    </span>
                    {photoOf(i) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="eng-look-thumb" src={photoOf(i)} alt="" loading="lazy" />
                    ) : null}
                    <div className="eng-look-info">
                      <span className="eng-look-name">{i.label}</span>
                      <span className="eng-look-price">{rupees(i.product.selling_price)}</span>
                    </div>
                    {action(i)}
                  </li>
                ))}
              </ol>
            </>
          ) : null}
          {showAddAll && hasAddable ? (
            <button type="button" className="eng-look-btn eng-look-all" onClick={addAll}>
              {added === ADD_ALL ? 'Added' : `Add all to bag · ${rupees(lookTotal(items))}`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

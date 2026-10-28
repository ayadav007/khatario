'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Minus, Plus, Tag, Trash2 } from 'lucide-react';
import { useStore, withStoreDraft } from '@/lib/store/store-context';
import { cartSavings, couponLabel, couponOutlook, freeDeliveryProgress, type StoreOfferCoupon } from '@/lib/store/quick';
import type { StoreProduct } from '../StoreProductCard';
import { rupees } from '../studio-theme/StudioSections';
import { QuickSheet } from './QuickChrome';

/** Same key checkout reads, so a coupon picked in the cart is already applied there. */
function couponKey(subdomain: string) {
  return `khatario-store-coupon:${subdomain}`;
}

function Stepper({
  quantity,
  canAdd,
  onDec,
  onInc,
  label,
}: {
  quantity: number;
  canAdd: boolean;
  onDec: () => void;
  onInc: () => void;
  label: string;
}) {
  return (
    <div className="qk-stepper">
      <button type="button" onClick={onDec} aria-label={quantity === 1 ? `Remove ${label}` : `One less ${label}`}>
        {quantity === 1 ? <Trash2 /> : <Minus />}
      </button>
      <b aria-live="polite">{quantity}</b>
      <button type="button" onClick={onInc} disabled={!canAdd} aria-label={`One more ${label}`}>
        <Plus />
      </button>
    </div>
  );
}

/** Cart as a bottom sheet: lines, savings, listed coupons, bill and a sticky checkout button. */
export function QuickCartSheet({ open, onClose, onCheckout }: { open: boolean; onClose: () => void; onCheckout?: () => void }) {
  const { cart, cartTotal, cartCount, updateCartQuantity, store, branches, selectedBranchId } = useStore();
  const [coupons, setCoupons] = useState<StoreOfferCoupon[]>([]);
  const [applied, setApplied] = useState('');

  useEffect(() => {
    if (!open || !store) return;
    try {
      setApplied(sessionStorage.getItem(couponKey(store.store_subdomain)) ?? '');
    } catch {
      /* ignore */
    }
    let cancelled = false;
    void fetch(`/api/public/store/${encodeURIComponent(store.store_subdomain)}/offers?${withStoreDraft(new URLSearchParams())}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setCoupons((d?.coupons as StoreOfferCoupon[] | undefined) ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, store]);

  const outlook = useMemo(() => couponOutlook(cartTotal, coupons), [cartTotal, coupons]);
  if (!store) return null;

  const branch = branches.find((b) => b.id === selectedBranchId) ?? (branches.length === 1 ? branches[0] : undefined);
  const free = freeDeliveryProgress(cartTotal, branch?.free_delivery_above);
  const saved = cartSavings(cart);
  const appliedRow = outlook.find((o) => o.coupon.code === applied);
  const couponSaving = appliedRow?.saving ?? 0;
  const minOrder = store.store_min_order_amount || 0;
  const belowMin = minOrder > 0 && cartTotal < minOrder;

  const apply = (code: string) => {
    const next = applied === code ? '' : code;
    setApplied(next);
    try {
      if (next) sessionStorage.setItem(couponKey(store.store_subdomain), next);
      else sessionStorage.removeItem(couponKey(store.store_subdomain));
    } catch {
      /* ignore */
    }
  };

  return (
    <QuickSheet
      open={open}
      onClose={onClose}
      label="Cart"
      title={
        <>
          <h2>Your cart</h2>
          <small>
            {cartCount} {cartCount === 1 ? 'item' : 'items'}
          </small>
        </>
      }
      footer={
        cart.length ? (
          <button type="button" className="qk-cta" onClick={onCheckout} disabled={belowMin}>
            <span>
              <b>{rupees(Math.max(0, cartTotal - couponSaving))}</b>
              <small>{couponSaving ? 'after coupon' : 'total'}</small>
            </span>
            <span>{belowMin ? `Add ${rupees(minOrder - cartTotal)} more` : 'Proceed to checkout →'}</span>
          </button>
        ) : null
      }
    >
      {cart.length === 0 ? (
        <div className="qk-empty">
          <b>Your cart is empty</b>
          <p>Add items from the shop and they will show up here.</p>
        </div>
      ) : (
        <>
          {saved + couponSaving > 0 ? (
            <div className="qk-saved">
              <Tag /> You save {rupees(saved + couponSaving)} on this order
            </div>
          ) : null}
          {free ? (
            <div className="qk-freeCard">
              <span>{free.remaining > 0 ? `Add ${rupees(free.remaining)} more for free delivery` : 'Free delivery unlocked'}</span>
              <i>
                <i style={{ width: `${Math.round(free.ratio * 100)}%` }} />
              </i>
            </div>
          ) : null}
          <ul className="qk-lines">
            {cart.map((item) => (
              <li key={item.variantId ? `${item.itemId}::${item.variantId}` : item.itemId}>
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imageUrl} alt="" />
                ) : (
                  <span className="qk-ph">{item.name.charAt(0)}</span>
                )}
                <div>
                  <p>{item.name}</p>
                  <small>{item.variantName || item.unit}</small>
                  <b>
                    {rupees(item.price * item.quantity)}
                    {item.mrp && item.mrp > item.price ? <del>{rupees(item.mrp * item.quantity)}</del> : null}
                  </b>
                </div>
                <Stepper
                  label={item.name}
                  quantity={item.quantity}
                  canAdd={item.quantity < item.maxStock}
                  onDec={() => updateCartQuantity(item.itemId, item.variantId, item.quantity - 1)}
                  onInc={() => updateCartQuantity(item.itemId, item.variantId, item.quantity + 1)}
                />
              </li>
            ))}
          </ul>
          {outlook.length ? (
            <section className="qk-offers">
              <h3>Offers for you</h3>
              {outlook.map(({ coupon, saving, shortBy }) => {
                const on = applied === coupon.code;
                return (
                  <div key={coupon.code} className={`qk-offer ${on ? 'on' : ''}`}>
                    <div>
                      <b>
                        {coupon.code} · {couponLabel(coupon)}
                      </b>
                      <small>
                        {shortBy > 0
                          ? `Add ${rupees(shortBy)} more to use`
                          : `Save ${rupees(saving)} on this cart`}
                        {coupon.min_order_amount > 0 ? ` · min ${rupees(coupon.min_order_amount)}` : ''}
                      </small>
                    </div>
                    <button type="button" disabled={shortBy > 0} onClick={() => apply(coupon.code)}>
                      {on ? (
                        <>
                          <Check /> Applied
                        </>
                      ) : (
                        'Apply'
                      )}
                    </button>
                  </div>
                );
              })}
            </section>
          ) : null}
          <section className="qk-bill">
            <h3>Bill summary</h3>
            <p>
              <span>Items total</span>
              <span>
                {saved > 0 ? <del>{rupees(cartTotal + saved)}</del> : null}
                {rupees(cartTotal)}
              </span>
            </p>
            {couponSaving > 0 ? (
              <p className="good">
                <span>Coupon {applied}</span>
                <span>−{rupees(couponSaving)}</span>
              </p>
            ) : null}
            <p className="muted">
              <span>Delivery</span>
              <span>{free && free.remaining === 0 ? 'Free' : 'At checkout'}</span>
            </p>
            {belowMin ? <p className="warn">Minimum order is {rupees(minOrder)}.</p> : null}
          </section>
        </>
      )}
    </QuickSheet>
  );
}

/** Size / weight picker for items with options, with an ADD or stepper per option. */
export function QuickVariantSheet({ product, open, onClose }: { product: StoreProduct; open: boolean; onClose: () => void }) {
  const { cart, addToCart, updateCartQuantity } = useStore();
  return (
    <QuickSheet
      open={open}
      onClose={onClose}
      label={`Choose an option for ${product.name}`}
      title={
        <>
          <h2>{product.name}</h2>
          <small>Choose an option</small>
        </>
      }
    >
      <ul className="qk-variants">
        {product.variants.map((v) => {
          const line = cart.find((c) => c.itemId === product.id && c.variantId === v.id);
          const out = v.current_stock <= 0;
          return (
            <li key={v.id} className={out ? 'out' : ''}>
              <div>
                <b>{v.variant_name}</b>
                <span>{rupees(Number(v.selling_price) || 0)}</span>
              </div>
              {out ? (
                <small>Out of stock</small>
              ) : line ? (
                <Stepper
                  label={v.variant_name}
                  quantity={line.quantity}
                  canAdd={line.quantity < line.maxStock}
                  onDec={() => updateCartQuantity(product.id, v.id, line.quantity - 1)}
                  onInc={() => updateCartQuantity(product.id, v.id, line.quantity + 1)}
                />
              ) : (
                <button
                  type="button"
                  className="qk-add"
                  onClick={() =>
                    addToCart({
                      itemId: product.id,
                      variantId: v.id,
                      name: product.name,
                      variantName: v.variant_name,
                      price: Number(v.selling_price) || 0,
                      quantity: 1,
                      imageUrl: product.image_url ?? undefined,
                      unit: product.unit,
                      maxStock: v.current_stock,
                      taxRate: product.tax_rate,
                    })
                  }
                >
                  ADD
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </QuickSheet>
  );
}

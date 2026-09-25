'use client';

import { X, Plus, Minus, Trash2, ShoppingBag } from 'lucide-react';
import { useStore } from '@/lib/store/store-context';
import { chowkInkOn, chowkOnAccent, isChowkPack, sanitizeStoreTheme } from '@/lib/store/store-theme';
import clsx from 'clsx';
import { useEffect } from 'react';

interface StoreCartDrawerProps {
  open: boolean;
  onClose: () => void;
  onCheckout?: () => void;
}

export function StoreCartDrawer({ open, onClose, onCheckout }: StoreCartDrawerProps) {
  const { cart, updateCartQuantity, cartTotal, store, cartCount } = useStore();
  const theme = sanitizeStoreTheme(store?.store_theme);
  const accent = theme.accent;
  const chowk = isChowkPack(theme);
  const paper = theme.background;
  const ink = chowkInkOn(paper);
  const hair = `1px solid color-mix(in srgb, ${ink} 12%, transparent)`;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!chowk && !open) return null;

  const classic = (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-xl">
        <ClassicCartBody
          cart={cart}
          cartCount={cartCount}
          cartTotal={cartTotal}
          store={store}
          accent={accent}
          updateCartQuantity={updateCartQuantity}
          onClose={onClose}
          onCheckout={onCheckout}
        />
      </div>
    </div>
  );

  if (!chowk) return classic;

  return (
    <div
      className={clsx('store-chowk fixed inset-0 z-50 flex justify-end', !open && 'pointer-events-none')}
      aria-hidden={!open}
    >
      <button
        type="button"
        className={clsx('chowk-scrim absolute inset-0 border-0 bg-black/35 p-0', open && 'is-on')}
        aria-label="Close bag"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
      />
      <aside
        className={clsx('chowk-drawer relative flex h-full w-full max-w-md flex-col pb-[env(safe-area-inset-bottom,0px)]', open && 'is-on')}
        style={{ backgroundColor: paper, color: ink }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chowk-bag-title"
      >
        <div className="flex items-center justify-between px-4 py-4" style={{ borderBottom: hair }}>
          <div>
            <h2 id="chowk-bag-title" className="font-chowk-display text-[1.65rem] leading-none">
              Bag
            </h2>
            <p className="mt-1 text-[12px]" style={{ opacity: 0.5 }}>
              {cartCount} {cartCount === 1 ? 'item' : 'items'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center"
            aria-label="Close bag"
          >
            <X className="h-5 w-5" strokeWidth={1.5} />
          </button>
        </div>

        {cart.length === 0 ? (
          <div className="flex flex-1 flex-col justify-center px-4">
            <p className="font-chowk-display text-2xl">Nothing in the bag</p>
            <p className="mt-2 text-[13px]" style={{ opacity: 0.5 }}>
              Add from the shop.
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-2">
            {cart.map((item) => {
              const key = item.variantId ? `${item.itemId}::${item.variantId}` : item.itemId;
              return (
                <div key={key} className="flex items-start gap-3 py-3" style={{ borderBottom: hair }}>
                  {item.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.imageUrl} alt="" className="h-16 w-16 object-cover" />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center text-lg" style={{ opacity: 0.28 }}>
                      {item.name.slice(0, 1)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px]">{item.name}</p>
                    <p className="text-[11px]" style={{ opacity: 0.45 }}>
                      {item.variantName || item.unit}
                    </p>
                    <p className="mt-1 text-[14px] font-medium tabular-nums">
                      ₹{(item.price * item.quantity).toLocaleString('en-IN')}
                    </p>
                  </div>
                  <div className="flex items-center" style={{ border: hair }}>
                    <button
                      type="button"
                      onClick={() => updateCartQuantity(item.itemId, item.variantId, item.quantity - 1)}
                      className="flex h-11 w-11 items-center justify-center"
                      aria-label={item.quantity === 1 ? 'Remove from bag' : 'Decrease quantity'}
                    >
                      {item.quantity === 1 ? <Trash2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                    </button>
                    <span className="w-6 text-center text-[13px] tabular-nums" aria-live="polite">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateCartQuantity(item.itemId, item.variantId, item.quantity + 1)}
                      disabled={item.quantity >= item.maxStock}
                      className="flex h-11 w-11 items-center justify-center disabled:opacity-40"
                      aria-label="Increase quantity"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {cart.length > 0 ? (
          <div className="px-4 py-4" style={{ borderTop: hair }}>
            {store?.store_min_order_amount && cartTotal < store.store_min_order_amount ? (
              <p className="mb-2 text-[12px]">
                Minimum order ₹{store.store_min_order_amount.toLocaleString('en-IN')}. Add ₹
                {(store.store_min_order_amount - cartTotal).toLocaleString('en-IN')} more.
              </p>
            ) : null}
            <div className="flex justify-between text-[13px]">
              <span style={{ opacity: 0.55 }}>Subtotal</span>
              <span className="tabular-nums">₹{cartTotal.toLocaleString('en-IN')}</span>
            </div>
            <button
              type="button"
              onClick={onCheckout}
              disabled={!!(store?.store_min_order_amount && cartTotal < store.store_min_order_amount)}
              className="mt-4 min-h-12 w-full py-3.5 text-center text-[14px] font-medium disabled:opacity-40"
              style={{
                backgroundColor:
                  store?.store_min_order_amount && cartTotal < store.store_min_order_amount
                    ? `color-mix(in srgb, ${ink} 20%, ${paper})`
                    : accent,
                color:
                  store?.store_min_order_amount && cartTotal < store.store_min_order_amount
                    ? ink
                    : chowkOnAccent(accent),
              }}
            >
              Checkout
            </button>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function ClassicCartBody({
  cart,
  cartCount,
  cartTotal,
  store,
  accent,
  updateCartQuantity,
  onClose,
  onCheckout,
}: {
  cart: ReturnType<typeof useStore>['cart'];
  cartCount: number;
  cartTotal: number;
  store: ReturnType<typeof useStore>['store'];
  accent: string;
  updateCartQuantity: ReturnType<typeof useStore>['updateCartQuantity'];
  onClose: () => void;
  onCheckout?: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Your cart</h2>
          <p className="text-xs text-gray-500">{cartCount} items</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
          aria-label="Close cart"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {cart.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4">
          <ShoppingBag className="h-12 w-12 text-gray-300" />
          <p className="text-sm text-gray-500">Your cart is empty</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="divide-y divide-gray-100">
            {cart.map((item) => {
              const key = item.variantId ? `${item.itemId}::${item.variantId}` : item.itemId;
              return (
                <div key={key} className="flex items-start gap-3 py-3">
                  {item.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.imageUrl} alt="" className="h-14 w-14 rounded-lg object-cover" />
                  ) : (
                    <div className="h-14 w-14 rounded-lg bg-gray-100" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{item.name}</p>
                    <p className="text-xs text-gray-500">{item.variantName || item.unit}</p>
                    <p className="mt-1 text-sm font-semibold">
                      ₹{(item.price * item.quantity).toLocaleString('en-IN')}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => updateCartQuantity(item.itemId, item.variantId, item.quantity - 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200"
                    >
                      {item.quantity === 1 ? (
                        <Trash2 className="h-3 w-3 text-red-500" />
                      ) : (
                        <Minus className="h-3 w-3" />
                      )}
                    </button>
                    <span className="w-6 text-center text-sm font-semibold">{item.quantity}</span>
                    <button
                      type="button"
                      onClick={() => updateCartQuantity(item.itemId, item.variantId, item.quantity + 1)}
                      disabled={item.quantity >= item.maxStock}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 disabled:opacity-40"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {cart.length > 0 ? (
        <div className="border-t border-gray-200 px-4 py-4">
          {store?.store_min_order_amount && cartTotal < store.store_min_order_amount ? (
            <p className="mb-2 text-center text-xs text-amber-600">
              Minimum order ₹{store.store_min_order_amount.toLocaleString('en-IN')}. Add ₹
              {(store.store_min_order_amount - cartTotal).toLocaleString('en-IN')} more.
            </p>
          ) : null}
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal</span>
              <span>₹{cartTotal.toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Delivery</span>
              <span>Calculated at checkout</span>
            </div>
            <div className="flex justify-between border-t border-gray-100 pt-2 font-bold text-gray-900">
              <span>Total</span>
              <span>₹{cartTotal.toLocaleString('en-IN')}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onCheckout}
            disabled={!!(store?.store_min_order_amount && cartTotal < store.store_min_order_amount)}
            className={clsx(
              'mt-3 w-full rounded-xl py-3.5 text-center text-sm font-semibold text-white',
              store?.store_min_order_amount && cartTotal < store.store_min_order_amount
                ? 'cursor-not-allowed bg-gray-300'
                : '',
            )}
            style={
              store?.store_min_order_amount && cartTotal < store.store_min_order_amount
                ? undefined
                : { backgroundColor: accent }
            }
          >
            Proceed to checkout
          </button>
        </div>
      ) : null}
    </>
  );
}

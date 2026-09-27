'use client';

import { X, Plus, Minus, Trash2 } from 'lucide-react';
import { useStore } from '@/lib/store/store-context';
import { chowkInkOn, chowkOnAccent, isStudioPack, sanitizeStoreTheme, storeCanvas, storePackClass } from '@/lib/store/store-theme';
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
  const grocery = theme.pack === 'grocery';
  const soft = grocery || isStudioPack(theme);
  const paper = storeCanvas(theme);
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

  return (
    <div
      className={clsx(
        'fixed inset-0 z-50 flex justify-end',
        storePackClass(theme),
        !open && 'pointer-events-none',
      )}
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
        className={clsx(
          'chowk-drawer relative flex h-full w-full max-w-md flex-col pb-[env(safe-area-inset-bottom,0px)]',
          'rounded-l-3xl',
          open ? 'is-on translate-x-0' : 'translate-x-full',
        )}
        style={{ backgroundColor: paper, color: ink }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chowk-bag-title"
      >
        <div className="flex items-center justify-between px-4 py-4" style={{ borderBottom: hair }}>
          <div>
            <h2 id="chowk-bag-title" className="text-[1.35rem] font-semibold leading-none">
              {soft ? 'Your cart' : 'Your bag'}
            </h2>
            <p className="mt-1 text-[12px]" style={{ opacity: 0.5 }}>
              {cartCount} {cartCount === 1 ? 'item' : 'items'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="relative z-10 flex h-11 w-11 items-center justify-center"
            aria-label="Close bag"
          >
            <X className="h-5 w-5" strokeWidth={1.5} />
          </button>
        </div>

        {cart.length === 0 ? (
          <div className="flex flex-1 flex-col justify-center px-4">
            <p className="text-2xl font-semibold">{soft ? 'Your cart is empty' : 'Nothing in the bag'}</p>
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
                    <img src={item.imageUrl} alt="" className={clsx('h-16 w-16 object-cover', soft && 'rounded-xl')} />
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
                      â‚¹{(item.price * item.quantity).toLocaleString('en-IN')}
                    </p>
                  </div>
                  <div className={clsx('flex items-center', soft && 'rounded-xl')} style={{ border: hair }}>
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
                Minimum order â‚¹{store.store_min_order_amount.toLocaleString('en-IN')}. Add â‚¹
                {(store.store_min_order_amount - cartTotal).toLocaleString('en-IN')} more.
              </p>
            ) : null}
            <div className="flex justify-between text-[13px]">
              <span style={{ opacity: 0.55 }}>Subtotal</span>
              <span className="tabular-nums">â‚¹{cartTotal.toLocaleString('en-IN')}</span>
            </div>
            <button
              type="button"
              onClick={onCheckout}
              disabled={!!(store?.store_min_order_amount && cartTotal < store.store_min_order_amount)}
              className={clsx(
                'mt-4 min-h-12 w-full py-3.5 text-center text-[14px] font-semibold disabled:opacity-40',
                soft ? 'rounded-2xl' : 'rounded-full',
              )}
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
              {soft ? `Proceed to Checkout Â· â‚¹${cartTotal.toLocaleString('en-IN')}` : 'Checkout'}
            </button>
          </div>
        ) : null}
      </aside>
    </div>
  );
}


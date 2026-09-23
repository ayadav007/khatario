'use client';

import { X, Plus, Minus, Trash2, ShoppingBag } from 'lucide-react';
import { useStore } from '@/lib/store/store-context';
import clsx from 'clsx';

interface StoreCartDrawerProps {
  open: boolean;
  onClose: () => void;
  onCheckout?: () => void;
}

export function StoreCartDrawer({ open, onClose, onCheckout }: StoreCartDrawerProps) {
  const { cart, updateCartQuantity, cartTotal, store, cartCount } = useStore();
  const accent = (store?.store_theme?.accent as string) || '#16a34a';

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Your cart</h2>
            <p className="text-xs text-gray-500">{cartCount} items</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
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
                      <p className="text-xs text-gray-500">
                        {item.variantName || item.unit}
                      </p>
                      <p className="mt-1 text-sm font-semibold">
                        ₹{(item.price * item.quantity).toLocaleString('en-IN')}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          updateCartQuantity(item.itemId, item.variantId, item.quantity - 1)
                        }
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
                        onClick={() =>
                          updateCartQuantity(item.itemId, item.variantId, item.quantity + 1)
                        }
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
      </div>
    </div>
  );
}

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
  const { cart, updateCartQuantity, removeFromCart, clearCart, cartTotal, store } = useStore();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Your Cart</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Cart items */}
        {cart.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4">
            <ShoppingBag className="h-12 w-12 text-gray-300" />
            <p className="text-sm text-gray-500">Your cart is empty</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="space-y-3">
              {cart.map((item) => {
                const key = item.variantId
                  ? `${item.itemId}::${item.variantId}`
                  : item.itemId;

                return (
                  <div
                    key={key}
                    className="flex items-center gap-3 rounded-lg border border-gray-100 bg-white p-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {item.name}
                      </p>
                      {item.variantName ? (
                        <p className="text-xs text-gray-500">{item.variantName}</p>
                      ) : null}
                      <p className="mt-1 text-sm font-semibold text-gray-900">
                        &#x20B9;{(item.price * item.quantity).toLocaleString('en-IN')}
                      </p>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() =>
                          updateCartQuantity(item.itemId, item.variantId, item.quantity - 1)
                        }
                        className="flex h-7 w-7 items-center justify-center rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
                      >
                        {item.quantity === 1 ? (
                          <Trash2 className="h-3 w-3 text-red-500" />
                        ) : (
                          <Minus className="h-3 w-3" />
                        )}
                      </button>
                      <span className="w-6 text-center text-sm font-semibold">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() =>
                          updateCartQuantity(item.itemId, item.variantId, item.quantity + 1)
                        }
                        disabled={item.quantity >= item.maxStock}
                        className="flex h-7 w-7 items-center justify-center rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {cart.length > 0 ? (
              <button
                onClick={clearCart}
                className="mt-4 text-xs text-red-500 hover:underline"
              >
                Clear cart
              </button>
            ) : null}
          </div>
        )}

        {/* Footer with total + checkout */}
        {cart.length > 0 ? (
          <div className="border-t border-gray-200 px-4 py-4">
            {store?.store_min_order_amount && cartTotal < store.store_min_order_amount ? (
              <p className="mb-2 text-center text-xs text-amber-600">
                Minimum order: &#x20B9;{store.store_min_order_amount.toLocaleString('en-IN')}.
                Add &#x20B9;{(store.store_min_order_amount - cartTotal).toLocaleString('en-IN')} more.
              </p>
            ) : null}

            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-gray-500">Subtotal</span>
              <span className="text-lg font-bold text-gray-900">
                &#x20B9;{cartTotal.toLocaleString('en-IN')}
              </span>
            </div>

            <button
              onClick={onCheckout}
              disabled={
                !!(store?.store_min_order_amount && cartTotal < store.store_min_order_amount)
              }
              className={clsx(
                'w-full rounded-xl py-3.5 text-center text-sm font-semibold text-white transition-colors',
                store?.store_min_order_amount && cartTotal < store.store_min_order_amount
                  ? 'bg-gray-300 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700',
              )}
            >
              Proceed to Checkout
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

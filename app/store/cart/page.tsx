'use client';

import { StoreShell } from '@/components/store/StoreShell';
import { useStore } from '@/lib/store/store-context';
import Link from 'next/link';

export default function StoreCartPage() {
  const { cart, cartTotal, updateCartQuantity, removeFromCart } = useStore();

  return (
    <StoreShell>
      <h1 className="mb-4 text-xl font-semibold">Your cart</h1>
      {cart.length === 0 ? (
        <p className="text-sm text-gray-500">Your cart is empty.</p>
      ) : (
        <div className="space-y-4">
          {cart.map((c) => (
            <div
              key={`${c.itemId}:${c.variantId ?? ''}`}
              className="flex items-center justify-between rounded-xl border bg-white p-4"
            >
              <div>
                <p className="font-medium">{c.name}</p>
                <p className="text-sm text-gray-500">
                  ₹{c.price.toLocaleString('en-IN')} × {c.quantity}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded border px-2"
                  onClick={() => updateCartQuantity(c.itemId, c.variantId, c.quantity - 1)}
                >
                  -
                </button>
                <span>{c.quantity}</span>
                <button
                  className="rounded border px-2"
                  onClick={() => updateCartQuantity(c.itemId, c.variantId, c.quantity + 1)}
                >
                  +
                </button>
                <button
                  className="text-xs text-red-600"
                  onClick={() => removeFromCart(c.itemId, c.variantId)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          <p className="text-right text-lg font-bold">
            Total ₹{cartTotal.toLocaleString('en-IN')}
          </p>
          <Link
            href="/checkout"
            className="block rounded-xl bg-green-600 py-3 text-center font-semibold text-white"
          >
            Checkout
          </Link>
        </div>
      )}
    </StoreShell>
  );
}

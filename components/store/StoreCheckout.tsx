'use client';

import { useState, useCallback } from 'react';
import {
  X, ArrowLeft, MapPin, User, Phone, Mail, FileText,
  Truck, Package, Loader2, CheckCircle2,
} from 'lucide-react';
import { useStore } from '@/lib/store/store-context';
import clsx from 'clsx';

interface StoreCheckoutProps {
  open: boolean;
  onClose: () => void;
  onOrderPlaced: (orderNumber: string, grandTotal: number) => void;
}

export function StoreCheckout({
  open,
  onClose,
  onOrderPlaced,
}: StoreCheckoutProps) {
  const { store, cart, cartTotal, selectedBranchId, clearCart } = useStore();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [pincode, setPincode] = useState('');
  const [deliveryMode, setDeliveryMode] = useState<'delivery' | 'pickup'>('delivery');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!store || cart.length === 0) return;

      setSubmitting(true);
      setError(null);

      try {
        const res = await fetch(
          `/api/public/store/${encodeURIComponent(store.store_subdomain)}/orders`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              branch_id: selectedBranchId,
              customer_name: name,
              customer_phone: phone,
              customer_email: email || undefined,
              customer_address: address || undefined,
              customer_pincode: pincode || undefined,
              delivery_mode: deliveryMode,
              notes: notes || undefined,
              items: cart.map((c) => ({
                item_id: c.itemId,
                variant_id: c.variantId,
                item_name: c.name,
                variant_name: c.variantName,
                quantity: c.quantity,
                unit: c.unit,
                unit_price: c.price,
                tax_rate: 0,
              })),
            }),
          },
        );

        if (!res.ok) {
          const data = await res.json();
          setError(data.error || 'Failed to place order');
          return;
        }

        const data = await res.json();
        clearCart();
        onOrderPlaced(data.order_number, data.grand_total);
      } catch {
        setError('Something went wrong. Please try again.');
      } finally {
        setSubmitting(false);
      }
    },
    [store, cart, selectedBranchId, name, phone, email, address, pincode, deliveryMode, notes, clearCart, onOrderPlaced],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-4">
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h2 className="text-lg font-semibold text-gray-900">Checkout</h2>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
            {error ? (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            {/* Delivery mode */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">
                How do you want to receive your order?
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDeliveryMode('delivery')}
                  className={clsx(
                    'flex items-center justify-center gap-2 rounded-xl border-2 py-3 text-sm font-medium transition-colors',
                    deliveryMode === 'delivery'
                      ? 'border-green-600 bg-green-50 text-green-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300',
                  )}
                >
                  <Truck className="h-4 w-4" />
                  Delivery
                </button>
                <button
                  type="button"
                  onClick={() => setDeliveryMode('pickup')}
                  className={clsx(
                    'flex items-center justify-center gap-2 rounded-xl border-2 py-3 text-sm font-medium transition-colors',
                    deliveryMode === 'pickup'
                      ? 'border-green-600 bg-green-50 text-green-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300',
                  )}
                >
                  <Package className="h-4 w-4" />
                  Self Pickup
                </button>
              </div>
            </div>

            {/* Customer details */}
            <div className="space-y-3">
              <h3 className="text-xs font-medium text-gray-500">Your Details</h3>

              <div className="relative">
                <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name *"
                  required
                  className="w-full rounded-lg border border-gray-200 py-2.5 pl-9 pr-3 text-sm placeholder:text-gray-400 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300"
                />
              </div>

              <div className="relative">
                <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Phone number *"
                  required
                  pattern="[0-9]{10}"
                  className="w-full rounded-lg border border-gray-200 py-2.5 pl-9 pr-3 text-sm placeholder:text-gray-400 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300"
                />
              </div>

              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email (optional)"
                  className="w-full rounded-lg border border-gray-200 py-2.5 pl-9 pr-3 text-sm placeholder:text-gray-400 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300"
                />
              </div>
            </div>

            {/* Delivery address */}
            {deliveryMode === 'delivery' ? (
              <div className="space-y-3">
                <h3 className="text-xs font-medium text-gray-500">Delivery Address</h3>

                <div className="relative">
                  <MapPin className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <textarea
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Full delivery address *"
                    required
                    rows={3}
                    className="w-full rounded-lg border border-gray-200 py-2.5 pl-9 pr-3 text-sm placeholder:text-gray-400 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300"
                  />
                </div>

                <input
                  type="text"
                  value={pincode}
                  onChange={(e) => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Pincode"
                  maxLength={6}
                  className="w-32 rounded-lg border border-gray-200 px-3 py-2.5 text-sm placeholder:text-gray-400 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300"
                />
              </div>
            ) : null}

            {/* Notes */}
            <div>
              <div className="relative">
                <FileText className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Order notes (optional)"
                  rows={2}
                  className="w-full rounded-lg border border-gray-200 py-2.5 pl-9 pr-3 text-sm placeholder:text-gray-400 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300"
                />
              </div>
            </div>

            {/* Order summary */}
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
              <h3 className="text-xs font-medium text-gray-500 mb-3">Order Summary</h3>
              <div className="space-y-2">
                {cart.map((c) => (
                  <div
                    key={c.variantId ? `${c.itemId}::${c.variantId}` : c.itemId}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-gray-700">
                      {c.name}
                      {c.variantName ? ` (${c.variantName})` : ''}{' '}
                      <span className="text-gray-400">x{c.quantity}</span>
                    </span>
                    <span className="font-medium text-gray-900">
                      &#x20B9;{(c.price * c.quantity).toLocaleString('en-IN')}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 border-t border-gray-200 pt-3 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Total</span>
                <span className="text-lg font-bold text-gray-900">
                  &#x20B9;{cartTotal.toLocaleString('en-IN')}
                </span>
              </div>
            </div>
          </div>

          {/* Submit */}
          <div className="border-t border-gray-200 px-4 py-4">
            <button
              type="submit"
              disabled={submitting || cart.length === 0}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {submitting ? 'Placing Order...' : `Place Order · ₹${cartTotal.toLocaleString('en-IN')}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface OrderConfirmationProps {
  orderNumber: string;
  grandTotal: number;
  storeName: string;
  storePhone: string | null;
  onClose: () => void;
}

export function OrderConfirmation({
  orderNumber,
  grandTotal,
  storeName,
  storePhone,
  onClose,
}: OrderConfirmationProps) {
  const whatsappMessage = encodeURIComponent(
    `Hi ${storeName}, I just placed order ${orderNumber} (₹${grandTotal.toLocaleString('en-IN')}) on your store. Please confirm.`,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
        <CheckCircle2 className="mx-auto h-16 w-16 text-green-500" />

        <h2 className="mt-4 text-xl font-bold text-gray-900">Order Placed!</h2>
        <p className="mt-1 text-sm text-gray-500">
          Your order <span className="font-semibold text-gray-900">{orderNumber}</span> has
          been placed successfully.
        </p>
        <p className="mt-2 text-lg font-bold text-gray-900">
          &#x20B9;{grandTotal.toLocaleString('en-IN')}
        </p>
        <p className="mt-3 text-xs text-gray-400">
          The store will confirm your order shortly.
        </p>

        {storePhone ? (
          <a
            href={`https://wa.me/${storePhone.replace(/\D/g, '')}?text=${whatsappMessage}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700"
          >
            Confirm on WhatsApp
          </a>
        ) : null}

        <button
          onClick={onClose}
          className="mt-3 w-full rounded-xl border border-gray-200 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Continue Shopping
        </button>
      </div>
    </div>
  );
}

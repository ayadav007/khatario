'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, MessageCircle, Phone, Send } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { storeHostSuffix } from '@/lib/store/subdomain';
import {
  agoText,
  canRemindManually,
  cartWhatsappLink,
  cartWhatsappText,
  reminderStatusText,
  type CartLine,
} from '@/lib/store/abandoned-cart-format';

interface AdminCart {
  id: string;
  customer_name: string | null;
  phone: string;
  item_count: number;
  subtotal: number;
  updated_at: string;
  reminded_at: string | null;
  reminder_via: string | null;
  lines: CartLine[];
}

const rupees = (n: number) => `₹${Number(n).toLocaleString('en-IN')}`;

export function AbandonedCartList() {
  const { business, user } = useAuth();
  const businessId = business?.id;
  const [carts, setCarts] = useState<AdminCart[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [cartUrl, setCartUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await fetch(`/api/settings/online-store/abandoned-carts?business_id=${businessId}`, {
      credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Could not load abandoned carts');
    setCarts(Array.isArray(data.carts) ? data.carts : []);
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    load()
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load abandoned carts');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, load]);

  // The store's public cart URL, for the WhatsApp text; left out when the host is unknown.
  useEffect(() => {
    if (!businessId || !user?.id) return;
    let cancelled = false;
    fetch(`/api/settings/online-store?business_id=${businessId}&user_id=${user.id}`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.store_subdomain) return;
        setCartUrl(`https://${data.store_subdomain}${storeHostSuffix(window.location.hostname)}/cart`);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [businessId, user?.id]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const remind = async (cart: AdminCart) => {
    if (!businessId) return;
    setBusyId(cart.id);
    setRowErrors((prev) => {
      const { [cart.id]: _drop, ...rest } = prev;
      return rest;
    });
    try {
      const res = await fetch(
        `/api/settings/online-store/abandoned-carts/${cart.id}/remind?business_id=${businessId}`,
        { method: 'POST', credentials: 'include' },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const base = typeof data?.error === 'string' ? data.error : 'Could not send the reminder.';
        const msg = res.status === 502 ? `${base} You can try again in 24 hours.` : base;
        setRowErrors((prev) => ({ ...prev, [cart.id]: msg }));
        if (res.status === 502 || res.status === 409) await load().catch(() => {});
        return;
      }
      await load().catch(() => {});
    } catch {
      setRowErrors((prev) => ({ ...prev, [cart.id]: 'Could not send the reminder. Try again later.' }));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</div>
    );
  }
  if (carts.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-gray-500">
        No abandoned carts. Carts that signed-in shoppers leave behind will show here.
      </Card>
    );
  }

  const now = new Date();
  return (
    <div className="space-y-3">
      {carts.map((cart) => {
        const open = expanded.has(cart.id);
        const eligible = canRemindManually(cart.reminded_at ? new Date(cart.reminded_at) : null, now);
        const wa = cartWhatsappLink(
          cart.phone,
          cartWhatsappText(cart.customer_name, cart.lines, business?.name || 'our store', cart.subtotal, cartUrl),
        );
        const busy = busyId === cart.id;
        return (
          <Card key={cart.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-900">{cart.customer_name || cart.phone}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <a href={`tel:${cart.phone}`} className="inline-flex items-center gap-1 text-gray-600 hover:underline">
                    <Phone className="h-3 w-3" />
                    {cart.phone}
                  </a>
                  {wa ? (
                    <a
                      href={wa}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-green-700 hover:underline"
                    >
                      <MessageCircle className="h-3 w-3" />
                      WhatsApp
                    </a>
                  ) : null}
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-900">{rupees(cart.subtotal)}</p>
                <p className="text-xs text-gray-500">left {agoText(cart.updated_at, now)}</p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => toggle(cart.id)}
                aria-expanded={open}
                className="inline-flex items-center gap-1 text-xs font-medium text-gray-700"
              >
                {cart.item_count} {cart.item_count === 1 ? 'item' : 'items'}
                {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              <span className="text-xs text-gray-500">{reminderStatusText(cart.reminded_at, cart.reminder_via, now)}</span>
            </div>

            {open ? (
              <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-100 text-xs text-gray-700">
                {cart.lines.map((l, i) => (
                  <li key={`${l.item_id}:${l.variant_id ?? ''}:${i}`} className="flex justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 break-words">
                      {l.name} × {l.quantity}
                    </span>
                    <span className="flex-shrink-0">{rupees(l.price)}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => void remind(cart)}
                disabled={!eligible || busy}
                title={eligible ? undefined : 'Already reminded in the last 24 hours'}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />}
                Send reminder
              </Button>
              {rowErrors[cart.id] ? <p className="text-xs text-red-600">{rowErrors[cart.id]}</p> : null}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

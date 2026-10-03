'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ImageOff,
  Loader2,
  MessageCircle,
  Minus,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  X,
} from 'lucide-react';

type ShopItem = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  mrp: number | null;
  unit: string | null;
  category: string | null;
  inStock: boolean;
  image: string | null;
};

type ShopData = {
  shop: { name: string; whatsappUrl: string | null; welcomeText: string };
  customer: { name: string; address: string };
  items: ShopItem[];
};

type PlacedOrder = {
  orderNumber: string;
  total: number;
  lines: Array<{ name: string; quantity: number; lineTotal: number }>;
  unavailable: string[];
  paymentLink: string | null;
  manualPayment: boolean;
};

type Cart = Record<string, number>;

const MAX_QTY = 999;

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);

function Thumb({ src, alt, className }: { src: string | null; alt: string; className: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <div className={`${className} flex items-center justify-center bg-gray-100 text-gray-400`}>
        <ImageOff className="h-6 w-6" />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" onError={() => setBroken(true)} className={`${className} object-cover`} />;
}

function Stepper({ qty, onChange, disabled }: { qty: number; onChange: (q: number) => void; disabled?: boolean }) {
  if (qty <= 0) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(1)}
        aria-label="Add to cart"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-300 text-[#008069] hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus className="h-5 w-5" />
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(qty - 1)}
        aria-label="Remove one"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50"
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="w-7 text-center text-sm font-semibold tabular-nums">{qty}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(MAX_QTY, qty + 1))}
        aria-label="Add one more"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-300 text-[#008069] hover:bg-emerald-50"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function Price({ item }: { item: ShopItem }) {
  return (
    <div className="flex items-baseline gap-2">
      {item.mrp && <span className="text-xs text-gray-400 line-through">{inr(item.mrp)}</span>}
      <span className="text-sm font-semibold text-gray-900">{inr(item.price)}</span>
      {item.unit && <span className="text-xs text-gray-500">/ {item.unit}</span>}
    </div>
  );
}

function Header({ title, onBack, right }: { title: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 bg-[#008069] px-3 text-white shadow">
      {onBack && (
        <button type="button" onClick={onBack} aria-label="Back" className="rounded-full p-1.5 hover:bg-white/10">
          <ArrowLeft className="h-5 w-5" />
        </button>
      )}
      <h1 className="min-w-0 flex-1 truncate text-lg font-medium">{title}</h1>
      {right}
    </header>
  );
}

export default function WaShopClient({ token }: { token: string }) {
  const storageKey = `wa-shop-cart:${token}`;
  const [data, setData] = useState<ShopData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<Cart>({});
  const [view, setView] = useState<'list' | 'cart' | 'done'>('list');
  const [detail, setDetail] = useState<ShopItem | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [order, setOrder] = useState<PlacedOrder | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/wa-shop/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'This shop link is not valid.');
        return json as ShopData;
      })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setName(d.customer.name || '');
        setAddress(d.customer.address || '');
        try {
          const saved = JSON.parse(localStorage.getItem(storageKey) || '{}') as Cart;
          const ids = new Set(d.items.map((i) => i.id));
          setCart(Object.fromEntries(Object.entries(saved).filter(([id, q]) => ids.has(id) && q > 0)));
        } catch {
          setCart({});
        }
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load the shop.'));
    return () => {
      cancelled = true;
    };
  }, [token, storageKey]);

  useEffect(() => {
    if (!data) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(cart));
    } catch {
      /* storage full or blocked: the cart still works for this visit */
    }
  }, [cart, data, storageKey]);

  const setQty = useCallback((id: string, qty: number) => {
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[id];
      else next[id] = Math.min(MAX_QTY, qty);
      return next;
    });
  }, []);

  const byId = useMemo(() => new Map((data?.items ?? []).map((i) => [i.id, i])), [data]);
  const cartLines = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ item: byId.get(id), qty }))
        .filter((l): l is { item: ShopItem; qty: number } => !!l.item),
    [cart, byId],
  );
  const cartCount = cartLines.reduce((n, l) => n + l.qty, 0);
  const cartTotal = cartLines.reduce((n, l) => n + l.qty * l.item.price, 0);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const i of data?.items ?? []) if (i.category) set.add(i.category);
    return Array.from(set);
  }, [data]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.items ?? []).filter(
      (i) =>
        (!category || i.category === category) &&
        (!q || i.name.toLowerCase().includes(q) || (i.description || '').toLowerCase().includes(q)),
    );
  }, [data, search, category]);

  const placeOrder = async () => {
    setPlacing(true);
    setPlaceError(null);
    try {
      const res = await fetch(`/api/public/wa-shop/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          address,
          lines: cartLines.map((l) => ({ item_id: l.item.id, quantity: l.qty })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not place the order.');
      setOrder(json as PlacedOrder);
      setCart({});
      setView('done');
      window.scrollTo({ top: 0 });
    } catch (e) {
      setPlaceError(e instanceof Error ? e.message : 'Could not place the order.');
    } finally {
      setPlacing(false);
    }
  };

  if (error) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#efeae2] px-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm">
          <ShoppingCart className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <h1 className="mb-1 text-lg font-semibold text-gray-900">Shop link not available</h1>
          <p className="text-sm text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-[#008069]" />
      </div>
    );
  }

  if (view === 'done' && order) {
    return (
      <div className="min-h-[100dvh] bg-[#efeae2]">
        <Header title={data.shop.name} />
        <main className="mx-auto max-w-md p-4">
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <CheckCircle2 className="h-9 w-9 shrink-0 text-[#25D366]" />
              <div>
                <p className="text-base font-semibold text-gray-900">Order {order.orderNumber} placed</p>
                <p className="text-sm text-gray-600">We&apos;ve also sent the details to your WhatsApp.</p>
              </div>
            </div>
            <ul className="divide-y divide-gray-100 border-y border-gray-100 text-sm">
              {order.lines.map((l, i) => (
                <li key={i} className="flex justify-between gap-3 py-2">
                  <span className="min-w-0 text-gray-700">
                    {l.name} × {l.quantity}
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">{inr(l.lineTotal)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-between text-base font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{inr(order.total)}</span>
            </div>
            {order.unavailable.length > 0 && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Not available, so not included: {order.unavailable.join(', ')}
              </p>
            )}
            {order.paymentLink ? (
              <>
                <a
                  href={order.paymentLink}
                  className="mt-5 flex h-12 w-full items-center justify-center rounded-full bg-[#008069] text-base font-semibold text-white hover:bg-[#017561]"
                >
                  Pay {inr(order.total)}
                </a>
                <p className="mt-2 text-center text-xs text-gray-500">
                  {order.manualPayment
                    ? 'After paying, send the payment screenshot to the shop on WhatsApp.'
                    : "Your order is confirmed on WhatsApp as soon as the payment goes through."}
                </p>
              </>
            ) : (
              <p className="mt-5 text-center text-sm text-gray-600">The shop will send you payment details on WhatsApp.</p>
            )}
          </div>
          {data.shop.whatsappUrl && (
            <a
              href={data.shop.whatsappUrl}
              className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-full border border-[#008069] bg-white text-sm font-medium text-[#008069]"
            >
              <MessageCircle className="h-4 w-4" /> Back to WhatsApp
            </a>
          )}
        </main>
      </div>
    );
  }

  if (view === 'cart') {
    return (
      <div className="min-h-[100dvh] bg-[#f0f2f5] pb-28">
        <Header title="Your cart" onBack={() => setView('list')} />
        <main className="mx-auto max-w-md space-y-3 p-3">
          {cartLines.length === 0 ? (
            <div className="rounded-xl bg-white p-8 text-center text-sm text-gray-600">
              Your cart is empty.
              <button type="button" onClick={() => setView('list')} className="mt-3 block w-full font-medium text-[#008069]">
                Browse items
              </button>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-gray-100 rounded-xl bg-white">
                {cartLines.map(({ item, qty }) => (
                  <li key={item.id} className="flex items-center gap-3 p-3">
                    <Thumb src={item.image} alt={item.name} className="h-14 w-14 shrink-0 rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">{item.name}</p>
                      <p className="text-xs text-gray-500">
                        {inr(item.price)} × {qty} = <span className="font-medium text-gray-800">{inr(item.price * qty)}</span>
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Stepper qty={qty} onChange={(q) => setQty(item.id, q)} />
                      <button
                        type="button"
                        onClick={() => setQty(item.id, 0)}
                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-600"
                      >
                        <Trash2 className="h-3 w-3" /> Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="space-y-3 rounded-xl bg-white p-4">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-gray-800">Your name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={100}
                    autoComplete="name"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#008069] focus:outline-none focus:ring-1 focus:ring-[#008069]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-gray-800">Delivery address</span>
                  <textarea
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    rows={3}
                    maxLength={500}
                    autoComplete="street-address"
                    placeholder="House, street, area, city, PIN code (leave blank for pickup)"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#008069] focus:outline-none focus:ring-1 focus:ring-[#008069]"
                  />
                </label>
              </div>

              <div className="flex justify-between rounded-xl bg-white p-4 text-base font-semibold">
                <span>Estimated total</span>
                <span className="tabular-nums">{inr(cartTotal)}</span>
              </div>
              {placeError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{placeError}</p>}
            </>
          )}
        </main>
        {cartLines.length > 0 && (
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white p-3">
            <button
              type="button"
              onClick={() => void placeOrder()}
              disabled={placing}
              className="mx-auto flex h-12 w-full max-w-md items-center justify-center gap-2 rounded-full bg-[#008069] text-base font-semibold text-white hover:bg-[#017561] disabled:opacity-60"
            >
              {placing && <Loader2 className="h-5 w-5 animate-spin" />}
              Place order · {inr(cartTotal)}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-white pb-24">
      <Header
        title={data.shop.name}
        right={
          <button type="button" onClick={() => setView('cart')} aria-label="Open cart" className="relative rounded-full p-1.5 hover:bg-white/10">
            <ShoppingCart className="h-6 w-6" />
            {cartCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-[#25D366] px-1 text-[11px] font-bold">
                {cartCount > 99 ? '99+' : cartCount}
              </span>
            )}
          </button>
        }
      />

      <div className="bg-gradient-to-br from-[#008069] to-[#25a589] px-4 pb-5 pt-4 text-white">
        <p className="mx-auto max-w-md text-sm leading-relaxed text-white/90">{data.shop.welcomeText}</p>
      </div>

      <div className="sticky top-14 z-10 border-b border-gray-100 bg-white px-3 pb-2 pt-3">
        <div className="mx-auto max-w-md">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items"
              className="h-10 w-full rounded-full bg-[#f0f2f5] pl-9 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-[#008069]/40"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {categories.length > 1 && (
            <div className="-mx-3 mt-2 flex gap-2 overflow-x-auto px-3 pb-1">
              {[null, ...categories].map((c) => (
                <button
                  key={c ?? 'all'}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${
                    category === c ? 'border-[#008069] bg-emerald-50 text-[#008069]' : 'border-gray-200 text-gray-600'
                  }`}
                >
                  {c ?? 'All'}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <main className="mx-auto max-w-md">
        {visible.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-500">
            {data.items.length === 0 ? 'No items are available right now.' : 'No items match your search.'}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {visible.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                <button type="button" onClick={() => setDetail(item)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <Thumb src={item.image} alt={item.name} className="h-16 w-16 shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium text-gray-900">{item.name}</p>
                    {item.description && <p className="line-clamp-1 text-xs text-gray-500">{item.description}</p>}
                    <div className="mt-0.5">
                      <Price item={item} />
                    </div>
                    {!item.inStock && <p className="text-xs font-medium text-red-600">Out of stock</p>}
                  </div>
                </button>
                <Stepper qty={cart[item.id] ?? 0} onChange={(q) => setQty(item.id, q)} disabled={!item.inStock} />
              </li>
            ))}
          </ul>
        )}
      </main>

      {cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white p-3">
          <button
            type="button"
            onClick={() => setView('cart')}
            className="mx-auto flex h-12 w-full max-w-md items-center justify-center rounded-full bg-[#008069] text-base font-semibold text-white hover:bg-[#017561]"
          >
            View cart ({cartCount}) · {inr(cartTotal)}
          </button>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => setDetail(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={detail.name}
            className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative">
              <Thumb src={detail.image} alt={detail.name} className="aspect-square w-full" />
              <button
                type="button"
                onClick={() => setDetail(null)}
                aria-label="Close"
                className="absolute right-3 top-3 rounded-full bg-black/50 p-1.5 text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 p-5">
              <h2 className="text-xl font-semibold text-gray-900">{detail.name}</h2>
              <Price item={detail} />
              {detail.description && <p className="whitespace-pre-line text-sm leading-relaxed text-gray-600">{detail.description}</p>}
              {!detail.inStock && <p className="text-sm font-medium text-red-600">Out of stock</p>}
              <div className="flex items-center justify-between gap-3 pt-2">
                <Stepper qty={cart[detail.id] ?? 0} onChange={(q) => setQty(detail.id, q)} disabled={!detail.inStock} />
                <button
                  type="button"
                  disabled={!detail.inStock}
                  onClick={() => {
                    if (!cart[detail.id]) setQty(detail.id, 1);
                    setDetail(null);
                  }}
                  className="h-11 flex-1 rounded-full bg-[#008069] text-sm font-semibold uppercase tracking-wide text-white hover:bg-[#017561] disabled:opacity-40"
                >
                  {cart[detail.id] ? 'Done' : 'Add to cart'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

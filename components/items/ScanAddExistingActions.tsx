'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, Package } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToastContext } from '@/contexts/ToastContext';
import type { ShopBarcodeMatch } from '@/lib/items/scan-add-lookup';
import { batchErrors, batchPayload, nameWithoutSize, type ScanAddFormErrors } from '@/lib/items/scan-add-form';

type Action = 'stock' | 'size' | null;

interface Extra {
  quantity: string;
  variant_id: string;
  variant_name: string;
  existing_variant_name: string;
  item_name: string;
  selling_price: string;
  purchase_price: string;
  batch_number: string;
  manufacturing_date: string;
  expiry_date: string;
}

export interface ScanAddExistingDone {
  itemId: string;
  name: string;
  outcome: 'stock' | 'size' | 'existing';
  qty: number;
}

interface Props {
  barcode: string;
  match: ShopBarcodeMatch;
  /** Plan has inventory adjustments; Add stock uses that flow. */
  canAddStock: boolean;
  onDone: (done: ScanAddExistingDone) => void;
}

const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * A scanned barcode that is already in the shop: add stock to it, add another pack size that
 * shares the barcode, or skip. Both writes send a retry key so a repeated tap cannot add twice.
 */
export function ScanAddExistingActions({ barcode, match, canAddStock, onDone }: Props) {
  const toast = useToastContext();
  const { item, variants } = match;
  const [action, setAction] = useState<Action>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<ScanAddFormErrors & Partial<Record<keyof Extra, string>>>({});
  const keyRef = useRef(newKey());
  const matched = variants.find((v) => v.id === match.matched_variant_id);
  const [extra, setExtra] = useState<Extra>({
    quantity: '',
    variant_id: match.matched_variant_id ?? (variants.length === 1 ? variants[0].id : ''),
    variant_name: '',
    existing_variant_name: item.net_quantity ?? '',
    item_name: nameWithoutSize(item.name, item.net_quantity),
    selling_price: '',
    purchase_price: '',
    batch_number: '',
    manufacturing_date: '',
    expiry_date: '',
  });
  const converting = !item.has_variants;
  // A plain item that has been sold or bought cannot be split into sizes.
  const canAddSize = item.has_variants || !match.has_history;

  const set = (field: keyof Extra) => (e: { target: { value: string } }) => {
    setExtra((x) => ({ ...x, [field]: e.target.value }));
    setErrors((x) => ({ ...x, [field]: undefined }));
  };

  const open = (a: Action) => {
    keyRef.current = newKey();
    setErrors({});
    setAction(a);
  };

  const batch = useMemo(() => batchPayload({ ...extra, opening_stock: extra.quantity }), [extra]);

  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': keyRef.current },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not save');
    return data;
  };

  const saveStock = async () => {
    const qty = Number(extra.quantity);
    const found: typeof errors = { ...batchErrors(extra) };
    if (!(qty > 0)) found.quantity = 'Enter how many you have';
    if (item.has_variants && !extra.variant_id) found.variant_id = 'Pick the size';
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    setSaving(true);
    try {
      await post('/api/inventory-adjustments', {
        adjustment_type: 'QUANTITY',
        item_id: item.id,
        variant_id: item.has_variants ? extra.variant_id : undefined,
        direction: 'INCREASE',
        quantity: qty,
        reason_code: 'STOCK_TAKE',
        reason_notes: 'Scan & Add Items',
        adjustment_date: new Date().toISOString().slice(0, 10),
        batch,
      });
      toast.success(`${qty} added to ${item.name}`);
      onDone({ itemId: item.id, name: item.name, outcome: 'stock', qty });
    } catch (e) {
      // Kept as typed; retrying sends the same key, so the stock cannot be added twice.
      toast.error(e instanceof Error ? e.message : 'Could not add stock');
    } finally {
      setSaving(false);
    }
  };

  const saveSize = async () => {
    const qty = Number(extra.quantity) || 0;
    const found: typeof errors = { ...batchErrors(extra) };
    if (!extra.variant_name.trim()) found.variant_name = 'Enter the new pack size, e.g. 75 g';
    if (converting && !extra.existing_variant_name.trim()) found.existing_variant_name = 'Enter the size you already have';
    if (qty > 0 && !(Number(extra.purchase_price) > 0)) found.purchase_price = 'Enter the purchase price for the stock you have';
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    setSaving(true);
    try {
      await post('/api/items/scan-add/variant', {
        item_id: item.id,
        variant_name: extra.variant_name.trim(),
        selling_price: extra.selling_price || undefined,
        purchase_price: extra.purchase_price || undefined,
        opening_stock: qty,
        batch,
        existing_variant_name: converting ? extra.existing_variant_name.trim() : undefined,
        item_name: converting ? extra.item_name.trim() : undefined,
      });
      toast.success(`${extra.variant_name.trim()} added to ${converting ? extra.item_name.trim() : item.name}`);
      onDone({ itemId: item.id, name: `${converting ? extra.item_name.trim() : item.name} ${extra.variant_name.trim()}`, outcome: 'size', qty });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add this size');
    } finally {
      setSaving(false);
    }
  };

  const batchFields = (
    <>
      <Input label="Batch no." value={extra.batch_number} onChange={set('batch_number')} placeholder="Optional" />
      <Input label="Mfg date" value={extra.manufacturing_date} onChange={set('manufacturing_date')} error={errors.manufacturing_date} placeholder="2026-09" />
      <Input label="Expiry date" value={extra.expiry_date} onChange={set('expiry_date')} error={errors.expiry_date} placeholder="2027-03" />
    </>
  );

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start gap-3">
        <Package className="mt-0.5 h-5 w-5 text-text-secondary" />
        <div>
          <p className="font-semibold">Already in your shop</p>
          <p>
            {item.name}
            {matched ? ` · ${matched.variant_name}` : ''}
          </p>
          <p className="text-sm text-text-secondary">
            Barcode {barcode} · Stock {matched ? matched.current_stock : item.current_stock} {item.unit ?? ''}
            {variants.length > 0 ? ` · Sizes: ${variants.map((v) => v.variant_name).join(', ')}` : ''}
          </p>
        </div>
      </div>

      {action === null ? (
        <div className="flex flex-wrap gap-2">
          {canAddStock ? <Button onClick={() => open('stock')}>Add stock</Button> : null}
          {canAddSize ? (
            <Button variant="secondary" onClick={() => open('size')}>
              Another size, same barcode
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => onDone({ itemId: item.id, name: item.name, outcome: 'existing', qty: 0 })}>
            Skip, scan next
          </Button>
          <Link href={`/items/${item.id}`}>
            <Button variant="ghost">Open item</Button>
          </Link>
          {!canAddSize ? (
            <p className="w-full text-xs text-text-secondary">
              This item has sales or purchases, so it cannot be split into sizes. Add a different size as a separate item without this barcode.
            </p>
          ) : null}
        </div>
      ) : null}

      {action === 'stock' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {item.has_variants ? (
              <div>
                <label className="type-label mb-1.5 block">Size</label>
                <select className="input" value={extra.variant_id} onChange={set('variant_id')}>
                  <option value="">Pick the size</option>
                  {variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.variant_name}
                    </option>
                  ))}
                </select>
                {errors.variant_id ? <p className="mt-1 text-xs text-red-600">{errors.variant_id}</p> : null}
              </div>
            ) : null}
            <Input label="How many to add *" type="number" min={0} step="any" value={extra.quantity} onChange={set('quantity')} error={errors.quantity} />
            {batchFields}
          </div>
          <p className="text-xs text-text-secondary">Valued at the item&apos;s current purchase price.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void saveStock()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Add stock
            </Button>
            <Button variant="secondary" onClick={() => setAction(null)} disabled={saving}>
              Back
            </Button>
          </div>
        </div>
      ) : null}

      {action === 'size' ? (
        <div className="space-y-3">
          {converting ? (
            <p className="text-sm">
              {item.name} will become one product with sizes. Scanning this barcode at billing will ask which size.
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {converting ? (
              <>
                <Input label="Product name (without size)" value={extra.item_name} onChange={set('item_name')} />
                <Input
                  label="Size you already have *"
                  value={extra.existing_variant_name}
                  onChange={set('existing_variant_name')}
                  error={errors.existing_variant_name}
                  placeholder="100 g"
                />
              </>
            ) : null}
            <Input label="New size *" value={extra.variant_name} onChange={set('variant_name')} error={errors.variant_name} placeholder="75 g" />
            <Input label="Selling price (₹)" type="number" min={0} step="0.01" value={extra.selling_price} onChange={set('selling_price')} />
            <Input label="Purchase price (₹)" type="number" min={0} step="0.01" value={extra.purchase_price} onChange={set('purchase_price')} error={errors.purchase_price} />
            <Input label="Stock you have now" type="number" min={0} step="any" value={extra.quantity} onChange={set('quantity')} />
            {batchFields}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void saveSize()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save size and scan next
            </Button>
            <Button variant="secondary" onClick={() => setAction(null)} disabled={saving}>
              Back
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

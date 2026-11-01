'use client';

import Link from 'next/link';
import { RETURN_METHOD_LABELS, type ReturnMethod } from '@/lib/returns/labels';

/** What the shop types when choosing how a return comes back (approving, or starting a return). */
export interface ReturnMethodForm {
  method: ReturnMethod;
  instructions: string;
  address: string;
  pincode: string;
  phone: string;
  weightKg: string;
}

/** The pickup details the server sends with a return (`return.pickup`). */
export interface SavedPickup {
  address: string | null;
  pincode: string | null;
  phone: string | null;
  weight_kg: number | null;
}

const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800';

const HINTS: Record<ReturnMethod, string> = {
  courier_pickup: 'Shiprocket collects the parcel from the customer and brings it to your shop.',
  customer_sends: 'The customer gets your instructions and sends or brings the parcel.',
  no_return: 'Nothing comes back. The credit note is posted now and no stock is added back.',
};

/** The form to start with. Courier pickup only when Shiprocket is connected and the pickup address and PIN are known. */
export function initialMethodForm(p: {
  shiprocketConnected: boolean;
  pickup?: SavedPickup | null;
  defaultInstructions?: string | null;
  /** True when the server fills a blank address, PIN and weight itself (starting a return). */
  serverFillsPickup?: boolean;
}): ReturnMethodForm {
  const pickup = p.pickup ?? null;
  const known = p.serverFillsPickup || Boolean(pickup?.address?.trim() && /^\d{6}$/.test(pickup?.pincode ?? ''));
  return {
    method: p.shiprocketConnected && known ? 'courier_pickup' : 'customer_sends',
    instructions: p.defaultInstructions ?? '',
    address: pickup?.address ?? '',
    pincode: pickup?.pincode ?? '',
    phone: pickup?.phone ?? '',
    weightKg: pickup?.weight_kg != null ? String(pickup.weight_kg) : '',
  };
}

/** True when the form can be sent. Only a PIN that is typed must be 6 digits; blanks are filled by the server. */
export function methodFormError(v: ReturnMethodForm): string | null {
  if (v.method === 'courier_pickup' && v.pincode.trim() && !/^\d{6}$/.test(v.pincode.trim())) return 'Enter a 6-digit PIN code';
  if (v.method === 'courier_pickup' && v.weightKg.trim() && !(Number(v.weightKg) > 0)) return 'Enter the parcel weight in kg';
  return null;
}

/** The request fields for the chosen way back. */
export function methodBody(v: ReturnMethodForm): Record<string, unknown> {
  if (v.method === 'courier_pickup') {
    return {
      method: v.method,
      pickup: {
        address: v.address.trim() || undefined,
        pincode: v.pincode.trim() || undefined,
        phone: v.phone.trim() || undefined,
        weight_kg: v.weightKg.trim() || undefined,
      },
    };
  }
  if (v.method === 'customer_sends') return { method: v.method, instructions: v.instructions.trim() || undefined };
  return { method: v.method };
}

/** "How does it come back?": the three ways, with the pickup address, phone and weight, or the customer's instructions. */
export function ReturnMethodFields({
  value,
  onChange,
  shiprocketConnected,
  blankHint,
}: {
  value: ReturnMethodForm;
  onChange: (next: ReturnMethodForm) => void;
  shiprocketConnected: boolean;
  /** Placeholder for the pickup fields the server fills in when left empty. */
  blankHint?: string;
}) {
  const set = (patch: Partial<ReturnMethodForm>) => onChange({ ...value, ...patch });
  const methods: ReturnMethod[] = shiprocketConnected ? ['courier_pickup', 'customer_sends', 'no_return'] : ['customer_sends', 'no_return'];
  const blank = blankHint ?? '';

  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium text-slate-500">How does it come back?</legend>
      <div className="space-y-1.5">
        {methods.map((m) => (
          <label
            key={m}
            className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
              value.method === m
                ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/20'
                : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50'
            }`}
          >
            <input type="radio" name="return-method" className="mt-1" checked={value.method === m} onChange={() => set({ method: m })} />
            <span>
              <span className="font-medium">{RETURN_METHOD_LABELS[m]}</span>
              <span className="block text-xs text-slate-500">{HINTS[m]}</span>
            </span>
          </label>
        ))}
      </div>
      {!shiprocketConnected ? (
        <p className="text-xs text-slate-500">
          <Link href="/settings/online-store" className="font-medium text-primary hover:underline">
            Connect Shiprocket to book pickups
          </Link>
        </p>
      ) : null}

      {value.method === 'courier_pickup' ? (
        <div className="space-y-2 pt-1">
          <label className="block text-xs text-slate-500">
            Pick up from (the customer&apos;s address)
            <textarea
              className={`${input} mt-1`}
              rows={2}
              placeholder={blank}
              value={value.address}
              onChange={(e) => set({ address: e.target.value })}
            />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="block text-xs text-slate-500">
              PIN code
              <input
                className={`${input} mt-1`}
                inputMode="numeric"
                maxLength={6}
                placeholder={blank}
                value={value.pincode}
                onChange={(e) => set({ pincode: e.target.value.replace(/\D/g, '') })}
              />
            </label>
            <label className="block text-xs text-slate-500">
              Phone
              <input
                className={`${input} mt-1`}
                inputMode="tel"
                placeholder={blank}
                value={value.phone}
                onChange={(e) => set({ phone: e.target.value })}
              />
            </label>
            <label className="block text-xs text-slate-500">
              Weight (kg)
              <input
                className={`${input} mt-1`}
                inputMode="decimal"
                placeholder={blank}
                value={value.weightKg}
                onChange={(e) => set({ weightKg: e.target.value })}
              />
            </label>
          </div>
        </div>
      ) : null}

      {value.method === 'customer_sends' ? (
        <label className="block pt-1 text-xs text-slate-500">
          What the customer is told
          <textarea
            className={`${input} mt-1`}
            rows={3}
            placeholder={blank}
            value={value.instructions}
            onChange={(e) => set({ instructions: e.target.value })}
          />
        </label>
      ) : null}
    </fieldset>
  );
}

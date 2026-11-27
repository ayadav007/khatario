'use client';

/**
 * The choice an admin makes when saving a change to a plan's features, limits or price:
 * who gets it. Shown once the admin has pressed Save and before they confirm. Nothing is pre-selected,
 * and the confirm button stays off until one is chosen (when any business is on the plan).
 */

export type PlanChangeScope = 'everyone' | 'new_customers';

export function PlanChangeScopeChoice({
  affected,
  scope,
  onChange,
  disabled,
}: {
  /** Businesses on the plan right now (active or trial). */
  affected: number;
  scope: PlanChangeScope | null;
  onChange: (scope: PlanChangeScope) => void;
  disabled?: boolean;
}) {
  const noun = affected === 1 ? 'business' : 'businesses';
  if (affected === 0) {
    return (
      <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700" role="status">
        No business is on this plan today, so this change affects new customers only. It is recorded with your name.
      </div>
    );
  }
  const option = (value: PlanChangeScope, title: string, detail: string) => (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg border-2 p-3 ${
        scope === value ? 'border-primary-500 bg-white' : 'border-amber-200 bg-amber-50/60 hover:border-amber-300'
      }`}
    >
      <input
        type="radio"
        name="plan-change-scope"
        value={value}
        checked={scope === value}
        onChange={() => onChange(value)}
        disabled={disabled}
        className="mt-1"
      />
      <span>
        <span className="block font-semibold text-gray-900">{title}</span>
        <span className="block text-gray-700">{detail}</span>
      </span>
    </label>
  );
  return (
    <fieldset className="mb-4 space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <legend className="px-1 font-semibold">Who gets this change? ({affected} {noun} on this plan)</legend>
      {option(
        'everyone',
        `Apply to everyone now — ${affected} ${noun} get this change today`,
        'Their access, limits and the price they pay at renewal follow the new settings as soon as you confirm.',
      )}
      {option(
        'new_customers',
        `Only new customers — paying businesses on this plan keep what they have now`,
        'Paying businesses keep their current features, limits and renewal price while they stay on this plan and keep renewing it. Businesses on a free trial get the new terms, including the new price when they start paying. A business that changes plan, or comes back to it later, gets the current terms.',
      )}
      <p className="text-xs text-amber-800">The change and your choice are recorded with your name.</p>
    </fieldset>
  );
}

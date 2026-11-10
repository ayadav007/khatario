import { GST_STATE_NAMES } from '@/lib/tax/gstin';
import { resolveState } from '@/lib/tax/state-names';
import { UNIT_CODES } from '@/lib/import/parse-values';

export type ChoiceType = 'state' | 'unit' | 'tax_rate';

/**
 * What the user picks from when a state, unit or tax rate in the file needs a match. One list
 * for the server (lib/import/sections) and the wizard; this module stays free of server code.
 */
export const VALUE_CHOICES: Record<ChoiceType, string[]> = {
  state: Array.from(
    new Set(
      Object.keys(GST_STATE_NAMES)
        .map((code) => resolveState(code)?.state)
        .filter((s): s is string => Boolean(s))
    )
  ),
  unit: [...UNIT_CODES],
  tax_rate: ['0', '0.25', '3', '5', '12', '18', '28'],
};

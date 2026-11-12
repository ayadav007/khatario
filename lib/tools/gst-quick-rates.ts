import { GST_RATE_SLABS } from '@/lib/gst/rates';

type Slab = (typeof GST_RATE_SLABS)[number];

/**
 * Quick-pick GST rates for the GST calculator: the main slabs from 22 September 2025.
 * Special rates (0.1, 0.25, 1.5, 3) stay available through the custom rate box.
 */
export const GST_QUICK_RATES: readonly Slab[] = [0, 5, 18, 40];

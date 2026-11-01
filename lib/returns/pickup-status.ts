import type { PickupStatus } from '@/lib/returns/labels';

/**
 * Maps a Shiprocket status label on a return shipment to our pickup status (spec section 5).
 * Keyword based like the forward parser; checked in table order. Unknown labels give null.
 */
export function parseShiprocketReturnStatus(label: string): PickupStatus | null {
  const s = String(label || '').trim().toLowerCase();
  if (!s) return null;
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('delivered') && !s.includes('out for delivery') && !s.includes('undeliver')) return 'arrived';
  // "not picked" contains "picked": the problem row has to win over the moving row.
  if (
    !s.includes('not picked') &&
    ['out for delivery', 'in transit', 'picked', 'shipped', 'reached'].some((k) => s.includes(k))
  ) {
    return 'in_transit';
  }
  if (s.includes('out for pickup')) return 'out_for_pickup';
  if (['pickup exception', 'not picked', 'fail', 'undeliver'].some((k) => s.includes(k))) return 'pickup_issue';
  if (['pickup scheduled', 'pickup generated', 'awb assigned', 'new'].some((k) => s.includes(k))) return 'booked';
  return null;
}

const RANK: Record<PickupStatus, number> = {
  booked: 0,
  out_for_pickup: 1,
  pickup_issue: 1,
  in_transit: 2,
  arrived: 3,
  cancelled: 99,
};

/**
 * Statuses only move forward. Out for pickup and pickup issue can swap (a missed pickup is retried);
 * cancelled is allowed only before the parcel is picked up; nothing leaves arrived or cancelled.
 */
export function canMovePickupStatus(from: PickupStatus | null, to: PickupStatus): boolean {
  if (from === null) return true;
  if (from === 'arrived' || from === 'cancelled') return false;
  if (to === 'cancelled') return RANK[from] < 2;
  if (from === to) return false;
  if (RANK[to] > RANK[from]) return true;
  return (from === 'out_for_pickup' && to === 'pickup_issue') || (from === 'pickup_issue' && to === 'out_for_pickup');
}

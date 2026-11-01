import { canMovePickupStatus, parseShiprocketReturnStatus } from '@/lib/returns/pickup-status';

describe('parseShiprocketReturnStatus', () => {
  it.each([
    ['Out For Delivery ', 'in_transit'],
    ['DELIVERED', 'arrived'],
    ['UNDELIVERED', 'pickup_issue'],
    ['OUT FOR PICKUP', 'out_for_pickup'],
    ['PICKUP EXCEPTION', 'pickup_issue'],
    ['NOT PICKED', 'pickup_issue'],
    ['PICKED UP', 'in_transit'],
    ['IN TRANSIT', 'in_transit'],
    ['PICKUP SCHEDULED', 'booked'],
    ['AWB ASSIGNED', 'booked'],
    ['CANCELED', 'cancelled'],
    ['CANCELLATION REQUESTED', 'cancelled'],
    ['LOST', null],
    ['', null],
  ])('%j -> %s', (label, expected) => {
    expect(parseShiprocketReturnStatus(label)).toBe(expected);
  });
});

describe('canMovePickupStatus', () => {
  it('lets a new return start at any status', () => {
    expect(canMovePickupStatus(null, 'booked')).toBe(true);
  });
  it('only moves forward', () => {
    expect(canMovePickupStatus('booked', 'in_transit')).toBe(true);
    expect(canMovePickupStatus('in_transit', 'arrived')).toBe(true);
    expect(canMovePickupStatus('in_transit', 'out_for_pickup')).toBe(false);
    expect(canMovePickupStatus('arrived', 'in_transit')).toBe(false);
    expect(canMovePickupStatus('booked', 'booked')).toBe(false);
  });
  it('lets out for pickup and pickup issue swap', () => {
    expect(canMovePickupStatus('pickup_issue', 'out_for_pickup')).toBe(true);
    expect(canMovePickupStatus('out_for_pickup', 'pickup_issue')).toBe(true);
  });
  it('cancels only before pickup, and nothing leaves arrived or cancelled', () => {
    expect(canMovePickupStatus('booked', 'cancelled')).toBe(true);
    expect(canMovePickupStatus('pickup_issue', 'cancelled')).toBe(true);
    expect(canMovePickupStatus('in_transit', 'cancelled')).toBe(false);
    expect(canMovePickupStatus('cancelled', 'booked')).toBe(false);
    expect(canMovePickupStatus('arrived', 'cancelled')).toBe(false);
  });
});

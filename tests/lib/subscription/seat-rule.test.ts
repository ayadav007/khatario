import { userOccupiesConsoleSeat, type SeatFields } from '@/lib/subscription/seat-counting';

const base: SeatFields = {
  is_active: true,
  is_primary_admin: false,
  role_id: null,
  access_type: 'full',
  seat_type: 'billing',
};

describe('userOccupiesConsoleSeat (same rule as CONSOLE_SEAT_COUNT_SQL)', () => {
  it('owner counts', () => {
    expect(userOccupiesConsoleSeat({ ...base, is_primary_admin: true, access_type: null })).toBe(true);
  });
  it('user holding a role counts', () => {
    expect(userOccupiesConsoleSeat({ ...base, role_id: 'r1' })).toBe(true);
  });
  it('attendance-only employee without a role does not count', () => {
    expect(userOccupiesConsoleSeat({ ...base, access_type: 'attendance_only' })).toBe(false);
  });
  it('attendance-only employee with a role counts', () => {
    expect(userOccupiesConsoleSeat({ ...base, access_type: 'attendance_only', role_id: 'r1' })).toBe(true);
  });
  it('inactive user does not count', () => {
    expect(userOccupiesConsoleSeat({ ...base, role_id: 'r1', is_active: false })).toBe(false);
  });
  it('Connect agent does not count', () => {
    expect(userOccupiesConsoleSeat({ ...base, role_id: 'r1', seat_type: 'connect' })).toBe(false);
  });
  it('user with no employee row (null access_type) counts', () => {
    expect(userOccupiesConsoleSeat({ ...base, access_type: null })).toBe(true);
  });
  it('null flags default like COALESCE', () => {
    expect(userOccupiesConsoleSeat({ is_active: null, is_primary_admin: null, role_id: null, access_type: null, seat_type: null })).toBe(true);
  });
});

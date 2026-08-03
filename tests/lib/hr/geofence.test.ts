import { validateCheckInGeofence } from '@/lib/hr/geofence';
import { DEFAULT_ATTENDANCE_POLICY } from '@/lib/hr/attendance-policy';

describe('geofence', () => {
  it('allows check-in when geofence disabled', () => {
    expect(validateCheckInGeofence(DEFAULT_ATTENDANCE_POLICY, null, null)).toEqual({ ok: true });
  });

  it('rejects check-in without location when geofence enabled', () => {
    const policy = {
      ...DEFAULT_ATTENDANCE_POLICY,
      geofence_enabled: true,
      geofence_lat: 28.6139,
      geofence_lng: 77.209,
      geofence_radius_m: 200,
    };
    const result = validateCheckInGeofence(policy, null, null);
    expect(result.ok).toBe(false);
  });

  it('accepts check-in inside radius', () => {
    const policy = {
      ...DEFAULT_ATTENDANCE_POLICY,
      geofence_enabled: true,
      geofence_lat: 28.6139,
      geofence_lng: 77.209,
      geofence_radius_m: 500,
    };
    expect(validateCheckInGeofence(policy, 28.614, 77.2091)).toEqual({ ok: true });
  });
});

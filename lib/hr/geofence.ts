import type { AttendancePolicy } from '@/lib/hr/attendance-policy';

const EARTH_RADIUS_M = 6_371_000;

export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export function validateCheckInGeofence(
  policy: AttendancePolicy,
  lat: number | null | undefined,
  lng: number | null | undefined,
): { ok: true } | { ok: false; error: string } {
  if (!policy.geofence_enabled) return { ok: true };

  const centerLat = policy.geofence_lat;
  const centerLng = policy.geofence_lng;
  const radius = policy.geofence_radius_m;

  if (centerLat == null || centerLng == null || radius == null || radius <= 0) {
    return { ok: true };
  }

  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return {
      ok: false,
      error: 'Location is required for check-in. Enable location access and try again.',
    };
  }

  const dist = distanceMeters(lat, lng, centerLat, centerLng);
  if (dist > radius) {
    return {
      ok: false,
      error: `Check-in must be within ${Math.round(radius)} m of the office location.`,
    };
  }

  return { ok: true };
}

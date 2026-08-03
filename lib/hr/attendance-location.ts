export function hasAttendanceCoordinates(
  lat?: number | string | null,
  lng?: number | string | null,
): boolean {
  const latN = lat != null ? Number(lat) : NaN;
  const lngN = lng != null ? Number(lng) : NaN;
  return Number.isFinite(latN) && Number.isFinite(lngN);
}

export function formatAttendanceCoordinates(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export function attendanceMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

export function formatAttendanceTime(value?: string | null): string | null {
  if (!value) return null;
  const raw = String(value);
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }
  return raw.length >= 5 ? raw.slice(0, 5) : raw;
}

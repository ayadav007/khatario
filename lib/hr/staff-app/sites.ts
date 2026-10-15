/**
 * Office sites for attendance: where staff may check in, each with a radius and trusted Wi-Fi.
 * An employee with no assigned sites may use any active site of their business. A business
 * with no sites falls back to the single geofence in its attendance policy.
 */
import { query, queryOne, queryRows } from '@/lib/db';
import { distanceMeters, validateCheckInGeofence } from '@/lib/hr/geofence';
import { getAttendancePolicy } from '@/lib/hr/attendance-policy';
import { normalizeBssid, type RiskSite } from '@/lib/hr/staff-app/risk';

/** Id given to the attendance-policy geofence when it stands in for a site. */
export const LEGACY_SITE_ID = 'policy-geofence';

export type AttendanceSite = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
  require_wifi: boolean;
  is_active: boolean;
  wifi: { bssid: string; ssid: string | null }[];
  assigned_employees: number;
};

export type SiteInput = {
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
  require_wifi: boolean;
  wifi: { bssid: string; ssid: string | null }[];
};

export class SiteInputError extends Error {}

export function parseSiteInput(raw: unknown): SiteInput {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = String(body.name ?? '').trim().slice(0, 120);
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const radius = Math.round(Number(body.radius_m ?? 150));
  if (!name) throw new SiteInputError('Give the site a name.');
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) {
    throw new SiteInputError('Enter a valid latitude and longitude.');
  }
  if (!Number.isFinite(radius) || radius < 20 || radius > 5000) {
    throw new SiteInputError('Radius must be between 20 and 5000 metres.');
  }
  const wifi: SiteInput['wifi'] = [];
  const seen = new Set<string>();
  for (const w of Array.isArray(body.wifi) ? body.wifi : []) {
    const entry = (w && typeof w === 'object' ? w : {}) as Record<string, unknown>;
    const bssid = normalizeBssid(String(entry.bssid ?? ''));
    if (!bssid) throw new SiteInputError(`"${String(entry.bssid ?? '')}" is not a valid Wi-Fi router address.`);
    if (seen.has(bssid)) continue;
    seen.add(bssid);
    const ssid = entry.ssid == null ? null : String(entry.ssid).slice(0, 64) || null;
    wifi.push({ bssid, ssid });
  }
  const requireWifi = body.require_wifi === true;
  if (requireWifi && wifi.length === 0) {
    throw new SiteInputError('Add at least one Wi-Fi network before making Wi-Fi required.');
  }
  return { name, lat, lng, radius_m: radius, require_wifi: requireWifi, wifi };
}

type SiteRow = {
  id: string;
  name: string;
  lat: string;
  lng: string;
  radius_m: number;
  require_wifi: boolean;
  is_active: boolean;
  wifi: { bssid: string; ssid: string | null }[] | null;
  assigned_employees: string | number;
};

function toSite(r: SiteRow): AttendanceSite {
  return {
    id: r.id,
    name: r.name,
    lat: Number(r.lat),
    lng: Number(r.lng),
    radius_m: r.radius_m,
    require_wifi: r.require_wifi,
    is_active: r.is_active,
    wifi: r.wifi ?? [],
    assigned_employees: Number(r.assigned_employees ?? 0),
  };
}

const SITE_SELECT = `
  SELECT s.id, s.name, s.lat, s.lng, s.radius_m, s.require_wifi, s.is_active,
    COALESCE((SELECT json_agg(json_build_object('bssid', w.bssid, 'ssid', w.ssid) ORDER BY w.created_at)
              FROM attendance_site_wifi w WHERE w.site_id = s.id), '[]'::json) AS wifi,
    (SELECT COUNT(*) FROM employee_attendance_sites es WHERE es.site_id = s.id) AS assigned_employees
  FROM attendance_sites s`;

export async function listSites(businessId: string): Promise<AttendanceSite[]> {
  const rows = await queryRows<SiteRow>(
    `${SITE_SELECT} WHERE s.business_id = $1 AND s.is_active ORDER BY s.created_at`,
    [businessId],
  );
  return rows.map(toSite);
}

export async function getSite(businessId: string, siteId: string): Promise<AttendanceSite | null> {
  const row = await queryOne<SiteRow>(`${SITE_SELECT} WHERE s.business_id = $1 AND s.id = $2 AND s.is_active`, [
    businessId,
    siteId,
  ]);
  return row ? toSite(row) : null;
}

async function replaceWifi(siteId: string, wifi: SiteInput['wifi']) {
  await query('DELETE FROM attendance_site_wifi WHERE site_id = $1', [siteId]);
  for (const w of wifi) {
    await query('INSERT INTO attendance_site_wifi (site_id, bssid, ssid) VALUES ($1, $2, $3)', [
      siteId,
      w.bssid,
      w.ssid,
    ]);
  }
}

export async function createSite(businessId: string, userId: string, input: SiteInput): Promise<AttendanceSite> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO attendance_sites (business_id, name, lat, lng, radius_m, require_wifi, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [businessId, input.name, input.lat, input.lng, input.radius_m, input.require_wifi, userId],
  );
  await replaceWifi(row!.id, input.wifi);
  return (await getSite(businessId, row!.id))!;
}

export async function updateSite(businessId: string, siteId: string, input: SiteInput): Promise<AttendanceSite | null> {
  const row = await queryOne<{ id: string }>(
    `UPDATE attendance_sites
     SET name = $3, lat = $4, lng = $5, radius_m = $6, require_wifi = $7, updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $1 AND id = $2 AND is_active RETURNING id`,
    [businessId, siteId, input.name, input.lat, input.lng, input.radius_m, input.require_wifi],
  );
  if (!row) return null;
  await replaceWifi(siteId, input.wifi);
  return getSite(businessId, siteId);
}

/** Past punches keep pointing at the site, so it is switched off rather than deleted. */
export async function deactivateSite(businessId: string, siteId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `UPDATE attendance_sites SET is_active = false, updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $1 AND id = $2 AND is_active RETURNING id`,
    [businessId, siteId],
  );
  if (!row) return false;
  await query('DELETE FROM employee_attendance_sites WHERE site_id = $1', [siteId]);
  return true;
}

export type WifiSuggestion = { bssid: string; ssid: string | null; employees: number; seen: number };

/** Routers seen during accepted check-ins at a site in the last 30 days that are not trusted yet. */
export async function wifiSuggestions(businessId: string, siteId: string): Promise<WifiSuggestion[]> {
  const rows = await queryRows<{ bssid: string; ssid: string | null; employees: string; seen: string }>(
    `SELECT w->>'bssid' AS bssid, MAX(w->>'ssid') AS ssid,
            COUNT(DISTINCT p.employee_id) AS employees, COUNT(*) AS seen
     FROM staff_attendance_punches p
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.wifi, '[]'::jsonb)) w
     WHERE p.business_id = $1 AND p.site_id = $2 AND p.decision = 'accepted'
       AND p.created_at > CURRENT_TIMESTAMP - INTERVAL '30 days'
       AND NOT EXISTS (SELECT 1 FROM attendance_site_wifi t WHERE t.site_id = $2 AND t.bssid = w->>'bssid')
     GROUP BY 1
     ORDER BY COUNT(DISTINCT p.employee_id) DESC, COUNT(*) DESC
     LIMIT 10`,
    [businessId, siteId],
  );
  return rows.map((r) => ({ bssid: r.bssid, ssid: r.ssid, employees: Number(r.employees), seen: Number(r.seen) }));
}

export async function getEmployeeSiteIds(employeeId: string): Promise<string[]> {
  const rows = await queryRows<{ site_id: string }>(
    `SELECT es.site_id FROM employee_attendance_sites es
     JOIN attendance_sites s ON s.id = es.site_id AND s.is_active
     WHERE es.employee_id = $1`,
    [employeeId],
  );
  return rows.map((r) => r.site_id);
}

/** Replaces the employee's sites. Ids that are not this business's active sites are ignored. */
export async function setEmployeeSites(businessId: string, employeeId: string, siteIds: string[]): Promise<string[]> {
  await query('DELETE FROM employee_attendance_sites WHERE employee_id = $1', [employeeId]);
  if (siteIds.length > 0) {
    await query(
      `INSERT INTO employee_attendance_sites (employee_id, site_id)
       SELECT $1, s.id FROM attendance_sites s
       WHERE s.business_id = $2 AND s.is_active AND s.id = ANY($3::uuid[])`,
      [employeeId, businessId, siteIds],
    );
  }
  return getEmployeeSiteIds(employeeId);
}

/** Sites this employee may check in at, ready for risk scoring. */
export async function sitesForEmployee(businessId: string, employeeId: string): Promise<RiskSite[]> {
  const assigned = await getEmployeeSiteIds(employeeId);
  const all = await listSites(businessId);
  const sites = assigned.length > 0 ? all.filter((s) => assigned.includes(s.id)) : all;
  if (sites.length > 0) {
    return sites.map((s) => ({
      id: s.id,
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      radius_m: s.radius_m,
      require_wifi: s.require_wifi,
      bssids: s.wifi.map((w) => w.bssid),
    }));
  }
  const policy = await getAttendancePolicy(businessId);
  if (
    policy.geofence_enabled &&
    policy.geofence_lat != null &&
    policy.geofence_lng != null &&
    policy.geofence_radius_m != null &&
    policy.geofence_radius_m > 0
  ) {
    return [
      {
        id: LEGACY_SITE_ID,
        name: 'the office',
        lat: policy.geofence_lat,
        lng: policy.geofence_lng,
        radius_m: policy.geofence_radius_m,
        require_wifi: false,
        bssids: [],
      },
    ];
  }
  return [];
}

/**
 * Location rule for the older self-service check-ins (web portal, OTP login): inside one of the
 * employee's sites when the business has sites, else the attendance-policy geofence.
 */
export async function validateSelfServiceLocation(
  businessId: string,
  employeeId: string,
  lat: number | null | undefined,
  lng: number | null | undefined,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sites = (await sitesForEmployee(businessId, employeeId)).filter((s) => s.id !== LEGACY_SITE_ID);
  if (sites.length === 0) {
    return validateCheckInGeofence(await getAttendancePolicy(businessId), lat, lng);
  }
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, error: 'Location is required for check-in. Enable location access and try again.' };
  }
  const inside = sites.filter((s) => distanceMeters(lat, lng, s.lat, s.lng) <= s.radius_m);
  if (inside.length === 0) return { ok: false, error: 'Check-in must be at one of your office locations.' };
  if (inside.every((s) => s.require_wifi)) {
    return { ok: false, error: 'This office checks Wi-Fi at check-in. Use the Khatario Staff app.' };
  }
  return { ok: true };
}

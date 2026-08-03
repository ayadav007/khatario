export type EngagementAudience = {
  type: 'all' | 'departments' | 'employees';
  departments?: string[];
  employee_ids?: string[];
};

export function parseAudience(raw: unknown): EngagementAudience {
  if (!raw || typeof raw !== 'object') return { type: 'all' };
  const o = raw as Record<string, unknown>;
  const type = o.type === 'departments' || o.type === 'employees' ? o.type : 'all';
  return {
    type,
    departments: Array.isArray(o.departments) ? o.departments.map(String) : undefined,
    employee_ids: Array.isArray(o.employee_ids) ? o.employee_ids.map(String) : undefined,
  };
}

export function buildEngagementPayload(audience: EngagementAudience, expiresAt?: string) {
  return {
    audience: {
      type: audience.type,
      ...(audience.type === 'departments' ? { departments: audience.departments ?? [] } : {}),
      ...(audience.type === 'employees' ? { employee_ids: audience.employee_ids ?? [] } : {}),
    },
    expires_at: expiresAt || undefined,
  };
}

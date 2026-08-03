'use client';

import { Input } from '@/components/ui/Input';
import type { EngagementAudience } from '@/lib/hr/engagement-audience';

type Props = {
  value: EngagementAudience;
  onChange: (value: EngagementAudience) => void;
  departments: string[];
  employees: Array<{ id: string; name: string; employee_code: string }>;
  expiresAt?: string;
  onExpiresAtChange?: (value: string) => void;
};

export function EngagementAudienceFields({
  value,
  onChange,
  departments,
  employees,
  expiresAt,
  onExpiresAtChange,
}: Props) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-gray-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Audience</p>
      <select
        className="input w-full text-sm"
        value={value.type}
        onChange={(e) => {
          const type = e.target.value as EngagementAudience['type'];
          onChange({ type, departments: [], employee_ids: [] });
        }}
      >
        <option value="all">Everyone</option>
        <option value="departments">Specific departments</option>
        <option value="employees">Specific employees</option>
      </select>

      {value.type === 'departments' && (
        <div className="max-h-32 space-y-1 overflow-y-auto">
          {departments.length === 0 ? (
            <p className="text-xs text-text-muted">Add departments in HR settings first.</p>
          ) : (
            departments.map((dept) => {
              const checked = value.departments?.includes(dept) ?? false;
              return (
                <label key={dept} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const next = new Set(value.departments ?? []);
                      if (checked) next.delete(dept);
                      else next.add(dept);
                      onChange({ ...value, departments: [...next] });
                    }}
                  />
                  {dept}
                </label>
              );
            })
          )}
        </div>
      )}

      {value.type === 'employees' && (
        <div className="max-h-40 space-y-1 overflow-y-auto">
          {employees.map((emp) => {
            const checked = value.employee_ids?.includes(emp.id) ?? false;
            return (
              <label key={emp.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = new Set(value.employee_ids ?? []);
                    if (checked) next.delete(emp.id);
                    else next.add(emp.id);
                    onChange({ ...value, employee_ids: [...next] });
                  }}
                />
                {emp.name} ({emp.employee_code})
              </label>
            );
          })}
        </div>
      )}

      {onExpiresAtChange ? (
        <div>
          <label className="mb-1 block text-xs text-text-muted">Expires on (optional)</label>
          <Input type="date" value={expiresAt ?? ''} onChange={(e) => onExpiresAtChange(e.target.value)} />
        </div>
      ) : null}
    </div>
  );
}

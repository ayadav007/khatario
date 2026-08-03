'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/Input';

type Props = {
  businessId: string | null | undefined;
  kind: 'departments' | 'designations';
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export function HrOrgCatalogField({
  businessId,
  kind,
  label,
  name,
  value,
  onChange,
  placeholder,
}: Props) {
  const [options, setOptions] = useState<string[]>([]);
  const listId = `${name}-${kind}-options`;

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/settings/hr-org-catalog?business_id=${businessId}`, {
        credentials: 'include',
      });
      if (!res.ok || cancelled) return;
      const data = await res.json();
      const catalog = data.catalog ?? {};
      setOptions(Array.isArray(catalog[kind]) ? catalog[kind] : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId, kind]);

  return (
    <div>
      <Input
        label={label}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        list={options.length > 0 ? listId : undefined}
      />
      {options.length > 0 ? (
        <datalist id={listId}>
          {options.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      ) : null}
    </div>
  );
}

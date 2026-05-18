import { useState, useEffect } from 'react';
import { Customer } from '@/types/database';

interface UseCustomersOptions {
  businessId: string | null;
  search?: string;
  filter?: 'all' | 'with-balance' | 'zero-balance';
}

export function useCustomers({ businessId, search = '', filter = 'all' }: UseCustomersOptions) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) {
      setLoading(false);
      return;
    }

    async function fetchCustomers() {
      try {
        setLoading(true);
        setError(null);

        const params = new URLSearchParams();
        if (businessId) {
          params.set('business_id', businessId);
        }
        if (search) params.set('search', search);
        if (filter !== 'all') params.set('filter', filter);

        const response = await fetch(`/api/customers?${params}`);

        if (!response.ok) {
          throw new Error('Failed to fetch customers');
        }

        const result = await response.json();
        setCustomers(result.customers || []);
      } catch (err: any) {
        setError(err.message);
        console.error('Customers fetch error:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchCustomers();
  }, [businessId, search, filter]);

  return { customers, loading, error };
}


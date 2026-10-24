'use client';

import React, { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Customer } from '@/types/database';

interface CustomerSearchSelectProps {
  /** Preloaded customers (the list API caps this, so typing also searches the server). */
  customers: Customer[];
  value: string;
  onSelect: (customer: Customer | null) => void;
  placeholder?: string;
}

export function CustomerSearchSelect({
  customers,
  value,
  onSelect,
  placeholder = 'Search customer by name or phone...',
}: CustomerSearchSelectProps) {
  const { business, user } = useAuth();
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [remoteResults, setRemoteResults] = useState<Customer[] | null>(null);

  const selectedCustomer = customers.find((c) => c.id === value) || remoteResults?.find((c) => c.id === value);

  useEffect(() => {
    if (selectedCustomer) setQuery(selectedCustomer.name);
    else if (!value) setQuery('');
  }, [selectedCustomer?.id, value]); // eslint-disable-line react-hooks/exhaustive-deps

  const searching = query.trim() !== '' && query !== selectedCustomer?.name;

  useEffect(() => {
    if (!searching || !business?.id) {
      setRemoteResults(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/customers?business_id=${business.id}&user_id=${user?.id}&limit=50&search=${encodeURIComponent(query.trim())}`,
          { signal: controller.signal }
        );
        if (res.ok) {
          const data = await res.json();
          setRemoteResults(data.customers || []);
        }
      } catch {
        // aborted or offline: keep local matches
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, searching, business?.id, user?.id]);

  const q = query.toLowerCase();
  const localMatches = searching
    ? customers.filter(
        (c) => c.name.toLowerCase().includes(q) || c.company_name?.toLowerCase().includes(q) || c.phone?.includes(query)
      )
    : customers;
  const filtered = remoteResults
    ? [...remoteResults, ...localMatches.filter((c) => !remoteResults.some((r) => r.id === c.id))]
    : localMatches;

  return (
    <div className="relative w-full">
      <div className="relative">
        <input
          type="text"
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            if (e.target.value === '') onSelect(null);
          }}
          onFocus={(e) => {
            e.target.select();
            setIsOpen(true);
          }}
          onBlur={() => setTimeout(() => setIsOpen(false), 200)}
        />
        <ChevronDown className="absolute right-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
      </div>
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto">
          {filtered.map((c) => (
            <div
              key={c.id}
              className="px-4 py-2 hover:bg-gray-50 cursor-pointer text-sm"
              onMouseDown={(e) => {
                e.preventDefault();
                setQuery(c.name);
                onSelect(c);
                setIsOpen(false);
              }}
            >
              <div className="font-medium text-gray-900">{c.name}</div>
              <div className="text-xs text-gray-500">{c.phone || 'No phone'}</div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="px-4 py-2 text-sm text-gray-500">No customers match &quot;{query}&quot;</div>
          )}
          <div
            className="px-4 py-2 hover:bg-gray-50 cursor-pointer text-sm text-primary-600 border-t"
            onMouseDown={(e) => {
              e.preventDefault();
              window.location.href = '/customers/new';
            }}
          >
            + Add New Customer
          </div>
        </div>
      )}
    </div>
  );
}

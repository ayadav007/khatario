'use client';

import React from 'react';
import { Customer } from '@/types/database';
import { useAuth } from '@/contexts/AuthContext';
import { ChevronDown } from 'lucide-react';

interface CustomerAutocompleteProps {
  customers: Customer[];
  value: string;
  onChange: (value: string) => void;
  onSelect: (customer: Customer) => void;
  disabled?: boolean;
  onAddNew?: () => void; // Callback when "Add New Customer" is clicked
}

// CustomerAutocomplete component (exact copy from parent to preserve behavior)
function CustomerAutocomplete({ customers, value, onChange, onSelect, disabled = false, onAddNew }: CustomerAutocompleteProps) {
  const [query, setQuery] = React.useState('');
  const [isOpen, setIsOpen] = React.useState(false);
  const [searchResults, setSearchResults] = React.useState<Customer[]>([]);
  const [isSearching, setIsSearching] = React.useState(false);
  const [searchTimeout, setSearchTimeout] = React.useState<NodeJS.Timeout | null>(null);
  const cacheRef = React.useRef<Map<string, Customer[]>>(new Map());
  const { business, user } = useAuth();
  
  const selectedCustomer = customers.find(c => c.id === value) || searchResults.find(c => c.id === value);
  
  React.useEffect(() => {
    if (selectedCustomer) {
        setQuery(selectedCustomer.name);
    }
  }, [selectedCustomer]);

  // Debounced server-side search - start searching after 1 character for faster results
  React.useEffect(() => {
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    if (!query.trim() || !business?.id) {
      setSearchResults([]);
      return;
    }

    // For single character, use local search only (instant)
    if (query.length === 1) {
      setSearchResults([]);
      return;
    }

    const cacheKey = `${business.id}:${query.toLowerCase()}`;
    if (cacheRef.current.has(cacheKey)) {
      setSearchResults(cacheRef.current.get(cacheKey) || []);
      return;
    }

    // For 2+ characters, do server-side search
    setIsSearching(true);
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/customers?business_id=${business.id}&search=${encodeURIComponent(query)}&limit=20&user_id=${user?.id}`);
        if (res.ok) {
          const data = await res.json();
          const result = data.customers || [];
          cacheRef.current.set(cacheKey, result);
          setSearchResults(result);
        }
      } catch (err) {
        console.error('Error searching customers:', err);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 200); // Reduced debounce from 300ms to 200ms for faster response

    setSearchTimeout(timeout);
    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [query, business?.id]);

  // Clear cache when business changes
  React.useEffect(() => {
    cacheRef.current.clear();
  }, [business?.id]);

  // Use search results if query exists and has 2+ chars, otherwise use local customers
  // Limit local filtering to first 20 for performance
  const filtered = query.trim().length >= 2 
    ? searchResults 
    : (query === '' 
        ? customers.slice(0, 20) // Show first 20 for quick access
        : customers.filter((c) => 
            c.name.toLowerCase().includes(query.toLowerCase()) || 
            c.company_name?.toLowerCase().includes(query.toLowerCase()) ||
            c.phone?.includes(query)
          ).slice(0, 20) // Limit to 20 results for performance
      );

  return (
    <div className="relative w-full">
        <div className="relative">
            <input
                type="text"
                className="input w-full cursor-text !px-3 !py-2 !text-sm placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="Search Customer..."
                value={query}
                disabled={disabled}
                onChange={(e) => {
                    setQuery(e.target.value);
                    setIsOpen(true);
                    if (e.target.value === '') {
                        onChange('');
                    }
                }}
                onFocus={() => setIsOpen(true)}
                onBlur={() => setTimeout(() => setIsOpen(false), 200)}
            />
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        </div>
        {isOpen && !disabled && (filtered.length > 0 || query.trim().length > 0) && (
            <div className="absolute z-50 w-full mt-1 bg-surface border border-border rounded-md shadow-lg max-h-60 overflow-auto dark:shadow-xl">
                {filtered.length > 0 ? (
                    <>
                        {filtered.map((c) => (
                            <div
                                key={c.id}
                                className="px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer text-sm"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    setQuery(c.name);
                                    onChange(c.id);
                                    onSelect(c);
                                    setIsOpen(false);
                                }}
                            >
                        <div className="font-medium text-text-primary">{c.name}</div>
                        {c.company_name && (
                          <div className="text-xs text-text-secondary">{c.company_name}</div>
                        )}
                        <div className="text-xs text-text-muted">{c.phone || 'No phone'}</div>
                            </div>
                        ))}
                        <div 
                            className="px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer text-sm text-primary-600 dark:text-sky-400 border-t border-border"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                if (onAddNew) {
                                    onAddNew();
                                } else {
                                    window.location.href = '/customers/new';
                                }
                            }}
                        >
                            + Add New Customer
                        </div>
                    </>
                ) : (
                    <div 
                        className="px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer text-sm text-primary-600 dark:text-sky-400"
                        onMouseDown={(e) => {
                            e.preventDefault();
                            if (onAddNew) {
                                onAddNew();
                            } else {
                                window.location.href = '/customers/new';
                            }
                        }}
                    >
                        {isSearching ? (
                            <div className="font-medium text-text-muted">Searching...</div>
                        ) : (
                            <>
                                <div className="font-medium text-text-primary">No customer found for "{query}"</div>
                                <div className="text-xs text-text-muted mt-1">+ Add New Customer</div>
                            </>
                        )}
                    </div>
                )}
            </div>
        )}
    </div>
  );
}

interface CustomerSectionProps {
  // Customer selection
  customers: Customer[];
  customerId: string;
  onCustomerChange: (customerId: string) => void;
  onCustomerSelect: (customer: Customer) => void;
  onAddNewCustomer?: () => void; // Callback when "Add New Customer" is clicked
  
  // Place of Supply
  placeOfSupply: string;
  onPlaceOfSupplyChange: (state: string) => void;
  
  // Display flags
  isFinal: boolean;
  isExport: boolean;
  isInvoiceLocked: boolean;
  
  // States list
  indianStates: string[];
}

const CustomerSection = React.memo(function CustomerSection({
  customers,
  customerId,
  onCustomerChange,
  onCustomerSelect,
  onAddNewCustomer,
  placeOfSupply,
  onPlaceOfSupplyChange,
  isFinal,
  isExport,
  isInvoiceLocked,
  indianStates,
}: CustomerSectionProps) {
  return (
    <>
      <div className="min-w-[180px] flex-[1_1_220px] lg:flex-[0_0_16rem]">
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Customer{' '}
          <span className="font-normal normal-case tracking-normal text-text-muted">(Optional for Cash Sale)</span>
        </label>
        <CustomerAutocomplete 
          customers={customers} 
          value={customerId} 
          onChange={onCustomerChange} 
          onSelect={onCustomerSelect} 
          disabled={isFinal}
          onAddNew={onAddNewCustomer}
        />
      </div>
      <div className="min-w-[150px] flex-[0_1_200px]">
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-secondary">Place of Supply</label>
        <select 
          className="input w-full !px-3 !py-2 !text-sm" 
          value={placeOfSupply} 
          onChange={e => onPlaceOfSupplyChange(e.target.value)} 
          disabled={isFinal || isExport}
        >
          <option value="">State</option>
          {indianStates.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
    </>
  );
});

export default CustomerSection;


'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Search, FileText, Users, Package, X, ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

interface SearchResult {
  id: string;
  type: 'invoice' | 'customer' | 'item' | 'purchase';
  title: string;
  subtitle?: string;
  href: string;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const router = useRouter();
  const { business, user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Always enabled - no feature flag check needed

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && results[selectedIndex]) {
        e.preventDefault();
        handleSelectResult(results[selectedIndex]);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, results, selectedIndex, onClose]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }

    const search = async () => {
      setLoading(true);
      try {
        // Search across multiple endpoints
        if (!business?.id || !user?.id) return;
        const [invoicesRes, customersRes, itemsRes] = await Promise.all([
          fetch(`/api/invoices?business_id=${business.id}&user_id=${user.id}&search=${encodeURIComponent(query)}&limit=5`).catch(() => null),
          fetch(`/api/customers?business_id=${business.id}&user_id=${user.id}&search=${encodeURIComponent(query)}&limit=5`).catch(() => null),
          fetch(`/api/items/search?business_id=${business.id}&q=${encodeURIComponent(query)}&limit=5`).catch(() => null),
        ]);

        const searchResults: SearchResult[] = [];

        if (invoicesRes?.ok) {
          const data = await invoicesRes.json();
          (data.invoices || []).forEach((invoice: any) => {
            searchResults.push({
              id: invoice.id,
              type: 'invoice',
              title: invoice.invoice_number || `Invoice #${invoice.id.substring(0, 8)}`,
              subtitle: invoice.customer_name,
              href: `/invoices/${invoice.id}`,
            });
          });
        }

        if (customersRes?.ok) {
          const data = await customersRes.json();
          (data.customers || []).forEach((customer: any) => {
            searchResults.push({
              id: customer.id,
              type: 'customer',
              title: customer.name,
              subtitle: customer.phone || customer.email,
              href: `/customers/${customer.id}`,
            });
          });
        }

        if (itemsRes?.ok) {
          const data = await itemsRes.json();
          (data.items || []).forEach((item: any) => {
            searchResults.push({
              id: item.id,
              type: 'item',
              title: item.name,
              subtitle: item.code || `Stock: ${item.current_stock || 0}`,
              href: `/items/${item.id}`,
            });
          });
        }

        setResults(searchResults);
      } catch (error) {
        console.error('Search error:', error);
      } finally {
        setLoading(false);
      }
    };

    const debounceTimer = setTimeout(search, 300);
    return () => clearTimeout(debounceTimer);
  }, [query]);

  const handleSelectResult = (result: SearchResult) => {
    router.push(result.href);
    onClose();
  };

  const getTypeIcon = (type: SearchResult['type']) => {
    switch (type) {
      case 'invoice':
        return <FileText className="w-4 h-4" />;
      case 'customer':
        return <Users className="w-4 h-4" />;
      case 'item':
        return <Package className="w-4 h-4" />;
      default:
        return <FileText className="w-4 h-4" />;
    }
  };

  const getTypeLabel = (type: SearchResult['type']) => {
    switch (type) {
      case 'invoice':
        return 'Invoice';
      case 'customer':
        return 'Customer';
      case 'item':
        return 'Item';
      case 'purchase':
        return 'Purchase';
      default:
        return '';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl mx-4 bg-white rounded-lg shadow-2xl border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200">
          <Search className="w-5 h-5 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search invoices, customers, items..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent border-none outline-none text-base"
          />
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Results */}
        <div ref={resultsRef} className="max-h-96 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-8 text-center text-gray-500">
              Searching...
            </div>
          ) : results.length === 0 && query.trim().length >= 2 ? (
            <div className="px-4 py-8 text-center text-gray-500">
              No results found for "{query}"
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500">
              <p className="text-sm font-medium mb-2">Quick Actions</p>
              <div className="space-y-1 text-left">
                <button
                  onClick={() => { router.push('/invoices/new'); onClose(); }}
                  className="w-full px-4 py-2 text-left hover:bg-gray-50 rounded text-sm"
                >
                  <ArrowRight className="w-4 h-4 inline mr-2" />
                  Create New Invoice
                </button>
                <button
                  onClick={() => { router.push('/customers/new'); onClose(); }}
                  className="w-full px-4 py-2 text-left hover:bg-gray-50 rounded text-sm"
                >
                  <ArrowRight className="w-4 h-4 inline mr-2" />
                  Add New Customer
                </button>
                <button
                  onClick={() => { router.push('/items/new'); onClose(); }}
                  className="w-full px-4 py-2 text-left hover:bg-gray-50 rounded text-sm"
                >
                  <ArrowRight className="w-4 h-4 inline mr-2" />
                  Add New Item
                </button>
              </div>
            </div>
          ) : (
            <div className="py-2">
              {results.map((result, index) => (
                <button
                  key={result.id}
                  onClick={() => handleSelectResult(result)}
                  className={`w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors ${
                    index === selectedIndex ? 'bg-slate-50' : ''
                  }`}
                >
                  <div className="flex-shrink-0 text-gray-400">
                    {getTypeIcon(result.type)}
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <div className="font-medium text-gray-900 truncate">
                      {result.title}
                    </div>
                    {result.subtitle && (
                      <div className="text-sm text-gray-500 truncate">
                        {result.subtitle}
                      </div>
                    )}
                  </div>
                  <div className="flex-shrink-0 text-xs text-gray-400">
                    {getTypeLabel(result.type)}
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
          <div className="flex items-center justify-between">
            <span>Press Enter to select • Esc to close</span>
            <span>⌘K to open</span>
          </div>
        </div>
      </div>
    </div>
  );
};


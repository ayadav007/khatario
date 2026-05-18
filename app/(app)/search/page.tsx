'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState, Suspense } from 'react';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/contexts/AuthContext';
import { useSearchParams, useRouter } from 'next/navigation';
import { format } from 'date-fns';
import Link from 'next/link';
import { FileText, Users, Package, Truck, FileCheck } from 'lucide-react';

function SearchContent() {
  const { business } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const query = searchParams.get('q') || '';
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const performSearch = async () => {
    if (!business?.id || !query.trim()) {
      setResults(null);
      return;
    }
    
    setLoading(true);
    try {
      const searchUrl = `/api/search?q=${encodeURIComponent(query)}&business_id=${business.id}`;
      console.log('[Search] Fetching:', searchUrl);
      
      const res = await fetch(searchUrl);
      
      if (res.ok) {
        const data = await res.json();
        console.log('[Search] Results:', data);
        setResults(data);
      } else {
        const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
        console.error('[Search] API error:', errorData);
        setResults(null);
      }
    } catch (error) {
      console.error('[Search] Network error:', error);
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (query && business?.id) {
      performSearch();
    } else {
      setResults(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, business?.id]);

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'invoice': return FileText;
      case 'estimate': return FileCheck;
      case 'customer': return Users;
      case 'item': return Package;
      case 'supplier': return Truck;
      default: return FileText;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'invoice': return 'Invoice';
      case 'estimate': return 'Estimate';
      case 'customer': return 'Customer';
      case 'item': return 'Item';
      case 'supplier': return 'Supplier';
      default: return type;
    }
  };

  const getTypeLink = (type: string, id: string) => {
    switch (type) {
      case 'invoice': return `/invoices/${id}`;
      case 'estimate': return `/estimates`; // Will show in detail panel when selected
      case 'customer': return `/customers/${id}`;
      case 'item': return `/items/${id}`;
      case 'supplier': return `/suppliers/${id}`;
      default: return '#';
    }
  };

  if (!query) {
    return (
      
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Search</h1>
          <p className="text-gray-600">Enter a search query to find invoices, customers, items, and suppliers.</p>
        </div>
      
    );
  }

  return (
    
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Search Results</h1>
          <p className="text-gray-600 text-sm mt-1">Searching for: "{query}"</p>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500">Searching...</div>
        ) : results && results.total > 0 ? (
          <div className="space-y-6">
            {/* Estimates */}
            {results.results.estimates && results.results.estimates.length > 0 && (
              <Card padding="lg">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <FileCheck className="w-5 h-5" />
                  Estimates ({results.results.estimates.length})
                </h2>
                <div className="space-y-2">
                  {results.results.estimates.map((item: any) => (
                    <Link
                      key={item.id}
                      href={`/estimates?select=${item.id}`}
                      className="block p-3 hover:bg-gray-50 rounded-lg transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-gray-900">{item.title}</p>
                          <p className="text-sm text-gray-600">
                            {item.date ? format(new Date(item.date), 'dd MMM yyyy') : ''}
                            {item.amount && ` • ₹${Number(item.amount).toLocaleString('en-IN')}`}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </Card>
            )}

            {/* Invoices */}
            {results.results.invoices && results.results.invoices.length > 0 && (
              <Card padding="lg">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Invoices ({results.results.invoices.length})
                </h2>
                <div className="space-y-2">
                  {results.results.invoices.map((item: any) => (
                    <Link
                      key={item.id}
                      href={getTypeLink(item.type, item.id)}
                      className="block p-3 hover:bg-gray-50 rounded-lg transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-gray-900">{item.title}</p>
                          <p className="text-sm text-gray-600">
                            {item.date ? format(new Date(item.date), 'dd MMM yyyy') : ''}
                            {item.amount && ` • ₹${Number(item.amount).toLocaleString('en-IN')}`}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </Card>
            )}

            {/* Customers */}
            {results.results.customers && results.results.customers.length > 0 && (
              <Card padding="lg">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Customers ({results.results.customers.length})
                </h2>
                <div className="space-y-2">
                  {results.results.customers.map((item: any) => (
                    <Link
                      key={item.id}
                      href={getTypeLink(item.type, item.id)}
                      className="block p-3 hover:bg-gray-50 rounded-lg transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-gray-900">{item.title}</p>
                          <p className="text-sm text-gray-600">{item.subtitle || ''}</p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </Card>
            )}

            {/* Items */}
            {results.results.items && results.results.items.length > 0 && (
              <Card padding="lg">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Package className="w-5 h-5" />
                  Items ({results.results.items.length})
                </h2>
                <div className="space-y-2">
                  {results.results.items.map((item: any) => (
                    <Link
                      key={item.id}
                      href={getTypeLink(item.type, item.id)}
                      className="block p-3 hover:bg-gray-50 rounded-lg transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-gray-900">{item.title}</p>
                          <p className="text-sm text-gray-600">
                            {item.subtitle && `Code: ${item.subtitle}`}
                            {item.amount && ` • ₹${Number(item.amount).toLocaleString('en-IN')}`}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </Card>
            )}

            {/* Suppliers */}
            {results.results.suppliers && results.results.suppliers.length > 0 && (
              <Card padding="lg">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Truck className="w-5 h-5" />
                  Suppliers ({results.results.suppliers.length})
                </h2>
                <div className="space-y-2">
                  {results.results.suppliers.map((item: any) => (
                    <Link
                      key={item.id}
                      href={getTypeLink(item.type, item.id)}
                      className="block p-3 hover:bg-gray-50 rounded-lg transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-gray-900">{item.title}</p>
                          <p className="text-sm text-gray-600">{item.subtitle || ''}</p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </Card>
            )}
          </div>
        ) : (
          <Card padding="lg">
            <div className="text-center py-12">
              <p className="text-gray-600">No results found for "{query}"</p>
              <p className="text-sm text-gray-500 mt-2">Try searching for invoices, customers, items, or suppliers</p>
            </div>
          </Card>
        )}
      </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Search</h1>
        <div className="text-center py-12 text-gray-500">Loading...</div>
      </div>
    }>
      <SearchContent />
    </Suspense>
  );
}


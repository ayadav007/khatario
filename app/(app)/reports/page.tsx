'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { TrendingUp, ShoppingCart, Package, FileText, Download, Calendar } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import Link from 'next/link';

interface SalesSummary {
  total_invoices: number;
  total_sales: number;
  total_collected: number;
  total_pending: number;
  total_tax: number;
}

interface PurchaseSummary {
  total_purchases: number;
  total_amount: number;
  total_paid: number;
  total_due: number;
  total_tax: number;
}

interface StockSummary {
  total_items: number;
  total_stock_qty: number;
  stock_value: number;
  low_stock_count: number;
  out_of_stock_count: number;
}

function ReportsPage() {
  const { business, user } = useAuth();
  const [activeTab, setActiveTab] = useState<'sales' | 'purchase' | 'stock' | 'gst'>('sales');
  const [salesSummary, setSalesSummary] = useState<SalesSummary | null>(null);
  const [purchaseSummary, setPurchaseSummary] = useState<PurchaseSummary | null>(null);
  const [stockSummary, setStockSummary] = useState<StockSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState({
    from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    to: new Date().toISOString().split('T')[0],
  });

  useEffect(() => {
    if (business?.id && user?.id) {
      fetchReports();
    }
  }, [business, user, activeTab, dateRange]);

  async function fetchReports() {
    if (!business?.id || !user?.id) return;
    setLoading(true);

    try {
      setError(null); // Clear previous errors
      
      if (activeTab === 'sales') {
        const response = await fetch(
          `/api/reports/sales-summary?business_id=${business.id}&from_date=${dateRange.from}&to_date=${dateRange.to}&user_id=${user.id}`
        );
        const data = await response.json();
        if (response.ok) {
          setSalesSummary(data.summary);
          setError(null);
        } else {
          console.error('Error fetching sales summary:', data.error);
          if (response.status === 403) {
            setError(data.error || 'Access denied. You do not have permission to view reports.');
          } else {
            setError(data.error || 'Failed to fetch sales summary');
          }
          setSalesSummary(null);
        }
      } else if (activeTab === 'purchase') {
        const response = await fetch(
          `/api/reports/purchase-summary?business_id=${business.id}&from_date=${dateRange.from}&to_date=${dateRange.to}&user_id=${user.id}`
        );
        const data = await response.json();
        if (response.ok) {
          setPurchaseSummary(data.summary);
          setError(null);
        } else {
          console.error('Error fetching purchase summary:', data.error);
          if (response.status === 403) {
            setError(data.error || 'Access denied. You do not have permission to view reports.');
          } else {
            setError(data.error || 'Failed to fetch purchase summary');
          }
          setPurchaseSummary(null);
        }
      } else if (activeTab === 'stock') {
        const response = await fetch(`/api/reports/stock-summary?business_id=${business.id}&user_id=${user.id}`);
        const data = await response.json();
        if (response.ok) {
          setStockSummary(data.summary);
          setError(null);
        } else {
          console.error('Error fetching stock summary:', data.error);
          if (response.status === 403) {
            setError(data.error || 'Access denied. You do not have permission to view reports.');
          } else {
            setError(data.error || 'Failed to fetch stock summary');
          }
          setStockSummary(null);
        }
      }
    } catch (error) {
      console.error('Error fetching reports:', error);
      // Clear summaries on error
      if (activeTab === 'sales') setSalesSummary(null);
      if (activeTab === 'purchase') setPurchaseSummary(null);
      if (activeTab === 'stock') setStockSummary(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Reports & Analytics</h1>
            <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">Insights into your business performance</p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/reports/builder">
              <button className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition">
                <FileText className="w-5 h-5" />
                <span>Custom Report Builder</span>
              </button>
            </Link>
            <button className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition">
              <Download className="w-5 h-5" />
              <span>Export PDF</span>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <div className="flex space-x-6">
            {[
              { id: 'sales', label: 'Sales Report', icon: TrendingUp },
              { id: 'purchase', label: 'Purchase Report', icon: ShoppingCart },
              { id: 'stock', label: 'Stock Report', icon: Package },
              { id: 'gst', label: 'GST Reports', icon: FileText },
            ].map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center space-x-2 pb-3 text-sm font-medium transition relative ${
                    activeTab === tab.id ? 'text-primary-600' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span>{tab.label}</span>
                  {activeTab === tab.id && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Date Range Filter */}
        {(activeTab === 'sales' || activeTab === 'purchase') && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Calendar className="w-5 h-5 text-gray-400" />
                <span className="text-sm font-medium text-gray-700">Date Range:</span>
              </div>
              <input
                type="date"
                value={dateRange.from}
                onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
              />
              <span className="text-gray-500">to</span>
              <input
                type="date"
                value={dateRange.to}
                onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
              />
            </div>
          </div>
        )}

        {/* Report Content */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
            <div className="text-red-600 font-semibold mb-2">⚠️ {error}</div>
            <p className="text-sm text-red-700">
              {error.includes('permission') || error.includes('Access denied') 
                ? 'Please contact your administrator to grant you report access permissions.'
                : 'Please try again or contact support if the issue persists.'}
            </p>
          </div>
        ) : (
          <>
            {/* Sales Report */}
            {activeTab === 'sales' && (
              salesSummary ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-6 border border-primary-200">
                    <p className="text-sm text-primary-600 mb-2">Total Sales</p>
                    <p className="text-3xl font-bold text-gray-900">₹{parseFloat(salesSummary.total_sales.toString()).toLocaleString()}</p>
                    <p className="text-xs text-gray-600 mt-1">{salesSummary.total_invoices} invoices</p>
                  </div>
                  <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-6 border border-green-200">
                    <p className="text-sm text-green-600 mb-2">Collected</p>
                    <p className="text-3xl font-bold text-gray-900">₹{parseFloat(salesSummary.total_collected.toString()).toLocaleString()}</p>
                  </div>
                  <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-6 border border-orange-200">
                    <p className="text-sm text-orange-600 mb-2">Pending</p>
                    <p className="text-3xl font-bold text-gray-900">₹{parseFloat(salesSummary.total_pending.toString()).toLocaleString()}</p>
                  </div>
                  <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-6 border border-purple-200">
                    <p className="text-sm text-purple-600 mb-2">Tax Collected</p>
                    <p className="text-3xl font-bold text-gray-900">₹{parseFloat(salesSummary.total_tax.toString()).toLocaleString()}</p>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
                  <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">No Data Available</h3>
                  <p className="text-gray-600">No sales data found for the selected date range.</p>
                </div>
              )
            )}

            {/* Purchase Report */}
            {activeTab === 'purchase' && (
              purchaseSummary ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-6 border border-purple-200">
                    <p className="text-sm text-purple-600 mb-2">Total Purchases</p>
                    <p className="text-3xl font-bold text-gray-900">₹{parseFloat(purchaseSummary.total_amount.toString()).toLocaleString()}</p>
                    <p className="text-xs text-gray-600 mt-1">{purchaseSummary.total_purchases} bills</p>
                  </div>
                  <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-6 border border-green-200">
                    <p className="text-sm text-green-600 mb-2">Paid</p>
                    <p className="text-3xl font-bold text-gray-900">₹{parseFloat(purchaseSummary.total_paid.toString()).toLocaleString()}</p>
                  </div>
                  <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-xl p-6 border border-red-200">
                    <p className="text-sm text-red-600 mb-2">Due</p>
                    <p className="text-3xl font-bold text-gray-900">₹{parseFloat(purchaseSummary.total_due.toString()).toLocaleString()}</p>
                  </div>
                  <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-6 border border-primary-200">
                    <p className="text-sm text-primary-600 mb-2">Tax Paid</p>
                    <p className="text-3xl font-bold text-gray-900">₹{parseFloat(purchaseSummary.total_tax.toString()).toLocaleString()}</p>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
                  <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">No Data Available</h3>
                  <p className="text-gray-600">No purchase data found for the selected date range.</p>
                </div>
              )
            )}

            {/* Stock Report */}
            {activeTab === 'stock' && (
              stockSummary ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-6 border border-primary-200">
                    <p className="text-sm text-primary-600 mb-2">Total Items</p>
                    <p className="text-3xl font-bold text-gray-900">{stockSummary.total_items}</p>
                  </div>
                  <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-6 border border-green-200">
                    <p className="text-sm text-green-600 mb-2">Stock Value</p>
                    <p className="text-3xl font-bold text-gray-900">₹{parseFloat(stockSummary.stock_value.toString()).toLocaleString()}</p>
                  </div>
                  <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-xl p-6 border border-yellow-200">
                    <p className="text-sm text-yellow-600 mb-2">Low Stock</p>
                    <p className="text-3xl font-bold text-gray-900">{stockSummary.low_stock_count}</p>
                  </div>
                  <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-xl p-6 border border-red-200">
                    <p className="text-sm text-red-600 mb-2">Out of Stock</p>
                    <p className="text-3xl font-bold text-gray-900">{stockSummary.out_of_stock_count}</p>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
                  <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">No Data Available</h3>
                  <p className="text-gray-600">No stock data found.</p>
                </div>
              )
            )}

            {/* GST Reports */}
            {activeTab === 'gst' && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
                <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-gray-900 mb-2">GST Returns</h3>
                <p className="text-gray-600 mb-8 max-w-md mx-auto">Generate and download your GSTR-1, GSTR-2, and GSTR-3B reports in JSON/CSV formats for easy filing.</p>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
                  <div className="border border-gray-200 rounded-lg p-6 hover:border-primary-500 hover:shadow-md transition cursor-pointer group" onClick={() => window.location.href = '/reports/gst/gstr1'}>
                    <div className="w-12 h-12 bg-slate-50 rounded-lg flex items-center justify-center mb-4 group-hover:bg-slate-100 transition">
                      <FileText className="w-6 h-6 text-primary-600" />
                    </div>
                    <h4 className="font-semibold text-gray-900 mb-2">GSTR-1</h4>
                    <p className="text-sm text-gray-500 mb-4">Details of outward supplies of goods or services</p>
                    <span className="text-primary-600 text-sm font-medium flex items-center justify-center gap-1 group-hover:gap-2 transition-all">
                      Generate Report <TrendingUp className="w-4 h-4" />
                    </span>
                  </div>

                  <div className="border border-gray-200 rounded-lg p-6 hover:border-primary-500 hover:shadow-md transition cursor-pointer group" onClick={() => window.location.href = '/reports/gst/gstr2b'}>
                    <div className="w-12 h-12 bg-slate-50 rounded-lg flex items-center justify-center mb-4 group-hover:bg-slate-100 transition">
                      <ShoppingCart className="w-6 h-6 text-primary-600" />
                    </div>
                    <h4 className="font-semibold text-gray-900 mb-2">GSTR-2B</h4>
                    <p className="text-sm text-gray-500 mb-4">Auto-drafted ITC statement (Inward Supplies)</p>
                    <span className="text-primary-600 text-sm font-medium flex items-center justify-center gap-1 group-hover:gap-2 transition-all">
                      Generate Report <TrendingUp className="w-4 h-4" />
                    </span>
                  </div>

                  <div className="border border-gray-200 rounded-lg p-6 hover:border-primary-500 hover:shadow-md transition cursor-pointer group" onClick={() => window.location.href = '/reports/gst/gstr3b'}>
                    <div className="w-12 h-12 bg-slate-50 rounded-lg flex items-center justify-center mb-4 group-hover:bg-slate-100 transition">
                      <Package className="w-6 h-6 text-primary-600" />
                    </div>
                    <h4 className="font-semibold text-gray-900 mb-2">GSTR-3B</h4>
                    <p className="text-sm text-gray-500 mb-4">Monthly summary return of outward supplies and ITC</p>
                    <span className="text-primary-600 text-sm font-medium flex items-center justify-center gap-1 group-hover:gap-2 transition-all">
                      Generate Report <TrendingUp className="w-4 h-4" />
                    </span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    
  );
}

export default withPageAuth('reports', 'read', ReportsPage);

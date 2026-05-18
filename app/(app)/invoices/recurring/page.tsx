'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Plus, Calendar, User, RefreshCw, Check, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';

interface RecurringInvoice {
  id: string;
  customer_id: string;
  customer_name: string;
  frequency: string;
  interval_value: number;
  start_date: string;
  end_date: string | null;
  next_run_date: string;
  last_run_date: string | null;
  is_active: boolean;
}

export default function RecurringInvoicesPage() {
  const router = useRouter();
  const { business } = useAuth();
  const [recurringInvoices, setRecurringInvoices] = useState<RecurringInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (business?.id) {
      fetchRecurringInvoices();
    }
  }, [business]);

  async function fetchRecurringInvoices() {
    try {
      const response = await fetch(`/api/recurring-invoices?business_id=${business!.id}`);
      const data = await response.json();
      setRecurringInvoices(data.recurringInvoices || []);
    } catch (error) {
      console.error('Error fetching recurring invoices:', error);
    } finally {
      setLoading(false);
    }
  }

  const getFrequencyLabel = (frequency: string, intervalValue: number) => {
    const labels: Record<string, string> = {
      daily: 'day(s)',
      weekly: 'week(s)',
      monthly: 'month(s)',
      quarterly: 'quarter(s)',
      yearly: 'year(s)',
    };
    return `Every ${intervalValue} ${labels[frequency] || frequency}`;
  };

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Recurring Invoices</h1>
            <p className="text-gray-600 text-sm mt-1">Automate periodic invoice generation</p>
          </div>
          <button
            onClick={() => router.push('/invoices/recurring/new')}
            className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
          >
            <Plus className="w-5 h-5" />
            <span>New Recurring Invoice</span>
          </button>
        </div>

        {/* Info Banner */}
        <div className="bg-slate-50 border border-primary-200 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <RefreshCw className="w-5 h-5 text-primary-600 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-primary-900">Automate Your Billing</p>
              <p className="text-sm text-primary-700 mt-1">
                Set up recurring invoices to automatically generate invoices for regular customers. 
                Perfect for subscriptions, retainers, and monthly services.
              </p>
            </div>
          </div>
        </div>

        {/* Recurring Invoices List */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          {loading ? (
            <div className="p-12 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : recurringInvoices.length === 0 ? (
            <div className="p-12 text-center">
              <RefreshCw className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No recurring invoices set up yet</p>
              <button
                onClick={() => router.push('/invoices/recurring/new')}
                className="mt-4 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
              >
                Create Your First Recurring Invoice
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Customer</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Frequency</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Next Run</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Last Run</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Status</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {recurringInvoices.map((recurring) => (
                    <tr key={recurring.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-4 px-4">
                        <div className="flex items-center space-x-2">
                          <User className="w-4 h-4 text-gray-400" />
                          <span className="text-sm font-medium text-gray-900">
                            {recurring.customer_name}
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center space-x-2">
                          <RefreshCw className="w-4 h-4 text-primary-500" />
                          <span className="text-sm text-gray-700">
                            {getFrequencyLabel(recurring.frequency, recurring.interval_value)}
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center space-x-2 text-sm text-gray-600">
                          <Calendar className="w-4 h-4" />
                          <span>{new Date(recurring.next_run_date).toLocaleDateString()}</span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        {recurring.last_run_date ? (
                          <span className="text-sm text-gray-600">
                            {new Date(recurring.last_run_date).toLocaleDateString()}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-400">Never</span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        {recurring.is_active ? (
                          <div className="flex items-center space-x-2">
                            <Check className="w-5 h-5 text-green-500" />
                            <span className="text-sm text-green-600">Active</span>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-2">
                            <X className="w-5 h-5 text-red-500" />
                            <span className="text-sm text-red-600">Inactive</span>
                          </div>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <button className="text-sm text-primary-600 hover:text-primary-700 font-medium">
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    
  );
}


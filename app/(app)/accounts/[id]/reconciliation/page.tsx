'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ArrowLeft, Loader2, Download, Calendar } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { format } from 'date-fns';

interface ReconciliationEntry {
  id: string;
  entry_date: string;
  voucher_type: string;
  voucher_id: string;
  reference_number?: string;
  narration?: string;
  debit: number;
  credit: number;
  running_balance: number;
}

interface ReconciliationSummary {
  opening_balance: number;
  total_debit: number;
  total_credit: number;
  current_balance: number;
  transaction_count: number;
}

export default function AccountReconciliationPage() {
  const params = useParams();
  const router = useRouter();
  const { business } = useAuth();
  const accountId = params.id as string;
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<any>(null);
  const [entries, setEntries] = useState<ReconciliationEntry[]>([]);
  const [summary, setSummary] = useState<ReconciliationSummary | null>(null);
  const [asOnDate, setAsOnDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    if (accountId && business?.id) {
      fetchReconciliation();
    }
  }, [accountId, business?.id, asOnDate]);

  const fetchReconciliation = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const res = await fetch(
        `/api/accounts/reconciliation?business_id=${business.id}&account_id=${accountId}&as_on_date=${asOnDate}`
      );
      if (res.ok) {
        const data = await res.json();
        setAccount(data.account);
        setEntries(data.entries || []);
        setSummary(data.summary);
      }
    } catch (error) {
      console.error('Error fetching reconciliation:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      
        <div className="flex items-center justify-center h-[calc(100vh-100px)]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      
    );
  }

  return (
    
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Link href={`/accounts/${accountId}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Account
            </Button>
          </Link>
        </div>

        <Card>
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-text-primary">
                Account Reconciliation
              </h1>
              <p className="text-sm text-text-secondary mt-1">
                {account?.account_name} ({account?.account_code})
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-text-secondary" />
                <label className="text-sm font-medium text-text-secondary">
                  As On Date:
                </label>
                <Input
                  type="date"
                  value={asOnDate}
                  onChange={(e) => setAsOnDate(e.target.value)}
                  className="w-40"
                />
              </div>
            </div>

            {summary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-lg">
                <div>
                  <label className="text-xs text-text-secondary">Opening Balance</label>
                  <p className="text-lg font-semibold text-text-primary">
                    ₹{Number(summary.opening_balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <label className="text-xs text-text-secondary">Total Debit</label>
                  <p className="text-lg font-semibold text-green-600">
                    ₹{Number(summary.total_debit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <label className="text-xs text-text-secondary">Total Credit</label>
                  <p className="text-lg font-semibold text-red-600">
                    ₹{Number(summary.total_credit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <label className="text-xs text-text-secondary">Current Balance</label>
                  <p className="text-lg font-semibold text-text-primary">
                    ₹{Number(summary.current_balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 text-sm font-medium text-text-secondary">Date</th>
                    <th className="text-left p-3 text-sm font-medium text-text-secondary">Voucher Type</th>
                    <th className="text-left p-3 text-sm font-medium text-text-secondary">Reference</th>
                    <th className="text-left p-3 text-sm font-medium text-text-secondary">Narration</th>
                    <th className="text-right p-3 text-sm font-medium text-text-secondary">Debit</th>
                    <th className="text-right p-3 text-sm font-medium text-text-secondary">Credit</th>
                    <th className="text-right p-3 text-sm font-medium text-text-secondary">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center p-8 text-text-secondary">
                        No transactions found
                      </td>
                    </tr>
                  ) : (
                    entries.map((entry) => (
                      <tr key={entry.id} className="border-b border-border hover:bg-gray-50">
                        <td className="p-3 text-sm text-text-primary">
                          {format(new Date(entry.entry_date), 'dd MMM yyyy')}
                        </td>
                        <td className="p-3 text-sm text-text-primary capitalize">
                          {entry.voucher_type?.replace('_', ' ')}
                        </td>
                        <td className="p-3 text-sm text-text-secondary">
                          {entry.reference_number || '-'}
                        </td>
                        <td className="p-3 text-sm text-text-secondary">
                          {entry.narration || '-'}
                        </td>
                        <td className="p-3 text-sm text-right text-green-600">
                          {Number(entry.debit) > 0
                            ? `₹${Number(entry.debit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                            : '-'}
                        </td>
                        <td className="p-3 text-sm text-right text-red-600">
                          {Number(entry.credit) > 0
                            ? `₹${Number(entry.credit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                            : '-'}
                        </td>
                        <td className="p-3 text-sm text-right font-medium text-text-primary">
                          ₹{Number(entry.running_balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      </div>
    
  );
}


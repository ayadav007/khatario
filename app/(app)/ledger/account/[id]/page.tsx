'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ArrowLeft, Loader2, FileText, Download, Printer } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { format } from 'date-fns';

interface LedgerEntry {
  id: string;
  entry_date: string;
  voucher_number?: string;
  voucher_type?: string;
  reference_number?: string;
  debit: number;
  credit: number;
  running_balance: number;
  description?: string;
}

export default function AccountLedgerPage() {
  const params = useParams();
  const router = useRouter();
  const { business } = useAuth();
  const accountId = params.id as string;
  const [account, setAccount] = useState<any>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingBalance, setOpeningBalance] = useState(0);
  const [closingBalance, setClosingBalance] = useState(0);
  const [fromDate, setFromDate] = useState(format(new Date(new Date().getFullYear(), 0, 1), 'yyyy-MM-dd'));
  const [toDate, setToDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  useEffect(() => {
    if (accountId && business?.id) {
      fetchLedger();
    }
  }, [accountId, business?.id, fromDate, toDate]);

  const fetchLedger = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        from_date: fromDate,
        to_date: toDate,
      });

      const res = await fetch(`/api/ledger/account/${accountId}?${params}`);
      if (res.ok) {
        const data = await res.json();
        setAccount(data.account);
        setEntries(data.entries || []);
        setOpeningBalance(data.opening_balance || 0);
        setClosingBalance(data.closing_balance || 0);
      } else {
        router.push('/ledger');
      }
    } catch (error) {
      console.error('Error fetching account ledger:', error);
      router.push('/ledger');
    } finally {
      setLoading(false);
    }
  };

  const [printing, setPrinting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const handlePrintStatement = async () => {
    setPrinting(true);
    try {
      const params = new URLSearchParams({
        business_id: business?.id || '',
        from_date: fromDate,
        to_date: toDate,
      });
      const res = await fetch(`/api/ledger/account/${accountId}/statement?${params}`);
      if (res.ok) {
        const { html } = await res.json();
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(html);
          printWindow.document.close();
          printWindow.focus();
          setTimeout(() => {
            printWindow.print();
          }, 500);
        }
      }
    } catch (error) {
      console.error('Error printing statement:', error);
    } finally {
      setPrinting(false);
    }
  };

  const handleDownloadStatement = async () => {
    setDownloading(true);
    try {
      const params = new URLSearchParams({
        business_id: business?.id || '',
        from_date: fromDate,
        to_date: toDate,
      });
      const res = await fetch(`/api/ledger/account/${accountId}/statement/pdf?${params}`);
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Statement-${account.name || 'Account'}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (error) {
      console.error('Error downloading statement:', error);
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      
        <div className="flex items-center justify-center h-[calc(100vh-100px)]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      
    );
  }

  if (!account) {
    return (
      
        <div className="text-center py-12">
          <p className="text-text-secondary">Account not found</p>
        </div>
      
    );
  }

  return (
    
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Link href="/ledger">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Ledger
            </Button>
          </Link>
          <div className="flex gap-2">
            <Link href={`/accounts/${accountId}`}>
              <Button variant="ghost" size="sm">
                View Account
              </Button>
            </Link>
            <Button variant="secondary" size="sm" onClick={handlePrintStatement} isLoading={printing} disabled={downloading}>
              <Printer className="w-4 h-4 mr-2" />
              Print Statement
            </Button>
            <Button variant="secondary" size="sm" onClick={handleDownloadStatement} isLoading={downloading} disabled={printing}>
              <Download className="w-4 h-4 mr-2" />
              Download Statement
            </Button>
          </div>
        </div>

        <Card>
          <div className="space-y-4">
            <div>
              <h1 className="text-2xl font-bold text-text-primary">{account.account_name}</h1>
              <p className="text-sm text-text-secondary mt-1">
                Account Code: {account.account_code} • {account.account_group_name}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                type="date"
                label="From Date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
              <Input
                type="date"
                label="To Date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
          </div>
        </Card>

        <Card>
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium text-text-secondary">Opening Balance</label>
                <p className="text-lg font-semibold text-text-primary mt-1">
                  ₹{Number(openingBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-text-secondary">Closing Balance</label>
                <p className="text-lg font-semibold text-text-primary mt-1">
                  ₹{Number(closingBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-text-secondary">Net Movement</label>
                <p className="text-lg font-semibold text-text-primary mt-1">
                  ₹{Number(closingBalance - openingBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          </div>

          {entries.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-text-secondary">No transactions found for this period</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Date</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Voucher</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Reference</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Description</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Debit</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Credit</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Opening Balance Row */}
                  <tr className="border-b border-border bg-gray-50">
                    <td colSpan={4} className="py-3 px-4 font-medium">
                      Opening Balance
                    </td>
                    <td colSpan={3} className="py-3 px-4 text-right font-semibold">
                      ₹{Number(openingBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>

                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b border-border hover:bg-gray-50">
                      <td className="py-4 px-4">
                        {format(new Date(entry.entry_date), 'dd MMM yyyy')}
                      </td>
                      <td className="py-4 px-4">
                        {entry.voucher_number && (
                          <span className="text-sm">{entry.voucher_number}</span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        {entry.reference_number && (
                          <span className="text-sm text-text-secondary">{entry.reference_number}</span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        {entry.description && (
                          <span className="text-sm text-text-secondary">{entry.description}</span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-right">
                        {Number(entry.debit) > 0 && (
                          <span className="text-primary-600">
                            ₹{Number(entry.debit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-right">
                        {Number(entry.credit) > 0 && (
                          <span className="text-green-600">
                            ₹{Number(entry.credit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-right font-semibold">
                        ₹{Number(entry.running_balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    
  );
}


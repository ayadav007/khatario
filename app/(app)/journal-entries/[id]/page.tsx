'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Edit, Loader2, FileText, Lock, Unlock } from 'lucide-react';
import { DocumentList } from '@/components/documents/DocumentList';
import { DocumentUploader } from '@/components/documents/DocumentUploader';
import { useAuth } from '@/contexts/AuthContext';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { format } from 'date-fns';
import { useToastContext } from '@/contexts/ToastContext';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { useMobileHeaderTitleOverride } from '@/contexts/MobileHeaderTitleContext';

interface JournalLine {
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
  narration?: string;
}

export default function JournalEntryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { business } = useAuth();
  const toast = useToastContext();
  const voucherId = params.id as string;
  const [entry, setEntry] = useState<any>(null);

  useMobileHeaderTitleOverride(entry?.voucher_number);
  const [lines, setLines] = useState<JournalLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [locking, setLocking] = useState(false);
  const [showDocumentUploader, setShowDocumentUploader] = useState(false);

  useEffect(() => {
    if (voucherId && business?.id) {
      fetchEntry();
    }
  }, [voucherId, business?.id]);

  const fetchEntry = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/journal-entries/${voucherId}?business_id=${business.id}`);
      if (res.ok) {
        const data = await res.json();
        setEntry(data.entry);
        setLines(data.lines || []);
      } else {
        router.push('/journal-entries');
      }
    } catch (error) {
      console.error('Error fetching journal entry:', error);
      router.push('/journal-entries');
    } finally {
      setLoading(false);
    }
  };

  const handleLock = async () => {
    if (!business?.id || !entry || locking) return;

    const lockReason = prompt('Enter reason for locking (optional):');
    if (lockReason === null) return; // User cancelled

    setLocking(true);
    try {
      const res = await fetch(`/api/journal-entries/${voucherId}/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          lock_reason: lockReason || undefined,
        }),
      });

      if (res.ok) {
        await fetchEntry();
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to lock entry');
      }
    } catch (error) {
      console.error('Error locking entry:', error);
      toast.error('Failed to lock entry');
    } finally {
      setLocking(false);
    }
  };

  const handleUnlock = async () => {
    if (!business?.id || !entry || locking) return;

    if (!confirm('Are you sure you want to unlock this entry?')) return;

    setLocking(true);
    try {
      const res = await fetch(`/api/journal-entries/${voucherId}/lock?business_id=${business.id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        await fetchEntry();
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to unlock entry');
      }
    } catch (error) {
      console.error('Error unlocking entry:', error);
      toast.error('Failed to unlock entry');
    } finally {
      setLocking(false);
    }
  };

  if (loading) {
    return (
      
        <div className="flex items-center justify-center h-[calc(100vh-100px)]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      
    );
  }

  if (!entry) {
    return (
      
        <div className="text-center py-12">
          <p className="text-text-secondary">Journal entry not found</p>
        </div>
      
    );
  }

  return (
    
      <div className="space-y-6">
        <MobileDuplicatePageChrome
          className="mb-0"
          title="Journal entry"
          description={`Voucher: ${entry.voucher_number}`}
          trailing={
            <div className="flex gap-2">
              {entry.is_locked ? (
                <Button variant="secondary" onClick={handleUnlock} disabled={locking}>
                  {locking ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Unlock className="w-4 h-4 mr-2" />
                  )}
                  Unlock Entry
                </Button>
              ) : (
                <>
                  <Button variant="secondary" onClick={handleLock} disabled={locking}>
                    {locking ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Lock className="w-4 h-4 mr-2" />
                    )}
                    Lock Entry
                  </Button>
                  <Link href={`/journal-entries/${voucherId}/edit`}>
                    <Button>
                      <Edit className="w-4 h-4 mr-2" />
                      Edit Entry
                    </Button>
                  </Link>
                </>
              )}
            </div>
          }
        />

        <Card>
          <div className="space-y-6">
            <div>
              <div className="flex items-center gap-3 hidden md:flex">
                <h2 className="text-xl font-bold text-text-primary">Journal Entry</h2>
                {entry.is_locked && (
                  <span className="px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-sm font-medium flex items-center gap-1">
                    <Lock className="w-3 h-3" />
                    Locked
                  </span>
                )}
                {entry.is_reversing && (
                  <span className="px-3 py-1 bg-slate-100 text-primary-800 rounded-full text-sm font-medium">
                    Reversing Entry
                  </span>
                )}
              </div>
              <p className="text-sm text-text-secondary mt-1">Voucher: {entry.voucher_number}</p>
              {entry.is_locked && entry.locked_at && (
                <div className="mt-2 text-sm text-text-secondary">
                  <p>Locked by: {entry.locked_by_name || 'Unknown'}</p>
                  <p>Locked at: {format(new Date(entry.locked_at), 'dd MMM yyyy HH:mm')}</p>
                  {entry.lock_reason && <p>Reason: {entry.lock_reason}</p>}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium text-text-secondary">Entry Date</label>
                <p className="mt-1 text-text-primary">
                  {format(new Date(entry.entry_date), 'dd MMM yyyy')}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-text-secondary">Reference Number</label>
                <p className="mt-1 text-text-primary">{entry.reference_number || '-'}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-text-secondary">Total Amount</label>
                <p className="mt-1 text-lg font-semibold text-text-primary">
                  ₹{Number(entry.total_debit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>

            <div className="pt-4 border-t border-border">
              <h2 className="text-lg font-semibold text-text-primary mb-4">Entry Lines</h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-4 font-semibold text-text-primary">Account</th>
                      <th className="text-right py-3 px-4 font-semibold text-text-primary">Debit</th>
                      <th className="text-right py-3 px-4 font-semibold text-text-primary">Credit</th>
                      <th className="text-left py-3 px-4 font-semibold text-text-primary">Narration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, index) => (
                      <tr key={index} className="border-b border-border">
                        <td className="py-4 px-4">
                          <div>
                            <div className="font-medium">{line.account_name}</div>
                            <div className="text-sm text-text-secondary font-mono">{line.account_code}</div>
                          </div>
                        </td>
                        <td className="py-4 px-4 text-right">
                          {Number(line.debit) > 0 && (
                            <span className="text-primary-600">
                              ₹{Number(line.debit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-4 text-right">
                          {Number(line.credit) > 0 && (
                            <span className="text-green-600">
                              ₹{Number(line.credit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-4 text-sm text-text-secondary">
                          {line.narration || '-'}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-border font-semibold">
                      <td className="py-4 px-4">Total</td>
                      <td className="py-4 px-4 text-right text-primary-600">
                        ₹{Number(entry.total_debit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-4 px-4 text-right text-green-600">
                        ₹{Number(entry.total_credit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Documents */}
            <div className="pt-4 border-t border-border">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-text-primary">Documents</h2>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowDocumentUploader(!showDocumentUploader)}
                >
                  {showDocumentUploader ? 'Hide Uploader' : 'Add Document'}
                </Button>
              </div>
              {showDocumentUploader && entry && business && (
                <div className="mb-4">
                  <DocumentUploader
                    entityType="journal_entry"
                    entityId={entry.voucher_id}
                    businessId={business.id}
                    onUploadSuccess={() => {
                      setShowDocumentUploader(false);
                    }}
                  />
                </div>
              )}
              {entry && business && (
                <DocumentList
                  entityType="journal_entry"
                  entityId={entry.voucher_id}
                  businessId={business.id}
                />
              )}
            </div>
          </div>
        </Card>
      </div>
    
  );
}


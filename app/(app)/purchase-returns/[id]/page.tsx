'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { useMobileHeaderTitleOverride } from '@/contexts/MobileHeaderTitleContext';
import { useToastContext } from '@/contexts/ToastContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { getApiErrorMessage, safeJsonParse } from '@/lib/api-utils';

interface ReturnItem {
  id: string;
  description: string;
  catalog_item_name?: string;
  hsn_sac?: string;
  qty: number;
  unit?: string;
  unit_price: number;
  tax_rate: number;
  tax_amount: number;
  line_total: number;
}

interface PurchaseReturnDetail {
  id: string;
  return_number: string;
  return_date: string;
  original_purchase_date?: string;
  reason?: string;
  supplier_name?: string;
  supplier_phone?: string;
  supplier_gstin?: string;
  purchase_bill_number?: string;
  purchase_id?: string;
  subtotal: number;
  tax_total: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  grand_total: number;
  refund_status: string;
  refund_mode?: string | null;
  refund_date?: string | null;
  refund_amount?: number | null;
  itc_reversed?: boolean;
  notes?: string;
  items: ReturnItem[];
}

function statusClass(status: string) {
  const colors: Record<string, string> = {
    pending: 'bg-amber-50 text-amber-800 border-amber-200',
    refunded: 'bg-green-50 text-green-800 border-green-200',
    adjusted: 'bg-slate-50 text-slate-800 border-border',
  };
  return colors[status] || 'bg-gray-50 text-gray-800 border-border';
}

type RefundStatus = 'pending' | 'refunded' | 'adjusted';

export default function PurchaseReturnDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  const returnId = params.id as string;

  const { allowed: canUpdate, loading: authLoading } = useAuthorizationGuard({
    resource: 'purchases',
    action: 'update',
    skipCheck: !user?.id || !business?.id,
  });

  const [data, setData] = useState<PurchaseReturnDetail | null>(null);

  useMobileHeaderTitleOverride(data?.return_number);
  const [loading, setLoading] = useState(true);
  const [savingRefund, setSavingRefund] = useState(false);
  const [refundForm, setRefundForm] = useState({
    refund_status: 'pending' as RefundStatus,
    refund_mode: '',
    refund_date: new Date().toISOString().split('T')[0],
    refund_amount: '',
  });

  useEffect(() => {
    if (returnId && business?.id) {
      void fetchReturn();
    }
  }, [returnId, business?.id]);

  async function fetchReturn() {
    if (!business?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/purchase-returns/${returnId}?business_id=${business.id}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const json = await res.json();
        const pr = json.purchaseReturn as PurchaseReturnDetail;
        setData(pr);
        setRefundForm({
          refund_status: (pr.refund_status as RefundStatus) || 'pending',
          refund_mode: pr.refund_mode || '',
          refund_date: pr.refund_date
            ? String(pr.refund_date).split('T')[0]
            : new Date().toISOString().split('T')[0],
          refund_amount:
            pr.refund_amount != null
              ? String(pr.refund_amount)
              : String(pr.grand_total ?? ''),
        });
      } else {
        router.push('/purchase-returns');
      }
    } catch (error) {
      console.error('Error fetching purchase return:', error);
      router.push('/purchase-returns');
    } finally {
      setLoading(false);
    }
  }

  async function saveRefundSettlement() {
    if (!business?.id || !data) return;
    setSavingRefund(true);
    try {
      const payload: Record<string, unknown> = {
        business_id: business.id,
        refund_status: refundForm.refund_status,
      };
      if (refundForm.refund_status !== 'pending') {
        payload.refund_mode =
          refundForm.refund_status === 'adjusted'
            ? 'adjusted_to_purchase'
            : refundForm.refund_mode;
        payload.refund_date = refundForm.refund_date;
        payload.refund_amount = parseFloat(refundForm.refund_amount) || Number(data.grand_total);
      }

      const res = await fetch(`/api/purchase-returns/${returnId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const json = await res.json();
        const pr = json.purchaseReturn as PurchaseReturnDetail;
        setData((prev) => (prev ? { ...prev, ...pr, items: prev.items } : pr));
        setRefundForm({
          refund_status: (pr.refund_status as RefundStatus) || 'pending',
          refund_mode: pr.refund_mode || '',
          refund_date: pr.refund_date
            ? String(pr.refund_date).split('T')[0]
            : refundForm.refund_date,
          refund_amount:
            pr.refund_amount != null ? String(pr.refund_amount) : String(data.grand_total),
        });
        toast.success('Refund settlement updated');
      } else {
        const err = await safeJsonParse(res);
        toast.error(getApiErrorMessage(err, 'Failed to update refund settlement'));
      }
    } catch (error) {
      console.error(error);
      toast.error('Failed to update refund settlement');
    } finally {
      setSavingRefund(false);
    }
  }

  if (loading || authLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <p className="text-text-secondary">Purchase return not found</p>
        <Button variant="ghost" onClick={() => router.push('/purchase-returns')} className="mt-4">
          Back to list
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <MobileDuplicatePageChrome
        className="mb-0"
        title={data.return_number}
        description={
          <>
            {data.supplier_name || 'Supplier'}
            <span className="mx-2">·</span>
            {format(new Date(data.return_date), 'dd MMM yyyy')}
          </>
        }
        trailing={
          <span
            className={`px-3 py-1 text-sm font-medium rounded-full border capitalize ${statusClass(data.refund_status)}`}
          >
            {data.refund_status}
          </span>
        }
      />

      <Card padding="md">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-text-secondary">Supplier</p>
            <p className="font-medium text-text-primary">{data.supplier_name || '—'}</p>
            {data.supplier_gstin && (
              <p className="text-text-muted">GSTIN: {data.supplier_gstin}</p>
            )}
          </div>
          <div>
            <p className="text-text-secondary">Linked purchase</p>
            {data.purchase_id && data.purchase_bill_number ? (
              <Link
                href={`/purchases/${data.purchase_id}`}
                className="font-medium link-primary"
              >
                {data.purchase_bill_number}
              </Link>
            ) : (
              <p className="font-medium text-text-primary">—</p>
            )}
          </div>
          {data.reason && (
            <div className="md:col-span-2">
              <p className="text-text-secondary">Reason</p>
              <p className="text-text-primary">{data.reason}</p>
            </div>
          )}
          {data.notes && (
            <div className="md:col-span-2">
              <p className="text-text-secondary">Notes</p>
              <p className="text-text-primary whitespace-pre-wrap">{data.notes}</p>
            </div>
          )}
        </div>
      </Card>

      <Card padding="md">
        <h2 className="text-lg font-semibold text-text-primary mb-1">Refund from supplier</h2>
        <p className="text-sm text-text-secondary mb-4">
          The return is already recorded in stock and accounts. Use this section when the supplier
          pays you back or adjusts your payable balance.
        </p>

        {!canUpdate ? (
          <p className="text-sm text-text-muted">You do not have permission to update refund status.</p>
        ) : (
          <div className="space-y-4 max-w-lg">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Status</label>
              <select
                value={refundForm.refund_status}
                onChange={(e) => {
                  const status = e.target.value as RefundStatus;
                  setRefundForm((f) => ({
                    ...f,
                    refund_status: status,
                    refund_mode: status === 'adjusted' ? 'adjusted_to_purchase' : f.refund_mode,
                  }));
                }}
                className="w-full border border-border rounded-md px-3 py-2 text-sm bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="pending">Pending — not settled yet</option>
                <option value="refunded">Refunded — money received</option>
                <option value="adjusted">Adjusted — netted against purchase due</option>
              </select>
            </div>

            {refundForm.refund_status === 'refunded' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Refund mode
                  </label>
                  <select
                    value={refundForm.refund_mode}
                    onChange={(e) =>
                      setRefundForm((f) => ({ ...f, refund_mode: e.target.value }))
                    }
                    className="w-full border border-border rounded-md px-3 py-2 text-sm bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">Select mode</option>
                    <option value="cash">Cash</option>
                    <option value="bank">Bank transfer</option>
                    <option value="upi">UPI</option>
                    <option value="cheque">Cheque</option>
                  </select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1">
                      Refund date
                    </label>
                    <input
                      type="date"
                      value={refundForm.refund_date}
                      onChange={(e) =>
                        setRefundForm((f) => ({ ...f, refund_date: e.target.value }))
                      }
                      className="w-full border border-border rounded-md px-3 py-2 text-sm bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1">
                      Amount received (₹)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={refundForm.refund_amount}
                      onChange={(e) =>
                        setRefundForm((f) => ({ ...f, refund_amount: e.target.value }))
                      }
                      className="w-full border border-border rounded-md px-3 py-2 text-sm bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>
              </>
            )}

            {refundForm.refund_status === 'adjusted' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Adjustment date
                  </label>
                  <input
                    type="date"
                    value={refundForm.refund_date}
                    onChange={(e) =>
                      setRefundForm((f) => ({ ...f, refund_date: e.target.value }))
                    }
                    className="w-full border border-border rounded-md px-3 py-2 text-sm bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Amount adjusted (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={refundForm.refund_amount}
                    onChange={(e) =>
                      setRefundForm((f) => ({ ...f, refund_amount: e.target.value }))
                    }
                    className="w-full border border-border rounded-md px-3 py-2 text-sm bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>
            )}

            {refundForm.refund_status === 'pending' && data.refund_mode && (
              <p className="text-xs text-text-muted">
                Previous settlement ({data.refund_mode}
                {data.refund_date
                  ? `, ${format(new Date(data.refund_date), 'dd MMM yyyy')}`
                  : ''}
                ) will be cleared when you save as pending.
              </p>
            )}

            <Button
              variant="primary"
              onClick={() => void saveRefundSettlement()}
              isLoading={savingRefund}
              disabled={savingRefund}
            >
              Save refund status
            </Button>
          </div>
        )}
      </Card>

      <Card padding="md">
        <h2 className="text-lg font-semibold text-text-primary mb-4">Line items</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 font-medium text-text-secondary">Item</th>
                <th className="text-right py-2 px-3 font-medium text-text-secondary">Qty</th>
                <th className="text-right py-2 px-3 font-medium text-text-secondary">Rate</th>
                <th className="text-right py-2 px-3 font-medium text-text-secondary">Tax</th>
                <th className="text-right py-2 px-3 font-medium text-text-secondary">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id} className="border-b border-border">
                  <td className="py-2 px-3">
                    <div className="font-medium text-text-primary">
                      {item.catalog_item_name || item.description}
                    </div>
                    {item.hsn_sac && (
                      <div className="text-xs text-text-muted">HSN: {item.hsn_sac}</div>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right text-text-primary">
                    {Number(item.qty)} {item.unit || ''}
                  </td>
                  <td className="py-2 px-3 text-right text-text-primary">
                    ₹{Number(item.unit_price).toLocaleString('en-IN')}
                  </td>
                  <td className="py-2 px-3 text-right text-text-primary">
                    {Number(item.tax_rate)}%
                  </td>
                  <td className="py-2 px-3 text-right font-medium text-text-primary">
                    ₹{Number(item.line_total).toLocaleString('en-IN')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card padding="md">
        <div className="space-y-2 max-w-xs ml-auto text-sm">
          <div className="flex justify-between">
            <span className="text-text-secondary">Subtotal</span>
            <span className="text-text-primary">
              ₹{Number(data.subtotal).toLocaleString('en-IN')}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-secondary">Tax</span>
            <span className="text-text-primary">
              ₹{Number(data.tax_total).toLocaleString('en-IN')}
            </span>
          </div>
          <div className="flex justify-between text-base font-bold border-t border-border pt-2">
            <span className="text-text-primary">Grand total</span>
            <span className="text-gray-900">
              ₹{Number(data.grand_total).toLocaleString('en-IN')}
            </span>
          </div>
          {data.itc_reversed && (
            <p className="text-xs text-text-muted pt-1">ITC reversed on this return</p>
          )}
        </div>
      </Card>
    </div>
  );
}

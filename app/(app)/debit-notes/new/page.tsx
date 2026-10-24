'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { AnnotatedFormSection } from '@/components/ui/AnnotatedFormSection';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { Loader2 } from 'lucide-react';
import { useToastContext } from '@/contexts/ToastContext';
import { GST_RATE_SLABS } from '@/lib/gst/rates';

interface Customer {
  id: string;
  name: string;
  gstin?: string | null;
}

interface InvoiceSummary {
  id: string;
  invoice_number: string;
  customer_id?: string | null;
}

export default function NewDebitNotePage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  
  // Check authorization before rendering form
  const { allowed: canCreate, loading: authLoading, reason: authReason } = useAuthorizationGuard({
    resource: 'invoices',
    action: 'create',
    skipCheck: !user?.id || !business?.id
  });

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);

  const [customerId, setCustomerId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [debitNoteNumber, setDebitNoteNumber] = useState('');
  const [debitNoteDate, setDebitNoteDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [reason, setReason] = useState('');

  // Single line item simplified
  const [description, setDescription] = useState('Adjustment');
  const [hsnSac, setHsnSac] = useState('');
  const [qty, setQty] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [taxRate, setTaxRate] = useState(0);

  const selectedCustomer = customers.find((c) => c.id === customerId);
  const isRegisteredCustomer = !!selectedCustomer?.gstin?.trim();
  const customerInvoices = useMemo(
    () => (customerId ? invoices.filter((inv) => inv.customer_id === customerId) : []),
    [invoices, customerId]
  );

  useEffect(() => {
    if (invoiceId && !customerInvoices.some((inv) => inv.id === invoiceId)) setInvoiceId('');
  }, [customerInvoices, invoiceId]);

  const subtotal = useMemo(() => qty * unitPrice, [qty, unitPrice]);
  const taxAmount = useMemo(() => subtotal * (taxRate / 100), [subtotal, taxRate]);
  const grandTotal = useMemo(() => subtotal + taxAmount, [subtotal, taxAmount]);

  useEffect(() => {
    if (!business?.id) return;
    const fetchData = async () => {
      try {
        const [custRes, numRes] = await Promise.all([
          fetch(`/api/customers?business_id=${business.id}&user_id=${user?.id}`),
          fetch(`/api/debit-notes?business_id=${business.id}&user_id=${user?.id}&next_number=1`)
        ]);
        if (numRes.ok) {
          const data = await numRes.json();
          if (data.next_debit_note_number) {
            setDebitNoteNumber((prev) => prev || data.next_debit_note_number);
          }
        }
        if (custRes.ok) {
          const data = await custRes.json();
          setCustomers(data.customers || []);
        }
      } catch (err) {
        console.error('Fetch error', err);
      }
    };
    fetchData();
  }, [business?.id]);

  useEffect(() => {
    if (!business?.id || !customerId) {
      setInvoices([]);
      return;
    }
    let cancelled = false;
    fetch(
      `/api/invoices?business_id=${business.id}&user_id=${user?.id}&customer_id=${encodeURIComponent(customerId)}&status=final&limit=500`
    )
      .then((res) => (res.ok ? res.json() : { invoices: [] }))
      .then((data) => {
        if (!cancelled) setInvoices(data.invoices || []);
      })
      .catch((err) => console.error('Fetch error', err));
    return () => {
      cancelled = true;
    };
  }, [business?.id, customerId, user?.id]);

  const handleSave = async () => {
    if (!business?.id) return;
    if (!customerId) {
      toast.error('Please select a customer');
      return;
    }
    if (isRegisteredCustomer && !invoiceId) {
      toast.error('Select the original invoice: required for a registered (GSTIN) customer');
      return;
    }
    const itemPayload = {
      item_id: null,
      description,
      hsn_sac: hsnSac.trim() || null,
      qty,
      unit: 'PCS',
      unit_price: unitPrice,
      discount: 0,
      tax_rate: taxRate,
      tax_amount: taxAmount,
      cgst_amount: 0,
      sgst_amount: 0,
      igst_amount: taxAmount, // assuming interstate; simplified
      taxable_value: subtotal,
      line_total: grandTotal
    };

    const payload = {
      business_id: business.id,
      customer_id: customerId,
      invoice_id: invoiceId || null,
      debit_note_number: debitNoteNumber.trim() || undefined,
      debit_note_date: debitNoteDate,
      reason,
      items: [itemPayload],
      subtotal,
      discount_total: 0,
      tax_total: taxAmount,
      round_off: 0,
      grand_total: grandTotal,
      notes: reason,
      place_of_supply_state_code: null,
      created_by: user?.id // Required for authorization
    };

    try {
      const res = await fetch('/api/debit-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      router.push('/debit-notes');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save');
    }
  };

  return (
      <div className="w-full min-w-0 max-w-5xl space-y-6">
        <MobileDuplicatePageChrome
          title="New debit note"
          description="Create a debit note for upward adjustments."
          onBack={() => router.push('/debit-notes')}
        />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
        >
          <div className="space-y-6">
            <AnnotatedFormSection
              title="Debit note details"
              description="Customer, document number, and link to the original invoice when required."
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-600">Customer</label>
                  <select
                    className="input w-full mt-1"
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                  >
                    <option value="">Select customer</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600">
                    Original Invoice {isRegisteredCustomer ? '(required for GSTIN customer)' : '(optional)'}
                  </label>
                  <select
                    className="input w-full mt-1"
                    value={invoiceId}
                    onChange={(e) => setInvoiceId(e.target.value)}
                    disabled={!customerId}
                  >
                    <option value="">{customerId ? 'None' : 'Select a customer first'}</option>
                    {customerInvoices.map((inv) => (
                      <option key={inv.id} value={inv.id}>{inv.invoice_number}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600">Debit Note Number</label>
                  <Input
                    value={debitNoteNumber}
                    onChange={(e) => setDebitNoteNumber(e.target.value)}
                    placeholder="Auto-numbered if left blank"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600">Date</label>
                  <Input type="date" value={debitNoteDate} onChange={(e) => setDebitNoteDate(e.target.value)} />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600">Reason / Notes</label>
                <textarea
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm mt-1"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Describe the adjustment"
                />
              </div>
            </AnnotatedFormSection>

            <AnnotatedFormSection
              title="Line item"
              description="Single adjustment line (simplified entry)."
            >
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600">Description</label>
                  <Input value={description} onChange={(e) => setDescription(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600">HSN/SAC</label>
                  <Input
                    value={hsnSac}
                    inputMode="numeric"
                    maxLength={8}
                    onChange={(e) => setHsnSac(e.target.value.replace(/\D/g, ''))}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600">Quantity</label>
                  <Input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600">Unit Price</label>
                  <Input type="number" value={unitPrice} onChange={(e) => setUnitPrice(Number(e.target.value))} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600">Tax %</label>
                  <select
                    className="input w-full"
                    value={String(taxRate)}
                    onChange={(e) => setTaxRate(Number(e.target.value))}
                  >
                    {[...GST_RATE_SLABS, 28].map((r) => (
                      <option key={r} value={String(r)}>{r}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div className="flex justify-between bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <span>Subtotal</span>
                  <span>₹ {subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <span>Tax</span>
                  <span>₹ {taxAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-semibold bg-slate-50 border border-primary-200 rounded-lg px-3 py-2 text-primary-900">
                  <span>Total</span>
                  <span>₹ {grandTotal.toFixed(2)}</span>
                </div>
              </div>
            </AnnotatedFormSection>
          </div>

          <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4 dark:border-border-dark">
            <Button type="button" variant="secondary" onClick={() => router.push('/debit-notes')}>
              Cancel
            </Button>
            <Button type="submit">Save debit note</Button>
          </div>
        </form>
      </div>
  );
}


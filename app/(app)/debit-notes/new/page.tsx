'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { Loader2 } from 'lucide-react';
import { useToastContext } from '@/contexts/ToastContext';

interface Customer {
  id: string;
  name: string;
}

interface InvoiceSummary {
  id: string;
  invoice_number: string;
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
  const [qty, setQty] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [taxRate, setTaxRate] = useState(0);

  const subtotal = useMemo(() => qty * unitPrice, [qty, unitPrice]);
  const taxAmount = useMemo(() => subtotal * (taxRate / 100), [subtotal, taxRate]);
  const grandTotal = useMemo(() => subtotal + taxAmount, [subtotal, taxAmount]);

  useEffect(() => {
    if (!business?.id) return;
    const fetchData = async () => {
      try {
        const [custRes, invRes] = await Promise.all([
          fetch(`/api/customers?business_id=${business.id}&user_id=${user?.id}`),
          fetch(`/api/invoices?business_id=${business.id}&status=final&user_id=${user?.id}`)
        ]);
        if (custRes.ok) {
          const data = await custRes.json();
          setCustomers(data.customers || []);
        }
        if (invRes.ok) {
          const data = await invRes.json();
          setInvoices(data.invoices || []);
        }
      } catch (err) {
        console.error('Fetch error', err);
      }
    };
    fetchData();
  }, [business?.id]);

  const handleSave = async () => {
    if (!business?.id) return;
    if (!customerId) {
      toast.error('Please select a customer');
      return;
    }
    if (!debitNoteNumber) {
      toast.error('Please enter debit note number');
      return;
    }
    const itemPayload = {
      item_id: null,
      description,
      hsn_sac: null,
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
      debit_note_number: debitNoteNumber,
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
    
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">New Debit Note</h1>
            <p className="text-gray-600 text-sm mt-1">Create a debit note for upward adjustments.</p>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
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
              <label className="text-xs font-semibold text-gray-600">Linked Invoice (optional)</label>
              <select
                className="input w-full mt-1"
                value={invoiceId}
                onChange={(e) => setInvoiceId(e.target.value)}
              >
                <option value="">None</option>
                {invoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>{inv.invoice_number}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600">Debit Note Number</label>
              <Input value={debitNoteNumber} onChange={(e) => setDebitNoteNumber(e.target.value)} />
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
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
          <h3 className="text-sm font-semibold text-gray-800">Line Item (simplified)</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600">Description</label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
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
              <Input type="number" value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))} />
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
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => router.push('/debit-notes')}>Cancel</Button>
          <Button onClick={handleSave}>Save Debit Note</Button>
        </div>
      </div>
    
  );
}



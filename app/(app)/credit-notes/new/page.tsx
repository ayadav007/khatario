'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { useToastContext } from '@/contexts/ToastContext';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';

interface Customer {
  id: string;
  name: string;
  phone?: string;
  gstin?: string;
  state_code?: string;
}

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  grand_total: number;
}

interface Item {
  id: string;
  name: string;
  hsn_sac?: string;
  unit?: string;
  selling_price: number;
  tax_rate: number;
  current_stock: number;
}

interface CreditNoteItem {
  item_id: string;
  item_name: string;
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  discount: number;
  tax_rate: number;
  tax_amount: number;
  line_total: number;
}

export default function NewCreditNotePage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  
  // Check authorization before rendering form
  const { allowed: canCreate, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'credit_notes',
    action: 'create',
    skipCheck: !user?.id || !business?.id
  });
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [items, setItems] = useState<Item[]>([]);

  // Get invoice_id and customer_id from URL params if provided
  const [urlParams, setUrlParams] = useState<{ invoice_id?: string; customer_id?: string }>({});

  const [formData, setFormData] = useState({
    customer_id: '',
    invoice_id: '',
    credit_note_number: '',
    credit_note_date: new Date().toISOString().split('T')[0],
    reason: '',
  });

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [creditNoteItems, setCreditNoteItems] = useState<CreditNoteItem[]>([]);

  // Parse URL params on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const invoiceId = params.get('invoice_id');
      const customerId = params.get('customer_id');
      if (invoiceId || customerId) {
        setUrlParams({ invoice_id: invoiceId || undefined, customer_id: customerId || undefined });
      }
    }
  }, []);

  useEffect(() => {
    if (business?.id) {
      fetchCustomers();
      fetchItems();
    }
  }, [business?.id]);

  // Pre-select customer and invoice from URL params
  useEffect(() => {
    if (urlParams.customer_id && customers.length > 0) {
      setFormData(prev => ({ ...prev, customer_id: urlParams.customer_id || '' }));
      const customer = customers.find(c => c.id === urlParams.customer_id);
      setSelectedCustomer(customer || null);
    }
  }, [urlParams.customer_id, customers]);

  useEffect(() => {
    if (urlParams.invoice_id && invoices.length > 0) {
      setFormData(prev => ({ ...prev, invoice_id: urlParams.invoice_id || '' }));
    }
  }, [urlParams.invoice_id, invoices]);

  useEffect(() => {
    if (formData.customer_id) {
      fetchInvoices(formData.customer_id);
    }
  }, [formData.customer_id]);

  useEffect(() => {
    if (formData.invoice_id) {
      loadInvoiceItems(formData.invoice_id);
    }
  }, [formData.invoice_id]);

  const fetchCustomers = async () => {
    try {
      const response = await fetch(`/api/customers?business_id=${business?.id}&user_id=${user?.id}`);
      if (response.ok) {
        const data = await response.json();
        setCustomers(data.customers || []);
      }
    } catch (error) {
      console.error('Error fetching customers:', error);
    }
  };

  const fetchInvoices = async (customerId: string) => {
    try {
      const response = await fetch(`/api/invoices?business_id=${business?.id}&user_id=${user?.id}`);
      if (response.ok) {
        const data = await response.json();
        const customerInvoices = data.invoices.filter(
          (inv: any) => inv.customer_id === customerId && inv.status === 'final'
        );
        setInvoices(customerInvoices);
      }
    } catch (error) {
      console.error('Error fetching invoices:', error);
    }
  };

  const fetchItems = async () => {
    try {
      const response = await fetch(`/api/items?business_id=${business?.id}&user_id=${user?.id}`);
      if (response.ok) {
        const data = await response.json();
        setItems(data.items || []);
      }
    } catch (error) {
      console.error('Error fetching items:', error);
    }
  };

  const loadInvoiceItems = async (invoiceId: string) => {
    try {
      const response = await fetch(`/api/invoices/${invoiceId}`);
      if (response.ok) {
        const data = await response.json();
        const invoice = data.invoice;
        
        // Auto-populate items from the invoice
        const loadedItems = invoice.items.map((item: any) => ({
          item_id: item.item_id || '',
          item_name: item.item_name,
          description: item.item_name,
          qty: Number(item.quantity),
          unit: item.unit || 'PCS',
          unit_price: Number(item.unit_price),
          discount: Number(item.discount_amount || 0),
          tax_rate: Number(item.tax_rate || 0),
          tax_amount: Number(item.tax_amount || 0),
          line_total: Number(item.line_total || 0),
        }));

        setCreditNoteItems(loadedItems);
        toast.info(`Loaded ${loadedItems.length} items from invoice. You can adjust quantities as needed.`);
      }
    } catch (error) {
      console.error('Error loading invoice items:', error);
    }
  };

  const handleCustomerChange = (customerId: string) => {
    setFormData({ ...formData, customer_id: customerId, invoice_id: '' });
    const customer = customers.find(c => c.id === customerId);
    setSelectedCustomer(customer || null);
    // Clear items when customer changes
    setCreditNoteItems([]);
  };

  const addCreditNoteItem = () => {
    setCreditNoteItems([
      ...creditNoteItems,
      {
        item_id: '',
        item_name: '',
        description: '',
        qty: 1,
        unit: 'PCS',
        unit_price: 0,
        discount: 0,
        tax_rate: 18,
        tax_amount: 0,
        line_total: 0,
      },
    ]);
  };

  const removeCreditNoteItem = (index: number) => {
    setCreditNoteItems(creditNoteItems.filter((_, i) => i !== index));
  };

  const updateCreditNoteItem = (index: number, field: string, value: any) => {
    const updatedItems = [...creditNoteItems];
    updatedItems[index] = { ...updatedItems[index], [field]: value };

    // If item selected, populate details
    if (field === 'item_id' && value) {
      const item = items.find(i => i.id === value);
      if (item) {
        updatedItems[index].item_name = item.name;
        updatedItems[index].description = item.name;
        updatedItems[index].unit = item.unit || 'PCS';
        updatedItems[index].unit_price = Number(item.selling_price);
        updatedItems[index].tax_rate = Number(item.tax_rate);
      }
    }

    // Recalculate amounts
    const qty = Number(updatedItems[index].qty) || 0;
    const unitPrice = Number(updatedItems[index].unit_price) || 0;
    const discount = Number(updatedItems[index].discount) || 0;
    const taxRate = Number(updatedItems[index].tax_rate) || 0;

    const subtotal = qty * unitPrice - discount;
    const taxAmount = (subtotal * taxRate) / 100;
    const lineTotal = subtotal + taxAmount;

    updatedItems[index].tax_amount = taxAmount;
    updatedItems[index].line_total = lineTotal;

    setCreditNoteItems(updatedItems);
  };

  const calculateTotals = () => {
    const subtotal = creditNoteItems.reduce((sum, item) => {
      const itemSubtotal = (item.qty * item.unit_price) - item.discount;
      return sum + itemSubtotal;
    }, 0);
    const taxTotal = creditNoteItems.reduce((sum, item) => sum + item.tax_amount, 0);
    
    // Calculate GST breakdown
    const businessStateCode = business?.state_code || '';
    const customerStateCode = selectedCustomer?.state_code || '';
    const isIntraState = businessStateCode === customerStateCode;

    let cgstTotal = 0, sgstTotal = 0, igstTotal = 0;
    
    creditNoteItems.forEach(item => {
      const itemSubtotal = (item.qty * item.unit_price) - item.discount;
      const itemTax = (itemSubtotal * item.tax_rate) / 100;
      
      if (isIntraState) {
        cgstTotal += itemTax / 2;
        sgstTotal += itemTax / 2;
      } else {
        igstTotal += itemTax;
      }
    });

    const grandTotal = subtotal + taxTotal;

    return { subtotal, taxTotal, cgstTotal, sgstTotal, igstTotal, grandTotal };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.customer_id || !formData.credit_note_number || creditNoteItems.length === 0) {
      toast.error('Please fill all required fields and add at least one item');
      return;
    }

    const totals = calculateTotals();

    const payload = {
      business_id: business?.id,
      customer_id: formData.customer_id,
      invoice_id: formData.invoice_id || null,
      credit_note_number: formData.credit_note_number,
      credit_note_date: formData.credit_note_date,
      reason: formData.reason,
      place_of_supply_state_code: selectedCustomer?.state_code,
      items: creditNoteItems.map(item => ({
        item_id: item.item_id || null,
        description: item.description,
        item_name: item.item_name,
        qty: item.qty,
        quantity: item.qty,
        unit: item.unit,
        unit_price: item.unit_price,
        discount: item.discount,
        tax_rate: item.tax_rate,
        tax_amount: item.tax_amount,
        line_total: item.line_total,
      })),
      subtotal: totals.subtotal,
      tax_total: totals.taxTotal,
      cgst_total: totals.cgstTotal,
      sgst_total: totals.sgstTotal,
      igst_total: totals.igstTotal,
      grand_total: totals.grandTotal,
      created_by: user?.id, // Required for authorization
    };

    try {
      setLoading(true);
      const response = await fetch('/api/credit-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        toast.success('Credit note created successfully!');
        router.push('/credit-notes');
      } else {
        const error = await safeJsonParse(response);
        toast.error(getApiErrorMessage(error, 'Failed to create credit note'));
      }
    } catch (error) {
      console.error('Error creating credit note:', error);
      toast.error('Failed to create credit note');
    } finally {
      setLoading(false);
    }
  };

  const totals = calculateTotals();
  
  // Show authorization denied if user cannot create
  if (!canCreate) {
    return (
      
        <AccessDenied
          module="credit_notes"
          action="create"
          details={reason}
          code="CREDIT_NOTE_CREATE_DENIED"
        />
      
    );
  }

  return (
    
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/credit-notes">
              <Button type="button" variant="ghost" size="sm">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-text-primary">New Credit Note</h1>
              <p className="text-sm text-text-secondary mt-1">Sales return - Customer returns goods</p>
            </div>
          </div>
          <Button type="submit" disabled={loading}>
            {loading ? 'Creating...' : 'Create Credit Note'}
          </Button>
        </div>

        {/* Basic Details */}
        <Card padding="md">
          <h2 className="text-lg font-semibold mb-4">Credit Note Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Credit Note Number *
              </label>
              <input
                type="text"
                required
                value={formData.credit_note_number}
                onChange={(e) => setFormData({ ...formData, credit_note_number: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                placeholder="CN-001"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Credit Note Date *
              </label>
              <input
                type="date"
                required
                value={formData.credit_note_date}
                onChange={(e) => setFormData({ ...formData, credit_note_date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Customer *
              </label>
              <select
                required
                value={formData.customer_id}
                onChange={(e) => handleCustomerChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">Select Customer</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Link to Invoice (Optional)
              </label>
              <select
                value={formData.invoice_id}
                onChange={(e) => setFormData({ ...formData, invoice_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                disabled={!formData.customer_id}
              >
                <option value="">Select Invoice (Optional)</option>
                {invoices.map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>
                    {invoice.invoice_number} - ₹{Number(invoice.grand_total).toLocaleString('en-IN')}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason for Return
              </label>
              <textarea
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                rows={2}
                placeholder="Defective goods, customer dissatisfaction, etc."
              />
            </div>
          </div>
        </Card>

        {/* Credit Note Items */}
        <Card padding="md">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Return Items</h2>
            <Button type="button" onClick={addCreditNoteItem} size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Add Item
            </Button>
          </div>

          <div className="space-y-4">
            {creditNoteItems.map((item, index) => (
              <div key={index} className="border border-gray-200 rounded-lg p-4">
                <div className="grid grid-cols-12 gap-4">
                  <div className="col-span-3">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Item</label>
                    <select
                      value={item.item_id}
                      onChange={(e) => updateCreditNoteItem(index, 'item_id', e.target.value)}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                    >
                      <option value="">Select Item</option>
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Qty</label>
                    <input
                      type="number"
                      step="0.01"
                      value={item.qty}
                      onChange={(e) => updateCreditNoteItem(index, 'qty', e.target.value)}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Price</label>
                    <input
                      type="number"
                      step="0.01"
                      value={item.unit_price}
                      onChange={(e) => updateCreditNoteItem(index, 'unit_price', e.target.value)}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                    />
                  </div>

                  <div className="col-span-1">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Tax %</label>
                    <input
                      type="number"
                      step="0.01"
                      value={item.tax_rate}
                      onChange={(e) => updateCreditNoteItem(index, 'tax_rate', e.target.value)}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                    />
                  </div>

                  <div className="col-span-3">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Total</label>
                    <div className="text-sm font-medium py-1">
                      ₹{item.line_total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </div>
                  </div>

                  <div className="col-span-1 flex items-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeCreditNoteItem(index)}
                    >
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}

            {creditNoteItems.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                No items added. Click "Add Item" to begin.
              </div>
            )}
          </div>
        </Card>

        {/* Totals */}
        {creditNoteItems.length > 0 && (
          <Card padding="md">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-600">Subtotal:</span>
                <span className="font-medium">₹{totals.subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              {totals.cgstTotal > 0 && (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-600">CGST:</span>
                    <span className="font-medium">₹{totals.cgstTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">SGST:</span>
                    <span className="font-medium">₹{totals.sgstTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                </>
              )}
              {totals.igstTotal > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600">IGST:</span>
                  <span className="font-medium">₹{totals.igstTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold border-t pt-2">
                <span>Grand Total:</span>
                <span>₹{totals.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
          </Card>
        )}
      </form>
    
  );
}


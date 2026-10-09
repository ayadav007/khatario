'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ItemAutocomplete } from '@/components/ui/ItemAutocomplete';
import { Plus, Trash2, Save, Loader2, Truck, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { CustomerSearchSelect } from '@/components/customers/CustomerSearchSelect';
import { Customer } from '@/types/database';
import { useToastContext } from '@/contexts/ToastContext';
import { INDIAN_STATES, getStateCode } from '@/lib/gst-utils';
import { toDateInputValue } from '@/lib/date-input';
import {
  computeChallanLines,
  EWAY_BILL_THRESHOLD,
  isChallanEditable,
} from '@/lib/delivery-challans/challan-math';

interface ChallanRow {
  id: string;
  item_id: string | null;
  item_name: string;
  description: string;
  hsn_sac: string;
  qty: number;
  unit: string;
  unit_price: number;
  tax_rate: number;
}

const newRow = (): ChallanRow => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  item_id: null,
  item_name: '',
  description: '',
  hsn_sac: '',
  qty: 0,
  unit: 'PCS',
  unit_price: 0,
  tax_rate: 0,
});

const inr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const stateNameFromCode = (code: string | null | undefined) =>
  (code && INDIAN_STATES.find((s) => getStateCode(s) === code)) || '';

/** Map a linked invoice / sales order line onto a challan row, keeping its post-discount value. */
function rowFromSourceLine(line: any): ChallanRow {
  const qty = Number(line.quantity ?? line.qty ?? 0);
  const taxable = Number(line.taxable_value || 0);
  const unitPrice = taxable > 0 && qty > 0 ? Math.round((taxable / qty) * 100) / 100 : Number(line.unit_price || 0);
  return {
    ...newRow(),
    item_id: line.item_id || null,
    item_name: line.item_name || line.description || '',
    description: line.description && line.description !== line.item_name ? line.description : '',
    hsn_sac: line.hsn_sac || '',
    qty,
    unit: line.unit || 'PCS',
    unit_price: unitPrice,
    tax_rate: Number(line.tax_rate || 0),
  };
}

const EMPTY_FORM = {
  customer_id: '',
  invoice_id: '',
  sales_order_id: '',
  challan_number: '',
  challan_date: new Date().toISOString().split('T')[0],
  delivery_date: '',
  e_way_bill_number: '',
  vehicle_number: '',
  transporter_name: '',
  transporter_gstin: '',
  shipping_address: '',
  billing_address: '',
  place_of_delivery: '',
  place_of_supply_state_code: '',
  dispatch_from_address: '',
  reason_for_transportation: 'supply',
  notes: '',
  terms: '',
};

export function DeliveryChallanForm({ editId }: { editId?: string }) {
  const router = useRouter();
  const { business, user } = useAuth();
  const { currentBranchId } = useBranch();
  const toast = useToastContext();
  const branchId = currentBranchId && currentBranchId !== 'ALL' ? currentBranchId : null;

  const [loading, setLoading] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(!!editId);
  const [existingStatus, setExistingStatus] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [salesOrders, setSalesOrders] = useState<any[]>([]);
  const [suggestedNumber, setSuggestedNumber] = useState('');
  const [supplierStateCode, setSupplierStateCode] = useState<string>('');
  const [chargeTax, setChargeTax] = useState(true);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [items, setItems] = useState<ChallanRow[]>([newRow()]);

  const { allowed: canCreate, reason } = useAuthorizationGuard({
    resource: 'invoices',
    action: editId ? 'update' : 'create',
    skipCheck: !user?.id || !business?.id,
  });

  useEffect(() => {
    if (!business?.id) return;
    fetchCustomers();
    fetchInvoices();
    fetchSalesOrders();
    fetchNumberingAndTax();
  }, [business?.id, branchId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (business?.id && editId) loadExisting(editId);
  }, [business?.id, editId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchCustomers() {
    try {
      const res = await fetch(`/api/customers?business_id=${business!.id}&user_id=${user?.id}`);
      const data = await res.json();
      setCustomers((prev) => {
        const loaded: Customer[] = data.customers || [];
        const extra = prev.filter((p) => !loaded.some((l) => l.id === p.id));
        return [...extra, ...loaded];
      });
    } catch (error) {
      console.error('Error fetching customers:', error);
    }
  }

  async function fetchInvoices() {
    try {
      const res = await fetch(`/api/invoices?business_id=${business!.id}&status=final&limit=100&user_id=${user?.id}`);
      const data = await res.json();
      setInvoices(data.invoices || []);
    } catch (error) {
      console.error('Error fetching invoices:', error);
    }
  }

  async function fetchSalesOrders() {
    try {
      const res = await fetch(`/api/sales-orders?business_id=${business!.id}`);
      const data = await res.json();
      setSalesOrders(data.salesOrders || []);
    } catch (error) {
      console.error('Error fetching sales orders:', error);
    }
  }

  async function fetchNumberingAndTax() {
    try {
      const qs = new URLSearchParams({ business_id: business!.id });
      if (branchId) qs.set('branch_id', branchId);
      const res = await fetch(`/api/delivery-challans/next-number?${qs}`);
      if (!res.ok) return;
      const data = await res.json();
      setSupplierStateCode(data.supplier_state_code || '');
      setChargeTax(data.charge_tax !== false);
      if (!editId) {
        setSuggestedNumber(data.challan_number || '');
        setFormData((prev) =>
          !prev.challan_number || prev.challan_number === suggestedNumber
            ? { ...prev, challan_number: data.challan_number || '' }
            : prev
        );
      }
    } catch (error) {
      console.error('Error fetching next challan number:', error);
    }
  }

  async function loadExisting(id: string) {
    setLoadingExisting(true);
    try {
      const res = await fetch(`/api/delivery-challans/${id}?business_id=${business!.id}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not load the delivery challan');
        return;
      }
      const dc = data.deliveryChallan;
      setExistingStatus(dc.status);
      if (dc.customer_id && dc.customer_name) {
        setCustomers((prev) =>
          prev.some((c) => c.id === dc.customer_id)
            ? prev
            : [{ id: dc.customer_id, name: dc.customer_name } as Customer, ...prev]
        );
      }
      const dateOnly = toDateInputValue;
      setFormData({
        customer_id: dc.customer_id || '',
        invoice_id: dc.invoice_id || '',
        sales_order_id: dc.sales_order_id || '',
        challan_number: dc.challan_number || '',
        challan_date: dateOnly(dc.challan_date),
        delivery_date: dateOnly(dc.delivery_date),
        e_way_bill_number: dc.e_way_bill_number || '',
        vehicle_number: dc.vehicle_number || '',
        transporter_name: dc.transporter_name || '',
        transporter_gstin: dc.transporter_gstin || '',
        shipping_address: dc.shipping_address || '',
        billing_address: dc.billing_address || '',
        place_of_delivery: dc.place_of_delivery || '',
        place_of_supply_state_code: dc.place_of_supply_state_code || '',
        dispatch_from_address: dc.dispatch_from_address || '',
        reason_for_transportation: dc.reason_for_transportation || 'supply',
        notes: dc.notes || '',
        terms: dc.terms || '',
      });
      const rows: ChallanRow[] = (data.items || []).map((l: any) => ({
        ...newRow(),
        item_id: l.item_id || null,
        item_name: l.item_name || '',
        description: l.description || '',
        hsn_sac: l.hsn_sac || '',
        qty: Number(l.qty || 0),
        unit: l.unit || 'PCS',
        unit_price: Number(l.unit_price || 0),
        tax_rate: Number(l.tax_rate || 0),
      }));
      setItems(rows.length ? rows : [newRow()]);
    } catch (error) {
      console.error('Error loading delivery challan:', error);
      toast.error('Could not load the delivery challan');
    } finally {
      setLoadingExisting(false);
    }
  }

  const applyCustomer = (customer: Customer | null) => {
    if (!customer) {
      setFormData((prev) => ({ ...prev, customer_id: '' }));
      return;
    }
    setCustomers((prev) => (prev.some((c) => c.id === customer.id) ? prev : [customer, ...prev]));
    setFormData((prev) => ({
      ...prev,
      customer_id: customer.id,
      shipping_address: customer.shipping_address || customer.address || prev.shipping_address,
      billing_address: customer.billing_address || customer.address || prev.billing_address,
      place_of_supply_state_code:
        customer.state_code || getStateCode(customer.state || '') || prev.place_of_supply_state_code,
    }));
  };

  const hasEnteredItems = () => items.some((r) => r.item_name.trim() && r.qty > 0);

  /** Copy customer, addresses, place of supply and lines from the linked invoice or sales order. */
  async function linkSource(kind: 'invoice' | 'sales_order', id: string) {
    setFormData((prev) => ({
      ...prev,
      invoice_id: kind === 'invoice' ? id : '',
      sales_order_id: kind === 'sales_order' ? id : '',
    }));
    if (!id) return;
    try {
      const table = kind === 'invoice' ? 'invoices' : 'sales_orders';
      const res = await fetch(`/api/documents/${table}/${id}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not load the linked document');
        return;
      }
      const doc = data.document || {};
      if (doc.customer_id && doc.party_name) {
        setCustomers((prev) =>
          prev.some((c) => c.id === doc.customer_id)
            ? prev
            : [{ id: doc.customer_id, name: doc.party_name, phone: doc.party_phone } as Customer, ...prev]
        );
      }
      setFormData((prev) => ({
        ...prev,
        customer_id: doc.customer_id || prev.customer_id,
        billing_address: doc.billing_address || prev.billing_address,
        shipping_address: doc.shipping_address || doc.billing_address || prev.shipping_address,
        place_of_supply_state_code: doc.place_of_supply_state_code || prev.place_of_supply_state_code,
      }));
      const sourceRows: ChallanRow[] = (data.items || [])
        .map(rowFromSourceLine)
        .filter((r: ChallanRow) => r.item_name && r.qty > 0);
      if (sourceRows.length === 0) return;
      if (!hasEnteredItems() || window.confirm('Replace the items on this challan with the items from the linked document?')) {
        setItems(sourceRows);
      }
    } catch (error) {
      console.error('Error loading linked document:', error);
      toast.error('Could not load the linked document');
    }
  }

  const addItem = () => setItems((prev) => [...prev, newRow()]);
  const removeItem = (id: string) => setItems((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  const patchItem = (id: string, patch: Partial<ChallanRow>) =>
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const posCode = formData.place_of_supply_state_code || supplierStateCode;
  const interState = !!(posCode && supplierStateCode && posCode !== supplierStateCode);
  const preview = useMemo(
    () => computeChallanLines(items, { interState, chargeTax }),
    [items, interState, chargeTax]
  );
  const linePreview = (row: ChallanRow) =>
    computeChallanLines([{ ...row, item_name: row.item_name || '-', qty: row.qty || 0 }], { interState, chargeTax })
      .lines[0];
  const needsEwayBill = preview.totals.grand_total > EWAY_BILL_THRESHOLD && !formData.e_way_bill_number.trim();

  const readOnly = !!editId && existingStatus !== null && !isChallanEditable(existingStatus);

  const handleSubmit = async (status: 'draft' | 'sent') => {
    if (!business?.id) {
      toast.error('Business not found');
      return;
    }
    if (!formData.challan_number || !formData.challan_date) {
      toast.error('Please fill in challan number and date');
      return;
    }
    if (!formData.customer_id && !formData.invoice_id && !formData.sales_order_id) {
      toast.error('Select a customer, or link an invoice or sales order');
      return;
    }
    const validItems = items.filter((r) => r.item_name.trim() && r.qty > 0);
    if (validItems.length === 0) {
      toast.error('Please add at least one item with a quantity');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        ...formData,
        place_of_supply_state_code: formData.place_of_supply_state_code || null,
        status,
        business_id: business.id,
        branch_id: branchId,
        auto_number: !editId && formData.challan_number === suggestedNumber,
        items: validItems.map((r) => ({
          item_id: r.item_id,
          item_name: r.item_name,
          description: r.description,
          hsn_sac: r.hsn_sac,
          qty: r.qty,
          unit: r.unit,
          unit_price: r.unit_price,
          tax_rate: r.tax_rate,
        })),
      };

      const res = await fetch(editId ? `/api/delivery-challans/${editId}` : '/api/delivery-challans', {
        method: editId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        const label = data.deliveryChallan?.challan_number
          ? `Delivery challan ${data.deliveryChallan.challan_number}`
          : 'Delivery challan';
        toast.success(editId ? `${label} updated` : status === 'draft' ? `${label} saved as draft` : `${label} generated`);
        const id = data.deliveryChallan?.id || editId;
        router.push(id ? `/delivery-challans/${id}` : '/delivery-challans');
      } else {
        toast.error(data.error || 'Failed to save delivery challan');
      }
    } catch (error) {
      console.error('Error saving delivery challan:', error);
      toast.error('Failed to save delivery challan');
    } finally {
      setLoading(false);
    }
  };

  if (!canCreate) {
    return (
      <AccessDenied
        module="invoices"
        action={editId ? 'update' : 'create'}
        details={reason}
        code="DELIVERY_CHALLAN_CREATE_DENIED"
      />
    );
  }

  if (loadingExisting) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {editId ? `Edit Delivery Challan ${formData.challan_number}` : 'New Delivery Challan'}
          </h1>
          <p className="text-gray-600 text-sm mt-1">Create a shipping document for goods delivery</p>
        </div>
      </div>

      {readOnly && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          This challan is {existingStatus} and can no longer be edited.
        </div>
      )}

      <fieldset disabled={readOnly} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Basic Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Challan Number *</label>
              <Input
                type="text"
                value={formData.challan_number}
                onChange={(e) => setFormData({ ...formData, challan_number: e.target.value })}
                placeholder="DC-001"
              />
              {!editId && formData.challan_number === suggestedNumber && suggestedNumber && (
                <p className="text-xs text-gray-500 mt-1">The next free number is assigned when you save.</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Challan Date *</label>
              <Input
                type="date"
                value={formData.challan_date}
                onChange={(e) => setFormData({ ...formData, challan_date: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Delivery Date</label>
              <Input
                type="date"
                value={formData.delivery_date}
                onChange={(e) => setFormData({ ...formData, delivery_date: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer *</label>
              <CustomerSearchSelect customers={customers} value={formData.customer_id} onSelect={applyCustomer} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Link to Invoice (Optional)</label>
              <select
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                value={formData.invoice_id}
                onChange={(e) => linkSource('invoice', e.target.value)}
              >
                <option value="">Select Invoice</option>
                {invoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoice_number} - {inv.customer_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Link to Sales Order (Optional)</label>
              <select
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                value={formData.sales_order_id}
                onChange={(e) => linkSource('sales_order', e.target.value)}
              >
                <option value="">Select Sales Order</option>
                {salesOrders.map((so) => (
                  <option key={so.id} value={so.id}>
                    {so.order_number} - {so.customer_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Transportation Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason for Transportation <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.reason_for_transportation}
                onChange={(e) => setFormData({ ...formData, reason_for_transportation: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
              >
                <option value="supply">Supply (Sale)</option>
                <option value="export">Export</option>
                <option value="job_work">Job Work</option>
                <option value="skd_ckd">SKD/CKD (Semi Knocked Down/Completely Knocked Down)</option>
                <option value="recipient_not_known">Recipient not known</option>
                <option value="line_sales">For own use</option>
                <option value="exhibition">Exhibition or fairs</option>
                <option value="others">Others</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Required by GST Rule 55. Determines what information must be shown on the delivery challan.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Place of Supply</label>
              <select
                value={formData.place_of_supply_state_code}
                onChange={(e) => setFormData({ ...formData, place_of_supply_state_code: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="">
                  {supplierStateCode ? `Same as business (${stateNameFromCode(supplierStateCode)})` : 'Select state'}
                </option>
                {INDIAN_STATES.map((s) => (
                  <option key={s} value={getStateCode(s)}>
                    {s}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                {interState ? 'Inter-state: IGST applies.' : 'Within the state: CGST and SGST apply.'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-Way Bill Number</label>
              <Input
                type="text"
                value={formData.e_way_bill_number}
                onChange={(e) => setFormData({ ...formData, e_way_bill_number: e.target.value })}
                placeholder="E-Way Bill #"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Number</label>
              <Input
                type="text"
                value={formData.vehicle_number}
                onChange={(e) => setFormData({ ...formData, vehicle_number: e.target.value.toUpperCase() })}
                placeholder="KA-01-AB-1234"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Transporter Name</label>
              <Input
                type="text"
                value={formData.transporter_name}
                onChange={(e) => setFormData({ ...formData, transporter_name: e.target.value })}
                placeholder="Transporter Name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Transporter GSTIN</label>
              <Input
                type="text"
                value={formData.transporter_gstin}
                onChange={(e) => setFormData({ ...formData, transporter_gstin: e.target.value.toUpperCase() })}
                placeholder="15-digit GSTIN"
                maxLength={15}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Place of Delivery</label>
              <Input
                type="text"
                value={formData.place_of_delivery}
                onChange={(e) => setFormData({ ...formData, place_of_delivery: e.target.value })}
                placeholder="City, State"
              />
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Addresses</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Shipping Address</label>
              <textarea
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                rows={3}
                value={formData.shipping_address}
                onChange={(e) => setFormData({ ...formData, shipping_address: e.target.value })}
                placeholder="Shipping address"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Billing Address</label>
              <textarea
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                rows={3}
                value={formData.billing_address}
                onChange={(e) => setFormData({ ...formData, billing_address: e.target.value })}
                placeholder="Billing address"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Dispatch From Address</label>
              <textarea
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                rows={3}
                value={formData.dispatch_from_address}
                onChange={(e) => setFormData({ ...formData, dispatch_from_address: e.target.value })}
                placeholder="Address from where goods are dispatched"
              />
            </div>
          </div>
        </div>

        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Items</h2>
            <Button onClick={addItem} variant="secondary" size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Add Item
            </Button>
          </div>
          <div className="md:overflow-x-auto">
            <table className="kh-line-cards w-full md:min-w-[900px]">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-2 text-left text-sm font-semibold text-gray-700">Item Name</th>
                  <th className="px-2 py-2 text-left text-sm font-semibold text-gray-700 w-28">HSN/SAC</th>
                  <th className="px-2 py-2 text-left text-sm font-semibold text-gray-700 w-24">Qty</th>
                  <th className="px-2 py-2 text-left text-sm font-semibold text-gray-700 w-20">Unit</th>
                  <th className="px-2 py-2 text-left text-sm font-semibold text-gray-700 w-28">Rate (₹)</th>
                  {chargeTax && <th className="px-2 py-2 text-left text-sm font-semibold text-gray-700 w-20">GST %</th>}
                  <th className="px-2 py-2 text-right text-sm font-semibold text-gray-700 w-28">Taxable</th>
                  {chargeTax && <th className="px-2 py-2 text-right text-sm font-semibold text-gray-700 w-24">Tax</th>}
                  <th className="px-2 py-2 text-right text-sm font-semibold text-gray-700 w-28">Total</th>
                  <th className="px-2 py-2 w-12" />
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const lp = linePreview(row);
                  return (
                    <tr key={row.id} className="border-b">
                      <td className="px-2 py-2" data-label="Item">
                        <ItemAutocomplete
                          value={row.item_name}
                          onChange={(val) => patchItem(row.id, { item_name: val })}
                          onSelect={(selected) => {
                            patchItem(row.id, {
                              item_id: selected.id,
                              item_name: selected.name,
                              hsn_sac: selected.hsn_sac || '',
                              unit: selected.unit || 'PCS',
                              unit_price: Number(selected.selling_price ?? 0),
                              tax_rate: Number(selected.tax_rate ?? 0),
                              ...(row.qty > 0 ? {} : { qty: 1 }),
                            });
                          }}
                        />
                      </td>
                      <td className="px-2 py-2" data-label="HSN/SAC">
                        <Input
                          type="text"
                          value={row.hsn_sac}
                          onChange={(e) => patchItem(row.id, { hsn_sac: e.target.value })}
                          placeholder="HSN"
                        />
                      </td>
                      <td className="px-2 py-2" data-label="Qty">
                        <Input
                          type="number"
                          min={0}
                          value={row.qty}
                          onChange={(e) => patchItem(row.id, { qty: Number(e.target.value) })}
                        />
                      </td>
                      <td className="px-2 py-2" data-label="Unit">
                        <Input
                          type="text"
                          value={row.unit}
                          onChange={(e) => patchItem(row.id, { unit: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-2" data-label="Rate">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={row.unit_price}
                          onChange={(e) => patchItem(row.id, { unit_price: Number(e.target.value) })}
                        />
                      </td>
                      {chargeTax && (
                        <td className="px-2 py-2" data-label="GST %">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={row.tax_rate}
                            onChange={(e) => patchItem(row.id, { tax_rate: Number(e.target.value) })}
                          />
                        </td>
                      )}
                      <td className="px-2 py-2 text-right text-sm text-gray-700" data-label="Taxable">{inr(lp?.taxable_value || 0)}</td>
                      {chargeTax && (
                        <td className="px-2 py-2 text-right text-sm text-gray-700" data-label="Tax">{inr(lp?.tax_amount || 0)}</td>
                      )}
                      <td className="px-2 py-2 text-right text-sm font-medium text-gray-900" data-label="Total">
                        {inr(lp?.line_total || 0)}
                      </td>
                      <td className="px-2 py-2" data-label="">
                        <Button variant="ghost" size="sm" onClick={() => removeItem(row.id)} disabled={items.length === 1}>
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex justify-end">
            <div className="w-full max-w-xs space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Taxable value</span>
                <span>₹{inr(preview.totals.subtotal)}</span>
              </div>
              {chargeTax && (interState ? (
                <div className="flex justify-between">
                  <span className="text-gray-600">IGST</span>
                  <span>₹{inr(preview.totals.igst_total)}</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-600">CGST</span>
                    <span>₹{inr(preview.totals.cgst_total)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">SGST</span>
                    <span>₹{inr(preview.totals.sgst_total)}</span>
                  </div>
                </>
              ))}
              <div className="flex justify-between border-t pt-1 font-semibold text-gray-900">
                <span>Value of goods</span>
                <span>₹{inr(preview.totals.grand_total)}</span>
              </div>
            </div>
          </div>

          {needsEwayBill && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                The goods are worth more than ₹{EWAY_BILL_THRESHOLD.toLocaleString('en-IN')}, so an e-way bill is
                usually needed before they move. Generate it on the e-way bill portal and enter its number above.
              </span>
            </div>
          )}
        </div>

        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Additional Information</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                rows={3}
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Additional notes"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Terms & Conditions</label>
              <textarea
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                rows={3}
                value={formData.terms}
                onChange={(e) => setFormData({ ...formData, terms: e.target.value })}
                placeholder="Terms and conditions"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button variant="secondary" onClick={() => router.back()} disabled={loading}>
            Cancel
          </Button>
          {editId ? (
            <Button onClick={() => handleSubmit('draft')} disabled={loading || readOnly}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              Save Changes
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => handleSubmit('draft')} disabled={loading}>
                <Save className="w-4 h-4 mr-2" />
                Save as Draft
              </Button>
              <Button onClick={() => handleSubmit('sent')} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Truck className="w-4 h-4 mr-2" />}
                Generate Challan
              </Button>
            </>
          )}
        </div>
      </fieldset>
    </div>
  );
}

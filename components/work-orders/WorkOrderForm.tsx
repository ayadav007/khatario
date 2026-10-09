'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ItemAutocomplete } from '@/components/ui/ItemAutocomplete';
import { Plus, Trash2, Save, Loader2, CalendarCheck } from 'lucide-react';
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
  computeWorkOrderCosts,
  DEFAULT_LABOR_SAC,
  DEFAULT_LABOR_TAX_RATE,
  isWorkOrderEditable,
  STATUS_LABELS,
  type WorkOrderStatus,
} from '@/lib/work-orders/work-order-math';

interface MaterialRow {
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

const newRow = (): MaterialRow => ({
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

const EMPTY_FORM = {
  customer_id: '',
  work_order_number: '',
  work_order_date: new Date().toISOString().split('T')[0],
  scheduled_start_date: '',
  scheduled_end_date: '',
  work_description: '',
  work_location: '',
  assigned_to: '',
  priority: 'medium',
  labor_cost: 0,
  other_cost: 0,
  labor_sac: DEFAULT_LABOR_SAC,
  labor_tax_rate: DEFAULT_LABOR_TAX_RATE,
  estimated_hours: '',
  actual_hours: '',
  place_of_supply_state_code: '',
  notes: '',
  terms: '',
};

const textareaClass = 'w-full border border-gray-300 rounded-md px-3 py-2 text-sm';

export function WorkOrderForm({ editId }: { editId?: string }) {
  const router = useRouter();
  const { business, user } = useAuth();
  const { currentBranchId } = useBranch();
  const toast = useToastContext();
  const branchId = currentBranchId && currentBranchId !== 'ALL' ? currentBranchId : null;

  const [loading, setLoading] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(!!editId);
  const [existingStatus, setExistingStatus] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suggestedNumber, setSuggestedNumber] = useState('');
  const [supplierStateCode, setSupplierStateCode] = useState('');
  const [chargeTax, setChargeTax] = useState(true);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [items, setItems] = useState<MaterialRow[]>([]);

  const { allowed: canSave, reason } = useAuthorizationGuard({
    resource: 'work_orders',
    action: editId ? 'update' : 'create',
    skipCheck: !user?.id || !business?.id,
  });

  useEffect(() => {
    if (!business?.id) return;
    fetchCustomers();
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

  async function fetchNumberingAndTax() {
    try {
      const qs = new URLSearchParams({ business_id: business!.id });
      if (branchId) qs.set('branch_id', branchId);
      const res = await fetch(`/api/work-orders/next-number?${qs}`);
      if (!res.ok) return;
      const data = await res.json();
      setSupplierStateCode(data.supplier_state_code || '');
      setChargeTax(data.charge_tax !== false);
      if (!editId) {
        setSuggestedNumber(data.work_order_number || '');
        setFormData((prev) =>
          !prev.work_order_number || prev.work_order_number === suggestedNumber
            ? { ...prev, work_order_number: data.work_order_number || '' }
            : prev
        );
      }
    } catch (error) {
      console.error('Error fetching next work order number:', error);
    }
  }

  async function loadExisting(id: string) {
    setLoadingExisting(true);
    try {
      const res = await fetch(`/api/work-orders/${id}?business_id=${business!.id}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not load the work order');
        return;
      }
      const wo = data.workOrder;
      setExistingStatus(wo.status);
      if (wo.customer_id && wo.customer_name) {
        setCustomers((prev) =>
          prev.some((c) => c.id === wo.customer_id)
            ? prev
            : [{ id: wo.customer_id, name: wo.customer_name } as Customer, ...prev]
        );
      }
      const dateOnly = toDateInputValue;
      setFormData({
        customer_id: wo.customer_id || '',
        work_order_number: wo.work_order_number || '',
        work_order_date: dateOnly(wo.work_order_date),
        scheduled_start_date: dateOnly(wo.scheduled_start_date),
        scheduled_end_date: dateOnly(wo.scheduled_end_date),
        work_description: wo.work_description || '',
        work_location: wo.work_location || '',
        assigned_to: wo.assigned_to || '',
        priority: wo.priority || 'medium',
        labor_cost: Number(wo.labor_cost || 0),
        other_cost: Number(wo.other_cost || 0),
        labor_sac: wo.labor_sac ?? DEFAULT_LABOR_SAC,
        labor_tax_rate: Number(wo.labor_tax_rate ?? DEFAULT_LABOR_TAX_RATE),
        estimated_hours: wo.estimated_hours != null ? String(Number(wo.estimated_hours)) : '',
        actual_hours: wo.actual_hours != null ? String(Number(wo.actual_hours)) : '',
        place_of_supply_state_code: wo.place_of_supply_state_code || '',
        notes: wo.notes || '',
        terms: wo.terms || '',
      });
      setItems(
        (data.items || []).map((l: any) => ({
          ...newRow(),
          item_id: l.item_id || null,
          item_name: l.item_name || '',
          description: l.description || '',
          hsn_sac: l.hsn_sac || '',
          qty: Number(l.qty || 0),
          unit: l.unit || 'PCS',
          unit_price: Number(l.unit_price || 0),
          tax_rate: Number(l.tax_rate || 0),
        }))
      );
    } catch (error) {
      console.error('Error loading work order:', error);
      toast.error('Could not load the work order');
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
      work_location:
        prev.work_location || customer.shipping_address || customer.billing_address || customer.address || '',
      place_of_supply_state_code:
        customer.state_code || getStateCode(customer.state || '') || prev.place_of_supply_state_code,
    }));
  };

  const addItem = () => setItems((prev) => [...prev, newRow()]);
  const removeItem = (id: string) => setItems((prev) => prev.filter((r) => r.id !== id));
  const patchItem = (id: string, patch: Partial<MaterialRow>) =>
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const preview = useMemo(
    () => computeWorkOrderCosts(items, formData.labor_cost, formData.other_cost),
    [items, formData.labor_cost, formData.other_cost]
  );

  const readOnly = !!editId && existingStatus !== null && !isWorkOrderEditable(existingStatus);

  const handleSubmit = async (status: 'draft' | 'scheduled') => {
    if (!business?.id) {
      toast.error('Business not found');
      return;
    }
    if (!formData.work_order_number || !formData.work_order_date || !formData.work_description.trim()) {
      toast.error('Please fill in work order number, date, and description');
      return;
    }
    if (status === 'scheduled' && !formData.scheduled_start_date) {
      toast.error('Pick a scheduled start date to schedule the work');
      return;
    }
    if (preview.costs.total_cost <= 0 && preview.lines.length === 0) {
      toast.error('Enter the labour cost or add materials');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        ...formData,
        place_of_supply_state_code: formData.place_of_supply_state_code || null,
        estimated_hours: formData.estimated_hours === '' ? null : formData.estimated_hours,
        actual_hours: formData.actual_hours === '' ? null : formData.actual_hours,
        labor_tax_rate: chargeTax ? formData.labor_tax_rate : 0,
        status,
        business_id: business.id,
        branch_id: branchId,
        auto_number: !editId && formData.work_order_number === suggestedNumber,
        items: preview.lines.map((l) => ({ ...l, tax_rate: chargeTax ? l.tax_rate : 0 })),
      };

      const res = await fetch(editId ? `/api/work-orders/${editId}` : '/api/work-orders', {
        method: editId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        const label = data.workOrder?.work_order_number
          ? `Work order ${data.workOrder.work_order_number}`
          : 'Work order';
        toast.success(editId ? `${label} updated` : status === 'scheduled' ? `${label} scheduled` : `${label} saved`);
        const id = data.workOrder?.id || editId;
        router.push(id ? `/work-orders/${id}` : '/work-orders');
      } else {
        toast.error(data.error || 'Failed to save work order');
      }
    } catch (error) {
      console.error('Error saving work order:', error);
      toast.error('Failed to save work order');
    } finally {
      setLoading(false);
    }
  };

  if (!canSave) {
    return (
      <AccessDenied
        module="work_orders"
        action={editId ? 'update' : 'create'}
        details={reason}
        code="WORK_ORDER_CREATE_DENIED"
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

  const set = <K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) =>
    setFormData((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {editId ? `Edit Work Order ${formData.work_order_number}` : 'New Work Order'}
        </h1>
        <p className="text-gray-600 text-sm mt-1">
          A job for a customer: what to do, where, when, who does it, and the materials and labour it needs.
        </p>
      </div>

      {readOnly && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          This work order is {STATUS_LABELS[existingStatus as WorkOrderStatus]?.toLowerCase() || existingStatus} and can
          no longer be edited.
        </div>
      )}

      <fieldset disabled={readOnly} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Basic Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Work Order Number *</label>
              <Input
                type="text"
                value={formData.work_order_number}
                onChange={(e) => set('work_order_number', e.target.value)}
                placeholder="WO-001"
              />
              {!editId && formData.work_order_number === suggestedNumber && suggestedNumber && (
                <p className="text-xs text-gray-500 mt-1">The next free number is assigned when you save.</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Work Order Date *</label>
              <Input type="date" value={formData.work_order_date} onChange={(e) => set('work_order_date', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
              <CustomerSearchSelect customers={customers} value={formData.customer_id} onSelect={applyCustomer} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
              <select
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                value={formData.priority}
                onChange={(e) => set('priority', e.target.value)}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Work Details</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Work Description *</label>
              <textarea
                className={textareaClass}
                rows={3}
                value={formData.work_description}
                onChange={(e) => set('work_description', e.target.value)}
                placeholder="Describe the work to be performed"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Work Location / Site</label>
                <textarea
                  className={textareaClass}
                  rows={2}
                  value={formData.work_location}
                  onChange={(e) => set('work_location', e.target.value)}
                  placeholder="Where the work will be done (filled from the customer's address)"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Assigned To</label>
                <Input
                  type="text"
                  value={formData.assigned_to}
                  onChange={(e) => set('assigned_to', e.target.value)}
                  placeholder="Technician / team / contractor"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Scheduled Start</label>
                <Input
                  type="date"
                  value={formData.scheduled_start_date}
                  onChange={(e) => set('scheduled_start_date', e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Scheduled End</label>
                <Input
                  type="date"
                  min={formData.scheduled_start_date || undefined}
                  value={formData.scheduled_end_date}
                  onChange={(e) => set('scheduled_end_date', e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Estimated Hours</label>
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  value={formData.estimated_hours}
                  onChange={(e) => set('estimated_hours', e.target.value)}
                  placeholder="0"
                />
              </div>
              {editId && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Actual Hours</label>
                  <Input
                    type="number"
                    min={0}
                    step="0.5"
                    value={formData.actual_hours}
                    onChange={(e) => set('actual_hours', e.target.value)}
                    placeholder="0"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Materials</h2>
            <Button onClick={addItem} variant="secondary" size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Add Material
            </Button>
          </div>
          <div className="md:overflow-x-auto">
            <table className="kh-line-cards w-full md:min-w-[820px]">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-2 text-left text-sm font-semibold text-gray-700">Item</th>
                  <th className="px-2 py-2 text-left text-sm font-semibold text-gray-700 w-28">HSN/SAC</th>
                  <th className="px-2 py-2 text-left text-sm font-semibold text-gray-700 w-24">Qty</th>
                  <th className="px-2 py-2 text-left text-sm font-semibold text-gray-700 w-20">Unit</th>
                  <th className="px-2 py-2 text-left text-sm font-semibold text-gray-700 w-28">Rate (₹)</th>
                  {chargeTax && <th className="px-2 py-2 text-left text-sm font-semibold text-gray-700 w-20">GST %</th>}
                  <th className="px-2 py-2 text-right text-sm font-semibold text-gray-700 w-28">Amount</th>
                  <th className="px-2 py-2 w-12" />
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={chargeTax ? 8 : 7} className="px-3 py-8 text-center text-gray-500 text-sm" data-label="">
                      No materials added. Click &quot;Add Material&quot; to add parts or consumables.
                    </td>
                  </tr>
                ) : (
                  items.map((row) => (
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
                        <Input type="text" value={row.unit} onChange={(e) => patchItem(row.id, { unit: e.target.value })} />
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
                      <td className="px-2 py-2 text-right text-sm font-medium text-gray-900" data-label="Amount">
                        {inr(Math.round((row.qty || 0) * (row.unit_price || 0) * 100) / 100)}
                      </td>
                      <td className="px-2 py-2" data-label="">
                        <Button variant="ghost" size="sm" onClick={() => removeItem(row.id)}>
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Labour &amp; Charges</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Labour Cost (₹)</label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={formData.labor_cost}
                onChange={(e) => set('labor_cost', Number(e.target.value))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Labour SAC</label>
              <Input
                type="text"
                value={formData.labor_sac}
                onChange={(e) => set('labor_sac', e.target.value)}
                placeholder={DEFAULT_LABOR_SAC}
                maxLength={10}
              />
            </div>
            {chargeTax && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Labour GST %</label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={formData.labor_tax_rate}
                  onChange={(e) => set('labor_tax_rate', Number(e.target.value))}
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Other Charges (₹)</label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={formData.other_cost}
                onChange={(e) => set('other_cost', Number(e.target.value))}
                placeholder="Travel, disposal…"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Place of Supply</label>
              <select
                value={formData.place_of_supply_state_code}
                onChange={(e) => set('place_of_supply_state_code', e.target.value)}
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
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <div className="w-full max-w-xs space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Materials</span>
                <span>₹{inr(preview.costs.material_cost)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Labour</span>
                <span>₹{inr(preview.costs.labor_cost)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Other charges</span>
                <span>₹{inr(preview.costs.other_cost)}</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-semibold text-gray-900">
                <span>Estimated total</span>
                <span>₹{inr(preview.costs.total_cost)}</span>
              </div>
              {chargeTax && <p className="text-xs text-gray-500">Before GST. Tax is added on the invoice.</p>}
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Additional Information</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes / Instructions</label>
              <textarea
                className={textareaClass}
                rows={3}
                value={formData.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="Access instructions, safety notes, customer requests"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Terms &amp; Conditions</label>
              <textarea
                className={textareaClass}
                rows={3}
                value={formData.terms}
                onChange={(e) => set('terms', e.target.value)}
                placeholder="Warranty, payment terms"
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
              <Button onClick={() => handleSubmit('scheduled')} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CalendarCheck className="w-4 h-4 mr-2" />}
                Save &amp; Schedule
              </Button>
            </>
          )}
        </div>
      </fieldset>
    </div>
  );
}

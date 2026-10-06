'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import { Loader2, Plus, Save, Search, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ItemAutocomplete } from '@/components/ui/ItemAutocomplete';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { AccessDenied } from '@/components/common/AccessDenied';
import { DesktopSalesOrderComposer } from '@/components/sales-orders/composer/DesktopSalesOrderComposer';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { useToastContext } from '@/contexts/ToastContext';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';
import { INDIAN_STATES, getStateCode } from '@/lib/gst-utils';
import {
  calculateRow,
  calculateTotals,
  numberToWords,
  type InvoiceItemRow,
} from '@/lib/invoice-engine';
import type { ComposerCharge, ComposerRow, PickerItem } from '@/components/invoices/composer/types';
import type { Customer } from '@/types/database';

const CLASSIC_DESKTOP_FORM_KEY = 'salesOrderClassicDesktop';

const emptyRow = (): ComposerRow => ({
  itemId: '',
  name: '',
  quantity: 1,
  freeQty: 0,
  unit: 'PCS',
  price: 0,
  discountPercent: 0,
  discountAmount: 0,
  taxPercent: 0,
  taxAmount: 0,
  hsnSac: '',
  taxableValue: 0,
  cgstAmount: 0,
  sgstAmount: 0,
  igstAmount: 0,
  total: 0,
});

const stateNameFromCode = (code: string | null | undefined): string =>
  (code && INDIAN_STATES.find((s) => getStateCode(s) === code)) || '';

function CustomerAutocomplete({
  customers,
  value,
  onChange,
  onSelect,
}: {
  customers: Customer[];
  value: string;
  onChange: (value: string) => void;
  onSelect: (customer: Customer) => void;
}) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const selectedCustomer = customers.find((c) => c.id === value);

  useEffect(() => {
    if (selectedCustomer) setQuery(selectedCustomer.name);
  }, [selectedCustomer]);

  const filtered =
    query === ''
      ? customers
      : customers.filter(
          (c) =>
            c.name.toLowerCase().includes(query.toLowerCase()) ||
            c.company_name?.toLowerCase().includes(query.toLowerCase()) ||
            c.phone?.includes(query)
        );

  return (
    <div className="relative w-full">
      <div className="relative">
        <input
          type="text"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          placeholder="Search Customer..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            if (e.target.value === '') onChange('');
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setTimeout(() => setIsOpen(false), 200)}
        />
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-gray-400" />
      </div>
      {isOpen && filtered.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-gray-300 bg-white shadow-lg">
          {filtered.map((customer) => (
            <button
              key={customer.id}
              type="button"
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100"
              onClick={() => {
                setQuery(customer.name);
                onChange(customer.id);
                onSelect(customer);
                setIsOpen(false);
              }}
            >
              <div className="font-medium">{customer.name}</div>
              {customer.company_name && (
                <div className="text-xs text-gray-500">{customer.company_name}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NewSalesOrderPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { business, user } = useAuth();
  const { currentBranchId } = useBranch();
  const toast = useToastContext();
  const editId = searchParams.get('edit');
  const convertFromId = searchParams.get('convert_from');
  const prefillOverridesRef = useRef<{ billing: string; shipping: string; placeOfSupply: string } | null>(
    null
  );
  const prefillDoneRef = useRef<string | null>(null);
  const editLoadedRef = useRef<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [editLoading, setEditLoading] = useState(!!editId);
  const [seriesLoading, setSeriesLoading] = useState(!editId);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [classicDesktopForm, setClassicDesktopForm] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [readOnlyReason, setReadOnlyReason] = useState<string | null>(null);

  const { allowed: canCreate, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'sales_sales_orders',
    action: 'create',
    skipCheck: !user?.id || !business?.id || !!editId,
  });
  const { allowed: canUpdate } = useAuthorizationGuard({
    resource: 'sales_sales_orders',
    action: 'update',
    skipCheck: !user?.id || !business?.id || !editId,
  });

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerId, setCustomerId] = useState('');
  const [orderDate, setOrderDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [placeOfSupply, setPlaceOfSupply] = useState(business?.state || '');
  const [billingAddress, setBillingAddress] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [rows, setRows] = useState<ComposerRow[]>([emptyRow()]);
  const [extraCharges, setExtraCharges] = useState<ComposerCharge[]>([]);
  const [enableRoundOff, setEnableRoundOff] = useState(false);
  const [pricesIncludeGst, setPricesIncludeGst] = useState(false);
  const [savedOrderId, setSavedOrderId] = useState<string | null>(editId);
  const [savedStatus, setSavedStatus] = useState<'draft' | 'confirmed' | null>(null);

  const branchId =
    currentBranchId && currentBranchId !== 'ALL' ? currentBranchId : undefined;

  useEffect(() => {
    try {
      setClassicDesktopForm(localStorage.getItem(CLASSIC_DESKTOP_FORM_KEY) === '1');
    } catch {
      /* ignore */
    }
    const mq = window.matchMedia('(min-width: 1024px)');
    const apply = () => setIsDesktop(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const rowContext = useMemo(
    () => ({
      businessStateCode: business?.state_code || getStateCode(business?.state || ''),
      businessState: business?.state || '',
      placeOfSupply,
      isExport: false as const,
      documentType: 'sales_order' as const,
      pricesIncludeGst,
    }),
    [business?.state, business?.state_code, placeOfSupply, pricesIncludeGst]
  );

  const isIntraState = useMemo(() => {
    const b = business?.state_code || getStateCode(business?.state || '');
    const p = getStateCode(placeOfSupply || '');
    return !!b && !!p && b === p;
  }, [business?.state, business?.state_code, placeOfSupply]);

  const recalculatedRows = useMemo(
    () => rows.map((r) => calculateRow(r, rowContext, true)),
    [rows, rowContext]
  );

  const engineTotals = useMemo(() => {
    const base = calculateTotals({
      rows: recalculatedRows,
      extraCharges,
      context: rowContext,
    });
    const roundOff = enableRoundOff
      ? Math.round(base.grandTotal) - base.grandTotal
      : 0;
    return {
      ...base,
      roundOff: Math.round(roundOff * 100) / 100,
      grandTotal: Math.round((base.grandTotal + roundOff) * 100) / 100,
    };
  }, [recalculatedRows, extraCharges, rowContext, enableRoundOff]);

  const composerTotals = useMemo(
    () => ({
      itemSubtotal: engineTotals.itemSubtotal,
      totalDiscount: engineTotals.totalDiscount,
      taxableAmount: engineTotals.taxableAmount,
      totalCGST: engineTotals.totalCGST,
      totalSGST: engineTotals.totalSGST,
      totalIGST: engineTotals.totalIGST,
      totalTax: engineTotals.totalTax,
      totalExtraCharges: engineTotals.totalExtraCharges,
      roundOff: engineTotals.roundOff,
      grandTotal: engineTotals.grandTotal,
    }),
    [engineTotals]
  );

  const amountInWords = useMemo(
    () => (composerTotals.grandTotal > 0 ? numberToWords(composerTotals.grandTotal) : ''),
    [composerTotals.grandTotal]
  );

  useEffect(() => {
    if (!business?.id) return;
    fetch(`/api/customers?business_id=${business.id}&user_id=${user?.id}`)
      .then((res) => res.json())
      .then((data) => setCustomers(data.customers || []))
      .catch((err) => console.error(err));
  }, [business?.id, user?.id]);

  useEffect(() => {
    if (!business?.id || editId) return;
    setSeriesLoading(true);
    fetch(`/api/sales-orders?business_id=${business.id}&user_id=${user?.id}`)
      .then((res) => res.json())
      .then((data) => {
        const existingNumbers = (data.salesOrders || []).map((so: { order_number: string }) => so.order_number);
        let nextNum = 1;
        while (existingNumbers.includes(`SO-${String(nextNum).padStart(3, '0')}`)) {
          nextNum++;
        }
        setOrderNumber(`SO-${String(nextNum).padStart(3, '0')}`);
      })
      .catch((err) => console.error(err))
      .finally(() => setSeriesLoading(false));
  }, [business?.id, user?.id, editId]);

  useEffect(() => {
    if (!editId || !business?.id || !user?.id) return;
    if (editLoadedRef.current === editId) return;
    editLoadedRef.current = editId;
    setEditLoading(true);
    fetch(`/api/sales-orders/${editId}`, { credentials: 'include' })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load sales order');
        return data.salesOrder;
      })
      .then((so) => {
        if (!so) return;
        const editable = so.editable !== false;
        if (!editable) {
          setReadOnlyReason('This sales order can no longer be edited.');
          toast.error('This sales order can no longer be edited.');
        }
        setSavedOrderId(so.id);
        setSavedStatus(so.status === 'confirmed' ? 'confirmed' : 'draft');
        setOrderNumber(so.order_number || '');
        setOrderDate(String(so.order_date || '').slice(0, 10));
        setExpectedDeliveryDate(
          so.expected_delivery_date ? String(so.expected_delivery_date).slice(0, 10) : ''
        );
        setCustomerId(so.customer_id || '');
        setBillingAddress(so.billing_address || '');
        setShippingAddress(so.shipping_address || '');
        setPlaceOfSupply(
          stateNameFromCode(so.place_of_supply_state_code) || so.customer_state || business.state || ''
        );
        setNotes(so.notes || '');
        setTerms(so.terms || '');
        if (Number(so.additional_charges) > 0) {
          setExtraCharges([
            {
              id: '1',
              purpose: so.additional_charges_label || 'Additional charges',
              amount: Number(so.additional_charges) || 0,
            },
          ]);
        }
        if (Math.abs(Number(so.round_off) || 0) > 0.001) setEnableRoundOff(true);
        const items = Array.isArray(so.items) ? so.items : [];
        if (items.length > 0) {
          setRows(
            items.map((i: Record<string, unknown>) =>
              calculateRow(
                {
                  itemId: String(i.item_id || ''),
                  name: String(i.item_name || ''),
                  freeQty: 0,
                  quantity: Number(i.qty || 1),
                  unit: String(i.unit || 'PCS'),
                  price: Number(i.unit_price || 0),
                  discountPercent: Number(i.discount_percent || 0),
                  discountAmount: Number(i.discount_amount || 0),
                  taxPercent: Number(i.tax_rate || 0),
                  taxAmount: 0,
                  hsnSac: String(i.hsn_sac || ''),
                  taxableValue: 0,
                  cgstAmount: 0,
                  sgstAmount: 0,
                  igstAmount: 0,
                  total: 0,
                },
                rowContext,
                true
              )
            )
          );
        }
      })
      .catch((err) => {
        console.error(err);
        toast.error(err instanceof Error ? err.message : 'Failed to load sales order');
        router.replace('/sales-orders');
      })
      .finally(() => setEditLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, business?.id, user?.id]);

  useEffect(() => {
    if (!customerId || !business) {
      if (!customerId) {
        setSelectedCustomer(null);
      }
      return;
    }
    const fromList = customers.find((c) => c.id === customerId);
    if (fromList) setSelectedCustomer(fromList);

    fetch(`/api/customers/${customerId}`)
      .then((res) => res.json())
      .then((data) => {
        const c = data.customer;
        if (!c) return;
        setSelectedCustomer(c);
        const overrides = prefillOverridesRef.current;
        if (overrides) {
          prefillOverridesRef.current = null;
          setBillingAddress(overrides.billing || c.billing_address || c.address || '');
          setShippingAddress(overrides.shipping || c.shipping_address || c.address || '');
          if (overrides.placeOfSupply) {
            setPlaceOfSupply(overrides.placeOfSupply);
            return;
          }
        } else if (!editId || !billingAddress) {
          setBillingAddress(c.billing_address || c.address || '');
          setShippingAddress(c.shipping_address || c.address || '');
        }
        if (!editId) {
          const cState = getStateCode(c.state || '');
          const bState = business.state_code || getStateCode(business.state || '');
          if (cState && bState && cState === bState) {
            setPlaceOfSupply(business.state || '');
          } else if (c.state) {
            setPlaceOfSupply(c.state);
          } else {
            setPlaceOfSupply(business.state || '');
          }
        }
      })
      .catch((err) => console.error(err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, business?.id, customers]);

  useEffect(() => {
    if (!business?.id || !user?.id || editId) return;
    const prefillKey = convertFromId || searchParams.get('customer_id') || searchParams.get('item_id');
    if (!prefillKey || prefillDoneRef.current === prefillKey) return;
    prefillDoneRef.current = prefillKey;

    if (convertFromId) {
      fetch(`/api/invoices/${convertFromId}?user_id=${user.id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          const est = data?.invoice || data;
          if (!est?.id) return;
          const estPlaceOfSupply = stateNameFromCode(est.place_of_supply_state_code);
          prefillOverridesRef.current = {
            billing: est.billing_address || '',
            shipping: est.shipping_address || '',
            placeOfSupply: estPlaceOfSupply,
          };
          if (est.customer_id) setCustomerId(est.customer_id);
          if (estPlaceOfSupply) setPlaceOfSupply(estPlaceOfSupply);
          setNotes(est.notes || '');
          setTerms(est.terms || '');
          if (Array.isArray(est.items) && est.items.length > 0) {
            setRows(
              est.items.map((i: Record<string, unknown>) =>
                calculateRow(
                  {
                    itemId: String(i.item_id || ''),
                    name: String(i.item_name || ''),
                    freeQty: 0,
                    quantity: Number(i.quantity || 1),
                    unit: String(i.unit || 'PCS'),
                    price: Number(i.unit_price || 0),
                    discountPercent: Number(i.discount_percent || 0),
                    discountAmount: 0,
                    taxPercent: Number(i.tax_rate || 0),
                    taxAmount: 0,
                    hsnSac: String(i.hsn_sac || ''),
                    taxableValue: 0,
                    cgstAmount: 0,
                    sgstAmount: 0,
                    igstAmount: 0,
                    total: 0,
                  },
                  rowContext,
                  false
                )
              )
            );
          }
        })
        .catch((err) => console.error('[Convert] Failed to load source estimate:', err));
      return;
    }

    const qCustomerId = searchParams.get('customer_id');
    const qItemId = searchParams.get('item_id');
    const qQty = Number(searchParams.get('qty') || 1) || 1;
    if (qCustomerId) setCustomerId(qCustomerId);
    if (qItemId) {
      fetch(`/api/items/${qItemId}?business_id=${business.id}&user_id=${user.id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          const item = data?.item || data;
          if (!item?.id) return;
          setRows([
            calculateRow(
              {
                ...emptyRow(),
                itemId: item.id,
                name: item.name || '',
                quantity: qQty,
                unit: item.unit || 'PCS',
                price: Number(item.selling_price || 0),
                taxPercent: Number(item.tax_rate || 0),
                hsnSac: item.hsn_sac || '',
              },
              rowContext,
              false
            ),
          ]);
        })
        .catch((err) => console.error('[Prefill] Failed to load item:', err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, user?.id, convertFromId, searchParams, editId]);

  const patchRow = useCallback(
    (index: number, patch: Partial<ComposerRow>, skipDiscountRecalc = false) => {
      setRows((prev) => {
        const next = [...prev];
        const merged = { ...next[index], ...patch } as InvoiceItemRow;
        next[index] = calculateRow(merged, rowContext, skipDiscountRecalc);
        return next;
      });
    },
    [rowContext]
  );

  const removeRow = useCallback((index: number) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }, []);

  const onApplyPicked = useCallback(
    (selections: Array<{ item: PickerItem; quantity: number }>) => {
      setRows((prev) => {
        const next = [...prev];
        let emptyIdx = next.findIndex((r) => !r.itemId && !r.name);
        for (const sel of selections) {
          const row: ComposerRow = {
            ...calculateRow(
              {
                ...emptyRow(),
                itemId: sel.item.id,
                name: sel.item.name,
                quantity: sel.quantity,
                unit: sel.item.unit || 'PCS',
                price: Number(sel.item.selling_price || 0),
                taxPercent: Number(sel.item.tax_rate || 0),
                hsnSac: sel.item.hsn_sac || '',
                variantId: sel.item.variantId,
                variantName: sel.item.variantName,
              },
              rowContext,
              false
            ),
            code: sel.item.code,
          };
          if (emptyIdx >= 0) {
            next[emptyIdx] = row;
            emptyIdx = next.findIndex((r, i) => i > emptyIdx && !r.itemId && !r.name);
          } else {
            next.push(row);
          }
        }
        if (next.every((r) => r.itemId || r.name)) next.push(emptyRow());
        return next;
      });
    },
    [rowContext]
  );

  const onBarcode = useCallback(
    async (code: string) => {
      if (!business?.id || !code.trim()) return;
      try {
        const res = await fetch(
          `/api/items?business_id=${business.id}&user_id=${user?.id}&search=${encodeURIComponent(code.trim())}&limit=5`
        );
        const data = await res.json();
        const item = (data.items || []).find(
          (i: { barcode?: string; code?: string }) =>
            i.barcode === code.trim() || i.code === code.trim()
        ) || data.items?.[0];
        if (!item) {
          toast.error('Item not found');
          return;
        }
        onApplyPicked([{ item, quantity: 1 }]);
      } catch {
        toast.error('Failed to look up barcode');
      }
    },
    [business?.id, user?.id, onApplyPicked, toast]
  );

  const buildPayload = (targetStatus: 'draft' | 'confirmed') => {
    const filled = recalculatedRows.filter((r) => r.itemId || r.name);
    const additional = extraCharges.reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const label =
      extraCharges
        .map((c) => c.purpose)
        .filter(Boolean)
        .join(', ') || undefined;
    return {
      customer_id: customerId,
      order_number: orderNumber,
      order_date: orderDate,
      expected_delivery_date: expectedDeliveryDate || null,
      items: filled.map((row) => ({
        item_id: row.itemId || null,
        item_name: row.name,
        description: '',
        hsn_sac: row.hsnSac || null,
        qty: row.quantity,
        unit: row.unit,
        unit_price: row.price,
        discount_percent: row.discountPercent,
        discount_amount: row.discountAmount,
        tax_rate: row.taxPercent,
        tax_amount: row.taxAmount,
        taxable_value: row.taxableValue,
        cgst_amount: row.cgstAmount,
        sgst_amount: row.sgstAmount,
        igst_amount: row.igstAmount,
        line_total: row.total,
      })),
      subtotal: engineTotals.taxableAmount,
      discount_total: engineTotals.totalDiscount,
      tax_total: engineTotals.totalTax,
      round_off: engineTotals.roundOff,
      grand_total: engineTotals.grandTotal,
      additional_charges: additional,
      additional_charges_label: label,
      shipping_address: shippingAddress || null,
      billing_address: billingAddress || null,
      place_of_supply_state_code: getStateCode(placeOfSupply) || null,
      notes: notes || null,
      terms: terms || null,
      status: targetStatus,
      branch_id: branchId,
    };
  };

  const handleSave = async (targetStatus: 'draft' | 'confirmed') => {
    if (readOnlyReason) {
      toast.error(readOnlyReason);
      return;
    }
    const filled = recalculatedRows.filter((r) => r.itemId || r.name);
    if (filled.length === 0) {
      toast.error('Please add at least one item');
      return;
    }
    if (!customerId) {
      toast.error('Please select a customer');
      return;
    }
    if (!orderNumber.trim()) {
      toast.error('Order number is required');
      return;
    }

    setLoading(true);
    try {
      const payload = buildPayload(targetStatus);
      const isUpdate = !!savedOrderId;
      const res = await fetch(isUpdate ? `/api/sales-orders/${savedOrderId}` : '/api/sales-orders', {
        method: isUpdate ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(
          isUpdate
            ? payload
            : {
                ...payload,
                business_id: business?.id,
                created_by: user?.id || null,
              }
        ),
      });

      if (res.ok) {
        const data = await res.json();
        const id = data.salesOrder?.id || savedOrderId;
        setSavedOrderId(id);
        setSavedStatus(targetStatus);
        toast.success(
          `Sales order ${targetStatus === 'draft' ? 'saved as draft' : 'confirmed'} successfully!`
        );
        if (targetStatus === 'confirmed' && id) {
          router.push(`/sales-orders/${id}`);
        }
      } else {
        const error = await safeJsonParse(res);
        toast.error(getApiErrorMessage(error, 'Failed to save sales order'));
      }
    } catch (error) {
      console.error('Error saving sales order:', error);
      toast.error('Failed to save sales order');
    } finally {
      setLoading(false);
    }
  };

  const handlePreview = async () => {
    if (!savedOrderId) {
      toast.info('Save a draft first to preview');
      return;
    }
    setPreviewLoading(true);
    try {
      window.open(`/api/documents/sales_orders/${savedOrderId}/preview`, '_blank');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePrint = () => {
    if (!savedOrderId) return;
    window.open(`/api/documents/sales_orders/${savedOrderId}/pdf`, '_blank');
  };

  const handleDownload = () => {
    if (!savedOrderId) return;
    window.open(`/api/documents/sales_orders/${savedOrderId}/pdf`, '_blank');
  };

  const useNewDesktopComposer = isDesktop && !classicDesktopForm;
  const readOnly = !!readOnlyReason || (editId ? !canUpdate && !authLoading : false);

  if (authLoading || editLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!editId && !canCreate) {
    return (
      <AccessDenied
        module="sales_sales_orders"
        action="create"
        details={reason}
        code="SALES_ORDER_CREATE_DENIED"
      />
    );
  }

  if (useNewDesktopComposer) {
    return (
      <DesktopSalesOrderComposer
        title={editId ? 'Edit Sales Order' : 'New Sales Order'}
        statusLabel={
          readOnly
            ? 'Read-only'
            : savedStatus
              ? savedStatus === 'confirmed'
                ? 'Confirmed'
                : 'Draft'
              : null
        }
        onBack={() => router.push(savedOrderId ? `/sales-orders/${savedOrderId}` : '/sales-orders')}
        onUseClassicForm={() => {
          try {
            localStorage.setItem(CLASSIC_DESKTOP_FORM_KEY, '1');
          } catch {
            /* ignore */
          }
          setClassicDesktopForm(true);
        }}
        readOnly={readOnly}
        banners={
          readOnlyReason ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {readOnlyReason}
            </div>
          ) : null
        }
        businessId={business?.id || ''}
        userId={user?.id}
        branchId={branchId}
        customers={customers}
        customer={selectedCustomer}
        onSelectCustomer={(c) => {
          setCustomerId(c.id);
          setSelectedCustomer(c);
        }}
        onClearCustomer={() => {
          setCustomerId('');
          setSelectedCustomer(null);
          setBillingAddress('');
          setShippingAddress('');
        }}
        onCreateCustomer={() => router.push('/customers/new')}
        billingAddress={billingAddress}
        setBillingAddress={setBillingAddress}
        shippingAddress={shippingAddress}
        setShippingAddress={setShippingAddress}
        orderNumber={orderNumber}
        setOrderNumber={setOrderNumber}
        orderDate={orderDate}
        setOrderDate={setOrderDate}
        expectedDeliveryDate={expectedDeliveryDate}
        setExpectedDeliveryDate={setExpectedDeliveryDate}
        placeOfSupply={placeOfSupply}
        setPlaceOfSupply={setPlaceOfSupply}
        states={INDIAN_STATES}
        sellerState={business?.state || ''}
        isIntraState={isIntraState}
        seriesLoading={seriesLoading}
        rows={recalculatedRows.length ? recalculatedRows : [emptyRow()]}
        patchRow={patchRow}
        removeRow={removeRow}
        onApplyPicked={onApplyPicked}
        onBarcode={onBarcode}
        onCreateItem={() => router.push('/items/new')}
        pricesIncludeGst={pricesIncludeGst}
        setPricesIncludeGst={setPricesIncludeGst}
        notes={notes}
        setNotes={setNotes}
        terms={terms}
        setTerms={setTerms}
        totals={composerTotals}
        amountInWords={amountInWords}
        extraCharges={extraCharges}
        setExtraCharges={setExtraCharges}
        enableRoundOff={enableRoundOff}
        setEnableRoundOff={setEnableRoundOff}
        saving={loading}
        previewLoading={previewLoading}
        savedOrderId={savedOrderId}
        onPreview={handlePreview}
        onSaveDraft={() => void handleSave('draft')}
        onConfirm={() => void handleSave('confirmed')}
        onPrint={handlePrint}
        onDownload={handleDownload}
      />
    );
  }

  // Classic / mobile form
  const classicSubtotal = recalculatedRows.reduce((acc, row) => acc + row.taxableValue, 0);
  const classicTax = recalculatedRows.reduce((acc, row) => acc + row.taxAmount, 0);
  const classicTotal = classicSubtotal + classicTax;

  return (
    <>
      <MobileDuplicatePageChrome
        title={editId ? 'Edit sales order' : 'New sales order'}
        onBack={() => router.push('/sales-orders')}
      />
      {isDesktop && classicDesktopForm && (
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            className="text-xs font-semibold text-primary-700 hover:underline"
            onClick={() => {
              try {
                localStorage.removeItem(CLASSIC_DESKTOP_FORM_KEY);
              } catch {
                /* ignore */
              }
              setClassicDesktopForm(false);
            }}
          >
            Use new sales order form
          </button>
        </div>
      )}
      <div className="mx-auto max-w-5xl space-y-6">
        <Card className="p-6">
          <h1 className="mb-4 text-xl font-bold text-gray-900">
            {editId ? 'Edit Sales Order' : 'New Sales Order'}
          </h1>
          {readOnlyReason && (
            <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {readOnlyReason}
            </p>
          )}
          <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Customer *</label>
              <CustomerAutocomplete
                customers={customers}
                value={customerId}
                onChange={setCustomerId}
                onSelect={(c) => setSelectedCustomer(c)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Order Number *</label>
              <Input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} disabled={readOnly} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Order Date *</label>
              <Input
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
                disabled={readOnly}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Expected Delivery</label>
              <Input
                type="date"
                value={expectedDeliveryDate}
                onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                disabled={readOnly}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Place of Supply</label>
              <select
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                value={placeOfSupply}
                onChange={(e) => setPlaceOfSupply(e.target.value)}
                disabled={readOnly}
              >
                <option value="">Select state</option>
                {INDIAN_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mb-4 space-y-2">
            {recalculatedRows.map((row, index) => (
              <div key={index} className="grid grid-cols-12 items-end gap-2">
                <div className="col-span-4">
                  <ItemAutocomplete
                    value={row.name}
                    onChange={(name) => patchRow(index, { name })}
                    onSelect={(item) =>
                      patchRow(index, {
                        itemId: item.id,
                        name: item.name,
                        hsnSac: item.hsn_sac || '',
                        price: Number(item.selling_price || 0),
                        taxPercent: Number(item.tax_rate || 0),
                        unit: item.unit || 'PCS',
                      })
                    }
                    disabled={readOnly}
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    type="number"
                    value={row.quantity}
                    onChange={(e) => patchRow(index, { quantity: Number(e.target.value) || 0 })}
                    disabled={readOnly}
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    type="number"
                    value={row.price}
                    onChange={(e) => patchRow(index, { price: Number(e.target.value) || 0 })}
                    disabled={readOnly}
                  />
                </div>
                <div className="col-span-2 text-right text-sm font-medium">
                  ₹{row.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
                <div className="col-span-2 flex justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => removeRow(index)}
                    disabled={readOnly || recalculatedRows.length <= 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
            {!readOnly && (
              <Button type="button" variant="secondary" size="sm" onClick={() => setRows((r) => [...r, emptyRow()])}>
                <Plus className="mr-1 h-4 w-4" /> Add item
              </Button>
            )}
          </div>

          <div className="mb-4 flex justify-end text-sm">
            <div className="space-y-1 text-right">
              <div>Taxable: ₹{classicSubtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
              <div>Tax: ₹{classicTax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
              <div className="text-lg font-bold">
                Total: ₹{classicTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>

          {!readOnly && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void handleSave('draft')} isLoading={loading}>
                <Save className="mr-2 h-4 w-4" /> Save draft
              </Button>
              <Button variant="primary" onClick={() => void handleSave('confirmed')} isLoading={loading}>
                Confirm order
              </Button>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

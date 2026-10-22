'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { useToastContext } from '@/contexts/ToastContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { RcmCoverageNotice } from '@/components/gst/RcmCoverageNotice';
import { SettlementAccountField } from '@/components/accounting/SettlementAccountField';
import { describeAccountingError } from '@/lib/accounting-ui/errors';
import { GST_RATE_SLABS } from '@/lib/gst/rates';

type ExpenseItem = {
  id: string;
  name: string;
  item_type: 'goods' | 'service';
  unit: string | null;
  hsn_sac: string | null;
  tax_rate: number;
};

type Supplier = { id: string; name: string; state_code?: string | null; gstin?: string | null };

type Category = { id: string; name: string; itc_blocked?: boolean };

type Line = {
  key: string;
  expense_item_id: string;
  quantity: string;
  unit_price: string;
  tax_rate: string;
};

type JournalLine = { account_code: string; account_name: string; debit: number; credit: number };

const RATE_OPTIONS = [...GST_RATE_SLABS, 28];
const TDS_SECTION_OPTIONS = [
  ['194C', '194C — Contractors'],
  ['194J', '194J — Professional / technical fees'],
  ['194H', '194H — Commission / brokerage'],
  ['194I', '194I — Rent'],
  ['194A', '194A — Interest'],
  ['OTHER', 'Other'],
];

function newLine(): Line {
  return { key: crypto.randomUUID(), expense_item_id: '', quantity: '1', unit_price: '', tax_rate: '0' };
}

export default function NewExpensePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('edit');
  const { business, user } = useAuth();
  const { currentBranchId } = useBranch();
  const toast = useToastContext();
  const idempotencyKey = useRef(crypto.randomUUID());

  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<ExpenseItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(!!editId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editConflict, setEditConflict] = useState<string | null>(null);
  const [journal, setJournal] = useState<JournalLine[]>([]);
  const [bill, setBill] = useState<{ amount: number; cgst: number; sgst: number; igst: number; intra_state: boolean } | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [savedWithoutLines, setSavedWithoutLines] = useState(false);

  const [categoryId, setCategoryId] = useState('');
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [paymentMode, setPaymentMode] = useState('cash');
  const [settlementAccountId, setSettlementAccountId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [pricesIncludeGst, setPricesIncludeGst] = useState(false);
  const [itcEligible, setItcEligible] = useState(true);
  const [isReverseCharge, setIsReverseCharge] = useState(false);
  const [supplierGstin, setSupplierGstin] = useState('');
  const [registration, setRegistration] = useState('unknown');
  const [supplyReceivedOn, setSupplyReceivedOn] = useState('');
  const [tdsSection, setTdsSection] = useState('');
  const [tdsAmount, setTdsAmount] = useState('');
  const [headerAmount, setHeaderAmount] = useState('');
  const [headerCgst, setHeaderCgst] = useState('');
  const [headerSgst, setHeaderSgst] = useState('');
  const [headerIgst, setHeaderIgst] = useState('');
  const [lines, setLines] = useState<Line[]>([newLine()]);

  const [itemName, setItemName] = useState('');
  const [itemType, setItemType] = useState<'goods' | 'service'>('goods');
  const [itemUnit, setItemUnit] = useState('PCS');
  const [itemHsn, setItemHsn] = useState('');
  const [itemRate, setItemRate] = useState('18');

  const filledLines = useMemo(
    () => lines.filter((line) => line.expense_item_id && Number(line.quantity) > 0 && line.unit_price !== ''),
    [lines]
  );

  useEffect(() => {
    if (!business?.id || !user?.id) return;
    void fetch(`/api/expense-categories?business_id=${business.id}`)
      .then((res) => res.json())
      .then((data) => setCategories(data.categories || []));
    void fetch('/api/expense-items')
      .then((res) => res.json())
      .then((data) => setItems(data.items || []));
    void fetch(`/api/suppliers?business_id=${business.id}&user_id=${user.id}`)
      .then((res) => res.json())
      .then((data) => setSuppliers(data.suppliers || []));
  }, [business?.id, user?.id]);

  useEffect(() => {
    if (!editId || !business?.id) return;
    let cancelled = false;
    setLoading(true);
    void fetch(`/api/expenses/${editId}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not open this expense');
        return data.expense;
      })
      .then((expense) => {
        if (cancelled || !expense) return;
        setCategoryId(expense.category_id || '');
        setExpenseDate(String(expense.expense_date).slice(0, 10));
        setReference(expense.reference_number || '');
        setDescription(expense.description || '');
        setPaymentMode(expense.payment_mode || 'cash');
        setSettlementAccountId(expense.settlement_account_id || '');
        setSupplierId(expense.supplier_id || '');
        setPricesIncludeGst(expense.prices_include_gst === true);
        setItcEligible(expense.itc_eligible !== false);
        setIsReverseCharge(!!expense.is_reverse_charge);
        setSupplierGstin(expense.supplier_gstin || '');
        setRegistration(expense.supplier_registration_status || 'unknown');
        setSupplyReceivedOn(expense.supply_received_on ? String(expense.supply_received_on).slice(0, 10) : '');
        setTdsSection(expense.tds_section || '');
        setTdsAmount(Number(expense.tds_amount) > 0 ? String(expense.tds_amount) : '');
        setHeaderAmount(String(expense.amount ?? ''));
        setHeaderCgst(Number(expense.cgst_amount) > 0 ? String(expense.cgst_amount) : '');
        setHeaderSgst(Number(expense.sgst_amount) > 0 ? String(expense.sgst_amount) : '');
        setHeaderIgst(Number(expense.igst_amount) > 0 ? String(expense.igst_amount) : '');
        setUpdatedAt(expense.updated_at ?? null);
        const loaded = Array.isArray(expense.lines) ? expense.lines : [];
        setSavedWithoutLines(loaded.length === 0);
        setLines(
          loaded.length
            ? loaded.map((line: { expense_item_id: string; quantity: number; unit_price: number; tax_rate: number }) => ({
                key: crypto.randomUUID(),
                expense_item_id: line.expense_item_id,
                quantity: String(line.quantity),
                unit_price: String(line.unit_price),
                tax_rate: String(line.tax_rate),
              }))
            : [newLine()]
        );
      })
      .catch((loadError: Error) => setError(loadError.message))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editId, business?.id]);

  useEffect(() => {
    if (!business?.id || !categoryId) {
      setJournal([]);
      setBill(null);
      return;
    }
    const sendingLines = filledLines.length > 0;
    if (!sendingLines && !(Number(headerAmount) > 0)) {
      setJournal([]);
      setBill(null);
      return;
    }
    const handle = setTimeout(() => {
      void fetch('/api/expenses/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category_id: categoryId,
          expense_date: expenseDate,
          payment_mode: paymentMode,
          settlement_account_id: settlementAccountId || null,
          supplier_id: supplierId || null,
          supplier_gstin: supplierGstin || null,
          description,
          prices_include_gst: pricesIncludeGst,
          itc_eligible: itcEligible,
          is_reverse_charge: isReverseCharge,
          tds_section: tdsSection,
          tds_amount: Number(tdsAmount) || 0,
          amount: sendingLines ? undefined : Number(headerAmount),
          cgst_amount: sendingLines ? undefined : Number(headerCgst) || 0,
          sgst_amount: sendingLines ? undefined : Number(headerSgst) || 0,
          igst_amount: sendingLines ? undefined : Number(headerIgst) || 0,
          ...(sendingLines
            ? {
                lines: filledLines.map((line) => ({
                  expense_item_id: line.expense_item_id,
                  quantity: Number(line.quantity),
                  unit_price: Number(line.unit_price),
                  tax_rate: Number(line.tax_rate),
                })),
              }
            : {}),
        }),
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Could not preview this expense');
          setJournal(data.lines || []);
          setBill(data.bill || null);
          setError(null);
        })
        .catch((previewError: Error) => {
          setJournal([]);
          setBill(null);
          setError(previewError.message);
        });
    }, 300);
    return () => clearTimeout(handle);
  }, [
    business?.id,
    categoryId,
    expenseDate,
    paymentMode,
    settlementAccountId,
    supplierId,
    supplierGstin,
    description,
    pricesIncludeGst,
    itcEligible,
    isReverseCharge,
    tdsSection,
    tdsAmount,
    headerAmount,
    headerCgst,
    headerSgst,
    headerIgst,
    filledLines,
  ]);

  function chooseSupplier(id: string) {
    setSupplierId(id);
    const supplier = suppliers.find((row) => row.id === id);
    if (supplier?.gstin) setSupplierGstin(supplier.gstin);
  }

  function chooseItem(index: number, itemId: string) {
    const item = items.find((row) => row.id === itemId);
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index
          ? { ...line, expense_item_id: itemId, tax_rate: item ? String(item.tax_rate) : line.tax_rate }
          : line
      )
    );
  }

  async function createItem() {
    setError(null);
    const res = await fetch('/api/expense-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: itemName,
        item_type: itemType,
        unit: itemUnit,
        hsn_sac: itemHsn,
        tax_rate: Number(itemRate),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Could not add the expense item');
      return;
    }
    setItems((current) => [...current, data.item].sort((a, b) => a.name.localeCompare(b.name)));
    setLines((current) => {
      const next = [...current];
      const empty = next.findIndex((line) => !line.expense_item_id);
      const target = empty >= 0 ? empty : next.length;
      if (!next[target]) next.push(newLine());
      next[target] = {
        ...next[target],
        expense_item_id: data.item.id,
        tax_rate: String(data.item.tax_rate),
      };
      return next;
    });
    setItemName('');
    toast.success('Expense item added');
  }

  async function save() {
    if (!business?.id) return;
    setSaving(true);
    setError(null);
    setEditConflict(null);
    const sendingLines = filledLines.length > 0;
    if (!sendingLines && (!editId || !savedWithoutLines)) {
      setSaving(false);
      setError('Add an expense item, quantity, and rate.');
      return;
    }
    const payload: Record<string, unknown> = {
      branch_id: currentBranchId || undefined,
      category_id: categoryId,
      expense_date: expenseDate,
      reference_number: reference || null,
      description,
      payment_mode: paymentMode,
      settlement_account_id: settlementAccountId || null,
      supplier_id: supplierId || null,
      supplier_gstin: supplierGstin || null,
      supplier_registration_status: registration,
      supply_received_on: supplyReceivedOn || null,
      prices_include_gst: pricesIncludeGst,
      itc_eligible: itcEligible,
      is_reverse_charge: isReverseCharge,
      tds_section: tdsSection,
      tds_amount: Number(tdsAmount) || 0,
    };
    if (sendingLines) {
      payload.lines = filledLines.map((line) => ({
        expense_item_id: line.expense_item_id,
        quantity: Number(line.quantity),
        unit_price: Number(line.unit_price),
        tax_rate: Number(line.tax_rate),
      }));
    } else {
      payload.amount = Number(headerAmount);
      payload.cgst_amount = Number(headerCgst) || 0;
      payload.sgst_amount = Number(headerSgst) || 0;
      payload.igst_amount = Number(headerIgst) || 0;
    }
    if (editId) payload.expected_updated_at = updatedAt;
    const res = await fetch(editId ? `/api/expenses/${editId}` : '/api/expenses', {
      method: editId ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(editId ? {} : { 'x-idempotency-key': idempotencyKey.current }),
      },
      body: JSON.stringify(editId ? payload : { ...payload, idempotency_key: idempotencyKey.current }),
    });
    const data = await res.json().catch(() => null);
    setSaving(false);
    if (!res.ok) {
      const view = describeAccountingError(res.status, data, {
        context: 'expense',
        verb: 'saved',
        canManagePeriods: false,
        currentPath: '/expenses/new',
        fallback: 'Could not save this expense.',
      });
      if (data?.code === 'EXPENSE_EDIT_CONFLICT') setEditConflict(view.message);
      else setError(view.message);
      return;
    }
    toast.success(editId ? 'Expense updated' : 'Expense added');
    router.push('/expenses');
  }

  const itemById = new Map(items.map((item) => [item.id, item]));

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title={editId ? 'Edit expense' : 'New expense'}
        subtitle="A bill for the business, from your expense items. It does not receive stock."
        actions={
          <button
            type="button"
            onClick={() => router.push('/expenses')}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
          >
            Back to expenses
          </button>
        }
      />

      {loading ? (
        <p className="text-sm text-gray-500">Loading expense…</p>
      ) : (
        <div className="space-y-5">
          <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium text-gray-700">Category</span>
                <select
                  value={categoryId}
                  onChange={(event) => {
                    const id = event.target.value;
                    setCategoryId(id);
                    const category = categories.find((row) => row.id === id);
                    if (category) setItcEligible(!category.itc_blocked);
                  }}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                >
                  <option value="">Select a category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="font-medium text-gray-700">Date</span>
                <input
                  type="date"
                  value={expenseDate}
                  onChange={(event) => setExpenseDate(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-gray-700">Bill number</span>
                <input
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-gray-700">Supplier</span>
                <select
                  value={supplierId}
                  onChange={(event) => chooseSupplier(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                >
                  <option value="">Select a supplier</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-sm">
              <span className="font-medium text-gray-700">Description</span>
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                placeholder="What was this expense for?"
              />
            </label>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-gray-900">Items</h2>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={pricesIncludeGst}
                  onChange={(event) => setPricesIncludeGst(event.target.checked)}
                />
                Rates include GST
              </label>
            </div>
            {savedWithoutLines && filledLines.length === 0 && (
              <div className="grid gap-3 md:grid-cols-4">
                <label className="text-sm">
                  Amount
                  <input value={headerAmount} onChange={(event) => setHeaderAmount(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" />
                </label>
                <label className="text-sm">
                  CGST
                  <input value={headerCgst} onChange={(event) => setHeaderCgst(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" />
                </label>
                <label className="text-sm">
                  SGST
                  <input value={headerSgst} onChange={(event) => setHeaderSgst(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" />
                </label>
                <label className="text-sm">
                  IGST
                  <input value={headerIgst} onChange={(event) => setHeaderIgst(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" />
                </label>
                <p className="md:col-span-4 text-xs text-gray-500">
                  This expense was saved as one amount. Add an expense item below to replace it with lines.
                </p>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="py-2 pr-2">Item</th>
                    <th className="py-2 pr-2">Type</th>
                    <th className="py-2 pr-2">Qty</th>
                    <th className="py-2 pr-2">Rate</th>
                    <th className="py-2 pr-2">GST %</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => {
                    const item = itemById.get(line.expense_item_id);
                    return (
                      <tr key={line.key} className="border-t border-gray-100">
                        <td className="py-2 pr-2">
                          <select
                            value={line.expense_item_id}
                            onChange={(event) => chooseItem(index, event.target.value)}
                            className="w-full min-w-48 rounded-lg border border-gray-300 px-2 py-1.5"
                          >
                            <option value="">Select an item</option>
                            {items.map((row) => (
                              <option key={row.id} value={row.id}>
                                {row.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 pr-2 capitalize text-gray-600">{item?.item_type || '—'}</td>
                        <td className="py-2 pr-2">
                          <input
                            value={line.quantity}
                            onChange={(event) =>
                              setLines((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, quantity: event.target.value } : row)))
                            }
                            className="w-20 rounded-lg border border-gray-300 px-2 py-1.5"
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <input
                            value={line.unit_price}
                            onChange={(event) =>
                              setLines((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, unit_price: event.target.value } : row)))
                            }
                            className="w-28 rounded-lg border border-gray-300 px-2 py-1.5"
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <select
                            value={line.tax_rate}
                            onChange={(event) =>
                              setLines((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, tax_rate: event.target.value } : row)))
                            }
                            className="rounded-lg border border-gray-300 px-2 py-1.5"
                          >
                            {RATE_OPTIONS.map((rate) => (
                              <option key={rate} value={String(rate)}>
                                {rate}%
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2">
                          <button
                            type="button"
                            aria-label="Remove line"
                            onClick={() => setLines((current) => (current.length === 1 ? [newLine()] : current.filter((_, rowIndex) => rowIndex !== index)))}
                            className="text-gray-400 hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={() => setLines((current) => [...current, newLine()])}
              className="inline-flex items-center gap-1 text-sm font-medium text-primary-600"
            >
              <Plus className="h-4 w-4" /> Add line
            </button>
            <div className="rounded-lg border border-dashed border-gray-200 p-3">
              <p className="text-sm font-medium text-gray-800">New expense item</p>
              <p className="text-xs text-gray-500">This list is only for expenses. It is not the items you sell.</p>
              <div className="mt-2 grid gap-2 md:grid-cols-6">
                <input value={itemName} onChange={(event) => setItemName(event.target.value)} placeholder="Name" className="rounded-lg border px-2 py-1.5 md:col-span-2" />
                <select value={itemType} onChange={(event) => setItemType(event.target.value as 'goods' | 'service')} className="rounded-lg border px-2 py-1.5">
                  <option value="goods">Goods</option>
                  <option value="service">Service</option>
                </select>
                <input value={itemUnit} onChange={(event) => setItemUnit(event.target.value)} placeholder="Unit" className="rounded-lg border px-2 py-1.5" />
                <input value={itemHsn} onChange={(event) => setItemHsn(event.target.value)} placeholder="HSN / SAC" className="rounded-lg border px-2 py-1.5" />
                <button type="button" onClick={() => void createItem()} className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm text-white">
                  Add item
                </button>
              </div>
              <label className="mt-2 block text-xs text-gray-600">
                GST %
                <select value={itemRate} onChange={(event) => setItemRate(event.target.value)} className="ml-2 rounded border px-2 py-1">
                  {RATE_OPTIONS.map((rate) => (
                    <option key={rate} value={String(rate)}>
                      {rate}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {bill && (
              <p className="text-sm text-gray-700">
                {isReverseCharge ? 'Supplier charge' : 'Bill total'} ₹{bill.amount.toFixed(2)}
                {bill.cgst + bill.sgst + bill.igst > 0
                  ? ` · ${bill.intra_state ? `CGST ₹${bill.cgst.toFixed(2)} SGST ₹${bill.sgst.toFixed(2)}` : `IGST ₹${bill.igst.toFixed(2)}`}`
                  : ''}
              </p>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium text-gray-700">Payment</span>
                <select
                  value={paymentMode}
                  onChange={(event) => {
                    setPaymentMode(event.target.value);
                    setSettlementAccountId('');
                  }}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                >
                  <option value="cash">Paid — Cash</option>
                  <option value="upi">Paid — UPI</option>
                  <option value="bank_transfer">Paid — Bank transfer</option>
                  <option value="on_account">Bill received, not paid yet</option>
                </select>
                <div className="mt-2">
                  <SettlementAccountField mode={paymentMode} value={settlementAccountId} onChange={setSettlementAccountId} />
                </div>
              </label>
              <div className="space-y-3 text-sm">
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={itcEligible} onChange={(event) => setItcEligible(event.target.checked)} />
                  <span>
                    Claim ITC on this GST
                    <span className="block text-xs text-gray-500">
                      Untick for blocked credit u/s 17(5) — food, club, personal use, motor vehicles etc. The GST is then added to the expense.
                    </span>
                  </span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={isReverseCharge}
                    onChange={(event) => setIsReverseCharge(event.target.checked)}
                  />
                  Reverse charge (RCM)
                </label>
                <RcmCoverageNotice kind="expense" />
                <p className="text-xs text-gray-500">
                  {isReverseCharge
                    ? 'The amount is what the supplier charged, without GST. A lawyer and a box of pens are two expenses when only one is reverse charge.'
                    : 'The amount is the bill total, including GST.'}
                </p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm">
                TDS section
                <select value={tdsSection} onChange={(event) => setTdsSection(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2">
                  <option value="">No TDS</option>
                  {TDS_SECTION_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                TDS amount
                <input value={tdsAmount} onChange={(event) => setTdsAmount(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" />
              </label>
              <label className="text-sm">
                Supplier GSTIN
                <input value={supplierGstin} onChange={(event) => setSupplierGstin(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" />
              </label>
              <label className="text-sm">
                Supplier registration
                <select value={registration} onChange={(event) => setRegistration(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2">
                  <option value="unknown">Unknown</option>
                  <option value="registered">Registered</option>
                  <option value="unregistered">Unregistered</option>
                </select>
              </label>
            </div>
            {journal.length > 0 && (
              <div>
                <p className="mb-1 text-sm font-medium text-gray-800">Journal</p>
                <ul className="space-y-1 text-sm text-gray-700">
                  {journal.map((line) => (
                    <li key={`${line.account_code}-${line.debit}-${line.credit}`}>
                      {line.account_code} {line.account_name}: {line.debit > 0 ? `Dr ₹${line.debit.toFixed(2)}` : `Cr ₹${line.credit.toFixed(2)}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {error && <p className="text-sm text-red-700">{error}</p>}
            {editConflict && <p className="text-sm text-amber-900">{editConflict}</p>}
            <button
              type="button"
              disabled={saving || !categoryId}
              onClick={() => void save()}
              className="rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : editId ? 'Save expense' : 'Add expense'}
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

'use client';

export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/PageHeader';
import { useEffect, useState } from 'react';
import { Plus, Filter, Calendar, DollarSign, Tag } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { useToastContext } from '@/contexts/ToastContext';
import { useRouter } from 'next/navigation';
import { ReasonConfirmModal } from '@/components/modals/ReasonConfirmModal';
import {
  canManagePeriodLocks,
  describeAccountingError,
  type AccountingErrorView,
} from '@/lib/accounting-ui/errors';
import { buildReversalUrl, REVERSAL_COPY } from '@/lib/accounting-ui/reversal';

interface Expense {
  id: string;
  amount: number;
  description: string;
  expense_date: string;
  payment_mode: string;
  category_name: string | null;
  category_id: string | null;
  cgst_amount?: number;
  sgst_amount?: number;
  igst_amount?: number;
  reference_number?: string | null;
  itc_eligible?: boolean;
  is_reverse_charge?: boolean;
  tds_section?: string | null;
  tds_amount?: number;
  supplier_id?: string | null;
}

interface ExpenseCategory {
  id: string;
  name: string;
  itc_blocked?: boolean;
}

const TDS_SECTION_OPTIONS = [
  ['194C', '194C — Contractors'],
  ['194J', '194J — Professional / technical fees'],
  ['194H', '194H — Commission / brokerage'],
  ['194I', '194I — Rent'],
  ['194A', '194A — Interest'],
  ['OTHER', 'Other'],
];

export default function ExpensesPage() {
  const router = useRouter();
  const { business, user, permissions, isPrimaryAdmin } = useAuth();
  const { currentBranchId, isLoading: branchLoading } = useBranch();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [reversing, setReversing] = useState<Expense | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const toast = useToastContext();

  async function reverseExpense(reason: string): Promise<AccountingErrorView | null> {
    if (!reversing || !business?.id) return null;
    let res: Response;
    try {
      res = await fetch(buildReversalUrl(`/api/expenses/${reversing.id}`, business.id, reason), { method: 'DELETE' });
    } catch {
      return { message: 'Could not reach the server. Check your connection and try again.' };
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return describeAccountingError(res.status, data, {
        context: 'expense',
        verb: 'reversed',
        canManagePeriods: canManagePeriodLocks(isPrimaryAdmin, permissions),
        currentPath: '/expenses',
        fallback: 'Could not reverse the expense. Please try again.',
      });
    }
    setReversing(null);
    toast.success(REVERSAL_COPY.success);
    fetchExpenses();
    return null;
  }

  useEffect(() => {
    // Wait for branch context to be ready before fetching
    if (business?.id && !branchLoading) {
      fetchExpenses();
      fetchCategories();
    }
  }, [business, selectedCategory, currentBranchId, branchLoading]);

  // /expenses/new redirects here with ?new=1 so the sidebar create link opens the form.
  useEffect(() => {
    if (!business?.id || !user?.id || branchLoading) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('new') !== '1') return;
    setShowAddModal(true);
  }, [business?.id, user?.id, branchLoading]);

  function closeExpenseForm() {
    setShowAddModal(false);
    setEditing(null);
    if (new URLSearchParams(window.location.search).get('new') === '1') {
      router.replace('/expenses', { scroll: false });
    }
  }

  async function fetchExpenses() {
    try {
      let url = `/api/expenses?business_id=${business!.id}`;
      if (selectedCategory) {
        url += `&category_id=${selectedCategory}`;
      }

      const response = await fetch(url);
      const data = await response.json();
      setExpenses(data.expenses || []);
    } catch (error) {
      console.error('Error fetching expenses:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchCategories() {
    try {
      const response = await fetch(`/api/expense-categories?business_id=${business!.id}`);
      const data = await response.json();
      setCategories(data.categories || []);
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  }

  const totalExpenses = expenses.reduce((sum, exp) => sum + parseFloat(exp.amount.toString()), 0);

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <PageHeader
  title="Expenses"
  subtitle="Track your business expenses"

  actions={
    <>
<button
            onClick={() => setShowAddModal(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
          >
            <Plus className="w-5 h-5" />
            <span>Add Expense</span>
          </button>
    </>
  }
/>

        {/* Stats & Filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Total Expenses Card */}
          <div className="bg-gradient-to-br from-red-50 to-orange-50 rounded-xl p-6 border border-red-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-red-600 mb-1">Total Expenses</p>
                <p className="text-3xl font-bold text-gray-900">₹{totalExpenses.toLocaleString()}</p>
                <p className="text-xs text-gray-600 mt-1">{expenses.length} transactions</p>
              </div>
              <div className="bg-red-100 p-3 rounded-lg">
                <DollarSign className="w-6 h-6 text-red-600" />
              </div>
            </div>
          </div>

          {/* Category Filter */}
          <div className="bg-white rounded-xl p-6 border border-gray-200">
            <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Category</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="">All Categories</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          {/* Manage Categories */}
          <div className="bg-white rounded-xl p-6 border border-gray-200 flex items-center justify-center">
            <button
              onClick={() => router.push('/expenses/categories')}
              className="flex items-center space-x-2 text-primary-600 hover:text-primary-700 font-medium"
            >
              <Tag className="w-5 h-5" />
              <span>Manage Categories</span>
            </button>
          </div>
        </div>

        {/* Expenses List */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          {loading ? (
            <div className="p-12 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : expenses.length === 0 ? (
            <div className="p-12 text-center">
              <DollarSign className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No expenses recorded yet</p>
              <button
                onClick={() => setShowAddModal(true)}
                className="mt-4 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
              >
                Add Your First Expense
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Date</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Category</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Description</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Payment Mode</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700">GST (ITC)</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700">Amount</th>
                    <th className="py-3 px-4" />
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((expense) => (
                    <tr key={expense.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-4 px-4">
                        <div className="flex items-center space-x-2 text-sm text-gray-600">
                          <Calendar className="w-4 h-4" />
                          <span>{new Date(expense.expense_date).toLocaleDateString()}</span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        {expense.category_name ? (
                          <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-slate-100 text-primary-800">
                            {expense.category_name}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-400">Uncategorized</span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <p className="text-sm text-gray-900">{expense.description || '-'}</p>
                      </td>
                      <td className="py-4 px-4">
                        <span className="text-sm text-gray-600">
                          {expense.payment_mode === 'on_account'
                            ? 'On account (unpaid)'
                            : expense.payment_mode || 'Cash'}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right text-sm text-gray-600">
                        {(() => {
                          const g =
                            (Number(expense.cgst_amount) || 0) +
                            (Number(expense.sgst_amount) || 0) +
                            (Number(expense.igst_amount) || 0);
                          if (g <= 0) return '—';
                          const label = `₹${g.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
                          if (expense.is_reverse_charge) return `${label} (RCM)`;
                          return expense.itc_eligible === false ? `${label} (blocked)` : label;
                        })()}
                      </td>
                      <td className="py-4 px-4 text-right">
                        <span className="text-sm font-semibold text-red-600">
                          ₹{parseFloat(expense.amount.toString()).toLocaleString()}
                        </span>
                        {Number(expense.tds_amount) > 0 && (
                          <p className="text-xs text-gray-500">TDS ₹{Number(expense.tds_amount).toLocaleString('en-IN')}</p>
                        )}
                      </td>
                      <td className="py-4 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setEditing(expense)}
                          className="text-sm text-primary-600 hover:underline mr-3"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setReversing(expense)}
                          className="text-sm text-red-600 hover:underline"
                        >
                          {REVERSAL_COPY.expense.button}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {reversing && (
          <ReasonConfirmModal
            key={reversing.id}
            title={REVERSAL_COPY.expense.title}
            subject={`${reversing.description || 'Expense'} · ₹${Number(reversing.amount).toLocaleString('en-IN')}`}
            description={REVERSAL_COPY.expense.description}
            confirmLabel={REVERSAL_COPY.confirm}
            requireReason
            reasonLabel={REVERSAL_COPY.reasonLabel}
            reasonPlaceholder={REVERSAL_COPY.reasonPlaceholder}
            onConfirm={reverseExpense}
            onClose={() => setReversing(null)}
          />
        )}

        {/* Add Expense Modal */}
        {(showAddModal || editing) && (
          <AddExpenseModal
            businessId={business!.id}
            userId={user!.id}
            branchId={currentBranchId || undefined}
            categories={categories}
            expense={editing}
            onClose={closeExpenseForm}
            onSuccess={() => {
              fetchExpenses();
              closeExpenseForm();
            }}
          />
        )}
      </div>
    
  );
}

// Add Expense Modal Component
function AddExpenseModal({
  businessId,
  userId,
  branchId,
  categories,
  expense,
  onClose,
  onSuccess,
}: {
  businessId: string;
  userId: string;
  branchId?: string;
  categories: ExpenseCategory[];
  expense?: Expense | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToastContext();
  const num = (v: unknown) => (Number(v) > 0 ? String(v) : '');
  const [formData, setFormData] = useState({
    category_id: expense?.category_id || '',
    amount: expense ? String(expense.amount) : '',
    description: expense?.description || '',
    expense_date: expense ? String(expense.expense_date).slice(0, 10) : new Date().toISOString().split('T')[0],
    payment_mode: expense?.payment_mode || 'cash',
    reference_number: expense?.reference_number || '',
    supplier_id: expense?.supplier_id || '',
    cgst_amount: num(expense?.cgst_amount),
    sgst_amount: num(expense?.sgst_amount),
    igst_amount: num(expense?.igst_amount),
    itc_eligible: expense ? expense.itc_eligible !== false : true,
    is_reverse_charge: !!expense?.is_reverse_charge,
    tds_section: expense?.tds_section || '',
    tds_amount: num(expense?.tds_amount),
  });
  const [saving, setSaving] = useState(false);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!businessId) return;
    (async () => {
      try {
        const response = await fetch(
          `/api/suppliers?business_id=${businessId}&user_id=${userId}`
        );
        const data = await response.json();
        setSuppliers(data.suppliers || []);
      } catch {
        setSuppliers([]);
      }
    })();
  }, [businessId, userId]);

  const isOnAccount = ['on_account'].includes(formData.payment_mode);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    try {
      const cgst = parseFloat(formData.cgst_amount) || 0;
      const sgst = parseFloat(formData.sgst_amount) || 0;
      const igst = parseFloat(formData.igst_amount) || 0;

      const tds = parseFloat(formData.tds_amount) || 0;

      const response = await fetch(expense ? `/api/expenses/${expense.id}` : '/api/expenses', {
        method: expense ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          business_id: businessId,
          branch_id: branchId,
          created_by: userId,
          amount: parseFloat(formData.amount),
          supplier_id: isOnAccount && formData.supplier_id ? formData.supplier_id : null,
          cgst_amount: cgst,
          sgst_amount: sgst,
          igst_amount: igst,
          tds_amount: tds,
          tds_section: tds > 0 ? formData.tds_section || 'OTHER' : null,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => null);
        throw new Error(
          describeAccountingError(response.status, err, { context: 'expense', fallback: 'Failed to save expense' }).message
        );
      }

      toast.success(expense ? 'Expense updated' : 'Expense added successfully!');
      onSuccess();
    } catch (error: unknown) {
      console.error('Error creating expense:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to add expense. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">{expense ? 'Edit Expense' : 'Add Expense'}</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
            <select
              value={formData.category_id}
              onChange={(e) => {
                const cat = categories.find((c) => c.id === e.target.value);
                setFormData({ ...formData, category_id: e.target.value, itc_eligible: !cat?.itc_blocked });
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Select category</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Map categories to P&amp;L accounts under Manage Categories — the ledger uses that account when you pick a category.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Amount *</label>
            <input
              type="number"
              step="0.01"
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              placeholder="0.00"
            />
            <p className="text-xs text-gray-500 mt-1">
              {formData.is_reverse_charge
                ? 'Amount charged by the supplier (no GST on the bill under reverse charge).'
                : 'Total on the bill (including GST, if any).'}
            </p>
          </div>

          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/80 p-3 space-y-2">
            <p className="text-sm font-medium text-gray-800">GST on bill (optional — ITC)</p>
            <p className="text-xs text-gray-600">
              If this is a B2B tax invoice, enter GST so books post Input CGST/SGST (intra-state) or Input IGST
              (inter-state). Leave all zero for non-GST bills. Amount must equal taxable expense + GST.
            </p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs text-gray-600 mb-1">CGST</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.cgst_amount}
                  onChange={(e) => setFormData({ ...formData, cgst_amount: e.target.value })}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">SGST</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.sgst_amount}
                  onChange={(e) => setFormData({ ...formData, sgst_amount: e.target.value })}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">IGST</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.igst_amount}
                  onChange={(e) => setFormData({ ...formData, igst_amount: e.target.value })}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                  placeholder="0"
                />
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={formData.itc_eligible}
                onChange={(e) => setFormData({ ...formData, itc_eligible: e.target.checked })}
              />
              <span>
                Claim ITC on this GST
                <span className="block text-xs text-gray-500">
                  Untick for blocked credit u/s 17(5) — food, club, personal use, motor vehicles etc. The GST is then
                  added to the expense.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={formData.is_reverse_charge}
                onChange={(e) => setFormData({ ...formData, is_reverse_charge: e.target.checked })}
              />
              <span>
                Reverse charge (RCM)
                <span className="block text-xs text-gray-500">
                  For GTA, advocate, unregistered-dealer notified services: enter the GST you must pay; it is
                  booked to RCM payable.
                </span>
              </span>
            </label>
          </div>

          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/80 p-3 space-y-2">
            <p className="text-sm font-medium text-gray-800">TDS deducted (optional)</p>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={formData.tds_section}
                onChange={(e) => setFormData({ ...formData, tds_section: e.target.value })}
                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
              >
                <option value="">Section</option>
                {TDS_SECTION_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="0.01"
                value={formData.tds_amount}
                onChange={(e) => setFormData({ ...formData, tds_amount: e.target.value })}
                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                placeholder="TDS amount"
              />
            </div>
            <p className="text-xs text-gray-500">
              Paid / payable to the vendor = amount − TDS. TDS is credited to TDS Payable (2102).
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Date *</label>
            <input
              type="date"
              value={formData.expense_date}
              onChange={(e) => setFormData({ ...formData, expense_date: e.target.value })}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Payment</label>
            <select
              value={formData.payment_mode}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  payment_mode: e.target.value,
                  supplier_id: e.target.value === 'on_account' ? formData.supplier_id : '',
                })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="cash">Paid — Cash</option>
              <option value="upi">Paid — UPI</option>
              <option value="bank_transfer">Paid — Bank transfer</option>
              <option value="card">Paid — Card</option>
              <option value="cheque">Paid — Cheque</option>
              <option value="on_account">Bill received, not paid yet (on account)</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Use &quot;Bill received, not paid yet&quot; when you have the bill but will pay later (books: Dr
              expense, Cr Accounts Payable). Then record a payment under Payments → Out to the same supplier.
            </p>
          </div>

          {isOnAccount && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Supplier / vendor (recommended)
              </label>
              <select
                value={formData.supplier_id}
                onChange={(e) => setFormData({ ...formData, supplier_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">— Select or add under Purchases → Suppliers —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Pick the repair shop (or create the supplier first). This links the due amount so you can pay
                them from Payments → Out.
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              rows={3}
              placeholder="What was this expense for?"
            />
          </div>

          <div className="flex space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50"
            >
              {saving ? 'Adding...' : 'Add Expense'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

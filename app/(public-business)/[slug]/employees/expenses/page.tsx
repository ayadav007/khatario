'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loader2, Plus } from 'lucide-react';
import { useEmployeePortal } from '@/components/employee-portal/EmployeePortalContext';

type ExpenseRow = {
  id: string;
  expense_date: string;
  amount: number;
  description: string;
  status: string;
  category_name?: string;
};

export default function EmployeePortalExpensesPage() {
  const { session } = useEmployeePortal();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [form, setForm] = useState({
    expense_date: format(new Date(), 'yyyy-MM-dd'),
    amount: '',
    description: '',
  });

  const load = async () => {
    if (!session) return;
    setLoading(true);
    const res = await fetch('/api/employees/expenses', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      setExpenses(data.expenses ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [session]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/employees/expenses', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: session.business.id,
          employee_id: session.employee.id,
          expense_date: form.expense_date,
          amount: parseFloat(form.amount),
          description: form.description,
        }),
      });
      if (res.ok) {
        setShowForm(false);
        setForm({
          expense_date: format(new Date(), 'yyyy-MM-dd'),
          amount: '',
          description: '',
        });
        await load();
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      {!showForm ? (
        <Button className="w-full" onClick={() => setShowForm(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Submit expense
        </Button>
      ) : (
        <Card className="space-y-4 p-4">
          <h1 className="text-lg font-semibold text-text-primary">New expense</h1>
          <form onSubmit={submit} className="space-y-4">
            <Input
              label="Date"
              type="date"
              value={form.expense_date}
              onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
              required
            />
            <Input
              label="Amount (₹)"
              type="number"
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              required
            />
            <Input
              label="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              required
            />
            <div className="flex gap-2">
              <Button type="button" variant="secondary" className="flex-1" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Submit'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <div className="space-y-3">
        {expenses.length === 0 ? (
          <p className="text-center text-sm text-text-secondary">No expenses submitted yet.</p>
        ) : (
          expenses.map((exp) => (
            <Card key={exp.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-text-primary">{exp.description}</p>
                  <p className="text-sm text-text-secondary">
                    {format(new Date(exp.expense_date), 'dd MMM yyyy')}
                    {exp.category_name ? ` · ${exp.category_name}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-gray-900">
                    ₹{Number(exp.amount).toLocaleString('en-IN')}
                  </p>
                  <span className="text-xs capitalize text-text-secondary">{exp.status}</span>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

'use client';



export const dynamic = 'force-dynamic';



import { useCallback, useEffect, useState } from 'react';

import { Calendar, Edit, Loader2, Plus, Trash2, Upload } from 'lucide-react';

import { SettingsPageShell } from '@/components/settings/SettingsPageShell';

import { Button } from '@/components/ui/Button';

import { Card } from '@/components/ui/Card';

import { Input } from '@/components/ui/Input';

import { useAuth } from '@/contexts/AuthContext';

import { useToastContext } from '@/contexts/ToastContext';

import type { HolidayList } from '@/lib/hr/shift-overtime/types';



type HolidayRow = {

  id: string;

  holiday_date: string;

  holiday_name: string;

  description: string | null;

  is_recurring: boolean;

};



type Branch = { id: string; name: string };



const emptyForm = {

  holiday_date: '',

  holiday_name: '',

  is_recurring: false,

  description: '',

};



export default function HolidayListsSettingsPage() {

  const { business } = useAuth();

  const toast = useToastContext();

  const [loading, setLoading] = useState(true);

  const [lists, setLists] = useState<HolidayList[]>([]);

  const [branches, setBranches] = useState<Branch[]>([]);

  const [selectedListId, setSelectedListId] = useState('');

  const [year, setYear] = useState(new Date().getFullYear());

  const [holidays, setHolidays] = useState<HolidayRow[]>([]);

  const [csvText, setCsvText] = useState('');

  const [importing, setImporting] = useState(false);

  const [showForm, setShowForm] = useState(false);

  const [saving, setSaving] = useState(false);

  const [editingHoliday, setEditingHoliday] = useState<HolidayRow | null>(null);

  const [formData, setFormData] = useState(emptyForm);



  const loadLists = useCallback(async () => {

    if (!business?.id) return;

    setLoading(true);

    try {

      const res = await fetch(`/api/settings/holiday-lists?business_id=${business.id}`, {

        credentials: 'include',

      });

      if (res.ok) {

        const data = await res.json();

        setLists(data.lists ?? []);

        setBranches(data.branches ?? []);

        if (!selectedListId && data.lists?.length) {

          setSelectedListId(data.lists[0].id);

        }

      }

    } finally {

      setLoading(false);

    }

  }, [business?.id, selectedListId]);



  const loadHolidays = useCallback(async () => {

    if (!business?.id || !selectedListId) return;

    const params = new URLSearchParams({

      business_id: business.id,

      list_id: selectedListId,

      year: String(year),

    });

    const res = await fetch(`/api/settings/holiday-lists?${params}`, { credentials: 'include' });

    if (res.ok) {

      const data = await res.json();

      setHolidays(data.holidays ?? []);

    }

  }, [business?.id, selectedListId, year]);



  useEffect(() => {

    void loadLists();

  }, [loadLists]);



  useEffect(() => {

    void loadHolidays();

  }, [loadHolidays]);



  function openAddForm() {

    setEditingHoliday(null);

    setFormData({ ...emptyForm, holiday_date: `${year}-01-01` });

    setShowForm(true);

  }



  function openEditForm(holiday: HolidayRow) {

    setEditingHoliday(holiday);

    setFormData({

      holiday_date: holiday.holiday_date.slice(0, 10),

      holiday_name: holiday.holiday_name,

      is_recurring: holiday.is_recurring,

      description: holiday.description ?? '',

    });

    setShowForm(true);

  }



  function closeForm() {

    setShowForm(false);

    setEditingHoliday(null);

    setFormData(emptyForm);

  }



  async function createBranchList(branchId: string) {

    if (!business?.id) return;

    const branch = branches.find((b) => b.id === branchId);

    const res = await fetch('/api/settings/holiday-lists', {

      method: 'POST',

      credentials: 'include',

      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify({ business_id: business.id, branch_id: branchId, name: branch?.name }),

    });

    if (res.ok) {

      const data = await res.json();

      await loadLists();

      if (data.list?.id) setSelectedListId(data.list.id);

      toast.success('Branch holiday list created');

    }

  }



  async function handleSaveHoliday(e: React.FormEvent) {

    e.preventDefault();

    if (!business?.id || !selectedListId) return;



    setSaving(true);

    try {

      const payload = {

        holiday_date: formData.holiday_date,

        holiday_name: formData.holiday_name.trim(),

        is_recurring: formData.is_recurring,

        description: formData.description.trim() || null,

      };



      const res = editingHoliday

        ? await fetch(`/api/settings/holiday-lists/${editingHoliday.id}`, {

            method: 'PATCH',

            credentials: 'include',

            headers: { 'Content-Type': 'application/json' },

            body: JSON.stringify(payload),

          })

        : await fetch('/api/settings/holiday-lists', {

            method: 'POST',

            credentials: 'include',

            headers: { 'Content-Type': 'application/json' },

            body: JSON.stringify({

              business_id: business.id,

              action: 'create',

              list_id: selectedListId,

              ...payload,

            }),

          });



      const data = await res.json();

      if (!res.ok) {

        toast.error(data.error || 'Failed to save holiday');

        return;

      }



      toast.success(editingHoliday ? 'Holiday updated' : 'Holiday added');

      closeForm();

      await loadHolidays();

    } finally {

      setSaving(false);

    }

  }



  async function handleDelete(id: string) {

    if (!confirm('Delete this holiday?')) return;



    const res = await fetch(`/api/settings/holiday-lists/${id}`, {

      method: 'DELETE',

      credentials: 'include',

    });

    if (res.ok) {

      toast.success('Holiday deleted');

      await loadHolidays();

    } else {

      const data = await res.json();

      toast.error(data.error || 'Failed to delete holiday');

    }

  }



  async function handleImport() {

    if (!business?.id || !selectedListId || !csvText.trim()) return;

    setImporting(true);

    try {

      const res = await fetch('/api/settings/holiday-lists', {

        method: 'POST',

        credentials: 'include',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({

          business_id: business.id,

          action: 'import',

          list_id: selectedListId,

          csv: csvText,

        }),

      });

      const data = await res.json();

      if (!res.ok) {

        toast.error(data.error || 'Import failed');

        return;

      }

      toast.success(`Imported ${data.imported} holiday(s)`);

      if (data.errors?.length) toast.error(data.errors.join('; '));

      setCsvText('');

      await loadHolidays();

    } finally {

      setImporting(false);

    }

  }



  const branchesWithoutList = branches.filter(

    (b) => !lists.some((l) => l.branch_id === b.id),

  );



  return (

    <SettingsPageShell

      title="Holiday lists"

      description="Branch-specific holiday calendars. Employees inherit holidays from their branch."

      icon={Calendar}

      actions={

        selectedListId ? (

          <Button type="button" onClick={openAddForm}>

            <Plus className="mr-2 h-4 w-4" />

            Add holiday

          </Button>

        ) : undefined

      }

    >

      {loading ? (

        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />

      ) : (

        <div className="space-y-6">

          <Card className="space-y-4 p-4">

            <div className="grid gap-4 sm:grid-cols-2">

              <div>

                <label className="mb-1 block text-sm font-medium">Holiday list</label>

                <select

                  className="input w-full"

                  value={selectedListId}

                  onChange={(e) => setSelectedListId(e.target.value)}

                >

                  {lists.map((l) => (

                    <option key={l.id} value={l.id}>

                      {l.name}

                      {l.is_default ? ' (default)' : ''}

                    </option>

                  ))}

                </select>

              </div>

              <div>

                <label className="mb-1 block text-sm font-medium">Year</label>

                <select

                  className="input w-full"

                  value={year}

                  onChange={(e) => setYear(Number(e.target.value))}

                >

                  {[year - 1, year, year + 1].map((y) => (

                    <option key={y} value={y}>

                      {y}

                    </option>

                  ))}

                </select>

              </div>

            </div>



            {branchesWithoutList.length > 0 && (

              <div>

                <p className="mb-2 text-sm text-text-secondary">Create list for branch</p>

                <div className="flex flex-wrap gap-2">

                  {branchesWithoutList.map((b) => (

                    <Button key={b.id} type="button" variant="secondary" size="sm" onClick={() => void createBranchList(b.id)}>

                      {b.name}

                    </Button>

                  ))}

                </div>

              </div>

            )}

          </Card>



          {showForm && (

            <Card className="p-4">

              <h3 className="mb-4 text-sm font-semibold text-text-primary">

                {editingHoliday ? 'Edit holiday' : 'Add holiday'}

              </h3>

              <form onSubmit={(e) => void handleSaveHoliday(e)} className="space-y-4">

                <div className="grid gap-4 sm:grid-cols-2">

                  <Input

                    label="Date *"

                    type="date"

                    value={formData.holiday_date}

                    onChange={(e) => setFormData({ ...formData, holiday_date: e.target.value })}

                    required

                  />

                  <Input

                    label="Holiday name *"

                    value={formData.holiday_name}

                    onChange={(e) => setFormData({ ...formData, holiday_name: e.target.value })}

                    required

                  />

                </div>

                <label className="flex items-center gap-2 text-sm text-text-primary">

                  <input

                    type="checkbox"

                    checked={formData.is_recurring}

                    onChange={(e) => setFormData({ ...formData, is_recurring: e.target.checked })}

                  />

                  Recurring (same date every year, e.g. Independence Day)

                </label>

                <div>

                  <label className="mb-1 block text-sm font-medium text-text-secondary">Description</label>

                  <textarea

                    className="input min-h-[80px] w-full"

                    value={formData.description}

                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}

                    rows={2}

                  />

                </div>

                <div className="flex justify-end gap-2">

                  <Button type="button" variant="ghost" onClick={closeForm}>

                    Cancel

                  </Button>

                  <Button type="submit" disabled={saving}>

                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}

                    Save

                  </Button>

                </div>

              </form>

            </Card>

          )}



          <Card className="p-4">

            <h3 className="mb-3 text-sm font-semibold text-text-primary">Holidays in {year}</h3>

            {holidays.length === 0 ? (

              <p className="text-sm text-text-secondary">

                No holidays for this list and year. Use <strong>Add holiday</strong> or import CSV below.

              </p>

            ) : (

              <div className="overflow-x-auto">

                <table className="w-full text-sm">

                  <thead>

                    <tr className="border-b border-border text-left">

                      <th className="py-2 pr-4 font-medium">Date</th>

                      <th className="py-2 pr-4 font-medium">Name</th>

                      <th className="py-2 pr-4 font-medium">Type</th>

                      <th className="py-2 font-medium">Description</th>

                      <th className="py-2 text-right font-medium">Actions</th>

                    </tr>

                  </thead>

                  <tbody>

                    {holidays.map((h) => (

                      <tr key={h.id} className="border-b border-border">

                        <td className="py-2 pr-4 whitespace-nowrap">{h.holiday_date}</td>

                        <td className="py-2 pr-4 font-medium">{h.holiday_name}</td>

                        <td className="py-2 pr-4 text-text-secondary">

                          {h.is_recurring ? 'Recurring' : 'One-time'}

                        </td>

                        <td className="py-2 pr-4 text-text-secondary">{h.description ?? '—'}</td>

                        <td className="py-2 text-right">

                          <div className="flex justify-end gap-1">

                            <Button type="button" size="sm" variant="ghost" onClick={() => openEditForm(h)}>

                              <Edit className="h-4 w-4" />

                            </Button>

                            <Button type="button" size="sm" variant="ghost" onClick={() => void handleDelete(h.id)}>

                              <Trash2 className="h-4 w-4 text-red-600" />

                            </Button>

                          </div>

                        </td>

                      </tr>

                    ))}

                  </tbody>

                </table>

              </div>

            )}

          </Card>



          <Card className="space-y-3 p-4">

            <h3 className="text-sm font-semibold text-text-primary">Import CSV</h3>

            <p className="text-xs text-text-secondary">

              Bulk import: header row <code>holiday_date,holiday_name,description</code> (description optional)

            </p>

            <textarea

              className="input min-h-[120px] w-full font-mono text-xs"

              value={csvText}

              onChange={(e) => setCsvText(e.target.value)}

              placeholder={'holiday_date,holiday_name,description\n2026-01-26,Republic Day,'}

            />

            <Button type="button" disabled={importing || !csvText.trim()} onClick={() => void handleImport()}>

              {importing ? (

                <Loader2 className="mr-2 h-4 w-4 animate-spin" />

              ) : (

                <Upload className="mr-2 h-4 w-4" />

              )}

              Import

            </Button>

          </Card>

        </div>

      )}

    </SettingsPageShell>

  );

}


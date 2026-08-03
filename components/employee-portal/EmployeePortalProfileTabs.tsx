'use client';

import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { Loader2, FileText, ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { useEmployeePortal } from '@/components/employee-portal/EmployeePortalContext';
import { EmployeePortalChangePassword } from '@/components/employee-portal/EmployeePortalChangePassword';
import { EmployeePortalResignationPanel } from '@/components/employee-portal/EmployeePortalResignationPanel';

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'job', label: 'Job' },
  { id: 'documents', label: 'Documents' },
  { id: 'security', label: 'Security' },
  { id: 'resignation', label: 'Resignation' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function EmployeePortalProfileTabs() {
  const { slug, session } = useEmployeePortal();
  const [tab, setTab] = useState<TabId>('profile');
  const [loading, setLoading] = useState(true);
  const [employee, setEmployee] = useState<Record<string, unknown> | null>(null);
  const [documents, setDocuments] = useState<
    Array<{ id: string; document_name: string; document_type: string; file_url: string }>
  >([]);

  useEffect(() => {
    if (!session) return;
    void (async () => {
      setLoading(true);
      const res = await fetch('/api/public/employee/portal/profile', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setEmployee(data.employee ?? null);
        setDocuments(data.documents ?? []);
      }
      setLoading(false);
    })();
  }, [session]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  const base = `/${slug}/employees/profile`;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-gray-200 text-lg font-bold text-gray-700">
          {String(employee?.user_name ?? session?.employee.name ?? '?')
            .charAt(0)
            .toUpperCase()}
        </div>
        <div>
          <h1 className="text-lg font-semibold text-gray-900">
            {String(employee?.user_name ?? session?.employee.name)}
          </h1>
          <p className="text-sm text-text-secondary">
            {String(employee?.designation ?? '')}
            {employee?.department ? ` · ${employee.department}` : ''}
          </p>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={clsx(
              'shrink-0 border-b-2 px-3 py-2 text-sm font-medium',
              tab === t.id
                ? 'border-primary-600 text-text-primary'
                : 'border-transparent text-text-secondary',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <Card className="divide-y divide-border p-0 text-sm">
          {renderRow('Employee ID', employee?.employee_code)}
          {renderRow('Email', employee?.user_email)}
          {renderRow('Phone', employee?.user_phone)}
          {renderRow('Joining date', formatDate(employee?.joining_date))}
        </Card>
      )}

      {tab === 'job' && (
        <Card className="divide-y divide-border p-0 text-sm">
          {renderRow('Designation', employee?.designation)}
          {renderRow('Department', employee?.department)}
          {renderRow('Employment type', employee?.employment_type)}
          {renderRow(
            'Reporting manager',
            employee?.reporting_manager_name
              ? `${employee.reporting_manager_code} – ${employee.reporting_manager_name}`
              : null,
          )}
        </Card>
      )}

      {tab === 'documents' && (
        <div className="space-y-2">
          {documents.length === 0 ? (
            <p className="text-sm text-text-muted">No documents on file.</p>
          ) : (
            documents.map((d) => (
              <Card key={d.id} className="flex items-center justify-between p-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-text-muted" />
                  <div>
                    <p className="text-sm font-medium text-text-primary">{d.document_name}</p>
                    <p className="text-xs capitalize text-text-muted">{d.document_type}</p>
                  </div>
                </div>
                <a href={d.file_url} target="_blank" rel="noopener noreferrer" className="text-text-muted">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Card>
            ))
          )}
        </div>
      )}

      {tab === 'security' && (
        <div>
          <EmployeePortalChangePassword />
        </div>
      )}

      {tab === 'resignation' && <EmployeePortalResignationPanel />}
    </div>
  );
}

function renderRow(label: string, value: unknown) {
  if (value == null || value === '') return null;
  return (
    <div className="flex justify-between gap-4 px-4 py-3">
      <span className="text-text-secondary">{label}</span>
      <span className="text-right font-medium capitalize text-text-primary">{String(value)}</span>
    </div>
  );
}

function formatDate(value: unknown) {
  if (!value) return null;
  const s = String(value).slice(0, 10);
  try {
    return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return s;
  }
}

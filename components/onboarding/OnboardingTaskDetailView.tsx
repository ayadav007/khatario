'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, ExternalLink, Loader2, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { clsx } from 'clsx';
import { identityDocTitle } from '@/lib/hr/recruitment/onboarding/templates';
import { taskStatusLabel } from '@/lib/hr/recruitment/onboarding/validation';
import {
  IDENTITY_FORM_SPECS,
  identityFormFromStored,
} from '@/lib/hr/recruitment/onboarding/identity-fields';
import type { IdentityDocKey } from '@/lib/hr/recruitment/onboarding/types';
import { CANDIDATE_SELF_STATUSES } from '@/lib/hr/recruitment/onboarding/types';

export type OnboardingTaskDetailData = {
  task: Record<string, unknown>;
  identityDocs: Record<string, unknown>[];
  entries: Record<string, unknown>[];
  files: Record<string, unknown>[];
  progress: { complete: number; required: number; canSubmit: boolean };
};

type Props = {
  data: OnboardingTaskDetailData;
  editable: boolean;
  taskId?: string;
  showSelfStatus?: boolean;
  onSelfStatusChange?: (value: string) => Promise<void>;
  onSaved?: () => void;
  error?: string | null;
  footer?: React.ReactNode;
};

export function OnboardingTaskDetailView({
  data,
  editable,
  taskId,
  showSelfStatus = false,
  onSelfStatusChange,
  onSaved,
  error,
  footer,
}: Props) {
  const task = data.task;
  const taskType = String(task?.task_type ?? '');
  const config = (task?.config_json ?? {}) as Record<string, unknown>;
  const [activeTab, setActiveTab] = useState('aadhaar');
  const [slotIndex, setSlotIndex] = useState(0);

  const identityMap = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    for (const d of data.identityDocs ?? []) {
      map.set(String(d.document_key), d);
    }
    return map;
  }, [data.identityDocs]);

  const title = taskPageTitle(String(task.name), taskType);
  const instruction =
    taskType === 'id_proof_bundle'
      ? `Upload any ${config.min_complete} of following documents`
      : taskType === 'single_identity_doc'
        ? 'Upload any 1 of following documents'
        : String(task.instruction_text ?? '');

  return (
    <div className="rounded-xl border border-border bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
          {taskStatusLabel(String(task.status))}
        </span>
        {showSelfStatus ? (
          <select
            className="rounded-md border border-border px-3 py-1.5 text-sm"
            value={String(task.candidate_self_status ?? 'not_started')}
            disabled={!editable}
            onChange={(e) => void onSelfStatusChange?.(e.target.value)}
          >
            {CANDIDATE_SELF_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === 'not_started' ? 'Not Started' : s === 'in_progress' ? 'In progress' : 'Completed'}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">{title}</h1>
          {instruction ? <p className="mt-1 text-sm text-text-secondary">{instruction}</p> : null}
          {task.reviewer_notes ? (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              HR note: {String(task.reviewer_notes)}
            </p>
          ) : null}
        </div>
        <ProgressRing complete={data.progress.complete} required={data.progress.required} />
      </div>

      {taskType === 'id_proof_bundle' || taskType === 'single_identity_doc' ? (
        <IdentityTaskBody
          taskId={taskId}
          taskType={taskType}
          config={config}
          identityMap={identityMap}
          editable={editable}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onSaved={onSaved}
        />
      ) : null}

      {taskType === 'repeating_file_slots' ? (
        <SalarySlotsBody
          taskId={taskId}
          slotCount={Number(config.slot_count ?? 3)}
          entries={data.entries}
          files={data.files}
          slotIndex={slotIndex}
          setSlotIndex={setSlotIndex}
          editable={editable}
          onSaved={onSaved}
        />
      ) : null}

      {taskType === 'attachments_checklist' ? (
        <AttachmentsBody
          taskId={taskId}
          labels={(config.accepted_labels as string[]) ?? []}
          labelHints={(config.label_hints as Record<string, string>) ?? {}}
          uploadHint={config.upload_hint ? String(config.upload_hint) : undefined}
          sectionTitle={config.section_title ? String(config.section_title) : undefined}
          files={data.files}
          editable={editable}
          onSaved={onSaved}
        />
      ) : null}

      {taskType === 'employment_record' ? (
        <EmploymentBody
          taskId={taskId}
          labels={(config.checklist_labels as string[]) ?? []}
          labelHints={(config.label_hints as Record<string, string>) ?? {}}
          fieldHints={(config.field_hints as Record<string, string>) ?? {}}
          uploadHint={config.upload_hint ? String(config.upload_hint) : undefined}
          sectionTitle={config.section_title ? String(config.section_title) : 'Current / last employer'}
          entries={data.entries}
          files={data.files}
          editable={editable}
          onSaved={onSaved}
        />
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {(String(task.status) === 'submitted' || String(task.status) === 'approved') ? (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {String(task.status) === 'approved'
            ? 'Task approved by recruiter'
            : 'Task uploaded, waiting to be verified by recruiter'}
        </div>
      ) : null}

      {footer}
    </div>
  );
}

function ProgressRing({ complete, required }: { complete: number; required: number }) {
  const pct = required > 0 ? Math.min(100, Math.round((complete / required) * 100)) : 0;
  return (
    <div className="flex items-center gap-2 text-sm text-text-secondary">
      <div
        className="h-10 w-10 rounded-full border-4 border-green-500 flex items-center justify-center text-xs font-semibold text-green-700"
        style={{ background: `conic-gradient(#16a34a ${pct}%, #e5e7eb 0)` }}
      >
        {complete}/{required}
      </div>
      <span>
        {complete} of {required} uploaded
      </span>
    </div>
  );
}

function IdentityTaskBody({
  taskId,
  taskType,
  config,
  identityMap,
  editable,
  activeTab,
  setActiveTab,
  onSaved,
}: {
  taskId?: string;
  taskType: string;
  config: Record<string, unknown>;
  identityMap: Map<string, Record<string, unknown>>;
  editable: boolean;
  activeTab: string;
  setActiveTab: (v: string) => void;
  onSaved?: () => void;
}) {
  const options =
    taskType === 'single_identity_doc'
      ? [String(config.document_key)]
      : ((config.options as string[]) ?? []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 border-b border-border">
        {options.map((key) => {
          const done = identityMap.get(key)?.is_complete;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={clsx(
                'pb-2 text-sm font-medium border-b-2 -mb-px',
                activeTab === key ? 'border-blue-600 text-text-primary' : 'border-transparent text-text-secondary',
              )}
            >
              {identityDocTitle(key)}
              {done ? ' ✓' : ''}
            </button>
          );
        })}
      </div>
      <IdentityForm
        taskId={taskId}
        docKey={activeTab as IdentityDocKey}
        existing={identityMap.get(activeTab)}
        editable={editable}
        onSaved={onSaved}
      />
    </div>
  );
}

function IdentityForm({
  taskId,
  docKey,
  existing,
  editable,
  onSaved,
}: {
  taskId?: string;
  docKey: IdentityDocKey;
  existing?: Record<string, unknown>;
  editable: boolean;
  onSaved?: () => void;
}) {
  const fields = (existing?.fields_json ?? {}) as Record<string, unknown>;
  const [form, setForm] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const specs = IDENTITY_FORM_SPECS[docKey];

  useEffect(() => {
    setForm(identityFormFromStored(docKey, fields));
  }, [existing, docKey]);

  const save = async () => {
    if (!taskId) return;
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    fd.append('fields', JSON.stringify(form));
    if (file) fd.append('file', file);
    try {
      const res = await fetch(
        `/api/public/candidate/session/tasks/${taskId}/identity/${docKey}`,
        { method: 'POST', credentials: 'include', body: fd },
      );
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || 'Save failed');
        return;
      }
      onSaved?.();
    } finally {
      setBusy(false);
    }
  };

  const ro = !editable;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {specs.map((spec) => {
          if (spec.type === 'gender') {
            return (
              <div key={spec.key} className="sm:col-span-2">
                <label className="text-sm text-text-secondary">{spec.label}</label>
                <select
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm disabled:bg-gray-50"
                  value={form[spec.key] ?? ''}
                  disabled={ro}
                  onChange={(e) => setForm({ ...form, [spec.key]: e.target.value })}
                >
                  <option value="">Select</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>
            );
          }
          if (spec.type === 'textarea') {
            return (
              <div key={spec.key} className="sm:col-span-2">
                <label className="text-sm text-text-secondary">{spec.label}</label>
                <textarea
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm disabled:bg-gray-50"
                  rows={3}
                  value={form[spec.key] ?? ''}
                  readOnly={ro}
                  onChange={(e) => setForm({ ...form, [spec.key]: e.target.value })}
                />
              </div>
            );
          }
          return (
            <Field
              key={spec.key}
              label={spec.label}
              type={spec.type === 'date' ? 'date' : 'text'}
              value={form[spec.key] ?? ''}
              onChange={(v) =>
                setForm({
                  ...form,
                  [spec.key]: spec.uppercase ? v.toUpperCase() : v,
                })
              }
              readOnly={ro}
            />
          );
        })}
      </div>

      {existing?.file_name ? (
        <FileChip name={String(existing.file_name)} url={existing.file_url ? String(existing.file_url) : undefined} />
      ) : null}

      {editable && taskId ? (
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm">
            <span className="text-text-secondary">Upload file</span>
            <input
              type="file"
              accept=".pdf,image/*"
              className="mt-1 block text-sm"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : `Save ${identityDocTitle(docKey)}`}
          </Button>
        </div>
      ) : null}
      {err ? <p className="text-sm text-red-600">{err}</p> : null}
    </div>
  );
}

function SalarySlotsBody({
  taskId,
  slotCount,
  entries,
  files,
  slotIndex,
  setSlotIndex,
  editable,
  onSaved,
}: {
  taskId?: string;
  slotCount: number;
  entries: Record<string, unknown>[];
  files: Record<string, unknown>[];
  slotIndex: number;
  setSlotIndex: (n: number) => void;
  editable: boolean;
  onSaved?: () => void;
}) {
  const entryKey = `slot_${slotIndex + 1}`;
  const entry = entries.find((e) => e.entry_key === entryKey);
  const fields = (entry?.fields_json ?? {}) as Record<string, string>;
  const [company, setCompany] = useState('');
  const [month, setMonth] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCompany(fields.company_name ?? '');
    setMonth(fields.month_label ?? '');
  }, [entry, slotIndex]);

  const entryFile = files.find((f) => {
    const eid = entry?.id;
    return eid && f.entry_id === eid;
  });

  const saveFields = async () => {
    if (!taskId) return;
    await fetch(`/api/public/candidate/session/tasks/${taskId}/files`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entry_key: entryKey,
        sort_order: slotIndex,
        fields: { company_name: company, month_label: month },
      }),
    });
    onSaved?.();
  };

  const uploadFile = async (file: File) => {
    if (!taskId) return;
    setBusy(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('entry_key', entryKey);
    fd.append('sort_order', String(slotIndex));
    await fetch(`/api/public/candidate/session/tasks/${taskId}/files`, {
      method: 'POST',
      credentials: 'include',
      body: fd,
    });
    await saveFields();
    setBusy(false);
    onSaved?.();
  };

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-text-primary">
        3 months Salary Slip · Viewing {slotIndex + 1}/{slotCount}
        <button type="button" className="ml-2 text-blue-600" disabled={slotIndex <= 0} onClick={() => setSlotIndex(slotIndex - 1)}>
          ‹
        </button>
        <button
          type="button"
          className="ml-1 text-blue-600"
          disabled={slotIndex >= slotCount - 1}
          onClick={() => setSlotIndex(slotIndex + 1)}
        >
          ›
        </button>
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company Name" value={company} onChange={setCompany} readOnly={!editable} />
        <Field
          label="Months for which the payslips are submitted"
          value={month}
          onChange={setMonth}
          readOnly={!editable}
        />
      </div>
      {entryFile ? (
        <FileChip name={String(entryFile.file_name)} url={entryFile.file_url ? String(entryFile.file_url) : undefined} />
      ) : null}
      {editable && taskId ? (
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => void saveFields()}>
            Save details
          </Button>
          <label className="text-sm">
            <input
              type="file"
              accept=".pdf,image/*"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadFile(f);
              }}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

function taskPageTitle(name: string, taskType: string): string {
  if (taskType === 'employment_record') return `${name} – Employment details`;
  return `${name} – Document submission`;
}

function HintBanner({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">{children}</p>
  );
}

function DocumentChecklist({
  labels,
  labelHints,
}: {
  labels: string[];
  labelHints: Record<string, string>;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-text-primary">Suggested documents</p>
      <ul className="space-y-3">
        {labels.map((label) => (
          <li key={label} className="rounded-lg border border-border bg-gray-50 px-3 py-2">
            <p className="text-sm font-medium text-text-primary">{label}</p>
            {labelHints[label] ? (
              <p className="mt-0.5 text-xs text-text-secondary">{labelHints[label]}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AttachmentsBody({
  taskId,
  labels,
  labelHints,
  uploadHint,
  sectionTitle,
  files,
  editable,
  onSaved,
}: {
  taskId?: string;
  labels: string[];
  labelHints: Record<string, string>;
  uploadHint?: string;
  sectionTitle?: string;
  files: Record<string, unknown>[];
  editable: boolean;
  onSaved?: () => void;
}) {
  const upload = async (file: File) => {
    if (!taskId) return;
    const fd = new FormData();
    fd.append('file', file);
    await fetch(`/api/public/candidate/session/tasks/${taskId}/files`, {
      method: 'POST',
      credentials: 'include',
      body: fd,
    });
    onSaved?.();
  };

  return (
    <div className="space-y-4">
      {sectionTitle ? (
        <h3 className="text-sm font-semibold text-text-primary">{sectionTitle}</h3>
      ) : null}
      <DocumentChecklist labels={labels} labelHints={labelHints} />
      <div>
        <p className="text-sm font-medium text-text-primary">Your uploads ({String(files.length)})</p>
        <div className="mt-2 space-y-2">
          {files.map((f) => (
            <FileChip
              key={String(f.id)}
              name={String(f.file_name)}
              url={f.file_url ? String(f.file_url) : undefined}
            />
          ))}
          {files.length === 0 ? (
            <p className="text-xs text-text-muted">No files uploaded yet.</p>
          ) : null}
        </div>
      </div>
      {editable && taskId ? (
        <div className="space-y-2">
          {uploadHint ? <HintBanner>{uploadHint}</HintBanner> : null}
          <label className="block text-sm text-text-secondary">
            <span className="font-medium text-text-primary">Add file</span>
            <span className="mt-0.5 block text-xs">PDF, JPEG, PNG, or WebP — max 5 MB each</span>
            <input
              type="file"
              accept=".pdf,image/*"
              className="mt-1 block w-full text-sm"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

function EmploymentBody({
  taskId,
  labels,
  labelHints,
  fieldHints,
  uploadHint,
  sectionTitle,
  entries,
  files,
  editable,
  onSaved,
}: {
  taskId?: string;
  labels: string[];
  labelHints: Record<string, string>;
  fieldHints: Record<string, string>;
  uploadHint?: string;
  sectionTitle: string;
  entries: Record<string, unknown>[];
  files: Record<string, unknown>[];
  editable: boolean;
  onSaved?: () => void;
}) {
  const entry = entries.find((e) => e.entry_key === 'employment_1');
  const fields = (entry?.fields_json ?? {}) as Record<string, string>;
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    setForm({
      company_name: fields.company_name ?? '',
      job_title: fields.job_title ?? '',
      date_of_joining: fields.date_of_joining?.slice?.(0, 10) ?? '',
      date_of_relieving: fields.date_of_relieving?.slice?.(0, 10) ?? '',
      location: fields.location ?? '',
      description: fields.description ?? '',
    });
  }, [entry]);

  const save = async () => {
    if (!taskId) return;
    await fetch(`/api/public/candidate/session/tasks/${taskId}/files`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry_key: 'employment_1', fields: form, sort_order: 0 }),
    });
    onSaved?.();
  };

  const upload = async (file: File) => {
    if (!taskId) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('entry_key', 'employment_1');
    await fetch(`/api/public/candidate/session/tasks/${taskId}/files`, {
      method: 'POST',
      credentials: 'include',
      body: fd,
    });
    onSaved?.();
  };

  return (
    <div className="space-y-4">
      <DocumentChecklist labels={labels} labelHints={labelHints} />
      <h3 className="text-sm font-semibold text-text-primary">{sectionTitle}</h3>
      <p className="text-xs text-text-secondary">
        Enter details for the company you most recently worked at (or where you work today).
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Company name"
          value={form.company_name}
          onChange={(v) => setForm({ ...form, company_name: v })}
          readOnly={!editable}
          placeholder={fieldHints.company_name}
        />
        <Field
          label="Job title"
          value={form.job_title}
          onChange={(v) => setForm({ ...form, job_title: v })}
          readOnly={!editable}
          placeholder={fieldHints.job_title}
        />
        <Field
          label="Date of joining"
          type="date"
          value={form.date_of_joining}
          onChange={(v) => setForm({ ...form, date_of_joining: v })}
          readOnly={!editable}
          hint={fieldHints.date_of_joining}
        />
        <Field
          label="Date of relieving"
          type="date"
          value={form.date_of_relieving}
          onChange={(v) => setForm({ ...form, date_of_relieving: v })}
          readOnly={!editable}
          hint={fieldHints.date_of_relieving}
        />
        <Field
          label="Location"
          value={form.location}
          onChange={(v) => setForm({ ...form, location: v })}
          readOnly={!editable}
          placeholder={fieldHints.location}
        />
        <div className="sm:col-span-2">
          <label className="text-sm text-text-secondary">Description</label>
          {fieldHints.description ? (
            <p className="mt-0.5 text-xs text-text-muted">{fieldHints.description}</p>
          ) : null}
          <textarea
            className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm disabled:bg-gray-50"
            rows={2}
            value={form.description}
            readOnly={!editable}
            placeholder={fieldHints.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
      </div>
      <div>
        <p className="text-sm font-medium text-text-primary">Supporting documents ({String(files.length)})</p>
        <div className="mt-2 space-y-2">
          {files.map((f) => (
            <FileChip key={String(f.id)} name={String(f.file_name)} url={f.file_url ? String(f.file_url) : undefined} />
          ))}
          {files.length === 0 ? (
            <p className="text-xs text-text-muted">Upload at least one document after saving details.</p>
          ) : null}
        </div>
      </div>
      {editable && taskId ? (
        <div className="flex flex-wrap gap-3">
          <Button size="sm" variant="secondary" onClick={() => void save()}>
            Save employment details
          </Button>
          <div className="w-full space-y-2 sm:w-auto sm:flex-1">
            {uploadHint ? <HintBanner>{uploadHint}</HintBanner> : null}
            <label className="block text-sm">
              <span className="font-medium text-text-primary">Upload document</span>
              <span className="mt-0.5 block text-xs text-text-muted">PDF, JPEG, PNG, or WebP</span>
              <input
                type="file"
                accept=".pdf,image/*"
                className="mt-1 block w-full text-sm"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                }}
              />
            </label>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  readOnly,
  type = 'text',
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  type?: string;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="text-sm text-text-secondary">{label}</label>
      {hint && type !== 'date' ? <p className="mt-0.5 text-xs text-text-muted">{hint}</p> : null}
      <Input
        type={type}
        className="mt-1 disabled:bg-gray-50"
        value={value}
        readOnly={readOnly}
        disabled={readOnly}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && type === 'date' ? <p className="mt-0.5 text-xs text-text-muted">{hint}</p> : null}
    </div>
  );
}

function FileChip({ name, url }: { name: string; url?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-gray-50 px-4 py-3 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <Paperclip className="h-4 w-4 shrink-0 text-text-muted" />
        <span className="truncate">{name}</span>
      </div>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-blue-600 hover:text-blue-700"
        >
          View <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : null}
    </div>
  );
}

export function OnboardingTaskDetailSkeleton() {
  return (
    <div className="flex min-h-[200px] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
    </div>
  );
}

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { EditableCard, SummaryList } from '@/components/settings/business-profile/ProfileSection';

type Kind = 'msme' | 'tan' | 'din';

type Entry = {
  number: string | null;
  file_name: string | null;
  mime_type: string | null;
};

type Payload = Record<Kind, Entry>;

const EMPTY: Payload = {
  msme: { number: null, file_name: null, mime_type: null },
  tan: { number: null, file_name: null, mime_type: null },
  din: { number: null, file_name: null, mime_type: null },
};

const FIELDS: { kind: Kind; label: string; placeholder: string; hint: string; maxLength: number }[] = [
  {
    kind: 'msme',
    label: 'Udyam / MSME',
    placeholder: 'UDYAM-KA-00-0000000',
    hint: 'Udyam registration certificate.',
    maxLength: 19,
  },
  {
    kind: 'tan',
    label: 'TAN',
    placeholder: 'BLRA12345B',
    hint: 'TAN allotment letter.',
    maxLength: 10,
  },
  {
    kind: 'din',
    label: 'DIN',
    placeholder: '00123456',
    hint: 'DIN of the director who signs. One number for the company.',
    maxLength: 8,
  },
];

export function RegistrationDetails() {
  const { business, refresh } = useAuth();
  const toast = useToastContext();
  const [saved, setSaved] = useState<Payload>(EMPTY);
  const [form, setForm] = useState({ msme: '', tan: '', din: '' });
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyKind, setBusyKind] = useState<Kind | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Kind, string>>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const res = await fetch('/api/business/registration-documents', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(data.error || 'Could not load registration details');
        return;
      }
      const next: Payload = {
        msme: data.msme || EMPTY.msme,
        tan: data.tan || EMPTY.tan,
        din: data.din || EMPTY.din,
      };
      setSaved(next);
      setForm({
        msme: next.msme.number || '',
        tan: next.tan.number || '',
        din: next.din.number || '',
      });
      setLoadError(null);
    } catch {
      setLoadError('Could not load registration details');
    } finally {
      setLoading(false);
    }
  }, [business?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveNumbers = async () => {
    if (!business?.id) return;
    setSaving(true);
    setErrors({});
    try {
      const res = await fetch(`/api/business/${business.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          udyam_number: form.msme,
          tan: form.tan,
          din: form.din,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = data.code as string | undefined;
        if (code === 'INVALID_UDYAM') setErrors({ msme: data.error });
        else if (code === 'INVALID_TAN') setErrors({ tan: data.error });
        else if (code === 'INVALID_DIN') setErrors({ din: data.error });
        else toast.error(data.error || 'Could not save registration numbers');
        return;
      }
      toast.success('Registration numbers saved');
      setEditing(false);
      await refresh();
      await load();
    } catch {
      toast.error('Could not save registration numbers');
    } finally {
      setSaving(false);
    }
  };

  const upload = async (kind: Kind, file: File) => {
    setBusyKind(kind);
    try {
      const body = new FormData();
      body.set('kind', kind);
      body.set('file', file);
      const res = await fetch('/api/business/registration-documents', {
        method: 'POST',
        credentials: 'include',
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Could not upload the certificate');
        return;
      }
      toast.success('Certificate saved');
      await load();
    } catch {
      toast.error('Could not upload the certificate');
    } finally {
      setBusyKind(null);
    }
  };

  const remove = async (kind: Kind) => {
    const label = FIELDS.find((field) => field.kind === kind)?.label || 'certificate';
    if (!confirm(`Remove the ${label} certificate? The number stays.`)) return;
    setBusyKind(kind);
    try {
      const res = await fetch(`/api/business/registration-documents/${kind}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Could not remove the certificate');
        return;
      }
      toast.success('Certificate removed');
      await load();
    } catch {
      toast.error('Could not remove the certificate');
    } finally {
      setBusyKind(null);
    }
  };

  return (
    <EditableCard
      title="MSME, TAN and DIN"
      isEditing={editing}
      canEdit={!loading && editing === false}
      onEdit={() => {
        setErrors({});
        setEditing(true);
      }}
      onCancel={() => {
        setForm({
          msme: saved.msme.number || '',
          tan: saved.tan.number || '',
          din: saved.din.number || '',
        });
        setErrors({});
        setEditing(false);
      }}
      onSave={() => void saveNumbers()}
      saving={saving}
      summary={
        <div className="space-y-3">
          {loadError ? <p className="text-sm text-red-600">{loadError}</p> : null}
          <SummaryList
            rows={FIELDS.map((field) => ({
              label: field.label,
              value: saved[field.kind].number || '',
            }))}
          />
          {!loading && (
            <ul className="space-y-2">
              {FIELDS.map((field) => (
                <li key={field.kind} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-text-secondary">
                    {field.label} certificate:{' '}
                    <span className="text-text-primary">
                      {saved[field.kind].file_name || 'Not uploaded'}
                    </span>
                  </span>
                  {saved[field.kind].file_name ? (
                    <a
                      href={`/api/business/registration-documents/${field.kind}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-primary-700"
                    >
                      View
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      }
    >
      <div className="space-y-5">
        {FIELDS.map((field) => (
          <div key={field.kind} className="space-y-2">
            <Input
              label={field.label}
              value={form[field.kind]}
              onChange={(e) => setForm((prev) => ({ ...prev, [field.kind]: e.target.value.toUpperCase() }))}
              placeholder={field.placeholder}
              maxLength={field.maxLength}
              error={errors[field.kind]}
            />
            <CertificateActions
              kind={field.kind}
              hint={field.hint}
              entry={saved[field.kind]}
              busy={busyKind === field.kind}
              disabled={busyKind !== null}
              onPick={(file) => void upload(field.kind, file)}
              onRemove={() => void remove(field.kind)}
            />
          </div>
        ))}
      </div>
    </EditableCard>
  );
}

function CertificateActions({
  kind,
  hint,
  entry,
  busy,
  disabled,
  onPick,
  onRemove,
}: {
  kind: Kind;
  hint: string;
  entry: Entry;
  busy: boolean;
  disabled: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-lg border border-border px-3 py-2.5 dark:border-border-dark">
      <div className="flex items-start gap-2">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-text-primary">{entry.file_name || 'No certificate uploaded'}</p>
          <p className="text-xs text-text-secondary">{hint} PDF, JPEG, PNG, or WebP, up to 5 MB.</p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onPick(file);
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          isLoading={busy}
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          {!busy && <Upload className="mr-1.5 h-3.5 w-3.5" />}
          {entry.file_name ? 'Replace' : 'Upload'}
        </Button>
        {entry.file_name ? (
          <>
            <a
              href={`/api/business/registration-documents/${kind}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center px-2 text-sm font-medium text-primary-700"
            >
              View
            </a>
            <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onRemove}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Remove
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

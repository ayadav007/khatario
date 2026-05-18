'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Plus, Copy, Trash2, Pencil, Lock, Loader2, FileText } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { useFeatureRegistry } from '@/hooks/useFeatureRegistry';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';
import { LabelPreview } from '@/components/labels/LabelPreview';
import { Button } from '@/components/ui/Button';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

interface LabelTemplate {
  id: string;
  business_id: string | null;
  name: string;
  description: string | null;
  format: 'A4_SHEET' | 'ROLL';
  width_mm: number;
  height_mm: number;
  columns: number | null;
  rows_count: number | null;
  gap_x_mm: number;
  gap_y_mm: number;
  margin_top_mm: number;
  margin_left_mm: number;
  symbology: string;
  fields: any[];
  is_system: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const SAMPLE_DATA = {
  businessName: 'Your Store',
  brand: 'Parle',
  productName: 'Parle-G Biscuit',
  variantName: null,
  barcode: '8901234567894',
  barcodeType: 'EAN13' as const,
  price: 10,
  mrp: 12,
  batchNumber: 'B2601',
  mfgDate: new Date('2026-04-01'),
  expiryDate: new Date('2027-04-01'),
  netQuantity: '100 g',
  fssai: '12345678901234',
  countryOfOrigin: 'IN',
  hsn: '1905',
};

export default function LabelTemplatesPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const { hasFeature, loading: featuresLoading } = useFeatureRegistry();

  const hasAccess = hasFeature('barcode_label_templates');

  const [templates, setTemplates] = useState<LabelTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!business?.id || !user?.id) return;
    try {
      setLoading(true);
      const res = await fetch(
        `/api/label-templates?business_id=${business.id}&user_id=${user.id}`
      );
      if (!res.ok) {
        const err = await safeJsonParse(res);
        throw new Error(getApiErrorMessage(err, 'Failed to load templates'));
      }
      const data = await res.json();
      setTemplates(data.templates || []);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, [business?.id, user?.id, toast]);

  useEffect(() => {
    if (!featuresLoading && hasAccess) load();
  }, [featuresLoading, hasAccess, load]);

  async function handleDuplicate(tpl: LabelTemplate) {
    if (!business?.id || !user?.id) return;
    try {
      setBusyId(tpl.id);
      const res = await fetch(
        `/api/label-templates/${tpl.id}/duplicate?business_id=${business.id}&user_id=${user.id}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ business_id: business.id, user_id: user.id }),
        }
      );
      const data = await safeJsonParse<{ template: { name?: string } }>(res);
      if (!res.ok) throw new Error(getApiErrorMessage(data, 'Duplicate failed'));
      toast.success(`Created "${data?.template?.name ?? 'template'}"`);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Duplicate failed');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(tpl: LabelTemplate) {
    if (!business?.id || !user?.id) return;
    if (!confirm(`Delete template "${tpl.name}"? This cannot be undone.`))
      return;
    try {
      setBusyId(tpl.id);
      const res = await fetch(
        `/api/label-templates/${tpl.id}?business_id=${business.id}&user_id=${user.id}`,
        { method: 'DELETE' }
      );
      const data = await safeJsonParse(res);
      if (!res.ok) throw new Error(getApiErrorMessage(data, 'Delete failed'));
      toast.success('Template deleted');
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Delete failed');
    } finally {
      setBusyId(null);
    }
  }

  if (featuresLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-text-secondary" />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <FileText className="w-12 h-12 mx-auto text-text-secondary mb-4" />
        <h2 className="text-xl font-semibold text-text-primary">
          Label Template Designer not available
        </h2>
        <p className="text-text-secondary mt-2">
          Your current plan does not include the Label Template Designer.
          Upgrade to customise barcode labels.
        </p>
      </div>
    );
  }

  const systemTemplates = templates.filter((t) => t.is_system);
  const customTemplates = templates.filter((t) => !t.is_system);

  return (
    <div className={`${SETTINGS_CONTENT_WIDTH} mx-auto py-6 px-4`}>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            Label Templates
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Design barcode label layouts. System templates are read-only —
            duplicate one to customise.
          </p>
        </div>
        <Link href="/settings/label-templates/new">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            New Template
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-text-secondary" />
        </div>
      ) : (
        <>
          <TemplateSection
            title="System Templates"
            subtitle="Seeded, read-only. Duplicate to make a custom copy you can edit."
            templates={systemTemplates}
            onDuplicate={handleDuplicate}
            onDelete={() => {}}
            busyId={busyId}
            readOnly
          />
          <div className="mt-10">
            <TemplateSection
              title="Your Templates"
              subtitle="Custom templates you've created for this business."
              templates={customTemplates}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
              busyId={busyId}
              emptyMessage="No custom templates yet. Duplicate a system template to get started."
            />
          </div>
        </>
      )}
    </div>
  );
}

function TemplateSection({
  title,
  subtitle,
  templates,
  onDuplicate,
  onDelete,
  busyId,
  readOnly = false,
  emptyMessage,
}: {
  title: string;
  subtitle: string;
  templates: LabelTemplate[];
  onDuplicate: (t: LabelTemplate) => void;
  onDelete: (t: LabelTemplate) => void;
  busyId: string | null;
  readOnly?: boolean;
  emptyMessage?: string;
}) {
  return (
    <section>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
          {readOnly && <Lock className="w-4 h-4 text-text-secondary" />}
          {title}
        </h2>
        <p className="text-xs text-text-secondary">{subtitle}</p>
      </div>

      {templates.length === 0 ? (
        <div className="text-sm text-text-secondary italic py-8 text-center border border-dashed rounded-md">
          {emptyMessage || 'No templates yet.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
              busy={busyId === t.id}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TemplateCard({
  template,
  onDuplicate,
  onDelete,
  busy,
  readOnly,
}: {
  template: LabelTemplate;
  onDuplicate: (t: LabelTemplate) => void;
  onDelete: (t: LabelTemplate) => void;
  busy: boolean;
  readOnly?: boolean;
}) {
  // Fit preview into a 260 px wide card regardless of label size.
  const MAX_PX = 260;
  const zoom = Math.max(
    1.5,
    Math.min(6, Math.floor(MAX_PX / template.width_mm))
  );

  return (
    <div className="border rounded-lg p-4 bg-surface dark:bg-slate-900/70 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="font-semibold text-text-primary truncate">
            {template.name}
          </div>
          <div className="text-xs text-text-secondary">
            {template.format} · {template.width_mm}×{template.height_mm} mm
            {template.format === 'A4_SHEET' &&
              template.columns &&
              template.rows_count && (
                <> · {template.columns}×{template.rows_count} up</>
              )}
          </div>
        </div>
        {readOnly && (
          <span className="text-[10px] uppercase tracking-wide text-text-secondary bg-gray-100 dark:bg-slate-700 rounded px-2 py-0.5">
            System
          </span>
        )}
      </div>

      {template.description && (
        <p className="text-xs text-text-secondary mb-3 line-clamp-2">
          {template.description}
        </p>
      )}

      <div className="flex items-center justify-center bg-gray-50 dark:bg-slate-800/40 rounded p-2 mb-3 overflow-auto">
        <LabelPreview
          template={{
            width_mm: Number(template.width_mm),
            height_mm: Number(template.height_mm),
            symbology: template.symbology,
            fields: template.fields || [],
          }}
          data={SAMPLE_DATA}
          zoom={zoom}
        />
      </div>

      <div className="flex items-center gap-2">
        {!readOnly ? (
          <Link
            href={`/settings/label-templates/${template.id}`}
            className="flex-1"
          >
            <Button variant="secondary" className="w-full" disabled={busy}>
              <Pencil className="w-3.5 h-3.5 mr-1" />
              Edit
            </Button>
          </Link>
        ) : null}
        <Button
          variant="secondary"
          onClick={() => onDuplicate(template)}
          disabled={busy}
          className={readOnly ? 'flex-1' : ''}
        >
          <Copy className="w-3.5 h-3.5 mr-1" />
          Duplicate
        </Button>
        {!readOnly && (
          <button
            onClick={() => onDelete(template)}
            disabled={busy}
            className="p-2 text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

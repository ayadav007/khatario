'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { ArrowLeft, Check, Download, Loader2, Redo2, ShieldCheck, Trash2, Undo2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { CustomFieldsTemplateLayout } from '@/components/custom-fields/CustomFieldsTemplateLayout';
import { ItemColumnChooser } from '@/components/templates/ItemColumnChooser';
import { UpgradeModal } from '@/components/subscription/UpgradeModal';
import { getDefaultTemplateSettings } from '@/lib/template-defaults';
import { getTemplatePreviewSpec } from '@/lib/template-screen-preview';
import { lockedSettingKeys } from '@/lib/invoice-statutory';
import { getTemplateById } from '@/lib/template-registry-real';
import {
  DENSITY_FONT_SIZE,
  FONT_OPTIONS,
  LAST_DOCUMENT_LABELS,
  PAGE_SIZES,
  PALETTES,
  colourSettings,
  densityOf,
  editableGroups,
  isShown,
  marginPresetOf,
  marginSettings,
  paletteOf,
  sectionSummary,
  sectionsFor,
  type Density,
  type DesignerSection,
  type DesignerSectionId,
  type DesignerSettings,
  type MarginPreset,
} from '@/lib/template-designer';
import {
  ControlRow,
  DesignerSectionPanel,
  GroupLabel,
  HexColourInput,
  Segmented,
  SwitchRow,
  TextAreaField,
  UpgradeNote,
} from './DesignerControls';
import { PreviewCanvas, type PreviewSource } from './PreviewCanvas';

const MAX_HISTORY = 40;

const DOC_TYPE_LABELS: Record<string, string> = {
  tax_invoice: 'Tax invoice',
  proforma_invoice: 'Proforma invoice',
  bill_of_supply: 'Bill of supply',
  credit_note: 'Credit note',
  debit_note: 'Debit note',
  delivery_challan: 'Delivery challan',
  sales_order: 'Sales order',
  purchase_order: 'Purchase order',
  payment_receipt: 'Payment receipt',
};

/** Sections a free plan can see but not change (today's paid gating: typography, layout, content). */
const PAID_SECTIONS: DesignerSectionId[] = ['page'];

export function TemplateDesigner({ templateId, documentType }: { templateId: string; documentType: string }) {
  const router = useRouter();
  const { business } = useAuth();
  const toast = useToastContext();
  const template = getTemplateById(templateId);
  const templateName = template?.name || templateId;
  const isThermal = templateId === 'thermal_58mm' || templateId === 'thermal_80mm';

  const templateDefaults = useMemo<DesignerSettings>(() => {
    const d = getDefaultTemplateSettings(templateId) as unknown as DesignerSettings;
    return { ...d, font_family: String(d.font_family || 'Inter').split(',')[0].trim() };
  }, [templateId]);

  const [settings, setSettings] = useState<DesignerSettings>(templateDefaults);
  const [savedSettings, setSavedSettings] = useState<DesignerSettings>(templateDefaults);
  const [loaded, setLoaded] = useState(false);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [history, setHistory] = useState<DesignerSettings[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [saving, setSaving] = useState(false);
  const [isPaid, setIsPaid] = useState<boolean | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [openSection, setOpenSection] = useState<DesignerSectionId | null>('style');
  const [mobileView, setMobileView] = useState<'edit' | 'preview'>('edit');
  const [showCustomColours, setShowCustomColours] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewSource, setPreviewSource] = useState<PreviewSource>('sample');
  const [previewDocNumber, setPreviewDocNumber] = useState<string | undefined>();
  const [downloading, setDownloading] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const locked = useMemo(() => lockedSettingKeys(documentType, templateId), [documentType, templateId]);
  const sections = useMemo(() => sectionsFor(templateId), [templateId]);
  const previewSpec = useMemo(() => getTemplatePreviewSpec(templateId, settings), [templateId, settings]);
  const isModified = useMemo(() => JSON.stringify(settings) !== JSON.stringify(savedSettings), [settings, savedSettings]);
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;
  const paid = isPaid === true;

  // Saved settings for this document type, plan features and the business's logo and signature.
  useEffect(() => {
    if (!business?.id) return;
    let cancelled = false;
    (async () => {
      let next = { ...templateDefaults };
      try {
        const res = await fetch(`/api/template-assignments?business_id=${business.id}`);
        if (res.ok) {
          const data = await res.json();
          const assignment = (data.assignments || []).find((a: { document_type: string }) => a.document_type === documentType);
          if (assignment) {
            setActiveTemplateId(assignment.template_id);
            if (assignment.settings) next = { ...templateDefaults, ...assignment.settings };
            // Older saves hold a CSS list ("Arial, sans-serif"); the picker works with the first name.
            next.font_family = String(next.font_family || 'Inter').split(',')[0].trim();
          }
        }
      } catch {
        // Fall back to the template defaults.
      }
      if (cancelled) return;
      setSettings(next);
      setSavedSettings(next);
      setHistory([next]);
      setHistoryIndex(0);
      setLoaded(true);
    })();
    (async () => {
      try {
        const res = await fetch(`/api/features/enabled?business_id=${business.id}`);
        const data = await res.json();
        if (!cancelled) setIsPaid((data.enabledIds || []).includes('settings_template_customization'));
      } catch {
        if (!cancelled) setIsPaid(false);
      }
    })();
    (async () => {
      try {
        const res = await fetch(`/api/businesses/${business.id}`);
        if (res.ok && !cancelled) {
          const { business: biz } = await res.json();
          setLogoUrl(biz?.logo_url || null);
          setSignatureUrl(biz?.signature_url || null);
        }
      } catch {
        // Not critical: the logo row just shows the upload button.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [business?.id, documentType, templateDefaults]);

  // Debounced live preview through the real print pipeline.
  useEffect(() => {
    if (!business?.id || !loaded) return;
    const ac = new AbortController();
    setPreviewLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/template-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            template_id: templateId,
            business_id: business.id,
            settings,
            source: previewSource,
            document_type: documentType,
          }),
          signal: ac.signal,
        });
        if (res.status === 404 && previewSource === 'last_document') {
          // Nothing saved of this type yet: go back to the sample.
          toast.info(`No saved ${(DOC_TYPE_LABELS[documentType] || 'document').toLowerCase()} yet, so the preview uses sample data.`);
          setPreviewSource('sample');
          return;
        }
        if (!res.ok) throw new Error(await res.text());
        const html = await res.text();
        if (!ac.signal.aborted) {
          setPreviewHtml(html);
          const num = res.headers.get('X-Preview-Document');
          setPreviewDocNumber(num ? decodeURIComponent(num) : undefined);
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') console.error('[Template preview]', err);
      } finally {
        if (!ac.signal.aborted) setPreviewLoading(false);
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [settings, templateId, business?.id, loaded, previewSource, documentType]);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const update = useCallback((patch: DesignerSettings) => {
    const next = { ...settingsRef.current, ...patch };
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
    setSettings(next);
    setHistory((h) => [...h.slice(0, historyIndex + 1), next].slice(-MAX_HISTORY));
    setHistoryIndex((i) => Math.min(i + 1, MAX_HISTORY - 1));
  }, [historyIndex]);
  const set = useCallback((key: string, value: unknown) => update({ [key]: value }), [update]);

  const undo = useCallback(() => {
    if (!canUndo) return;
    setSettings(history[historyIndex - 1]);
    setHistoryIndex(historyIndex - 1);
  }, [canUndo, history, historyIndex]);
  const redo = useCallback(() => {
    if (!canRedo) return;
    setSettings(history[historyIndex + 1]);
    setHistoryIndex(historyIndex + 1);
  }, [canRedo, history, historyIndex]);

  const save = useCallback(async () => {
    if (!business?.id || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/template-assignments', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id, document_type: documentType, template_id: templateId, settings }),
      });
      if (!res.ok) throw new Error('save failed');
      setSavedSettings({ ...settings });
      setActiveTemplateId(templateId);
      toast.success('Template saved');
    } catch {
      toast.error("Couldn't save the template. Try again.");
    } finally {
      setSaving(false);
    }
  }, [business?.id, documentType, templateId, settings, saving, toast]);

  const openFromPreview = useCallback((section: string) => {
    if (!sectionsFor(templateId).some((s) => s.id === section)) return;
    setOpenSection(section as DesignerSectionId);
    setMobileView('edit');
    requestAnimationFrame(() =>
      document.getElementById(`designer-panel-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  }, [templateId]);

  const downloadSamplePdf = async () => {
    if (!business?.id || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch('/api/template-preview/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_id: templateId,
          business_id: business.id,
          settings,
          source: previewSource,
          document_type: documentType,
        }),
      });
      if (!res.ok) throw new Error('pdf');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${templateId}-sample.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      toast.error("Couldn't make the PDF. Try again.");
    } finally {
      setDownloading(false);
    }
  };

  const resetToDefaults = () => {
    if (confirm('Reset this template to its default look? You can undo this before saving.')) update({ ...templateDefaults });
  };

  const leave = (href: string) => {
    if (isModified && !confirm('You have unsaved changes. Leave without saving?')) return;
    router.push(href);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
      if (k === 's') { e.preventDefault(); if (isModified) save(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, save, isModified]);

  useEffect(() => {
    if (!isModified) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isModified]);

  const uploadLogo = async (file: File) => {
    if (!business?.id) return;
    setUploadingLogo(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('type', 'logo');
      const up = await fetch('/api/upload/image', { method: 'POST', body: form });
      if (!up.ok) throw new Error('upload');
      const { url } = await up.json();
      const put = await fetch(`/api/business/${business.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logo_url: url }),
      });
      if (!put.ok) throw new Error('save');
      setLogoUrl(url);
      setSettings((s) => ({ ...s })); // refresh the preview with the new logo
      toast.success('Logo updated');
    } catch {
      toast.error("Couldn't upload the logo. Try a JPEG or PNG under 2 MB.");
    } finally {
      setUploadingLogo(false);
    }
  };

  const removeLogo = async () => {
    if (!business?.id) return;
    try {
      const res = await fetch(`/api/business/${business.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logo_url: '' }),
      });
      if (!res.ok) throw new Error('remove');
      setLogoUrl(null);
      setSettings((s) => ({ ...s }));
      toast.success('Logo removed');
    } catch {
      toast.error("Couldn't remove the logo.");
    }
  };

  const switches = (section: DesignerSection) => {
    const groups = editableGroups(section, locked);
    return groups.map((g, i) => (
      <div key={g.title || i}>
        {g.title && groups.length > 1 && <GroupLabel>{g.title}</GroupLabel>}
        {g.fields.map((fl) => (
          <SwitchRow key={fl.key} label={fl.label} checked={isShown(settings, fl.key)} onChange={(v) => set(fl.key, v)} />
        ))}
      </div>
    ));
  };

  const activePalette = paletteOf(settings);
  const density = densityOf(settings);
  const marginPreset = marginPresetOf(settings);
  const [customMargins, setCustomMargins] = useState(false);
  const showMarginSliders = customMargins || marginPreset === 'custom';

  const body = (section: DesignerSection) => {
    switch (section.id) {
      case 'style':
        return (
          <div className="space-y-4">
            <div>
              <GroupLabel>Colour</GroupLabel>
              <div className="grid grid-cols-6 gap-2">
                {PALETTES.map((p) => {
                  const on = activePalette === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => update(colourSettings(p.primary, p.header))}
                      title={p.name}
                      aria-label={`${p.name} colours`}
                      aria-pressed={on}
                      className={clsx(
                        'group flex flex-col items-center gap-1 rounded-lg p-1 transition',
                        on ? 'bg-gray-100 dark:bg-slate-800' : 'hover:bg-gray-50 dark:hover:bg-slate-800/60',
                      )}
                    >
                      <span
                        className={clsx(
                          'relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full ring-1 ring-black/10',
                          on && 'ring-2 ring-primary-500 ring-offset-2 dark:ring-offset-slate-900',
                        )}
                        style={{ background: `linear-gradient(135deg, ${p.primary} 50%, ${p.header} 50%)` }}
                      >
                        {on && <Check className="h-4 w-4 text-white drop-shadow" aria-hidden />}
                      </span>
                      <span className="text-[11px] text-gray-600 dark:text-slate-400">{p.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <ControlRow label="Brand colour">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-500 dark:text-slate-400">
                {activePalette ? 'Pick your own' : String(settings.primary_color || '')}
                <input
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(String(settings.primary_color)) ? String(settings.primary_color) : '#1e3a8a'}
                  onChange={(e) => update(colourSettings(e.target.value))}
                  aria-label="Brand colour"
                  className="h-7 w-7 cursor-pointer rounded-md border border-gray-200 bg-transparent p-0.5 dark:border-slate-600"
                />
              </label>
            </ControlRow>
            <div>
              <button
                type="button"
                onClick={() => setShowCustomColours((v) => !v)}
                aria-expanded={showCustomColours}
                className="text-xs font-medium text-primary-600 hover:underline dark:text-primary-300"
              >
                {showCustomColours ? 'Hide custom colours' : 'Custom colours'}
              </button>
              {showCustomColours && (
                <div className="mt-2 rounded-lg border border-gray-200 px-3 py-1 dark:border-slate-700">
                  <HexColourInput label="Titles" value={String(settings.primary_color || '')} onChange={(v) => set('primary_color', v)} />
                  <HexColourInput label="Table header" value={String(settings.table_header_color || '')} onChange={(v) => update({ table_header_color: v, table_header_text_color: undefined })} />
                  <HexColourInput label="Text" value={String(settings.text_color || '')} onChange={(v) => set('text_color', v)} />
                </div>
              )}
            </div>
            {paid ? (
              <>
                <ControlRow label="Font">
                  <select
                    value={String(settings.font_family || 'Inter')}
                    onChange={(e) => set('font_family', e.target.value)}
                    aria-label="Font"
                    className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[13px] text-gray-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                  >
                    {FONT_OPTIONS.map((fo) => (
                      <option key={fo.value} value={fo.value} style={{ fontFamily: fo.value }}>{fo.label}</option>
                    ))}
                  </select>
                </ControlRow>
                <ControlRow label="Density">
                  <Segmented<Density>
                    size="sm"
                    aria-label="Density"
                    value={density}
                    onChange={(d) => set('font_size', DENSITY_FONT_SIZE[d])}
                    options={[
                      { value: 'compact', label: 'Compact' },
                      { value: 'regular', label: 'Regular' },
                      { value: 'roomy', label: 'Roomy' },
                    ]}
                  />
                </ControlRow>
              </>
            ) : (
              isPaid === false && <UpgradeNote what="Changing the font and density" onUpgrade={() => setShowUpgrade(true)} />
            )}
          </div>
        );

      case 'header':
        return (
          <div>
            <div className="mb-2 flex items-center gap-3 rounded-lg border border-gray-200 p-2.5 dark:border-slate-700">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="Your logo" className="h-10 max-w-[120px] object-contain" />
              ) : (
                <span className="text-xs text-gray-500 dark:text-slate-400">No logo yet</span>
              )}
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                disabled={uploadingLogo}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-slate-800"
              >
                {uploadingLogo ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Upload className="h-3.5 w-3.5" aria-hidden />}
                {logoUrl ? 'Replace' : 'Upload logo'}
              </button>
              {logoUrl && (
                <button type="button" onClick={removeLogo} aria-label="Remove logo" className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              <input
                ref={logoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadLogo(file);
                  e.target.value = '';
                }}
              />
            </div>
            {switches(section)}
          </div>
        );

      case 'details':
        return (
          <div>
            {switches(section)}
            <div className="mt-4 border-t border-gray-100 pt-3 dark:border-slate-800">
              <CustomFieldsTemplateLayout
                settings={settings}
                onChange={(next) => update(next as DesignerSettings)}
                supportsInvoiceFields={['tax_invoice', 'proforma_invoice', 'bill_of_supply'].includes(documentType)}
              />
            </div>
          </div>
        );

      case 'items':
        return templateId === 'distributor' ? (
          <ItemColumnChooser
            value={settings.item_columns as string[] | undefined}
            onChange={(next) => set('item_columns', next)}
            documentType={documentType}
          />
        ) : (
          <div>{switches(section)}</div>
        );

      case 'footer':
        return (
          <div>
            {switches(section)}
            <div className="mt-2 flex items-center justify-between gap-3 py-1.5 text-xs text-gray-500 dark:text-slate-400">
              <span>{signatureUrl ? 'Signature from your business profile' : 'No signature uploaded yet'}</span>
              <Link href="/settings/business#bp-signature" className="font-medium text-primary-600 hover:underline dark:text-primary-300">
                {signatureUrl ? 'Change' : 'Upload'}
              </Link>
            </div>
            <GroupLabel>Text</GroupLabel>
            {paid ? (
              <>
                <TextAreaField label="Terms and conditions" value={String(settings.terms || '')} onChange={(v) => set('terms', v)} maxLength={2000} rows={4} placeholder={'Goods once sold will not be taken back.\nInterest at 18% p.a. on overdue payments.'} />
                <TextAreaField label="Notes" value={String(settings.notes || '')} onChange={(v) => set('notes', v)} maxLength={1000} placeholder="Thank you for your business" />
                <TextAreaField label="Payment terms" value={String(settings.payment_terms || '')} onChange={(v) => set('payment_terms', v)} maxLength={500} rows={2} placeholder="Net 30 days" />
                <TextAreaField label="Footer line" value={String(settings.footer_text || '')} onChange={(v) => set('footer_text', v)} maxLength={200} rows={1} placeholder="Subject to Pune jurisdiction" />
              </>
            ) : (
              isPaid === false && <UpgradeNote what="Writing your own terms and footer" onUpgrade={() => setShowUpgrade(true)} />
            )}
          </div>
        );

      case 'page':
        if (isPaid === false) return <UpgradeNote what="Changing paper size and margins" onUpgrade={() => setShowUpgrade(true)} />;
        if (isThermal) {
          return <p className="text-xs text-gray-500 dark:text-slate-400">The paper width is set by this thermal template. Pick the 58 mm or 80 mm template for a different roll.</p>;
        }
        return (
          <div>
            <ControlRow label="Paper">
              <Segmented size="sm" aria-label="Paper size" value={String(settings.page_size || 'A4')} onChange={(v) => set('page_size', v)} options={PAGE_SIZES} />
            </ControlRow>
            <ControlRow label="Orientation">
              <Segmented
                size="sm"
                aria-label="Orientation"
                value={String(settings.orientation || 'portrait')}
                onChange={(v) => set('orientation', v)}
                options={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]}
              />
            </ControlRow>
            <ControlRow label="Margins">
              <Segmented<MarginPreset>
                size="sm"
                aria-label="Margins"
                value={showMarginSliders ? 'custom' : marginPreset}
                onChange={(m) => {
                  if (m === 'custom') setCustomMargins(true);
                  else {
                    setCustomMargins(false);
                    update(marginSettings(m));
                  }
                }}
                options={[
                  { value: 'narrow', label: 'Narrow' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'wide', label: 'Wide' },
                  { value: 'custom', label: 'Custom' },
                ]}
              />
            </ControlRow>
            {showMarginSliders && (
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
                {(['top', 'right', 'bottom', 'left'] as const).map((side) => {
                  const key = `margin_${side}`;
                  const v = Number(settings[key] ?? 10);
                  return (
                    <label key={side} className="block text-xs text-gray-600 dark:text-slate-400">
                      <span className="flex justify-between capitalize">{side}<span className="tabular-nums">{v} mm</span></span>
                      <input type="range" min={3} max={25} step={1} value={v} onChange={(e) => set(key, Number(e.target.value))} className="w-full" />
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );

      default:
        return <div>{switches(section)}</div>;
    }
  };

  const summary = (section: DesignerSection): string => {
    switch (section.id) {
      case 'style': {
        const p = PALETTES.find((x) => x.id === activePalette);
        return `${p ? p.name : 'Custom colour'} · ${String(settings.font_family || 'Inter')}`;
      }
      case 'items':
        return templateId === 'distributor' ? 'Choose and order columns' : sectionSummary(section, settings, locked);
      case 'page':
        return isThermal
          ? 'Thermal roll'
          : `${settings.page_size || 'A4'} · ${settings.orientation === 'landscape' ? 'landscape' : 'portrait'} · ${marginPreset} margins`;
      default:
        return sectionSummary(section, settings, locked);
    }
  };

  const docTypes = (template?.documentTypes || [documentType]).filter((d) => DOC_TYPE_LABELS[d]);
  const willActivate = loaded && activeTemplateId !== templateId;

  return (
    <div className="fixed inset-0 z-[61] flex flex-col bg-white dark:bg-slate-900">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-gray-200 px-3 sm:px-4 dark:border-slate-700">
        <button
          type="button"
          onClick={() => leave(`/settings/templates?doc=${documentType}`)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Templates</span>
        </button>
        <div className="mx-1 hidden h-5 w-px bg-gray-200 sm:block dark:bg-slate-700" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-gray-900 dark:text-white">{templateName}</div>
        </div>
        {docTypes.length > 1 ? (
          <select
            value={documentType}
            onChange={(e) => leave(`/settings/templates/design?template=${encodeURIComponent(templateId)}&doc=${e.target.value}`)}
            aria-label="Document type"
            className="ml-1 hidden rounded-lg border border-gray-200 bg-white py-1 pl-2 pr-7 text-xs text-gray-700 sm:block dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          >
            {docTypes.map((d) => <option key={d} value={d}>{DOC_TYPE_LABELS[d]}</option>)}
          </select>
        ) : (
          <span className="ml-1 hidden rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600 sm:inline dark:bg-slate-800 dark:text-slate-300">
            {DOC_TYPE_LABELS[documentType] || documentType}
          </span>
        )}

        <div className="flex-1" />

        <span className="hidden items-center gap-1.5 text-xs md:inline-flex" aria-live="polite">
          {isModified ? (
            <><span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden /><span className="text-amber-700 dark:text-amber-400">Unsaved changes</span></>
          ) : (
            loaded && <span className="text-gray-500 dark:text-slate-400">All changes saved</span>
          )}
        </span>
        <div className="flex items-center">
          <button type="button" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo" className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 disabled:opacity-30 dark:text-slate-300 dark:hover:bg-slate-800">
            <Undo2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)" aria-label="Redo" className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 disabled:opacity-30 dark:text-slate-300 dark:hover:bg-slate-800">
            <Redo2 className="h-4 w-4" />
          </button>
        </div>
        <button type="button" onClick={resetToDefaults} className="hidden rounded-lg px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-100 lg:inline dark:text-slate-300 dark:hover:bg-slate-800">
          Reset
        </button>
        <button
          type="button"
          onClick={downloadSamplePdf}
          disabled={downloading}
          title="Download a sample PDF with these settings"
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Download className="h-3.5 w-3.5" aria-hidden />}
          <span className="hidden md:inline">Sample PDF</span>
        </button>
        <Button variant="primary" size="sm" onClick={save} disabled={!isModified || saving}>
          {saving ? 'Saving…' : willActivate ? 'Save and use' : 'Save'}
        </Button>
      </header>

      {/* Phone: switch between editing and the preview */}
      <div className="flex justify-center border-b border-gray-200 py-2 lg:hidden dark:border-slate-700">
        <Segmented
          size="sm"
          aria-label="View"
          value={mobileView}
          onChange={setMobileView}
          options={[{ value: 'edit', label: 'Edit' }, { value: 'preview', label: 'Preview' }]}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left rail */}
        <aside
          className={clsx(
            'min-h-0 w-full shrink-0 flex-col overflow-y-auto border-r border-gray-200 lg:flex lg:w-[360px] dark:border-slate-700',
            mobileView === 'edit' ? 'flex' : 'hidden',
          )}
        >
          {willActivate && (
            <p className="border-b border-gray-200 bg-gray-50 px-5 py-2.5 text-xs text-gray-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
              Saving makes this the template for every {(DOC_TYPE_LABELS[documentType] || documentType).toLowerCase()}.
            </p>
          )}
          {sections.map((section) => (
            <DesignerSectionPanel
              key={section.id}
              id={section.id}
              title={section.title}
              summary={summary(section)}
              locked={isPaid === false && PAID_SECTIONS.includes(section.id)}
              open={openSection === section.id}
              onToggle={() => setOpenSection((cur) => (cur === section.id ? null : section.id))}
            >
              {body(section)}
            </DesignerSectionPanel>
          ))}
          {locked.length > 0 && (
            <div className="m-5 flex gap-2.5 rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-600 dark:bg-slate-800/60 dark:text-slate-300">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" aria-hidden />
              <span>
                GST requires some details on every {(DOC_TYPE_LABELS[documentType] || 'invoice').toLowerCase()}: both GSTINs, the buyer&apos;s name and
                address, HSN, place of supply, quantities, tax and totals, and the signatory. They always print, so they aren&apos;t listed here.
              </span>
            </div>
          )}
        </aside>

        {/* Preview */}
        <main className={clsx('min-h-0 min-w-0 flex-1 flex-col lg:flex', mobileView === 'preview' ? 'flex' : 'hidden')}>
          <PreviewCanvas
            html={previewHtml}
            spec={previewSpec}
            loading={previewLoading}
            source={previewSource}
            onSourceChange={setPreviewSource}
            lastDocumentLabel={LAST_DOCUMENT_LABELS[documentType] ?? null}
            documentNumber={previewDocNumber}
            onSectionClick={openFromPreview}
          />
        </main>
      </div>

      {showUpgrade && (
        <UpgradeModal limitType="feature" featureName="Template customisation" onClose={() => setShowUpgrade(false)} />
      )}
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback, useRef, useMemo, type LegacyRef } from 'react';
import Link from 'next/link';
import { X, Save, RotateCcw, Palette, Type, Layout, FileText, Image as ImageIcon, Undo2, Redo2, Monitor, Smartphone, Loader2, Lock, Upload, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { CustomFieldsTemplateLayout } from '@/components/custom-fields/CustomFieldsTemplateLayout';
import {
  getTemplatePreviewSpec,
  type TemplatePreviewSpec,
} from '@/lib/template-screen-preview';

interface TemplateSettings {
  primary_color?: string;
  secondary_color?: string;
  text_color?: string;
  table_header_color?: string;
  accent_color?: string;
  font_family?: string;
  font_size?: number;
  margin_top?: number;
  margin_right?: number;
  margin_bottom?: number;
  margin_left?: number;
  page_size?: string;
  orientation?: string;
  show_logo?: boolean;
  show_business_name?: boolean;
  show_business_address?: boolean;
  show_business_phone?: boolean;
  show_business_email?: boolean;
  show_business_gstin?: boolean;
  show_business_website?: boolean;
  show_business_pan?: boolean;
  show_business_cin?: boolean;
  show_bill_to?: boolean;
  show_ship_to?: boolean;
  show_customer_name?: boolean;
  show_customer_address?: boolean;
  show_customer_phone?: boolean;
  show_customer_email?: boolean;
  show_customer_gstin?: boolean;
  show_customer_state?: boolean;
  show_customer_state_code?: boolean;
  show_customer_pan?: boolean;
  show_contact_person?: boolean;
  show_invoice_number?: boolean;
  show_invoice_date?: boolean;
  show_invoice_type?: boolean;
  show_due_date?: boolean;
  show_po_number?: boolean;
  show_reference_number?: boolean;
  show_place_of_supply?: boolean;
  show_reverse_charge?: boolean;
  show_eway_bill_number?: boolean;
  show_delivery_note?: boolean;
  show_payment_terms?: boolean;
  show_other_references?: boolean;
  show_dispatched_through?: boolean;
  show_destination?: boolean;
  show_terms_of_delivery?: boolean;
  show_serial_number?: boolean;
  show_item_name?: boolean;
  show_item_image?: boolean;
  show_hsn?: boolean;
  show_quantity?: boolean;
  show_unit?: boolean;
  show_rate?: boolean;
  show_discount_percent?: boolean;
  show_discount_amount?: boolean;
  show_tax_rate?: boolean;
  show_tax_amount?: boolean;
  show_line_total?: boolean;
  show_batch_number?: boolean;
  show_expiry_date?: boolean;
  show_subtotal?: boolean;
  show_discount_total?: boolean;
  show_additional_charges?: boolean;
  show_cgst?: boolean;
  show_sgst?: boolean;
  show_igst?: boolean;
  show_cess?: boolean;
  show_tax_total?: boolean;
  show_round_off?: boolean;
  show_grand_total?: boolean;
  show_paid_amount?: boolean;
  show_balance_amount?: boolean;
  show_amount_in_words?: boolean;
  show_bank_details?: boolean;
  show_bank_name?: boolean;
  show_account_number?: boolean;
  show_ifsc_code?: boolean;
  show_branch_name?: boolean;
  show_signature?: boolean;
  show_authorized_signatory?: boolean;
  show_qr_code?: boolean;
  show_terms?: boolean;
  show_notes?: boolean;
  show_customer_country?: boolean;
  show_buyer_tax_id?: boolean;
  show_business_iec?: boolean;
  show_business_swift?: boolean;
  show_swift_code?: boolean;
  show_invoice_currency?: boolean;
  show_exchange_rate?: boolean;
  show_country_of_origin?: boolean;
  show_port_of_loading?: boolean;
  show_port_of_discharge?: boolean;
  show_place_of_delivery?: boolean;
  show_incoterms?: boolean;
  show_transport_mode?: boolean;
  show_awb_number?: boolean;
  show_bl_number?: boolean;
  show_export_declaration?: boolean;
  show_lut_declaration?: boolean;
  terms?: string;
  notes?: string;
  payment_terms?: string;
  footer_text?: string;
}

interface CustomizeTemplateDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  templateId: string;
  templateName: string;
  documentType: string;
  onSave: (settings: TemplateSettings) => Promise<void>;
  onPreview: (settings: TemplateSettings) => void;
  isPaidFeature?: boolean;
}

const FONT_OPTIONS = [
  { value: 'Inter', label: 'Inter (Modern)' },
  { value: 'Arial', label: 'Arial (Classic)' },
  { value: 'Helvetica', label: 'Helvetica (Clean)' },
  { value: 'Georgia', label: 'Georgia (Formal)' },
  { value: 'Times New Roman', label: 'Times New Roman (Traditional)' },
  { value: 'Courier New', label: 'Courier New (Monospace)' },
  { value: 'Segoe UI', label: 'Segoe UI (Professional)' },
];

const DEFAULT_SETTINGS: TemplateSettings = {
  primary_color: '#3949AB',
  secondary_color: '#1E88E5',
  text_color: '#333333',
  table_header_color: '#EEEEEE',
  accent_color: '#FF6B6B',
  font_family: 'Inter',
  font_size: 12,
  margin_top: 10,
  margin_right: 10,
  margin_bottom: 10,
  margin_left: 10,
  page_size: 'A4',
  orientation: 'portrait',
  show_logo: true,
  show_business_name: true,
  show_business_address: true,
  show_business_phone: true,
  show_business_email: true,
  show_business_gstin: true,
  show_business_website: true,
  show_business_pan: true,
  show_business_cin: true,
  show_bill_to: true,
  show_ship_to: true,
  show_customer_name: true,
  show_customer_address: true,
  show_customer_phone: true,
  show_customer_email: true,
  show_customer_gstin: true,
  show_customer_state: true,
  show_customer_state_code: true,
  show_customer_pan: true,
  show_contact_person: true,
  show_invoice_number: true,
  show_invoice_date: true,
  show_invoice_type: true,
  show_due_date: true,
  show_po_number: true,
  show_reference_number: true,
  show_place_of_supply: true,
  show_reverse_charge: true,
  show_eway_bill_number: true,
  show_delivery_note: false,
  show_other_references: false,
  show_dispatched_through: false,
  show_destination: false,
  show_terms_of_delivery: false,
  show_serial_number: true,
  show_item_name: true,
  show_item_image: false,
  show_hsn: true,
  show_quantity: true,
  show_unit: true,
  show_rate: true,
  show_discount_percent: true,
  show_discount_amount: true,
  show_tax_rate: true,
  show_tax_amount: true,
  show_line_total: true,
  show_batch_number: false,
  show_expiry_date: false,
  show_subtotal: true,
  show_discount_total: true,
  show_additional_charges: true,
  show_cgst: true,
  show_sgst: true,
  show_igst: true,
  show_cess: true,
  show_tax_total: true,
  show_round_off: true,
  show_grand_total: true,
  show_paid_amount: true,
  show_balance_amount: true,
  show_amount_in_words: true,
  show_bank_details: true,
  show_bank_name: true,
  show_account_number: true,
  show_ifsc_code: true,
  show_branch_name: true,
  show_signature: true,
  show_authorized_signatory: true,
  show_qr_code: false,
  show_terms: true,
  show_notes: true,
  show_payment_terms: true,
};

type TabId = 'colors' | 'fields' | 'branding' | 'typography' | 'layout' | 'content';

const TABS: { id: TabId; label: string; icon: any; free: boolean }[] = [
  { id: 'colors', label: 'Colors', icon: Palette, free: true },
  { id: 'fields', label: 'Fields', icon: FileText, free: true },
  { id: 'branding', label: 'Branding', icon: ImageIcon, free: true },
  { id: 'typography', label: 'Typography', icon: Type, free: false },
  { id: 'layout', label: 'Layout', icon: Layout, free: false },
  { id: 'content', label: 'Content', icon: ImageIcon, free: false },
];

const MAX_HISTORY = 40;

/**
 * Preview at true paper width (A4/A5). The whole document is scaled down to fit
 * the panel — same as a thumbnail. PDF/print still paginates; nothing is clipped.
 */
function PreviewFrame({
  iframeRef,
  previewMode,
  previewLoading,
  previewSpec,
  onLoad,
}: {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  previewMode: 'desktop' | 'mobile';
  previewLoading: boolean;
  previewSpec: TemplatePreviewSpec;
  onLoad: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.7);
  const [contentH, setContentH] = useState(previewSpec.heightPx);
  const [contentW, setContentW] = useState(previewSpec.widthPx);

  const iframeW =
    previewMode === 'mobile'
      ? Math.min(375, previewSpec.widthPx)
      : previewSpec.widthPx;

  useEffect(() => {
    setContentH(previewSpec.heightPx);
    setContentW(iframeW);
  }, [previewSpec.heightPx, previewSpec.widthPx, previewLoading, iframeW]);

  const measureContent = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentDocument?.documentElement) return;
    const doc = iframe.contentDocument;
    const w = Math.max(
      doc.documentElement.scrollWidth,
      doc.body?.scrollWidth ?? 0,
      iframeW
    );
    const h = Math.max(
      doc.documentElement.scrollHeight,
      doc.body?.scrollHeight ?? 0,
      previewSpec.heightPx
    );
    setContentW(w);
    setContentH(h + 8);
  }, [iframeRef, iframeW, previewSpec.heightPx]);

  const recomputeScale = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { width: cw, height: ch } = el.getBoundingClientRect();
    const padding = 40;
    const sw = (cw - padding) / contentW;
    const sh = (ch - padding) / contentH;
    const s = Math.min(sw, sh, 1);
    setScale(Math.max(0.28, s));
  }, [contentW, contentH]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    recomputeScale();
    const ro = new ResizeObserver(recomputeScale);
    ro.observe(el);
    return () => ro.disconnect();
  }, [previewMode, recomputeScale]);

  const handleIframeLoad = () => {
    measureContent();
    requestAnimationFrame(() => {
      measureContent();
      recomputeScale();
    });
    onLoad();
  };

  const scaledW = contentW * scale;
  const scaledH = contentH * scale;

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden relative flex items-center justify-center"
      style={{ background: '#e5e7eb' }}
    >
      {previewLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-200/80 z-10">
          <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
        </div>
      )}
      <div
        className="shrink-0 overflow-hidden"
        style={{
          width: scaledW,
          height: scaledH,
        }}
      >
        <iframe
          ref={iframeRef as LegacyRef<HTMLIFrameElement>}
          className="border-0 bg-white rounded-lg"
          scrolling="no"
          style={{
            width: contentW,
            height: contentH,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            overflow: 'hidden',
            boxShadow: '0 4px 24px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08)',
          }}
          title="Template Preview"
          onLoad={handleIframeLoad}
        />
      </div>
    </div>
  );
}

function ContentTextarea({ label, value, onChange, rows, maxLength, placeholder, hint }: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  rows: number;
  maxLength: number;
  placeholder: string;
  hint: string;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1.5">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-vertical focus:ring-2 focus:ring-primary-200 focus:border-primary-400"
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
      />
      <div className="flex justify-between mt-1">
        <p className="text-xs text-gray-400">{hint}</p>
        <p className={`text-xs ${value.length > maxLength * 0.9 ? 'text-amber-500' : 'text-gray-400'}`}>
          {value.length}/{maxLength}
        </p>
      </div>
    </div>
  );
}

function FieldToggleGroup({ title, color, fields, settings, onChange }: {
  title: string;
  color: string;
  fields: { key: string; label: string }[];
  settings: TemplateSettings;
  onChange: (key: keyof TemplateSettings, val: boolean) => void;
}) {
  return (
    <div>
      <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full`} style={{ backgroundColor: color }} />
        {title}
      </h3>
      <div className="space-y-1.5 pl-4">
        {fields.map((f) => (
          <label key={f.key} className="flex items-center gap-3 cursor-pointer group py-0.5">
            <input
              type="checkbox"
              checked={settings[f.key as keyof TemplateSettings] as boolean ?? true}
              onChange={(e) => onChange(f.key as keyof TemplateSettings, e.target.checked)}
              className="w-4 h-4 rounded focus:ring-2"
              style={{ accentColor: color }}
            />
            <span className="text-sm text-gray-700 group-hover:text-gray-900">{f.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export default function CustomizeTemplateDrawer({
  isOpen,
  onClose,
  templateId,
  templateName,
  documentType,
  onSave,
  onPreview,
  isPaidFeature = true,
}: CustomizeTemplateDrawerProps) {
  const { business } = useAuth();
  const toast = useToastContext();
  const [settings, setSettings] = useState<TemplateSettings>(DEFAULT_SETTINGS);
  const [savedSettings, setSavedSettings] = useState<TemplateSettings>(DEFAULT_SETTINGS);
  const [activeTab, setActiveTab] = useState<TabId>('colors');
  const [isSaving, setIsSaving] = useState(false);
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [previewLoading, setPreviewLoading] = useState(true);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const isThermalTemplate =
    templateId === 'thermal_58mm' || templateId === 'thermal_80mm';

  // Undo/redo
  const [history, setHistory] = useState<TemplateSettings[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const skipHistoryRef = useRef(false);

  // Preview debounce
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);

  const previewSpec = useMemo(
    () => getTemplatePreviewSpec(templateId, settings as Record<string, unknown>),
    [templateId, settings]
  );

  const isModified = useMemo(() => {
    return JSON.stringify(settings) !== JSON.stringify(savedSettings);
  }, [settings, savedSettings]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  // Load saved settings on open
  useEffect(() => {
    async function fetchSettings() {
      if (!isOpen || !business?.id) return;

      try {
        const response = await fetch(`/api/template-assignments?business_id=${business.id}`);
        if (response.ok) {
          const data = await response.json();
          const assignment = data.assignments?.find((a: any) => a.document_type === documentType);
          const loaded = assignment?.settings
            ? { ...DEFAULT_SETTINGS, ...assignment.settings }
            : { ...DEFAULT_SETTINGS };
          setSettings(loaded);
          setSavedSettings(loaded);
          setHistory([loaded]);
          setHistoryIndex(0);
        } else {
          setSettings({ ...DEFAULT_SETTINGS });
          setSavedSettings({ ...DEFAULT_SETTINGS });
          setHistory([{ ...DEFAULT_SETTINGS }]);
          setHistoryIndex(0);
        }
      } catch {
        setSettings({ ...DEFAULT_SETTINGS });
        setSavedSettings({ ...DEFAULT_SETTINGS });
        setHistory([{ ...DEFAULT_SETTINGS }]);
        setHistoryIndex(0);
      }
    }
    fetchSettings();
  }, [isOpen, templateId, documentType, business?.id]);

  // Fetch current logo & signature from business profile
  useEffect(() => {
    if (!isOpen || !business?.id) return;
    (async () => {
      try {
        const res = await fetch(`/api/business/${business.id}`);
        if (res.ok) {
          const biz = await res.json();
          setLogoUrl(biz.logo_url || null);
          setSignatureUrl(biz.signature_url || null);
        }
      } catch { /* non-critical */ }
    })();
  }, [isOpen, business?.id]);

  const handleLogoUpload = async (file: File) => {
    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'logo');

      const uploadRes = await fetch('/api/upload/image', { method: 'POST', body: formData });
      if (!uploadRes.ok) throw new Error('Upload failed');
      const { url } = await uploadRes.json();

      const saveRes = await fetch(`/api/business/${business!.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logo_url: url }),
      });
      if (!saveRes.ok) throw new Error('Save failed');

      setLogoUrl(url);
      toast.success('Logo uploaded successfully!');
    } catch {
      toast.error('Failed to upload logo. Please try again.');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleRemoveLogo = async () => {
    try {
      await fetch(`/api/business/${business!.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logo_url: null }),
      });
      setLogoUrl(null);
      toast.success('Logo removed.');
    } catch {
      toast.error('Failed to remove logo.');
    }
  };

  // Debounced preview update (POST — full settings, print pipeline + screen CSS)
  useEffect(() => {
    if (!isOpen || !business?.id) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    setPreviewLoading(true);
    debounceRef.current = setTimeout(async () => {
      previewAbortRef.current?.abort();
      const ac = new AbortController();
      previewAbortRef.current = ac;

      try {
        const res = await fetch('/api/template-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            template_id: templateId,
            business_id: business.id,
            settings,
          }),
          signal: ac.signal,
        });

        if (!res.ok) {
          throw new Error(await res.text());
        }

        const html = await res.text();
        if (iframeRef.current && !ac.signal.aborted) {
          iframeRef.current.srcdoc = html;
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('[Template preview]', err);
          setPreviewLoading(false);
        }
      }
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      previewAbortRef.current?.abort();
    };
  }, [settings, templateId, isOpen, business?.id]);

  const pushHistory = useCallback((newSettings: TemplateSettings) => {
    setHistory(prev => {
      const truncated = prev.slice(0, historyIndex + 1);
      const updated = [...truncated, newSettings].slice(-MAX_HISTORY);
      return updated;
    });
    setHistoryIndex(prev => Math.min(prev + 1, MAX_HISTORY - 1));
  }, [historyIndex]);

  const handleSettingChange = useCallback((key: keyof TemplateSettings, value: any) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      if (!skipHistoryRef.current) {
        pushHistory(next);
      }
      return next;
    });
  }, [pushHistory]);

  const handleUndo = useCallback(() => {
    if (!canUndo) return;
    const newIndex = historyIndex - 1;
    skipHistoryRef.current = true;
    setSettings(history[newIndex]);
    setHistoryIndex(newIndex);
    skipHistoryRef.current = false;
  }, [canUndo, history, historyIndex]);

  const handleRedo = useCallback(() => {
    if (!canRedo) return;
    const newIndex = historyIndex + 1;
    skipHistoryRef.current = true;
    setSettings(history[newIndex]);
    setHistoryIndex(newIndex);
    skipHistoryRef.current = false;
  }, [canRedo, history, historyIndex]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(settings);
      setSavedSettings({ ...settings });
      toast.success('Template customizations saved!');
    } catch {
      toast.error('Failed to save customizations. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (confirm('Reset all customizations to default? This cannot be undone.')) {
      const defaults = { ...DEFAULT_SETTINGS };
      setSettings(defaults);
      pushHistory(defaults);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); handleRedo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (isModified) handleSave(); }
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, handleUndo, handleRedo, isModified, onClose]);

  if (!isOpen) return null;

  const renderColorInput = (label: string, key: keyof TemplateSettings, hint: string) => (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1.5">{label}</label>
      <div className="flex gap-2 items-center">
        <input
          type="color"
          value={(settings[key] as string) || '#000000'}
          onChange={(e) => handleSettingChange(key, e.target.value)}
          className="w-12 h-9 rounded-lg border-2 border-gray-300 cursor-pointer"
        />
        <input
          type="text"
          value={(settings[key] as string) || ''}
          onChange={(e) => handleSettingChange(key, e.target.value)}
          className="flex-1 px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm font-mono"
        />
      </div>
      <p className="text-xs text-gray-500 mt-1">{hint}</p>
    </div>
  );

  const isTabLocked = (tab: TabId) => !isPaidFeature && !TABS.find(t => t.id === tab)?.free;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Full-screen panel — mobile: live preview on top, controls below (reference-style) */}
      <div className="relative flex flex-col lg:flex-row w-full h-full max-h-[100dvh] overflow-hidden bg-white">
        {/* Settings — below preview on mobile, left column on desktop */}
        <div className="order-2 lg:order-1 flex w-full lg:w-[420px] lg:min-w-[380px] min-h-0 max-h-[min(52vh,480px)] lg:max-h-none flex flex-col border-t lg:border-t-0 lg:border-r border-gray-200 bg-white z-10 shrink-0">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gradient-to-r from-slate-50 to-purple-50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-primary-500 to-purple-500 rounded-xl">
                <Palette className="w-4 h-4 text-white" />
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">Customize Template</h2>
                <p className="text-xs text-gray-600">{templateName}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleUndo}
                disabled={!canUndo}
                className="p-1.5 rounded-lg hover:bg-white/60 disabled:opacity-30 disabled:cursor-not-allowed transition"
                title="Undo (Ctrl+Z)"
              >
                <Undo2 className="w-4 h-4 text-gray-600" />
              </button>
              <button
                onClick={handleRedo}
                disabled={!canRedo}
                className="p-1.5 rounded-lg hover:bg-white/60 disabled:opacity-30 disabled:cursor-not-allowed transition"
                title="Redo (Ctrl+Y)"
              >
                <Redo2 className="w-4 h-4 text-gray-600" />
              </button>
              <button onClick={onClose} className="p-1.5 hover:bg-white/60 rounded-lg transition ml-1">
                <X className="w-4 h-4 text-gray-600" />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-200 px-2 bg-gray-50 overflow-x-auto">
            {TABS.map((tab) => {
              const locked = isTabLocked(tab.id);
              return (
                <button
                  key={tab.id}
                  onClick={() => !locked && setActiveTab(tab.id)}
                  disabled={locked}
                  className={`
                    flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap
                    ${locked ? 'opacity-50 cursor-not-allowed border-transparent text-gray-400' :
                      activeTab === tab.id
                        ? 'border-primary-500 text-primary-600'
                        : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
                    }
                  `}
                >
                  <tab.icon className="w-3.5 h-3.5" />
                  {tab.label}
                  {locked && <Lock className="w-3 h-3" />}
                </button>
              );
            })}
          </div>

          {/* Settings content */}
          <div className="flex-1 overflow-y-auto px-5 py-5">
            {activeTab === 'colors' && (
              <div className="space-y-5">
                <div className="lg:hidden rounded-xl border border-gray-200 bg-slate-50 p-3 space-y-2">
                  <p className="text-xs font-semibold text-gray-700">Quick palette</p>
                  <p className="text-[11px] text-gray-500">Tap to apply — refine below</p>
                  <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
                    {[
                      { name: 'Indigo', primary: '#3949AB', secondary: '#1E88E5', accent: '#FF6B6B' },
                      { name: 'Forest', primary: '#1B5E20', secondary: '#2E7D32', accent: '#C62828' },
                      { name: 'Slate', primary: '#37474F', secondary: '#546E7A', accent: '#F9A825' },
                      { name: 'Wine', primary: '#6A1B9A', secondary: '#8E24AA', accent: '#00897B' },
                      { name: 'Ocean', primary: '#01579B', secondary: '#0277BD', accent: '#FF6F00' },
                    ].map((preset) => (
                      <button
                        key={preset.name}
                        type="button"
                        onClick={() => {
                          handleSettingChange('primary_color', preset.primary);
                          handleSettingChange('secondary_color', preset.secondary);
                          handleSettingChange('accent_color', preset.accent);
                        }}
                        className="shrink-0 flex flex-col items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-2 shadow-sm active:scale-[0.98]"
                      >
                        <span className="flex -space-x-1">
                          <span
                            className="h-7 w-7 rounded-full border-2 border-white shadow ring-1 ring-gray-200"
                            style={{ backgroundColor: preset.primary }}
                          />
                          <span
                            className="h-7 w-7 rounded-full border-2 border-white shadow ring-1 ring-gray-200"
                            style={{ backgroundColor: preset.secondary }}
                          />
                        </span>
                        <span className="text-[10px] font-medium text-gray-700">{preset.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {renderColorInput('Primary Color', 'primary_color', 'Headers, titles, and accents')}
                {renderColorInput('Text Color', 'text_color', 'Main text throughout the document')}
                {renderColorInput('Table Header', 'table_header_color', 'Background for table headers')}
                {renderColorInput('Accent Color', 'accent_color', 'Highlights and emphasis elements')}
              </div>
            )}

            {activeTab === 'branding' && (
              <div className="space-y-6">
                {/* Logo Upload */}
                <div>
                  <h3 className="text-sm font-bold text-gray-900 mb-3">Business Logo</h3>
                  <p className="text-xs text-gray-500 mb-3">Appears in the header of your invoices. Max 2 MB, JPEG/PNG.</p>
                  {logoUrl ? (
                    <div className="relative w-full border border-gray-200 rounded-lg p-3 bg-gray-50 flex items-center gap-4">
                      <img src={logoUrl} alt="Logo" className="h-16 max-w-[180px] object-contain rounded" />
                      <div className="flex-1" />
                      <button
                        onClick={() => logoInputRef.current?.click()}
                        className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                      >
                        Change
                      </button>
                      <button
                        onClick={() => handleRemoveLogo()}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition"
                        title="Remove logo"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => logoInputRef.current?.click()}
                      disabled={uploadingLogo}
                      className="w-full border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-primary-400 hover:bg-slate-50/30 transition group"
                    >
                      {uploadingLogo ? (
                        <Loader2 className="w-6 h-6 animate-spin text-primary-500 mx-auto" />
                      ) : (
                        <>
                          <Upload className="w-6 h-6 text-gray-400 group-hover:text-primary-500 mx-auto mb-2" />
                          <p className="text-sm font-medium text-gray-600 group-hover:text-primary-600">
                            Click to upload logo
                          </p>
                        </>
                      )}
                    </button>
                  )}
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleLogoUpload(file);
                      e.target.value = '';
                    }}
                  />
                </div>

                <div>
                  <h3 className="text-sm font-bold text-gray-900 mb-2">Digital signature</h3>
                  <p className="text-xs text-gray-500 mb-3">
                    Upload once in business profile. Use the toggle below to show or hide it on this template.
                  </p>
                  {signatureUrl ? (
                    <img
                      src={signatureUrl}
                      alt="Signature preview"
                      className="h-12 max-w-[200px] object-contain rounded border border-gray-200 bg-gray-50 p-2 mb-2"
                    />
                  ) : (
                    <p className="text-sm text-gray-500 mb-2">No signature uploaded yet.</p>
                  )}
                  <Link
                    href="/settings/business#bp-signature"
                    className="text-sm font-medium text-primary-600 hover:text-primary-700"
                  >
                    Manage signature in Business profile →
                  </Link>
                </div>

                {/* Toggle visibility */}
                <div className="border-t border-gray-200 pt-4">
                  <h3 className="text-sm font-bold text-gray-900 mb-3">Visibility</h3>
                  <div className="space-y-2">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.show_logo as boolean ?? true}
                        onChange={(e) => handleSettingChange('show_logo', e.target.checked)}
                        className="w-4 h-4 rounded"
                      />
                      <span className="text-sm text-gray-700">Show logo on invoice</span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.show_signature as boolean ?? true}
                        onChange={(e) => handleSettingChange('show_signature', e.target.checked)}
                        className="w-4 h-4 rounded"
                      />
                      <span className="text-sm text-gray-700">Show signature on invoice</span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.show_authorized_signatory as boolean ?? true}
                        onChange={(e) => handleSettingChange('show_authorized_signatory', e.target.checked)}
                        className="w-4 h-4 rounded"
                      />
                      <span className="text-sm text-gray-700">Show &quot;Authorized Signatory&quot; text</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'typography' && (
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Font Family</label>
                  <select
                    value={settings.font_family}
                    onChange={(e) => handleSettingChange('font_family', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    {FONT_OPTIONS.map((font) => (
                      <option key={font.value} value={font.value}>{font.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                    Font Size: {settings.font_size}px
                  </label>
                  <input
                    type="range" min="10" max="16" step="1"
                    value={settings.font_size}
                    onChange={(e) => handleSettingChange('font_size', parseInt(e.target.value))}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>Small (10px)</span><span>Large (16px)</span>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'layout' && (
              <div className="space-y-5">
                {isThermalTemplate ? (
                  <p className="text-sm text-gray-600 rounded-lg border border-border bg-gray-50 dark:bg-slate-800/50 p-3">
                    Paper width is fixed by this thermal template (58mm or 80mm). To change roll size, activate a
                    different template under Settings → Templates &amp; printing.
                  </p>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1.5">Paper size</label>
                      <select
                        value={settings.page_size || 'A4'}
                        onChange={(e) => handleSettingChange('page_size', e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      >
                        <option value="A4">A4 (standard)</option>
                        <option value="A5">A5 (compact — shorter page)</option>
                        <option value="Letter">Letter (US)</option>
                        <option value="Legal">Legal</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1.5">Orientation</label>
                      <select
                        value={settings.orientation || 'portrait'}
                        onChange={(e) => handleSettingChange('orientation', e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      >
                        <option value="portrait">Portrait</option>
                        <option value="landscape">Landscape</option>
                      </select>
                    </div>
                  </div>
                )}
                <p className="text-sm text-gray-600">
                  Page margins (mm) — shown in live preview and applied when you print or download PDF.
                  Long invoices continue on extra pages in the PDF. The live preview zooms the whole page to fit on screen — it does not change your font size or margins for print.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  {(['top', 'right', 'bottom', 'left'] as const).map(side => {
                    const key = `margin_${side}` as keyof TemplateSettings;
                    return (
                      <div key={side}>
                        <label className="block text-sm font-semibold text-gray-700 mb-1.5 capitalize">
                          {side} ({settings[key] as number} mm)
                        </label>
                        <input
                          type="range" min="3" max="25" step="1"
                          value={settings[key] as number}
                          onChange={(e) => handleSettingChange(key, parseInt(e.target.value, 10))}
                          className="w-full"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeTab === 'fields' && (
              <div className="space-y-6">
                <FieldToggleGroup title="Business Information" color="#6366f1" fields={[
                  { key: 'show_logo', label: 'Logo' },
                  { key: 'show_business_name', label: 'Business Name' },
                  { key: 'show_business_address', label: 'Address' },
                  { key: 'show_business_phone', label: 'Phone' },
                  { key: 'show_business_email', label: 'Email' },
                  { key: 'show_business_website', label: 'Website' },
                  { key: 'show_business_gstin', label: 'GSTIN' },
                  { key: 'show_business_pan', label: 'PAN' },
                  { key: 'show_business_cin', label: 'CIN' },
                  { key: 'show_business_iec', label: 'IEC Code' },
                  { key: 'show_business_swift', label: 'SWIFT Code' },
                ]} settings={settings} onChange={handleSettingChange} />

                <FieldToggleGroup title="Invoice Information" color="#f97316" fields={[
                  { key: 'show_invoice_number', label: 'Invoice Number' },
                  { key: 'show_invoice_date', label: 'Invoice Date' },
                  { key: 'show_invoice_type', label: 'Invoice Type' },
                  { key: 'show_due_date', label: 'Due Date' },
                  { key: 'show_po_number', label: 'PO Number' },
                  { key: 'show_reference_number', label: 'Reference Number' },
                  { key: 'show_place_of_supply', label: 'Place of Supply' },
                  { key: 'show_reverse_charge', label: 'Reverse Charge' },
                  { key: 'show_eway_bill_number', label: 'E-Way Bill Number' },
                  { key: 'show_delivery_note', label: 'Delivery Note' },
                  { key: 'show_payment_terms', label: 'Mode/Terms of Payment' },
                  { key: 'show_other_references', label: 'Other References' },
                  { key: 'show_dispatched_through', label: 'Dispatched through' },
                  { key: 'show_destination', label: 'Destination' },
                  { key: 'show_terms_of_delivery', label: 'Terms of Delivery' },
                ]} settings={settings} onChange={handleSettingChange} />

                <CustomFieldsTemplateLayout
                  settings={settings as Record<string, unknown>}
                  onChange={(next) => setSettings(next as TemplateSettings)}
                />

                <FieldToggleGroup title="Customer Information" color="#3b82f6" fields={[
                  { key: 'show_bill_to', label: 'Bill To Section' },
                  { key: 'show_ship_to', label: 'Ship To Section' },
                  { key: 'show_customer_name', label: 'Name' },
                  { key: 'show_customer_address', label: 'Address' },
                  { key: 'show_customer_phone', label: 'Phone' },
                  { key: 'show_customer_email', label: 'Email' },
                  { key: 'show_customer_gstin', label: 'GSTIN' },
                  { key: 'show_customer_state', label: 'State' },
                  { key: 'show_customer_state_code', label: 'State Code' },
                  { key: 'show_customer_pan', label: 'PAN' },
                  { key: 'show_contact_person', label: 'Contact Person' },
                  { key: 'show_customer_country', label: 'Country' },
                  { key: 'show_buyer_tax_id', label: 'Buyer Tax ID' },
                ]} settings={settings} onChange={handleSettingChange} />

                <FieldToggleGroup title="Item Table Columns" color="#22c55e" fields={[
                  { key: 'show_serial_number', label: 'Serial Number' },
                  { key: 'show_item_name', label: 'Item Name' },
                  { key: 'show_item_image', label: 'Item Image' },
                  { key: 'show_hsn', label: 'HSN/SAC Code' },
                  { key: 'show_quantity', label: 'Quantity' },
                  { key: 'show_unit', label: 'Unit' },
                  { key: 'show_rate', label: 'Rate' },
                  { key: 'show_discount_percent', label: 'Discount %' },
                  { key: 'show_discount_amount', label: 'Discount Amount' },
                  { key: 'show_tax_rate', label: 'Tax Rate' },
                  { key: 'show_tax_amount', label: 'Tax Amount' },
                  { key: 'show_line_total', label: 'Line Total' },
                  { key: 'show_batch_number', label: 'Batch Number' },
                  { key: 'show_expiry_date', label: 'Expiry Date' },
                ]} settings={settings} onChange={handleSettingChange} />

                <FieldToggleGroup title="Totals & Summary" color="#a855f7" fields={[
                  { key: 'show_subtotal', label: 'Subtotal' },
                  { key: 'show_discount_total', label: 'Total Discount' },
                  { key: 'show_additional_charges', label: 'Additional Charges' },
                  { key: 'show_cgst', label: 'CGST' },
                  { key: 'show_sgst', label: 'SGST' },
                  { key: 'show_igst', label: 'IGST' },
                  { key: 'show_cess', label: 'CESS' },
                  { key: 'show_tax_total', label: 'Total Tax' },
                  { key: 'show_round_off', label: 'Round Off' },
                  { key: 'show_grand_total', label: 'Grand Total' },
                  { key: 'show_paid_amount', label: 'Paid Amount' },
                  { key: 'show_balance_amount', label: 'Balance Due' },
                  { key: 'show_amount_in_words', label: 'Amount in Words' },
                ]} settings={settings} onChange={handleSettingChange} />

                <FieldToggleGroup title="Bank & Payment" color="#6366f1" fields={[
                  { key: 'show_bank_details', label: 'Bank Details Section' },
                  { key: 'show_bank_name', label: 'Bank Name' },
                  { key: 'show_account_number', label: 'Account Number' },
                  { key: 'show_ifsc_code', label: 'IFSC Code' },
                  { key: 'show_branch_name', label: 'Branch Name' },
                  { key: 'show_swift_code', label: 'SWIFT Code' },
                ]} settings={settings} onChange={handleSettingChange} />

                <FieldToggleGroup title="Export Invoice Fields" color="#14b8a6" fields={[
                  { key: 'show_invoice_currency', label: 'Invoice Currency' },
                  { key: 'show_exchange_rate', label: 'Exchange Rate' },
                  { key: 'show_country_of_origin', label: 'Country of Origin' },
                  { key: 'show_port_of_loading', label: 'Port of Loading' },
                  { key: 'show_port_of_discharge', label: 'Port of Discharge' },
                  { key: 'show_place_of_delivery', label: 'Place of Delivery' },
                  { key: 'show_incoterms', label: 'Incoterms' },
                  { key: 'show_transport_mode', label: 'Transport Mode' },
                  { key: 'show_awb_number', label: 'AWB Number' },
                  { key: 'show_bl_number', label: 'BL Number' },
                  { key: 'show_export_declaration', label: 'Export Declaration' },
                  { key: 'show_lut_declaration', label: 'LUT Declaration' },
                ]} settings={settings} onChange={handleSettingChange} />

                <FieldToggleGroup title="Footer & Additional" color="#ec4899" fields={[
                  { key: 'show_terms', label: 'Terms & Conditions' },
                  { key: 'show_notes', label: 'Notes' },
                  { key: 'show_signature', label: 'Signature' },
                  { key: 'show_authorized_signatory', label: 'Authorized Signatory' },
                  { key: 'show_qr_code', label: 'QR Code' },
                ]} settings={settings} onChange={handleSettingChange} />
              </div>
            )}

            {activeTab === 'content' && (
              <div className="space-y-5">
                <ContentTextarea
                  label="Terms & Conditions"
                  value={settings.terms || ''}
                  onChange={(v) => handleSettingChange('terms', v)}
                  rows={5}
                  maxLength={2000}
                  placeholder="E.g., Payment is due within 14 days of invoice date.&#10;Interest @ 18% p.a. will be charged on overdue payments.&#10;Goods once sold will not be taken back."
                  hint="Shown at the bottom of the invoice. Use new lines to separate clauses."
                />
                <ContentTextarea
                  label="Notes"
                  value={settings.notes || ''}
                  onChange={(v) => handleSettingChange('notes', v)}
                  rows={4}
                  maxLength={1000}
                  placeholder="E.g., Thank you for your business!&#10;For queries, contact accounts@example.com"
                  hint="Internal or customer-facing notes shown on the invoice."
                />
                <ContentTextarea
                  label="Payment Terms"
                  value={settings.payment_terms || ''}
                  onChange={(v) => handleSettingChange('payment_terms', v)}
                  rows={3}
                  maxLength={500}
                  placeholder="E.g., Net 30 days, Due on receipt"
                  hint="Payment terms displayed near the bank details section."
                />
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Footer Text</label>
                  <input
                    type="text"
                    value={settings.footer_text || ''}
                    onChange={(e) => handleSettingChange('footer_text', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    maxLength={200}
                    placeholder="E.g., Thank you for your business!"
                  />
                  <p className="text-xs text-gray-400 mt-1 text-right">{(settings.footer_text || '').length}/200</p>
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 bg-gray-50">
            <Button variant="secondary" size="sm" onClick={handleReset} className="text-red-600 hover:bg-red-50 border-red-200">
              <RotateCcw className="w-4 h-4 mr-1.5" />
              Reset
            </Button>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleSave} disabled={!isModified || isSaving}>
                <Save className="w-4 h-4 mr-1.5" />
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </div>

        {/* Live preview — top on mobile, right pane on desktop */}
        <div
          className="order-1 lg:order-2 flex flex-1 flex-col z-10 overflow-hidden min-h-[38vh] max-h-[48vh] lg:min-h-0 lg:max-h-none lg:flex-1"
          style={{ background: '#e5e7eb' }}
        >
          {/* Preview header */}
          <div className="flex items-center justify-between px-4 sm:px-5 py-2 sm:py-2.5 bg-white border-b border-gray-200 shrink-0">
            <div>
              <h3 className="text-sm font-semibold text-gray-700">Live preview</h3>
              <p className="text-xs text-gray-500">
                {previewSpec.pageLabel} — zoomed to fit panel; print uses your typography and adds pages if needed
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex bg-gray-100 rounded-lg p-0.5">
                <button
                  onClick={() => setPreviewMode('desktop')}
                  className={`p-1.5 rounded-md transition ${previewMode === 'desktop' ? 'bg-white shadow text-primary-600' : 'text-gray-500 hover:text-gray-700'}`}
                  title="Desktop preview"
                >
                  <Monitor className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setPreviewMode('mobile')}
                  className={`p-1.5 rounded-md transition ${previewMode === 'mobile' ? 'bg-white shadow text-primary-600' : 'text-gray-500 hover:text-gray-700'}`}
                  title="Mobile preview"
                >
                  <Smartphone className="w-4 h-4" />
                </button>
              </div>
              {isModified && (
                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full font-medium">
                  Unsaved changes
                </span>
              )}
            </div>
          </div>

          <PreviewFrame
            iframeRef={iframeRef}
            previewMode={previewMode}
            previewLoading={previewLoading}
            previewSpec={previewSpec}
            onLoad={() => setPreviewLoading(false)}
          />
        </div>
      </div>
    </div>
  );
}


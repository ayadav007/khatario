'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import Link from 'next/link';
import { 
  FileText, Eye, Settings, Check, ChevronLeft, ArrowLeft,
  Sparkles, Download, Copy, Palette, Zap, Layout, Search, Loader2
} from 'lucide-react';
import { TemplatePreviewPlaceholder } from '@/components/templates/TemplatePreviewPlaceholder';
import { TemplatePreviewModal } from '@/components/templates/TemplatePreviewModal';
import { CopyTemplateDialog } from '@/components/templates/CopyTemplateDialog';
import CustomizeTemplateDrawer from '@/components/templates/CustomizeTemplateDrawer';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { getTemplatesForDocType, getTemplateCountByDocType } from '@/lib/template-registry-real';
import { UpgradeModal } from '@/components/subscription/UpgradeModal';
import { WIDE_PAGE_CONTENT_CLASS } from '@/lib/page-layout';

type DocumentType = 
  | 'tax_invoice' 
  | 'proforma_invoice' 
  | 'bill_of_supply' 
  | 'credit_note' 
  | 'debit_note' 
  | 'delivery_challan' 
  | 'sales_order' 
  | 'purchase_order';

type Template = {
  id: string;
  name: string;
  description: string;
  active: boolean;
  preview: string;
  features: string[];
  color: string;
  isComposition?: boolean;
};

export default function TemplatesPage() {
  const { business } = useAuth();
  const toast = useToastContext();
  const [activeDocType, setActiveDocType] = useState<DocumentType>('tax_invoice');
  const [previewModal, setPreviewModal] = useState<{ isOpen: boolean; template: Template | null }>({
    isOpen: false,
    template: null
  });
  const [copyDialog, setCopyDialog] = useState<{ isOpen: boolean; template: Template | null }>({
    isOpen: false,
    template: null
  });
  const [customizeDrawer, setCustomizeDrawer] = useState<{ isOpen: boolean; template: Template | null }>({
    isOpen: false,
    template: null
  });
  const [previewSettings, setPreviewSettings] = useState<any>(null);
  const [activeTemplates, setActiveTemplates] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState<string | null>(null);
  const [hasTemplateCustomization, setHasTemplateCustomization] = useState<boolean | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  /** Mobile: which template is shown in the large hero preview */
  const [focusTemplateId, setFocusTemplateId] = useState<string | null>(null);

  const templateCounts = getTemplateCountByDocType();

  const totalTemplates = useMemo(() => Object.values(templateCounts).reduce((s, c) => s + c, 0), [templateCounts]);
  const totalDocTypes = useMemo(() => Object.keys(templateCounts).filter(k => templateCounts[k] > 0).length, [templateCounts]);
  const totalActive = useMemo(() => Object.keys(activeTemplates).length, [activeTemplates]);

  const documentTypes = [
    { id: 'tax_invoice' as DocumentType, label: 'Tax Invoice', count: templateCounts['tax_invoice'] || 0, icon: '📄', color: 'blue' },
    { id: 'proforma_invoice' as DocumentType, label: 'Proforma Invoice', count: templateCounts['proforma_invoice'] || 0, icon: '📋', color: 'purple' },
    { id: 'bill_of_supply' as DocumentType, label: 'Bill of Supply', count: templateCounts['bill_of_supply'] || 0, badge: 'NEW', icon: '🧾', color: 'yellow' },
    { id: 'credit_note' as DocumentType, label: 'Credit Note', count: templateCounts['credit_note'] || 0, icon: '🔴', color: 'red' },
    { id: 'debit_note' as DocumentType, label: 'Debit Note', count: templateCounts['debit_note'] || 0, icon: '🟠', color: 'orange' },
    { id: 'delivery_challan' as DocumentType, label: 'Delivery Challan', count: templateCounts['delivery_challan'] || 0, icon: '🚚', color: 'cyan' },
    { id: 'sales_order' as DocumentType, label: 'Sales Order', count: templateCounts['sales_order'] || 0, icon: '📦', color: 'green' },
    { id: 'purchase_order' as DocumentType, label: 'Purchase Order', count: templateCounts['purchase_order'] || 0, icon: '🛒', color: 'indigo' },
    { id: 'payment_receipt' as DocumentType, label: 'Payment Receipt', count: templateCounts['payment_receipt'] || 0, icon: '💰', color: 'violet' },
  ];

  const getTemplates = (docType: DocumentType): Template[] => {
    const activeTemplateId = activeTemplates[docType];
    const registryTemplates = getTemplatesForDocType(docType);
    return registryTemplates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      active: activeTemplateId === t.id,
      preview: `/api/template-preview-image?template_id=${t.id}`,
      features: t.features,
      color: t.color,
      isComposition: t.isComposition,
    }));
  };

  // Fetch active template assignments and check feature access
  useEffect(() => {
    const fetchActiveTemplates = async () => {
      if (!business?.id) return;
      
      try {
        const response = await fetch(`/api/template-assignments?business_id=${business.id}`);
        const data = await response.json();
        
        if (data.success) {
          const assignments: Record<string, string> = {};
          data.assignments.forEach((assignment: any) => {
            assignments[assignment.document_type] = assignment.template_id;
          });
          setActiveTemplates(assignments);
        }
      } catch (error) {
        console.error('Error fetching active templates:', error);
      } finally {
        setLoading(false);
      }
    };

    const checkFeatureAccess = async () => {
      if (!business?.id) return;
      
      try {
        const response = await fetch(`/api/features/enabled?business_id=${business.id}`);
        const data = await response.json();
        const enabledFeatures = data.enabledIds || [];
        setHasTemplateCustomization(enabledFeatures.includes('settings_template_customization'));
      } catch (error) {
        console.error('Error checking feature access:', error);
        setHasTemplateCustomization(false);
      }
    };

    fetchActiveTemplates();
    checkFeatureAccess();
  }, [business?.id]);

  useEffect(() => {
    const list = getTemplates(activeDocType);
    const active = list.find((t) => t.active);
    const next = active?.id ?? list[0]?.id ?? null;
    setFocusTemplateId((prev) => {
      if (prev && list.some((t) => t.id === prev)) return prev;
      return next;
    });
  }, [activeDocType, activeTemplates]);

  const handlePreview = (template: Template) => {
    setPreviewModal({ isOpen: true, template });
  };

  const handleClosePreview = () => {
    setPreviewModal({ isOpen: false, template: null });
  };

  const handleActivate = async (templateId: string) => {
    if (!business?.id) {
      toast.error('Please log in to activate templates');
      return;
    }

    setActivating(templateId);

    try {
      const response = await fetch('/api/template-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          template_id: templateId,
          document_type: activeDocType
        })
      });

      const data = await response.json();

      if (data.success) {
        setActiveTemplates(prev => ({
          ...prev,
          [activeDocType]: templateId
        }));
        
        toast.success(`Template activated successfully!`);
      } else {
        toast.error(`Failed to activate template: ${data.error}`);
      }
    } catch (error) {
      console.error('Error activating template:', error);
      toast.error('Failed to activate template. Please try again.');
    } finally {
      setActivating(null);
    }
  };

  const handleCopyTemplate = (template: Template) => {
    setCopyDialog({ isOpen: true, template });
  };

  const handleCloseCopyDialog = () => {
    setCopyDialog({ isOpen: false, template: null });
  };

  const handleCopy = async (targetDocTypes: string[]) => {
    if (!business?.id || !copyDialog.template) return;

    try {
      const response = await fetch('/api/templates/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          template_id: copyDialog.template.id,
          source_doc_type: activeDocType,
          target_doc_types: targetDocTypes
        })
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`Template copied to ${targetDocTypes.length} document type(s)!`);
        
        const updates: Record<string, string> = {};
        targetDocTypes.forEach(docType => {
          updates[docType] = copyDialog.template!.id;
        });
        setActiveTemplates(prev => ({ ...prev, ...updates }));
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error('Error copying template:', error);
      throw error;
    }
  };

  const currentTemplates = getTemplates(activeDocType);
  const currentDocType = documentTypes.find(d => d.id === activeDocType);

  const focusedTemplate = useMemo(() => {
    if (!currentTemplates.length) return null;
    const byFocus = focusTemplateId ? currentTemplates.find((t) => t.id === focusTemplateId) : null;
    return byFocus ?? currentTemplates.find((t) => t.active) ?? currentTemplates[0] ?? null;
  }, [currentTemplates, focusTemplateId]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      {/* Custom Header - No AppLayout */}
      <header className="sticky top-0 z-50 bg-white/95 dark:bg-slate-950/95 backdrop-blur-xl border-b border-border shadow-sm">
        <div className="px-4 py-3 sm:px-6 sm:py-4">
          <div className={`flex flex-col gap-3 ${WIDE_PAGE_CONTENT_CLASS} mx-auto lg:flex-row lg:items-center lg:justify-between lg:gap-6`}>
            <div className="flex items-start gap-3 min-w-0">
              <Link href="/settings" className="shrink-0 mt-0.5">
                <button
                  type="button"
                  className="flex items-center gap-1.5 px-2 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-all font-medium group"
                >
                  <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform shrink-0" />
                  <span className="hidden xs:inline">All Settings</span>
                </button>
              </Link>
              <div className="hidden lg:block h-8 w-px bg-gray-300 dark:bg-slate-600 shrink-0" aria-hidden />
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="p-2 sm:p-2.5 bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 rounded-xl shadow-lg shadow-purple-200 shrink-0">
                  <Layout className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-base sm:text-xl font-bold text-text-primary truncate">
                    Templates & Printing
                  </h1>
                  <p className="text-[11px] sm:text-xs text-text-secondary line-clamp-2 sm:line-clamp-none">
                    Design beautiful documents for your business
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-0.5 -mx-1 px-1 scrollbar-thin lg:pb-0 lg:mx-0 lg:px-0 lg:overflow-visible">
              <div className="flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 bg-slate-50 rounded-xl border border-primary-200 shrink-0">
                <span className="text-xl sm:text-2xl font-bold text-primary-600">{totalTemplates}</span>
                <span className="text-[10px] sm:text-xs text-primary-600 font-medium">Templates</span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 bg-green-50 rounded-xl border border-green-200 shrink-0">
                <span className="text-xl sm:text-2xl font-bold text-green-600">{totalDocTypes}</span>
                <span className="text-[10px] sm:text-xs text-green-600 font-medium">Types</span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 bg-purple-50 rounded-xl border border-purple-200 shrink-0">
                <span className="text-xl sm:text-2xl font-bold text-purple-600">{totalActive}</span>
                <span className="text-[10px] sm:text-xs text-purple-600 font-medium">Active</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile: document types — horizontal chips (reference-style) */}
      <div className="lg:hidden bg-surface dark:bg-slate-900/70 border-b border-border">
        <div className="px-3 pt-2 pb-2">
          <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2 px-1">
            Document types
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:thin]">
            {documentTypes.map((docType) => (
              <button
                key={docType.id}
                type="button"
                onClick={() => setActiveDocType(docType.id)}
                className={`
                  shrink-0 flex items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-xs font-semibold transition-all border
                  ${
                    activeDocType === docType.id
                      ? 'bg-gradient-to-r from-primary-500 to-primary-600 text-white border-primary-500 shadow-md'
                      : 'bg-gray-50 dark:bg-slate-800/40 text-text-primary border-border hover:border-primary-200'
                  }
                `}
              >
                <span className="text-lg leading-none">{docType.icon}</span>
                <span className="max-w-[120px] truncate">{docType.label}</span>
                <span
                  className={`
                    text-[10px] px-1.5 py-0.5 rounded-md font-bold
                    ${
                      activeDocType === docType.id
                        ? 'bg-white/25 text-white'
                        : 'bg-gray-200 text-text-secondary'
                    }
                  `}
                >
                  {docType.count}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content: Sidebar + Gallery */}
      <div className={`flex flex-col lg:flex-row ${WIDE_PAGE_CONTENT_CLASS} mx-auto`}>
        {/* Left Sidebar — desktop only; mobile uses chips above */}
        <aside className="hidden lg:flex flex-col w-72 min-h-[calc(100vh-80px)] bg-surface dark:bg-slate-900/70 border-r border-border lg:sticky lg:top-[80px] shrink-0">
          <div className="p-4">
            <div className="mb-4">
              <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3 px-2">
                Document Types
              </h3>
            </div>
            
            <nav className="space-y-1.5">
              {documentTypes.map((docType) => (
                <button
                  key={docType.id}
                  onClick={() => setActiveDocType(docType.id)}
                  className={`
                    w-full text-left px-4 py-3.5 rounded-xl text-sm font-medium transition-all
                    flex items-center justify-between group relative overflow-hidden
                    ${activeDocType === docType.id 
                      ? 'bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-lg shadow-primary-200' 
                      : 'text-text-secondary hover:bg-gray-100 dark:hover:bg-slate-800'
                    }
                  `}
                >
                  {activeDocType === docType.id && (
                    <div className="absolute inset-0 bg-gradient-to-r from-white/20 to-transparent opacity-50"></div>
                  )}
                  
                  <span className="flex items-center gap-3 relative z-10">
                    <span className="text-xl">{docType.icon}</span>
                    <span className="flex flex-col">
                      <span className={`font-semibold ${activeDocType === docType.id ? 'text-white' : 'text-text-primary'}`}>
                        {docType.label}
                      </span>
                      {docType.badge && (
                        <span className="text-xs bg-yellow-400 text-yellow-900 px-2 py-0.5 rounded-full font-bold mt-1 w-fit flex items-center gap-1">
                          <Sparkles className="w-2.5 h-2.5" />
                          {docType.badge}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className={`
                    relative z-10 text-xs px-2.5 py-1 rounded-lg font-bold
                    ${activeDocType === docType.id 
                      ? 'bg-white/25 text-white' 
                      : 'bg-gray-200 text-text-secondary group-hover:bg-gray-300'
                    }
                  `}>
                    {docType.count}
                  </span>
                </button>
              ))}
            </nav>
          </div>
        </aside>

        {/* Template gallery */}
        <main className="flex-1 px-4 py-4 sm:px-6 sm:py-6 lg:p-8 min-h-[calc(100vh-80px)]">
          {/* Mobile: large preview on top, template strip + actions (reference-style) */}
          {focusedTemplate && (
            <div className="lg:hidden space-y-4 mb-6">
              <div>
                <h2 className="text-lg font-bold text-text-primary">{currentDocType?.label} templates</h2>
                <p className="text-xs text-text-secondary mt-0.5">
                  Tap a thumbnail to preview · {currentTemplates.length} designs
                </p>
              </div>
              <div className="relative rounded-2xl overflow-hidden border-2 border-border bg-gradient-to-br from-gray-50 to-white shadow-inner max-h-[min(52vh,420px)]">
                <div className="aspect-[3/4] max-h-[min(52vh,420px)] relative">
                  <img
                    src={`/api/template-preview-image?template_id=${focusedTemplate.id}&t=${Date.now()}`}
                    alt={focusedTemplate.name}
                    className="w-full h-full object-cover object-top"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      e.currentTarget.nextElementSibling?.classList.remove('hidden');
                    }}
                  />
                  <div className="hidden absolute inset-0">
                    <TemplatePreviewPlaceholder
                      templateId={focusedTemplate.id}
                      templateName={focusedTemplate.name}
                      color={focusedTemplate.color}
                      isComposition={focusedTemplate.isComposition}
                    />
                  </div>
                  {focusedTemplate.active && (
                    <div className="absolute top-3 right-3 z-20 bg-gradient-to-r from-emerald-500 to-green-500 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-1.5 shadow-lg">
                      <Check className="w-3.5 h-3.5" />
                      ACTIVE
                    </div>
                  )}
                  <div className="absolute bottom-3 left-3 right-3 flex flex-wrap gap-1.5">
                    {focusedTemplate.features.slice(0, 4).map((feature, idx) => (
                      <span
                        key={idx}
                        className="text-[10px] sm:text-xs bg-white/95 backdrop-blur-sm text-text-secondary px-2 py-1 rounded-md font-semibold shadow border border-border/80"
                      >
                        {feature}
                      </span>
                    ))}
                    {focusedTemplate.features.length > 4 && (
                      <span className="text-[10px] bg-white/95 text-text-secondary px-2 py-1 rounded-md font-semibold border border-border/80">
                        +{focusedTemplate.features.length - 4} more
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2 px-0.5">
                  Choose template
                </p>
                <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 [scrollbar-width:thin]">
                  {currentTemplates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => setFocusTemplateId(template.id)}
                      className={`
                        shrink-0 w-[4.5rem] rounded-xl overflow-hidden border-2 transition-all
                        ${
                          focusTemplateId === template.id || (!focusTemplateId && template.active)
                            ? 'border-primary-500 ring-2 ring-primary-100 shadow-md'
                            : 'border-border opacity-90 hover:border-primary-200'
                        }
                      `}
                    >
                      <div className="aspect-[3/4] bg-gray-100 relative">
                        <img
                          src={`/api/template-preview-image?template_id=${template.id}`}
                          alt=""
                          className="w-full h-full object-cover object-top"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            e.currentTarget.nextElementSibling?.classList.remove('hidden');
                          }}
                        />
                        <div className="hidden absolute inset-0">
                          <TemplatePreviewPlaceholder
                            templateId={template.id}
                            templateName={template.name}
                            color={template.color}
                            isComposition={template.isComposition}
                          />
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-surface dark:bg-slate-900/70 p-4 space-y-3">
                <div>
                  <h3 className="font-bold text-text-primary">{focusedTemplate.name}</h3>
                  <p className="text-sm text-text-secondary mt-1">{focusedTemplate.description}</p>
                </div>
                <div className="flex flex-col gap-2">
                  {!focusedTemplate.active && (
                    <Button
                      variant="primary"
                      className="w-full justify-center"
                      onClick={() => handleActivate(focusedTemplate.id)}
                      disabled={activating === focusedTemplate.id}
                    >
                      {activating === focusedTemplate.id ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4 mr-2" />
                      )}
                      {activating === focusedTemplate.id ? 'Activating…' : 'Use this template'}
                    </Button>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="secondary" size="sm" className="w-full" onClick={() => handlePreview(focusedTemplate)}>
                      <Eye className="w-4 h-4 mr-1.5" />
                      Full preview
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full"
                      onClick={() => setCustomizeDrawer({ isOpen: true, template: focusedTemplate })}
                    >
                      <Palette className="w-4 h-4 mr-1.5" />
                      Customize
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-text-secondary"
                    onClick={() => handleCopyTemplate(focusedTemplate)}
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    Copy to other document types
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Section Header — desktop */}
          <div className="mb-8 hidden lg:block">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-gradient-to-br from-gray-100 to-gray-200 rounded-2xl">
                  <span className="text-4xl">{currentDocType?.icon}</span>
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-text-primary">
                    {currentDocType?.label} Templates
                  </h2>
                  <p className="text-sm text-text-secondary mt-1">
                    Choose from {currentTemplates.length} professionally designed templates
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <Button variant="secondary" size="sm">
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </Button>
                <Button 
                  variant="primary" 
                  size="sm"
                  disabled={!currentTemplates.find(t => t.active)}
                  onClick={() => {
                    const active = currentTemplates.find(t => t.active);
                    if (active) setCustomizeDrawer({ isOpen: true, template: active });
                  }}
                >
                  <Settings className="w-4 h-4 mr-2" />
                  Customize Active
                </Button>
              </div>
            </div>
          </div>

          {/* Templates Grid — desktop */}
          <div className="hidden lg:grid lg:grid-cols-2 gap-8 mb-8">
            {currentTemplates.map((template) => (
              <div
                key={template.id}
                className={`
                  relative border-2 rounded-2xl overflow-hidden cursor-pointer
                  transition-all duration-300 group bg-surface dark:bg-slate-900/70
                  ${template.active 
                    ? 'border-primary-400 shadow-2xl shadow-primary-100 ring-4 ring-primary-50' 
                    : 'border-border hover:border-primary-200 hover:shadow-xl'
                  }
                `}
              >
                {/* Active Badge */}
                {template.active && (
                  <div className="absolute top-4 right-4 z-20 bg-gradient-to-r from-emerald-500 to-green-500 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-xl">
                    <Check className="w-4 h-4" />
                    ACTIVE
                  </div>
                )}

                {/* Template Preview - Larger */}
                <div className="aspect-[3/4] bg-gradient-to-br from-gray-50 via-white to-gray-100 relative overflow-hidden border-b-2 border-border">
                  {/* Actual Template Screenshot */}
                  <img
                    src={`/api/template-preview-image?template_id=${template.id}`}
                    alt={template.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      // Fallback to placeholder if image fails to load
                      e.currentTarget.style.display = 'none';
                      e.currentTarget.nextElementSibling?.classList.remove('hidden');
                    }}
                  />
                  {/* Fallback placeholder (hidden by default) */}
                  <div className="hidden absolute inset-0">
                    <TemplatePreviewPlaceholder
                      templateId={template.id}
                      templateName={template.name}
                      color={template.color}
                      isComposition={template.isComposition}
                    />
                  </div>
                  
                  {/* Feature Tags */}
                  <div className="absolute bottom-4 left-4 right-4 flex flex-wrap gap-2">
                    {template.features.slice(0, 3).map((feature, idx) => (
                      <span key={idx} className="text-xs bg-white/95 backdrop-blur-sm text-text-secondary px-3 py-1.5 rounded-lg font-semibold shadow-md border border-border">
                        {feature}
                      </span>
                    ))}
                    {template.features.length > 3 && (
                      <span className="text-xs bg-white/95 backdrop-blur-sm text-text-secondary px-3 py-1.5 rounded-lg font-semibold shadow-md border border-border">
                        +{template.features.length - 3} more
                      </span>
                    )}
                  </div>
                  
                      {/* Hover Overlay */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-end justify-center pb-8">
                        <div className="flex gap-3">
                          <button 
                            onClick={() => handlePreview(template)}
                            className="px-5 py-3 bg-surface dark:bg-slate-900/70 text-text-primary rounded-xl text-sm font-bold hover:bg-gray-50 dark:bg-slate-800/40 dark:hover:bg-slate-800/70 transition flex items-center gap-2 shadow-2xl transform hover:scale-105"
                          >
                            <Eye className="w-4 h-4" />
                            Preview
                          </button>
                          {!template.active && (
                            <button 
                              onClick={() => handleActivate(template.id)}
                              disabled={activating === template.id}
                              className="px-5 py-3 bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-xl text-sm font-bold hover:from-primary-700 hover:to-primary-800 transition shadow-2xl transform hover:scale-105 disabled:opacity-70"
                            >
                              {activating === template.id ? (
                                <Loader2 className="w-4 h-4 mr-2 inline animate-spin" />
                              ) : (
                                <Check className="w-4 h-4 mr-2 inline" />
                              )}
                              {activating === template.id ? 'Activating...' : 'Activate'}
                            </button>
                          )}
                          <button 
                            onClick={() => setCustomizeDrawer({ isOpen: true, template })}
                            className="px-5 py-3 bg-white/95 text-text-secondary rounded-xl text-sm font-bold hover:bg-surface dark:bg-slate-900/70 transition flex items-center gap-2 shadow-2xl transform hover:scale-105"
                            title="Customize template"
                          >
                            <Palette className="w-4 h-4" />
                            Customize
                          </button>
                          <button 
                            onClick={() => handleCopyTemplate(template)}
                            className="p-3 bg-white/95 text-text-secondary rounded-xl hover:bg-surface dark:bg-slate-900/70 transition shadow-2xl transform hover:scale-105"
                            title="Copy template settings to other document types"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                </div>

                {/* Template Footer */}
                <div className={`p-5 ${template.active ? 'bg-gradient-to-r from-slate-50 to-purple-50' : 'bg-surface dark:bg-slate-900/70'}`}>
                  <h4 className="font-bold text-base text-text-primary mb-1">{template.name}</h4>
                  <p className="text-sm text-text-secondary">{template.description}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Info Box — desktop; mobile keeps screen for preview + actions */}
          <div className="hidden lg:block p-6 bg-gradient-to-r from-slate-50 via-indigo-50 to-purple-50 border-2 border-indigo-200 rounded-2xl">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-gradient-to-br from-primary-500 to-indigo-600 rounded-xl shadow-lg">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h4 className="text-base font-bold text-text-primary mb-3 flex items-center gap-2">
                  💡 Pro Tips for Templates
                </h4>
                <ul className="text-sm text-text-secondary space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-primary-500 font-bold">•</span>
                    <span><strong>Preview</strong> templates before activating to see how they look with your data</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary-500 font-bold">•</span>
                    <span><strong>Customize</strong> active templates to match your brand colors and logo</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary-500 font-bold">•</span>
                    <span><strong>Test print</strong> templates to ensure they look good on paper</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary-500 font-bold">•</span>
                    <span><strong>Different templates</strong> can be set for different document types</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Preview Modal */}
      {previewModal.template && (
        <TemplatePreviewModal
          isOpen={previewModal.isOpen}
          onClose={() => {
            handleClosePreview();
            setPreviewSettings(null);
          }}
          template={previewModal.template}
          onActivate={() => {
            handleActivate(previewModal.template!.id);
            handleClosePreview();
            setPreviewSettings(null);
          }}
          customSettings={previewSettings}
        />
      )}

      {/* Copy Template Dialog */}
      {copyDialog.template && (
        <CopyTemplateDialog
          isOpen={copyDialog.isOpen}
          onClose={handleCloseCopyDialog}
          template={copyDialog.template}
          currentDocType={activeDocType}
          onCopy={handleCopy}
        />
      )}

      {/* Upgrade Modal */}
      {showUpgradeModal && (
        <UpgradeModal
          limitType="feature"
          featureName="Template Customization"
          onClose={() => setShowUpgradeModal(false)}
        />
      )}

      {/* Customize Template Drawer */}
      {customizeDrawer.template && (
        <CustomizeTemplateDrawer
          isOpen={customizeDrawer.isOpen}
          onClose={() => setCustomizeDrawer({ isOpen: false, template: null })}
          templateId={customizeDrawer.template.id}
          templateName={customizeDrawer.template.name}
          documentType={activeDocType}
          onSave={async (settings) => {
            const response = await fetch('/api/template-assignments', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                business_id: business?.id,
                document_type: activeDocType,
                settings
              })
            });

            if (!response.ok) {
              throw new Error('Failed to save template settings');
            }
          }}
          isPaidFeature={hasTemplateCustomization ?? false}
          onPreview={(settings) => {
            if (customizeDrawer.template) {
              setPreviewSettings(settings);
              setPreviewModal({ isOpen: true, template: customizeDrawer.template });
            }
          }}
        />
      )}
    </div>
  );
}


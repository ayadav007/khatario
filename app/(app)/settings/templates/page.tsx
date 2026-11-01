'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import Link from 'next/link';
import {
  ArrowLeft, Check, Copy, Eye, FileMinus, FilePlus, FileSignature, FileText, Loader2, Palette,
  Receipt, ShoppingBag, ShoppingCart, Truck, Wallet, type LucideIcon,
} from 'lucide-react';
import { TemplatePreviewPlaceholder } from '@/components/templates/TemplatePreviewPlaceholder';
import { TemplatePreviewModal } from '@/components/templates/TemplatePreviewModal';
import { CopyTemplateDialog } from '@/components/templates/CopyTemplateDialog';
import { useRouter } from 'next/navigation';
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
  | 'purchase_order'
  | 'payment_receipt';

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
  const router = useRouter();
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
  const openDesigner = (template: Template) =>
    router.push(`/settings/templates/design?template=${encodeURIComponent(template.id)}&doc=${activeDocType}`);
  const [previewSettings, setPreviewSettings] = useState<any>(null);
  const [activeTemplates, setActiveTemplates] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState<string | null>(null);
  const [hasTemplateCustomization, setHasTemplateCustomization] = useState<boolean | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [loadedThumbs, setLoadedThumbs] = useState<Record<string, boolean>>({});

  const templateCounts = getTemplateCountByDocType();

  const documentTypes: { id: DocumentType; label: string; count: number; icon: LucideIcon }[] = [
    { id: 'tax_invoice', label: 'Tax invoice', count: templateCounts['tax_invoice'] || 0, icon: FileText },
    { id: 'proforma_invoice', label: 'Proforma invoice', count: templateCounts['proforma_invoice'] || 0, icon: FileSignature },
    { id: 'bill_of_supply', label: 'Bill of supply', count: templateCounts['bill_of_supply'] || 0, icon: Receipt },
    { id: 'credit_note', label: 'Credit note', count: templateCounts['credit_note'] || 0, icon: FileMinus },
    { id: 'debit_note', label: 'Debit note', count: templateCounts['debit_note'] || 0, icon: FilePlus },
    { id: 'delivery_challan', label: 'Delivery challan', count: templateCounts['delivery_challan'] || 0, icon: Truck },
    { id: 'sales_order', label: 'Sales order', count: templateCounts['sales_order'] || 0, icon: ShoppingBag },
    { id: 'purchase_order', label: 'Purchase order', count: templateCounts['purchase_order'] || 0, icon: ShoppingCart },
    { id: 'payment_receipt', label: 'Payment receipt', count: templateCounts['payment_receipt'] || 0, icon: Wallet },
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

  // Open on the document type in the URL (the designer's Back link sends it), and keep it there.
  useEffect(() => {
    const doc = new URLSearchParams(window.location.search).get('doc');
    if (doc && documentTypes.some((d) => d.id === doc)) setActiveDocType(doc as DocumentType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const chooseDocType = (doc: DocumentType) => {
    setActiveDocType(doc);
    window.history.replaceState(null, '', `/settings/templates?doc=${doc}`);
  };

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
  const activeTemplate = currentTemplates.find((t) => t.active);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <div className={`${WIDE_PAGE_CONTENT_CLASS} mx-auto px-4 py-5 sm:px-6 lg:py-8`}>
        <header className="mb-6 min-w-0">
          <Link href="/settings" className="mb-2 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Settings
          </Link>
          <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl dark:text-white">Templates and printing</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Pick a design for each document, then customise it to match your brand.</p>
        </header>

        {/* Phone: document types as a scrolling row */}
        <nav aria-label="Document types" className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden [scrollbar-width:none]">
          {documentTypes.map((d) => {
            const on = d.id === activeDocType;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => chooseDocType(d.id)}
                aria-current={on ? 'page' : undefined}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${
                  on
                    ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
                    : 'border-gray-200 bg-white text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                <d.icon className="h-4 w-4" aria-hidden />
                {d.label}
              </button>
            );
          })}
        </nav>

        <div className="flex gap-8">
          {/* Desktop: document types */}
          <nav aria-label="Document types" className="sticky top-6 hidden w-56 shrink-0 self-start lg:block">
            <ul className="space-y-0.5">
              {documentTypes.map((d) => {
                const on = d.id === activeDocType;
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => chooseDocType(d.id)}
                      aria-current={on ? 'page' : undefined}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        on
                          ? 'bg-white font-medium text-gray-900 shadow-sm ring-1 ring-gray-200 dark:bg-slate-800 dark:text-white dark:ring-slate-700'
                          : 'text-gray-600 hover:bg-white hover:text-gray-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <d.icon className={`h-4 w-4 shrink-0 ${on ? 'text-primary-600 dark:text-primary-300' : 'text-gray-400'}`} aria-hidden />
                      <span className="flex-1 truncate">{d.label}</span>
                      <span className="text-xs tabular-nums text-gray-400">{d.count}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <main className="min-w-0 flex-1">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">{currentDocType?.label} templates</h2>
                <p className="text-sm text-gray-500 dark:text-slate-400">
                  {currentTemplates.length} {currentTemplates.length === 1 ? 'design' : 'designs'}
                  {activeTemplate ? ` · using ${activeTemplate.name}` : ' · none chosen yet, so the default is used'}
                </p>
              </div>
              {activeTemplate && (
                <Button variant="primary" size="sm" onClick={() => openDesigner(activeTemplate)}>
                  <Palette className="mr-1.5 h-4 w-4" aria-hidden />
                  Customise {activeTemplate.name}
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 2xl:grid-cols-4">
              {currentTemplates.map((template) => (
                <article
                  key={template.id}
                  className={`group flex flex-col overflow-hidden rounded-xl border bg-white transition-shadow hover:shadow-md dark:bg-slate-900 ${
                    template.active ? 'border-primary-500 ring-1 ring-primary-500' : 'border-gray-200 dark:border-slate-700'
                  }`}
                >
                  <div className="relative aspect-[3/4] overflow-hidden border-b border-gray-100 bg-gray-100 dark:border-slate-800 dark:bg-slate-800">
                    {!loadedThumbs[template.id] && (
                      <div className="absolute inset-0 animate-pulse bg-gradient-to-b from-gray-100 to-gray-200 dark:from-slate-800 dark:to-slate-700" aria-hidden />
                    )}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={template.preview}
                      alt={`${template.name} template`}
                      loading="lazy"
                      onLoad={() => setLoadedThumbs((m) => ({ ...m, [template.id]: true }))}
                      className="relative h-full w-full object-cover object-top"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        e.currentTarget.nextElementSibling?.classList.remove('hidden');
                        setLoadedThumbs((m) => ({ ...m, [template.id]: true }));
                      }}
                    />
                    <div className="absolute inset-0 hidden">
                      <TemplatePreviewPlaceholder
                        templateId={template.id}
                        templateName={template.name}
                        color={template.color}
                        isComposition={template.isComposition}
                      />
                    </div>
                    {template.active && (
                      <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-primary-600 px-2 py-0.5 text-xs font-medium text-white shadow-sm">
                        <Check className="h-3 w-3" aria-hidden />
                        In use
                      </span>
                    )}
                    {/* Desktop: actions on hover or keyboard focus */}
                    <div className="absolute inset-x-0 bottom-0 hidden translate-y-2 gap-1.5 bg-gradient-to-t from-black/55 to-transparent p-2.5 pt-10 opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 lg:flex">
                      <button
                        type="button"
                        onClick={() => handlePreview(template)}
                        className="inline-flex min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-lg bg-white/95 px-1.5 py-1.5 text-[11px] font-medium text-gray-900 hover:bg-white"
                      >
                        <Eye className="h-3.5 w-3.5" aria-hidden />
                        Preview
                      </button>
                      <button
                        type="button"
                        onClick={() => openDesigner(template)}
                        className="inline-flex min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-lg bg-white/95 px-1.5 py-1.5 text-[11px] font-medium text-gray-900 hover:bg-white"
                      >
                        <Palette className="h-3.5 w-3.5" aria-hidden />
                        Customise
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col p-3 sm:p-4">
                    <h3 className="text-sm font-medium text-gray-900 dark:text-white">{template.name}</h3>
                    <p className="mt-0.5 line-clamp-2 text-xs text-gray-500 dark:text-slate-400">{template.description}</p>
                    <div className="mt-2 hidden flex-wrap gap-1 sm:flex">
                      {template.features.slice(0, 3).map((feature) => (
                        <span key={feature} className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-slate-800 dark:text-slate-300">
                          {feature}
                        </span>
                      ))}
                    </div>
                    <div className="mt-auto flex items-center gap-2 pt-3">
                      {template.active ? (
                        <span className="hidden whitespace-nowrap text-xs font-medium text-primary-700 sm:inline dark:text-primary-300">In use</span>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleActivate(template.id)}
                          disabled={activating === template.id}
                        >
                          {activating === template.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                          {activating === template.id ? 'Switching…' : 'Use'}
                        </Button>
                      )}
                      <div className="flex-1" />
                      <button
                        type="button"
                        onClick={() => handlePreview(template)}
                        aria-label={`Preview ${template.name}`}
                        className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 lg:hidden dark:hover:bg-slate-800"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openDesigner(template)}
                        aria-label={`Customise ${template.name}`}
                        className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 lg:hidden dark:hover:bg-slate-800"
                      >
                        <Palette className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopyTemplate(template)}
                        title="Use these settings for other documents"
                        aria-label={`Copy ${template.name} settings to other documents`}
                        className="hidden rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 sm:inline-flex dark:hover:bg-slate-800"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </main>
        </div>
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

    </div>
  );
}


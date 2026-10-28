'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { TemplateDesigner } from '@/components/templates/designer/TemplateDesigner';
import { getTemplateById } from '@/lib/template-registry-real';

function DesignerFromQuery() {
  const params = useSearchParams();
  const templateId = params.get('template') || 'gst_standard';
  const template = getTemplateById(templateId);
  const doc = params.get('doc');
  const documentType = doc && template?.documentTypes.includes(doc) ? doc : template?.documentTypes[0] || 'tax_invoice';
  // Remount on a different template or document type so state starts clean.
  return <TemplateDesigner key={`${templateId}:${documentType}`} templateId={templateId} documentType={documentType} />;
}

export default function TemplateDesignPage() {
  return (
    <Suspense fallback={null}>
      <DesignerFromQuery />
    </Suspense>
  );
}

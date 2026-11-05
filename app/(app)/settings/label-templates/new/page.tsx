'use client';

export const dynamic = 'force-dynamic';

import { LabelTemplateEditor } from '@/components/labels/LabelTemplateEditor';
import { useFeatureRegistry } from '@/hooks/useFeatureRegistry';
import { FileText, Loader2 } from 'lucide-react';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { PlanFeatureDeniedCallout } from '@/components/subscription/PlanFeatureDeniedCallout';

export default function NewLabelTemplatePage() {
  const { hasFeature, loading } = useFeatureRegistry();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-text-secondary" />
      </div>
    );
  }

  if (!hasFeature('barcode_label_templates')) {
    return (
      <SettingsPageShell title="Label templates" description="Design barcode and price labels for your items." icon={FileText}>
        <PlanFeatureDeniedCallout
          featureKey="barcode_label_templates"
          title="Label designer isn't in your plan"
          description="Upgrade to design your own barcode and price labels."
        />
      </SettingsPageShell>
    );
  }

  return <LabelTemplateEditor mode="new" />;
}

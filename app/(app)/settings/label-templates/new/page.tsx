'use client';

export const dynamic = 'force-dynamic';

import { LabelTemplateEditor } from '@/components/labels/LabelTemplateEditor';
import { useFeatureRegistry } from '@/hooks/useFeatureRegistry';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';

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
      <div className="max-w-2xl mx-auto py-16 text-center">
        <h2 className="text-xl font-semibold">Feature not available</h2>
        <p className="text-text-secondary mt-2">
          The Label Template Designer isn't on your plan.
        </p>
        <Link
          href="/settings/label-templates"
          className="inline-block mt-4 text-primary-600 hover:underline"
        >
          Back to templates
        </Link>
      </div>
    );
  }

  return <LabelTemplateEditor mode="new" />;
}

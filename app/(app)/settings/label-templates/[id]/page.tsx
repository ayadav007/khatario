'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import {
  LabelTemplateEditor,
  serverTemplateToState,
} from '@/components/labels/LabelTemplateEditor';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { useFeatureRegistry } from '@/hooks/useFeatureRegistry';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';

export default function EditLabelTemplatePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { business, user } = useAuth();
  const toast = useToastContext();
  const { hasFeature, loading: featuresLoading } = useFeatureRegistry();

  const [state, setState] = useState<ReturnType<
    typeof serverTemplateToState
  > | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSystem, setIsSystem] = useState(false);

  useEffect(() => {
    if (!id || !business?.id || !user?.id) return;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        const res = await fetch(
          `/api/label-templates/${id}?business_id=${business.id}&user_id=${user.id}`
        );
        const data = await safeJsonParse<{ template: Record<string, unknown> }>(res);
        if (!res.ok)
          throw new Error(getApiErrorMessage(data, 'Failed to load'));
        if (cancelled) return;
        if (!data?.template) throw new Error('Invalid template response');
        if (Boolean(data.template.is_system)) {
          setIsSystem(true);
          setLoading(false);
          return;
        }
        setState(serverTemplateToState(data.template));
      } catch (err: any) {
        if (!cancelled) toast.error(err?.message || 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, business?.id, user?.id, toast]);

  if (featuresLoading || loading) {
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
      </div>
    );
  }

  if (isSystem) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <h2 className="text-xl font-semibold">System templates are read-only</h2>
        <p className="text-text-secondary mt-2">
          To customise this template, click <b>Duplicate</b> from the list
          page and edit the copy.
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

  if (!state) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <h2 className="text-xl font-semibold">Template not found</h2>
      </div>
    );
  }

  return <LabelTemplateEditor mode="edit" initialTemplate={state} />;
}

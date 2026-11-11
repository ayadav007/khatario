'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { FileText, Loader2 } from 'lucide-react';
import {
  LabelTemplateEditor,
  serverTemplateToState,
} from '@/components/labels/LabelTemplateEditor';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { useFeatureRegistry } from '@/hooks/useFeatureRegistry';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { PlanFeatureDeniedCallout } from '@/components/subscription/PlanFeatureDeniedCallout';
import { EmptyState } from '@/components/ui/EmptyState';

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
      <SettingsPageShell title="Label templates" description="Design barcode and price labels for your items." icon={FileText}>
        <PlanFeatureDeniedCallout
          featureKey="barcode_label_templates"
          title="Label designer isn't in your plan"
          description="Upgrade to design your own barcode and price labels."
        />
      </SettingsPageShell>
    );
  }

  if (isSystem) {
    return (
      <SettingsPageShell title="Label templates" icon={FileText}>
        <EmptyState
          className="card"
          icon={FileText}
          title="System templates are read-only"
          description={<>To customise this template, choose <b>Duplicate</b> on the list page and edit the copy.</>}
          action={<Link href="/settings/label-templates" className="inline-flex min-h-11 items-center rounded-lg px-3 font-medium text-primary-600 hover:bg-gray-100 dark:text-primary-200 dark:hover:bg-slate-800">Back to label templates</Link>}
        />
      </SettingsPageShell>
    );
  }

  if (!state) {
    return (
      <SettingsPageShell title="Label templates" icon={FileText}>
        <EmptyState
          className="card"
          icon={FileText}
          title="Template not found"
          description="It may have been deleted."
          action={<Link href="/settings/label-templates" className="inline-flex min-h-11 items-center rounded-lg px-3 font-medium text-primary-600 hover:bg-gray-100 dark:text-primary-200 dark:hover:bg-slate-800">Back to label templates</Link>}
        />
      </SettingsPageShell>
    );
  }

  return <LabelTemplateEditor mode="edit" initialTemplate={state} />;
}

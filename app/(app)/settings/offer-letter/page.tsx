'use client';



export const dynamic = 'force-dynamic';



import React, { useCallback, useEffect, useRef, useState } from 'react';

import { Check, Eye, FileText, Loader2, RefreshCw } from 'lucide-react';

import { clsx } from 'clsx';

import { useAuth } from '@/contexts/AuthContext';

import { useToastContext } from '@/contexts/ToastContext';

import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';

import { SettingsPageShell } from '@/components/settings/SettingsPageShell';

import { AccessDenied } from '@/components/common/AccessDenied';

import { Card } from '@/components/ui/Card';

import { Button } from '@/components/ui/Button';

import { Input } from '@/components/ui/Input';

import type { OfferLetterTemplateSettings } from '@/lib/hr/offer-letter-template-settings';

import type { OfferLetterTemplateMeta } from '@/lib/offer-letter-template-registry';



const CLAUSE_FIELDS = [

  ['body_intro', 'Introduction paragraph'],

  ['probation_clause', 'Probation clause'],

  ['notice_period_clause', 'Notice period clause'],

  ['additional_terms', 'Additional terms'],

  ['footer_text', 'Footer text'],

] as const;



const TEMPLATE_ACCENT: Record<string, string> = {

  standard: 'border-gray-300 bg-gray-50',

  formal: 'border-gray-800 bg-gray-100',

  minimal: 'border-slate-300 bg-slate-50',

  startup: 'border-sky-400 bg-sky-50',

};



export default function OfferLetterSettingsPage() {

  const { business, user } = useAuth();

  const toast = useToastContext();

  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);

  const [settings, setSettings] = useState<OfferLetterTemplateSettings | null>(null);

  const [templateId, setTemplateId] = useState('standard');

  const [templates, setTemplates] = useState<OfferLetterTemplateMeta[]>([]);

  const [previewKey, setPreviewKey] = useState(0);

  const [autoRefresh, setAutoRefresh] = useState(true);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);



  const { status: authStatus } = useAuthorizationGuard({

    resource: 'settings',

    action: 'read',

    skipCheck: !user?.id || !business?.id,

  });



  const qs = () =>

    new URLSearchParams({ business_id: business!.id, user_id: user!.id }).toString();



  const fetchSettings = useCallback(async () => {

    if (!business?.id || !user?.id) return;

    setLoading(true);

    try {

      const res = await fetch(`/api/settings/offer-letter-template?${qs()}`);

      if (res.ok) {

        const data = await res.json();

        setSettings(data.settings);

        setTemplateId(data.template_id ?? 'standard');

        setTemplates(data.templates ?? []);

      }

    } finally {

      setLoading(false);

    }

  }, [business?.id, user?.id]);



  useEffect(() => {

    void fetchSettings();

  }, [fetchSettings]);



  useEffect(() => {

    if (!autoRefresh || !settings) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => setPreviewKey((k) => k + 1), 800);

    return () => {

      if (debounceRef.current) clearTimeout(debounceRef.current);

    };

  }, [settings, templateId, autoRefresh]);



  const getPreviewUrl = () => {

    if (!settings || !business?.id || !user?.id) return '';

    const settingsJson = encodeURIComponent(JSON.stringify(settings));

    return `/api/settings/offer-letter-template/preview?${qs()}&template_id=${encodeURIComponent(templateId)}&settings=${settingsJson}&t=${previewKey}`;

  };



  const selectTemplate = (id: string) => {

    setTemplateId(id);

    setPreviewKey((k) => k + 1);

  };



  const save = async (templateOnly = false) => {

    if (!settings || !business?.id || !user?.id) return;

    setSaving(true);

    try {

      const res = await fetch(`/api/settings/offer-letter-template?${qs()}`, {

        method: 'PATCH',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify(

          templateOnly ? { template_id: templateId } : { template_id: templateId, settings },

        ),

      });

      if (res.ok) {

        toast.success(templateOnly ? 'Layout updated' : 'Offer letter template saved');

        setPreviewKey((k) => k + 1);

      } else {

        const err = await res.json();

        toast.error(err.error || 'Failed to save');

      }

    } catch {

      toast.error('Failed to save');

    } finally {

      setSaving(false);

    }

  };



  if (authStatus === 'denied') return <AccessDenied module="settings" action="read" />;



  return (

    <SettingsPageShell

      title="Offer letter template"

      description="Pick a layout and customize legal text — preview updates as you edit"

      icon={FileText}

    >

      {loading ? (

        <div className="flex justify-center py-12">

          <Loader2 className="h-8 w-8 animate-spin text-text-muted" />

        </div>

      ) : settings ? (

        <div className="space-y-6">

          {/* Template picker */}

          <div>

            <h2 className="mb-3 text-sm font-semibold text-text-primary">Choose layout</h2>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">

              {templates.map((t) => {

                const active = t.id === templateId;

                return (

                  <button

                    key={t.id}

                    type="button"

                    onClick={() => selectTemplate(t.id)}

                    className={clsx(

                      'relative rounded-xl border-2 p-4 text-left transition-shadow',

                      active

                        ? 'border-primary-500 shadow-md ring-2 ring-primary-100'

                        : 'border-border hover:border-gray-400 hover:shadow-sm',

                    )}

                  >

                    {active && (

                      <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold uppercase text-green-800">

                        <Check className="h-3 w-3" /> Active

                      </span>

                    )}

                    <div

                      className={clsx(

                        'mb-3 h-16 rounded-lg border',

                        TEMPLATE_ACCENT[t.id] ?? 'border-border bg-gray-50',

                      )}

                    />

                    <p className="font-semibold text-text-primary">{t.name}</p>

                    <p className="mt-1 text-xs text-text-secondary line-clamp-2">{t.description}</p>

                    <ul className="mt-2 flex flex-wrap gap-1">

                      {t.features.slice(0, 2).map((f) => (

                        <li

                          key={f}

                          className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-text-muted"

                        >

                          {f}

                        </li>

                      ))}

                    </ul>

                  </button>

                );

              })}

            </div>

            <div className="mt-3">

              <Button

                type="button"

                variant="secondary"

                size="sm"

                onClick={() => save(true)}

                disabled={saving}

              >

                Save layout selection

              </Button>

            </div>

          </div>



          <div className="flex min-h-[calc(100vh-14rem)] flex-col gap-4 lg:flex-row">

            <Card className="w-full shrink-0 space-y-4 p-5 lg:max-w-md xl:max-w-lg">

              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">

                <p className="font-medium">Per-business customization</p>

                <p className="mt-1 text-blue-800">

                  Layout + clause text are saved for your business. Salary and candidate details are

                  filled per offer by HR.

                </p>

              </div>



              <label className="flex items-center gap-2 text-sm">

                <input

                  type="checkbox"

                  checked={settings.show_watermark}

                  onChange={(e) => setSettings({ ...settings, show_watermark: e.target.checked })}

                />

                Show logo watermark on document

              </label>

              <label className="flex items-center gap-2 text-sm">

                <input

                  type="checkbox"

                  checked={settings.show_ctc_breakdown}

                  onChange={(e) =>

                    setSettings({ ...settings, show_ctc_breakdown: e.target.checked })

                  }

                />

                Show annual CTC breakdown table

              </label>

              <Input

                label="Authorized signatory name (default)"

                value={settings.authorized_signatory_name}

                onChange={(e) =>

                  setSettings({ ...settings, authorized_signatory_name: e.target.value })

                }

              />

              <Input

                label="Authorized signatory title"

                value={settings.authorized_signatory_title}

                onChange={(e) =>

                  setSettings({ ...settings, authorized_signatory_title: e.target.value })

                }

              />

              {CLAUSE_FIELDS.map(([key, label]) => (

                <label key={key} className="block text-sm">

                  <span className="text-text-secondary">{label}</span>

                  <textarea

                    className="mt-1 block w-full rounded-md border border-border px-3 py-2 text-sm"

                    rows={3}

                    value={settings[key]}

                    onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}

                  />

                  <span className="mt-1 block text-xs text-text-muted">

                    Placeholders: {'{{business.name}}'}, {'{{offer.probation_months}}'},{' '}

                    {'{{offer.notice_period_days}}'}

                  </span>

                </label>

              ))}

              <Button onClick={() => save(false)} disabled={saving} className="w-full">

                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save customization'}

              </Button>

            </Card>



            <div className="min-h-[480px] flex-1 rounded-xl border border-border bg-gray-100 p-4 lg:min-h-0">

              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">

                <div className="flex items-center gap-3">

                  <h2 className="text-sm font-semibold text-text-primary">Live preview</h2>

                  <span className="text-xs text-text-muted">

                    {templates.find((t) => t.id === templateId)?.name ?? templateId}

                  </span>

                  <label className="flex cursor-pointer items-center gap-2 text-xs text-text-secondary">

                    <input

                      type="checkbox"

                      checked={autoRefresh}

                      onChange={(e) => setAutoRefresh(e.target.checked)}

                      className="rounded border-border"

                    />

                    Auto-refresh

                  </label>

                </div>

                <Button

                  type="button"

                  variant="secondary"

                  size="sm"

                  onClick={() => setPreviewKey((k) => k + 1)}

                >

                  <RefreshCw className="mr-1 h-3.5 w-3.5" />

                  Refresh

                </Button>

              </div>

              {!autoRefresh && (

                <p className="mb-2 flex items-center gap-1 text-xs text-amber-700">

                  <Eye className="h-3 w-3" /> Click refresh to see edits

                </p>

              )}

              <div className="overflow-hidden rounded-lg border border-border bg-white shadow-md">

                <iframe

                  key={`${previewKey}-${templateId}`}

                  src={getPreviewUrl()}

                  title="Offer letter preview"

                  className="w-full border-0"

                  style={{ height: 'min(80vh, 1123px)', minHeight: '560px' }}

                />

              </div>

            </div>

          </div>

        </div>

      ) : null}

    </SettingsPageShell>

  );

}



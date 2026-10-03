'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Building2, CheckCircle2, ImagePlus, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { IntlPhoneInput } from '@/components/ui/IntlPhoneInput';
import { Switch } from '@/components/ui/Switch';
import { useAuth } from '@/contexts/AuthContext';
import { useLayoutData } from '@/contexts/LayoutDataContext';
import { useFeatureRegistry } from '@/hooks/useFeatureRegistry';
import { UpgradePrompt } from '@/components/subscription/UpgradePrompt';
import { INDIAN_STATES } from '@/lib/gst-utils';
import { useToastContext } from '@/contexts/ToastContext';
import { ManualPaymentMethodsSettings } from '@/components/settings/manual-payments/ManualPaymentMethodsSettings';
import { EditableCard, ProfileSection, SummaryList } from '@/components/settings/business-profile/ProfileSection';
import { BankAccountsCard } from '@/components/settings/business-profile/BankAccountsCard';
import {
  getProfileGaps,
  type BusinessProfileLike,
  type ProfileRequirementContext,
} from '@/lib/business-profile-requirements';

type ProfileForm = {
  name: string;
  email: string;
  phone: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  pincode: string;
  gstin: string;
  gst_registration_type: string;
  aggregate_turnover_above_5cr: boolean;
  pan: string;
  logo_url: string;
  signature_url: string;
  business_type: string;
  industry: string;
  business_model: string;
  company_introduction: string;
  iec_code: string;
  swift_code: string;
};

type SectionKey = 'basic' | 'address' | 'tax' | 'about' | 'export';

const SECTION_FIELDS: Record<SectionKey, (keyof ProfileForm)[]> = {
  basic: ['name', 'email', 'phone'],
  address: ['address_line1', 'address_line2', 'city', 'state', 'pincode'],
  tax: ['gst_registration_type', 'gstin', 'pan', 'aggregate_turnover_above_5cr'],
  about: ['business_type', 'industry', 'business_model', 'company_introduction'],
  export: ['iec_code', 'swift_code'],
};

/** Outlet-level fields; with several active branches these are saved on the branch row. */
const BRANCH_FIELDS = new Set<keyof ProfileForm>([
  'name', 'email', 'phone', 'address_line1', 'address_line2', 'city', 'state', 'pincode', 'gstin',
]);

const HIGHLIGHT_SECTION: Record<string, SectionKey> = {
  name: 'basic',
  email: 'basic',
  phone: 'basic',
  address_line1: 'address',
  city: 'address',
  state: 'address',
  pincode: 'address',
  gstin: 'tax',
};

const GST_TYPES = [
  { value: 'regular', label: 'Regular', hint: 'Charge GST and issue tax invoices.' },
  { value: 'composition', label: 'Composition scheme', hint: 'Issue bills of supply. No GST is charged.' },
  { value: 'unregistered', label: 'Not registered', hint: 'Below the threshold, no GSTIN.' },
];

const BUSINESS_TYPES = [
  ['retail', 'Retail'], ['wholesaler', 'Wholesaler'], ['distributor', 'Distributor'],
  ['manufacturer', 'Manufacturer'], ['service', 'Service'], ['other', 'Other'],
] as const;
const INDUSTRIES = [
  ['pharmaceuticals', 'Pharmaceuticals'], ['textiles', 'Textiles'], ['garments', 'Garments'],
  ['electronics', 'Electronics'], ['food_beverages', 'Food & Beverages'], ['automotive', 'Automotive'],
  ['construction', 'Construction'], ['services', 'Services'], ['other', 'Other'],
] as const;
const BUSINESS_MODELS = [
  ['b2b', 'B2B'], ['b2c', 'B2C'], ['b2b2c', 'B2B2C'], ['export', 'Export'], ['mixed', 'Mixed'],
] as const;

const labelOf = (list: readonly (readonly [string, string])[], v: string) => list.find(([k]) => k === v)?.[1] ?? '';

function profileFrom(business: any, branch: any, activeBranchCount: number): ProfileForm {
  // Single outlet: company identity is the business row. Several outlets: prefer the assigned branch overlay.
  const p = activeBranchCount <= 1 && business ? business : branch || business || {};
  return {
    name: p.name || business?.name || '',
    email: p.email || business?.email || '',
    phone: p.phone || business?.phone || '',
    address_line1: p.address_line1 || business?.address_line1 || '',
    address_line2: p.address_line2 || business?.address_line2 || '',
    city: p.city || business?.city || '',
    state: p.state || business?.state || '',
    pincode: p.pincode || business?.pincode || '',
    gstin: p.gstin || business?.gstin || '',
    gst_registration_type: business?.gst_registration_type || 'unregistered',
    aggregate_turnover_above_5cr: !!business?.aggregate_turnover_above_5cr,
    pan: business?.pan || '',
    logo_url: business?.logo_url || '',
    signature_url: business?.signature_url || '',
    business_type: business?.business_type || '',
    industry: business?.industry || '',
    business_model: business?.business_model || '',
    company_introduction: business?.company_introduction || '',
    iec_code: business?.iec_code || '',
    swift_code: business?.swift_code || '',
  };
}

function validate(section: SectionKey, f: ProfileForm, gstApplies: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  if (section === 'basic' && !f.name.trim()) e.name = 'Business name is required';
  if (section === 'address' && f.pincode.trim() && !/^\d{6}$/.test(f.pincode.trim())) {
    e.pincode = 'Pincode must be 6 digits';
  }
  if (section === 'tax') {
    const gstin = f.gstin.trim().toUpperCase();
    if (gstApplies && f.gst_registration_type !== 'unregistered') {
      if (!gstin) e.gstin = 'GSTIN is required for GST-registered businesses';
      else if (!/^[0-9A-Z]{15}$/.test(gstin)) e.gstin = 'GSTIN has 15 characters, like 27ABCDE1234F1Z5';
    }
    if (f.pan.trim() && !/^[A-Z]{5}\d{4}[A-Z]$/.test(f.pan.trim().toUpperCase())) e.pan = 'PAN format is ABCDE1234F';
  }
  if (section === 'export') {
    if (f.iec_code.trim() && !/^[0-9A-Z]{10}$/i.test(f.iec_code.trim())) e.iec_code = 'IEC has 10 characters';
    if (f.swift_code.trim() && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/i.test(f.swift_code.trim())) {
      e.swift_code = 'SWIFT has 8 or 11 characters';
    }
  }
  return e;
}

function asProfileLike(f: ProfileForm): BusinessProfileLike {
  return {
    name: f.name,
    address_line1: f.address_line1,
    city: f.city,
    state: f.state,
    pincode: f.pincode,
    gstin: f.gstin,
  } as BusinessProfileLike;
}

export const BusinessProfileTab: React.FC = () => {
  const { business, branch, user, activeBranchCount, hasPlatformModule, refresh } = useAuth();
  const { refreshWarehouses } = useLayoutData();
  const featureRegistry = useFeatureRegistry();
  const searchParams = useSearchParams();
  const toast = useToastContext();
  const hasBilling = hasPlatformModule('billing');
  const hasHr = hasPlatformModule('hr');
  const hasConnect = hasPlatformModule('connect');
  const isBranchView = !!branch && activeBranchCount > 1;

  const saved = useMemo(() => profileFrom(business, branch, activeBranchCount), [business, branch, activeBranchCount]);
  const [form, setForm] = useState<ProfileForm>(saved);
  const [editing, setEditing] = useState<SectionKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<'logo' | 'signature' | null>(null);
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const highlightRef = useRef<string | null>(null);
  const highlightHandled = useRef(false);

  const [productVariantsEnabled, setProductVariantsEnabled] = useState(false);
  const [loadingVariantsSetting, setLoadingVariantsSetting] = useState(false);
  const [defaultAllowSaleWhenOutOfStock, setDefaultAllowSaleWhenOutOfStock] = useState(false);
  const [loadingItemSalesStockSetting, setLoadingItemSalesStockSetting] = useState(false);
  const [warehousesEnabled, setWarehousesEnabled] = useState(false);
  const [loadingWarehousesSetting, setLoadingWarehousesSetting] = useState(false);
  const [autoAssignBranchWarehouses, setAutoAssignBranchWarehouses] = useState(true);
  const [loadingAutoAssignSetting, setLoadingAutoAssignSetting] = useState(false);
  const [posModeEnabled, setPosModeEnabled] = useState(false);
  const [showWarehouseUpgradePrompt, setShowWarehouseUpgradePrompt] = useState(false);

  useEffect(() => {
    if (!editing) setForm(saved);
  }, [saved, editing]);

  const set = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: '' }));
  };

  const readinessContext: ProfileRequirementContext =
    saved.gst_registration_type === 'unregistered' ? 'print_or_finalize_invoice' : 'finalize_gst_invoice';
  const gaps = getProfileGaps(asProfileLike(saved), readinessContext);

  const focusField = useCallback((name: string) => {
    window.setTimeout(() => {
      const el = fieldRefs.current[name];
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const target = el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement
        ? el
        : el.querySelector<HTMLElement>('input,select,textarea');
      target?.focus();
      el.classList.add('ring-2', 'ring-amber-500', 'ring-offset-2', 'rounded-md');
      window.setTimeout(() => el.classList.remove('ring-2', 'ring-amber-500', 'ring-offset-2', 'rounded-md'), 2500);
    }, 150);
  }, []);

  const clearHighlightParam = () => {
    highlightRef.current = null;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('highlight')) return;
    url.searchParams.delete('highlight');
    window.history.replaceState({}, '', url.toString());
  };

  const startEdit = (section: SectionKey, focus?: string, base: ProfileForm = saved) => {
    setForm(base);
    setErrors({});
    setEditing(section);
    if (focus) focusField(focus);
  };

  const cancelEdit = () => {
    setForm(saved);
    setErrors({});
    setEditing(null);
    clearHighlightParam();
  };

  // Deep link from the "complete your profile" prompts: /settings/business?highlight=pincode
  useEffect(() => {
    if (highlightHandled.current || !business?.id) return;
    const h = searchParams.get('highlight');
    if (!h) return;
    highlightHandled.current = true;
    const section = HIGHLIGHT_SECTION[h];
    if (!section || (h === 'gstin' && (saved.gst_registration_type === 'unregistered' || !hasBilling))) {
      clearHighlightParam();
      return;
    }
    highlightRef.current = h;
    startEdit(section, h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, business?.id]);

  useEffect(() => {
    if (!business?.id) return;
    const id = business.id;
    const getJson = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    void getJson(`/api/settings/product-variants?business_id=${id}`).then((d) => {
      if (d) setProductVariantsEnabled(!!d.product_variants_enabled);
    });
    void getJson(`/api/settings/item-sales-stock?business_id=${id}`).then((d) => {
      if (d) setDefaultAllowSaleWhenOutOfStock(!!d.default_allow_sale_when_out_of_stock);
    });
    void getJson(`/api/settings/warehouses?business_id=${id}`).then((d) => {
      if (!d) return;
      setWarehousesEnabled(!!d.warehouses_enabled);
      setAutoAssignBranchWarehouses(d.auto_assign_branch_warehouses ?? true);
    });
    setPosModeEnabled(localStorage.getItem('pos_mode_enabled') === 'true');
  }, [business?.id]);

  const patchJson = async (url: string, body: Record<string, unknown>) => {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Could not save');
    }
  };

  const persist = async (values: Partial<ProfileForm>) => {
    if (!business?.id) throw new Error('Business not loaded. Refresh the page and try again.');
    if (activeBranchCount <= 1 || !branch?.id) {
      await patchJson(`/api/business/${business.id}`, values);
      return;
    }
    const bizPart: Record<string, unknown> = {};
    const branchPart: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      (BRANCH_FIELDS.has(k as keyof ProfileForm) ? branchPart : bizPart)[k] = v;
    }
    if (Object.keys(branchPart).length) {
      const multiBranch = featureRegistry.hasFeature('multi_branch');
      const branchIsDefault = !!(branch as { is_primary?: boolean }).is_primary;
      if (!multiBranch && !branchIsDefault) {
        throw new Error('This outlet cannot be edited on your current plan. Switch to your default branch or upgrade for multi-branch.');
      }
    }
    if (Object.keys(bizPart).length) await patchJson(`/api/business/${business.id}`, bizPart);
    if (Object.keys(branchPart).length) {
      await patchJson(`/api/branches/${branch.id}`, {
        business_id: business.id,
        updated_by_user_id: user?.id,
        ...branchPart,
      });
    }
  };

  const saveSection = async (section: SectionKey) => {
    const errs = validate(section, form, hasBilling);
    setErrors(errs);
    const firstError = Object.keys(errs)[0];
    if (firstError) {
      focusField(firstError);
      return;
    }

    let fields = SECTION_FIELDS[section];
    if (section === 'tax' && !hasBilling) fields = ['pan'];
    if (section === 'about' && !hasBilling) fields = ['company_introduction'];
    const values: Partial<ProfileForm> = {};
    for (const k of fields) (values as Record<string, unknown>)[k] = form[k];
    if (section === 'tax') {
      values.gstin = form.gst_registration_type === 'unregistered' ? '' : form.gstin.trim().toUpperCase();
      values.pan = form.pan.trim().toUpperCase();
    }
    if (section === 'export') {
      values.iec_code = form.iec_code.trim().toUpperCase();
      values.swift_code = form.swift_code.trim().toUpperCase();
    }

    setSaving(true);
    try {
      await persist(values);
      await refresh();
      setEditing(null);

      if (highlightRef.current) {
        const merged = { ...saved, ...values };
        const remaining = getProfileGaps(asProfileLike(merged), readinessContext);
        const next = remaining[0];
        const nextSection = next ? HIGHLIGHT_SECTION[next.highlightParam] : undefined;
        if (next && nextSection) {
          highlightRef.current = next.highlightParam;
          toast.success(`Saved. Next, add ${next.label.toLowerCase()}.`);
          startEdit(nextSection, next.highlightParam, merged);
          return;
        }
        clearHighlightParam();
        toast.success('Saved. Your profile has everything invoices need.');
        return;
      }
      toast.success('Saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const uploadImage = async (file: File, kind: 'logo' | 'signature') => {
    setUploading(kind);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('type', kind);
      const res = await fetch('/api/upload/image', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to upload ${kind}`);
      await persist(kind === 'logo' ? { logo_url: data.url } : { signature_url: data.url });
      await refresh();
      toast.success(kind === 'logo' ? 'Logo updated' : 'Signature updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Failed to upload ${kind}`);
    } finally {
      setUploading(null);
    }
  };

  const removeImage = async (kind: 'logo' | 'signature') => {
    if (!confirm(kind === 'logo' ? 'Remove your logo from invoices?' : 'Remove your signature from invoices?')) return;
    setUploading(kind);
    try {
      await persist(kind === 'logo' ? { logo_url: '' } : { signature_url: '' });
      await refresh();
      toast.success(kind === 'logo' ? 'Logo removed' : 'Signature removed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove');
    } finally {
      setUploading(null);
    }
  };

  const patchSetting = async (url: string, body: Record<string, unknown>) => {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_id: business?.id, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.details || 'Failed to update setting');
    return data;
  };

  const toggleProductVariants = async () => {
    if (!business?.id) return;
    setLoadingVariantsSetting(true);
    try {
      const next = !productVariantsEnabled;
      const data = await patchSetting('/api/settings/product-variants', { product_variants_enabled: next });
      setProductVariantsEnabled(!!data.product_variants_enabled);
      if (data.warning) toast.warning(data.warning);
      else toast.success(`Product variants ${next ? 'turned on' : 'turned off'}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update setting');
    } finally {
      setLoadingVariantsSetting(false);
    }
  };

  const toggleDefaultAllowSaleWhenOutOfStock = async () => {
    if (!business?.id) return;
    setLoadingItemSalesStockSetting(true);
    try {
      const next = !defaultAllowSaleWhenOutOfStock;
      const data = await patchSetting('/api/settings/item-sales-stock', { default_allow_sale_when_out_of_stock: next });
      setDefaultAllowSaleWhenOutOfStock(!!data.default_allow_sale_when_out_of_stock);
      toast.success(
        next
          ? 'New items will allow sales when out of stock, unless set otherwise on the item.'
          : 'New items will block sales when stock is short, unless set otherwise on the item.'
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update setting');
    } finally {
      setLoadingItemSalesStockSetting(false);
    }
  };

  const toggleWarehouses = async () => {
    if (!business?.id) return;
    const next = !warehousesEnabled;
    if (next && !featureRegistry.hasFeature('multi_warehouse')) {
      setShowWarehouseUpgradePrompt(true);
      return;
    }
    setLoadingWarehousesSetting(true);
    try {
      const data = await patchSetting('/api/settings/warehouses', { warehouses_enabled: next === true });
      const savedValue = data.warehouses_enabled === true;
      setWarehousesEnabled(savedValue);
      if (savedValue !== next) toast.warning('The warehouse setting may not have saved. Refresh and check again.');
      else toast.success(`Warehouses ${next ? 'turned on' : 'turned off'}`);
      await refreshWarehouses();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update setting');
    } finally {
      setLoadingWarehousesSetting(false);
    }
  };

  const toggleAutoAssignBranchWarehouses = async () => {
    if (!business?.id) return;
    setLoadingAutoAssignSetting(true);
    try {
      const data = await patchSetting('/api/settings/warehouses', {
        auto_assign_branch_warehouses: !autoAssignBranchWarehouses,
      });
      setAutoAssignBranchWarehouses(data.auto_assign_branch_warehouses ?? true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update setting');
    } finally {
      setLoadingAutoAssignSetting(false);
    }
  };

  const togglePosMode = () => {
    const next = !posModeEnabled;
    localStorage.setItem('pos_mode_enabled', String(next));
    setPosModeEnabled(next);
    window.dispatchEvent(new Event('posModeChanged'));
  };

  const cardProps = (section: SectionKey) => ({
    isEditing: editing === section,
    canEdit: editing === null,
    onEdit: () => startEdit(section),
    onCancel: cancelEdit,
    onSave: () => void saveSection(section),
    saving: saving && editing === section,
  });

  const ref = (name: string) => (el: HTMLElement | null) => {
    fieldRefs.current[name] = el;
  };

  const gstLabel = GST_TYPES.find((g) => g.value === saved.gst_registration_type)?.label ?? 'Not registered';
  const showAbout = hasBilling || hasConnect;
  const initials = (saved.name || 'B').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="w-full max-w-5xl space-y-6">
      {hasBilling && (
        gaps.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 dark:border-green-900/50 dark:bg-green-950/30">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
            <p className="text-sm text-green-900 dark:text-green-200">
              <span className="font-medium">
                {readinessContext === 'finalize_gst_invoice' ? 'Ready for GST invoices.' : 'Ready to print bills.'}
              </span>{' '}
              Your name and address{readinessContext === 'finalize_gst_invoice' ? ' and GSTIN' : ''} will print on every invoice.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/30 sm:flex-row sm:items-center">
            <AlertTriangle className="hidden h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400 sm:block" />
            <p className="flex-1 text-sm text-amber-900 dark:text-amber-200">
              <span className="font-medium">Add {gaps.map((g) => g.label.toLowerCase()).join(', ')}</span>{' '}
              before you print or finalize your next {readinessContext === 'finalize_gst_invoice' ? 'tax invoice' : 'bill'}.
            </p>
            {editing === null && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  const section = HIGHLIGHT_SECTION[gaps[0].highlightParam];
                  if (section) startEdit(section, gaps[0].highlightParam);
                }}
              >
                Add now
              </Button>
            )}
          </div>
        )
      )}

      {isBranchView && (
        <div className="flex items-start gap-3 rounded-lg border border-border bg-gray-50 px-4 py-3 dark:border-border-dark dark:bg-slate-800/50" data-tour="bp-branch-notice">
          <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" />
          <p className="text-sm text-text-secondary">
            <span className="font-medium text-text-primary">Editing branch: {branch?.name}.</span> Name, contact, address
            and GSTIN apply to this branch. PAN, logo and signature apply to the whole company.
          </p>
        </div>
      )}

      <div className="space-y-6">
        <ProfileSection
          id="bp-basic"
          tour="bp-basic"
          title={isBranchView ? 'Branch details' : 'Business details'}
          description="Shown on invoices, quotes and messages you send to customers."
        >
          <EditableCard
            title={isBranchView ? 'Branch' : 'Business'}
            editTour="bp-save"
            {...cardProps('basic')}
            summary={
              <div className="flex items-center gap-4">
                {saved.logo_url ? (
                  <img src={saved.logo_url} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-border object-contain p-1 dark:border-border-dark" />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-sm font-semibold text-white">
                    {initials}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate font-semibold text-text-primary">
                    {saved.name || <span className="text-amber-700 dark:text-amber-400">Business name missing</span>}
                  </p>
                  <p className="truncate text-sm text-text-secondary">
                    {[saved.email, saved.phone].filter(Boolean).join('  ·  ') || 'No email or phone yet'}
                  </p>
                </div>
              </div>
            }
          >
            <Input
              label={isBranchView ? 'Branch name *' : 'Business name *'}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              error={errors.name}
              inputRef={ref('name')}
              autoComplete="organization"
            />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input
                label="Email"
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="accounts@yourbusiness.in"
                inputRef={ref('email')}
              />
              <div ref={ref('phone')}>
                <IntlPhoneInput
                  label="Phone"
                  value={form.phone}
                  onChange={(full) => set('phone', full)}
                  nationalPlaceholder="Mobile number"
                />
              </div>
            </div>
          </EditableCard>
        </ProfileSection>

        <ProfileSection
          id="bp-address"
          tour="bp-address"
          title="Address"
          description="Printed in the header of every invoice. GST rules require it on tax invoices."
        >
          <EditableCard
            title="Registered address"
            {...cardProps('address')}
            summary={
              <SummaryList
                rows={[
                  { label: 'Street', value: [saved.address_line1, saved.address_line2].filter(Boolean).join(', '), required: hasBilling },
                  { label: 'City, state', value: [saved.city, saved.state].filter(Boolean).join(', '), required: hasBilling && (!saved.city || !saved.state) },
                  { label: 'Pincode', value: saved.pincode, required: hasBilling },
                ]}
              />
            }
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input
                label="Address line 1"
                value={form.address_line1}
                onChange={(e) => set('address_line1', e.target.value)}
                placeholder="Shop / building, street"
                inputRef={ref('address_line1')}
                autoComplete="address-line1"
              />
              <Input
                label="Address line 2"
                value={form.address_line2}
                onChange={(e) => set('address_line2', e.target.value)}
                placeholder="Area, landmark"
                autoComplete="address-line2"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Input
                label="City"
                value={form.city}
                onChange={(e) => set('city', e.target.value)}
                inputRef={ref('city')}
                autoComplete="address-level2"
              />
              <div>
                <label className="type-label mb-1.5 block">State</label>
                <select
                  value={form.state}
                  onChange={(e) => set('state', e.target.value)}
                  ref={ref('state')}
                  className="input"
                >
                  <option value="">Select state</option>
                  {INDIAN_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <Input
                label="Pincode"
                value={form.pincode}
                onChange={(e) => set('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="411001"
                inputMode="numeric"
                maxLength={6}
                error={errors.pincode}
                inputRef={ref('pincode')}
                autoComplete="postal-code"
              />
            </div>
          </EditableCard>
        </ProfileSection>

        {hasBilling ? (
          <ProfileSection
            id="bp-gst"
            tour="bp-gst"
            title="GST registration"
            description="Decides whether you issue tax invoices or bills of supply, and what prints in the invoice header."
          >
            <EditableCard
              title="Tax details"
              {...cardProps('tax')}
              summary={
                <div className="space-y-3">
                  <SummaryList
                    rows={[
                      { label: 'Registration', value: gstLabel },
                      ...(saved.gst_registration_type !== 'unregistered'
                        ? [{ label: 'GSTIN', value: saved.gstin, required: true }]
                        : []),
                      { label: 'PAN', value: saved.pan },
                      ...(saved.gst_registration_type !== 'unregistered'
                        ? [{ label: 'HSN digits', value: saved.aggregate_turnover_above_5cr ? '6 (turnover above ₹5 crore)' : '4 (turnover up to ₹5 crore)' }]
                        : []),
                    ]}
                  />
                  {saved.gst_registration_type === 'composition' && (
                    <p className="text-xs text-text-secondary">
                      Composition scheme: invoices are issued as Bill of Supply and no GST is charged.
                    </p>
                  )}
                </div>
              }
            >
              <div>
                <span className="type-label mb-1.5 block">Registration type</span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {GST_TYPES.map((g) => {
                    const active = form.gst_registration_type === g.value;
                    return (
                      <button
                        key={g.value}
                        type="button"
                        onClick={() => {
                          set('gst_registration_type', g.value);
                          if (g.value === 'unregistered') setErrors((prev) => ({ ...prev, gstin: '' }));
                        }}
                        className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                          active
                            ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                            : 'border-border hover:bg-gray-50 dark:border-border-dark dark:hover:bg-slate-800/50'
                        }`}
                        aria-pressed={active}
                      >
                        <span className={`block text-sm font-medium ${active ? 'text-primary-700 dark:text-primary-300' : 'text-text-primary'}`}>
                          {g.label}
                        </span>
                        <span className="mt-0.5 block text-xs text-text-secondary">{g.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {form.gst_registration_type !== 'unregistered' && (
                  <Input
                    label="GSTIN *"
                    value={form.gstin}
                    onChange={(e) => {
                      const v = e.target.value.toUpperCase().replace(/\s/g, '').slice(0, 15);
                      set('gstin', v);
                      if (v.length === 15 && !form.pan) set('pan', v.slice(2, 12));
                    }}
                    placeholder="27ABCDE1234F1Z5"
                    maxLength={15}
                    error={errors.gstin}
                    helperText="State and PAN are read from the GSTIN."
                    inputRef={ref('gstin')}
                  />
                )}
                <Input
                  label="PAN"
                  value={form.pan}
                  onChange={(e) => set('pan', e.target.value.toUpperCase().slice(0, 10))}
                  placeholder="ABCDE1234F"
                  maxLength={10}
                  error={errors.pan}
                  inputRef={ref('pan')}
                />
              </div>
              {form.gst_registration_type !== 'unregistered' && (
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={form.aggregate_turnover_above_5cr}
                    onChange={(e) => set('aggregate_turnover_above_5cr', e.target.checked)}
                  />
                  <span>
                    <span className="type-label block">Turnover above ₹5 crore last financial year</span>
                    <span className="type-body-sm text-text-muted">Invoices then need 6-digit HSN codes instead of 4.</span>
                  </span>
                </label>
              )}
            </EditableCard>
          </ProfileSection>
        ) : hasHr ? (
          <ProfileSection
            id="bp-tax-hr"
            tour="bp-gst"
            title="Tax details"
            description="Used on payslips, Form 16 and other HR documents."
          >
            <EditableCard
              title="PAN"
              {...cardProps('tax')}
              summary={<SummaryList rows={[{ label: 'PAN', value: saved.pan }]} />}
            >
              <Input
                label="PAN"
                value={form.pan}
                onChange={(e) => set('pan', e.target.value.toUpperCase().slice(0, 10))}
                placeholder="ABCDE1234F"
                maxLength={10}
                error={errors.pan}
                inputRef={ref('pan')}
              />
            </EditableCard>
          </ProfileSection>
        ) : null}

        <ProfileSection
          id="bp-branding"
          title="Logo and signature"
          description={`Printed on ${hasBilling ? 'invoices and ' : ''}documents. Uploads save straight away.`}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <BrandTile
              id="bp-logo"
              tour="bp-logo"
              label="Logo"
              hint="Top of the invoice. Square PNG works best, up to 2 MB."
              url={saved.logo_url}
              busy={uploading === 'logo'}
              disabled={uploading !== null}
              onPick={(f) => void uploadImage(f, 'logo')}
              onRemove={() => void removeImage('logo')}
            />
            <BrandTile
              id="bp-signature"
              tour="bp-signature"
              label="Signature"
              hint={'Above "Authorised signatory". Use a clear image on white.'}
              url={saved.signature_url}
              busy={uploading === 'signature'}
              disabled={uploading !== null}
              onPick={(f) => void uploadImage(f, 'signature')}
              onRemove={() => void removeImage('signature')}
            />
          </div>
        </ProfileSection>

        {hasBilling && (
          <ProfileSection
            id="bp-payments"
            title="Bank and UPI"
            description="Customers see these on invoices and payment links, so they know where to pay."
          >
            <BankAccountsCard businessId={business?.id} userId={user?.id} />
            <ManualPaymentMethodsSettings businessId={business?.id ?? null} userId={user?.id ?? null} embedded />
          </ProfileSection>
        )}

        {showAbout && (
          <ProfileSection
            id="bp-about"
            tour="bp-type"
            title="About your business"
            description="Helps tailor reports, and gives the WhatsApp AI assistant context about what you sell."
          >
            <EditableCard
              title="About"
              {...cardProps('about')}
              summary={
                <div className="space-y-3">
                  {hasBilling && (
                    <SummaryList
                      rows={[
                        { label: 'Business type', value: labelOf(BUSINESS_TYPES, saved.business_type) },
                        { label: 'Industry', value: labelOf(INDUSTRIES, saved.industry) },
                        { label: 'Sells to', value: labelOf(BUSINESS_MODELS, saved.business_model) },
                      ]}
                    />
                  )}
                  <div>
                    <p className="text-sm text-text-secondary">Introduction for the AI assistant</p>
                    <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-text-primary">
                      {saved.company_introduction || (
                        <span className="text-text-muted">Not written yet. Without it, AI replies know less about your business.</span>
                      )}
                    </p>
                  </div>
                </div>
              }
            >
              {hasBilling && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <SelectField label="Business type" value={form.business_type} onChange={(v) => set('business_type', v)} options={BUSINESS_TYPES} />
                  <SelectField label="Industry" value={form.industry} onChange={(v) => set('industry', v)} options={INDUSTRIES} />
                  <SelectField label="Sells to" value={form.business_model} onChange={(v) => set('business_model', v)} options={BUSINESS_MODELS} />
                </div>
              )}
              <div>
                <label className="type-label mb-1.5 block">Introduction for the AI assistant</label>
                <textarea
                  value={form.company_introduction}
                  onChange={(e) => set('company_introduction', e.target.value)}
                  rows={5}
                  placeholder="What you sell, delivery areas, payment terms, timings, and anything a sales person should know."
                  className="input min-h-[120px] resize-y"
                />
              </div>
            </EditableCard>
          </ProfileSection>
        )}

        {hasBilling && (
          <ProfileSection
            id="bp-export"
            tour="bp-export"
            title="Exporter details"
            description="Only needed if you sell outside India or receive international transfers."
          >
            <EditableCard
              title="Export"
              {...cardProps('export')}
              summary={
                saved.iec_code || saved.swift_code ? (
                  <SummaryList
                    rows={[
                      { label: 'IEC', value: saved.iec_code },
                      { label: 'SWIFT / BIC', value: saved.swift_code },
                    ]}
                  />
                ) : (
                  <p className="text-sm text-text-muted">Not set. Leave empty if you don&apos;t export.</p>
                )
              }
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Input
                  label="IEC (Import Export Code)"
                  value={form.iec_code}
                  onChange={(e) => set('iec_code', e.target.value.toUpperCase())}
                  placeholder="10 characters"
                  maxLength={10}
                  error={errors.iec_code}
                />
                <Input
                  label="SWIFT / BIC"
                  value={form.swift_code}
                  onChange={(e) => set('swift_code', e.target.value.toUpperCase())}
                  placeholder="HDFCINBBXXX"
                  maxLength={11}
                  error={errors.swift_code}
                />
              </div>
            </EditableCard>
          </ProfileSection>
        )}

        {hasBilling && (
          <ProfileSection
            id="bp-features"
            tour="bp-features"
            title="Billing preferences"
            description="How items, stock and the invoice screen behave. Changes apply as soon as you switch them."
          >
            <div className="card divide-y divide-border px-4 dark:divide-border-dark md:px-5">
              <PreferenceRow
                label="Product variants"
                description="Sizes, colours and other options on one item. Common for garments and textiles."
                checked={productVariantsEnabled}
                disabled={loadingVariantsSetting}
                onChange={toggleProductVariants}
              />
              <PreferenceRow
                label="Allow sales when out of stock"
                description="Default for new items. You can override it on each item."
                checked={defaultAllowSaleWhenOutOfStock}
                disabled={loadingItemSalesStockSetting}
                onChange={toggleDefaultAllowSaleWhenOutOfStock}
              />
              <PreferenceRow
                label="Warehouses"
                description={
                  !featureRegistry.hasFeature('multi_warehouse') && !warehousesEnabled
                    ? 'Track stock across several locations. Needs a plan upgrade.'
                    : 'Track stock across several locations and move stock between them.'
                }
                checked={warehousesEnabled}
                disabled={loadingWarehousesSetting}
                onChange={toggleWarehouses}
              />
              {warehousesEnabled && (
                <PreferenceRow
                  label="Give branch staff their branch's warehouses"
                  description="When off, assign warehouse access to each user yourself."
                  checked={autoAssignBranchWarehouses}
                  disabled={loadingAutoAssignSetting}
                  onChange={toggleAutoAssignBranchWarehouses}
                />
              )}
              <div id="pos-mode" data-tour="bp-pos" className="scroll-mt-24">
                <PreferenceRow
                  label="POS mode"
                  description="A faster two-column invoice screen for counter billing. Applies on this device."
                  checked={posModeEnabled}
                  onChange={togglePosMode}
                />
              </div>
            </div>
            {showWarehouseUpgradePrompt && (
              <UpgradePrompt
                featureKey="settings_multi_warehouse"
                featureName="Multi-Warehouse"
                onClose={() => setShowWarehouseUpgradePrompt(false)}
              />
            )}
          </ProfileSection>
        )}
      </div>
    </div>
  );
};

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly (readonly [string, string])[];
}) {
  return (
    <div>
      <label className="type-label mb-1.5 block">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input">
        <option value="">Select</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </div>
  );
}

function PreferenceRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <div className="py-4">
      <Switch label={label} description={description} checked={checked} disabled={disabled} onChange={() => onChange()} />
    </div>
  );
}

function BrandTile({
  id,
  tour,
  label,
  hint,
  url,
  busy,
  disabled,
  onPick,
  onRemove,
}: {
  id: string;
  tour: string;
  label: string;
  hint: string;
  url: string;
  busy: boolean;
  disabled: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div id={id} data-tour={tour} className="card scroll-mt-24 flex items-center gap-4 p-4">
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-white dark:border-border-dark">
        {url ? (
          <img src={url} alt={label} className="max-h-[4.5rem] max-w-[4.5rem] object-contain" />
        ) : (
          <ImagePlus className="h-6 w-6 text-text-muted" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text-primary">{label}</p>
        <p className="mt-0.5 text-xs text-text-secondary">{hint}</p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) onPick(file);
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            isLoading={busy}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            {!busy && <Upload className="mr-1.5 h-3.5 w-3.5" />}
            {url ? 'Replace' : 'Upload'}
          </Button>
          {url && (
            <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onRemove}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

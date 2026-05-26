'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { FormSection } from '@/components/ui/FormSection';
import { Input } from '@/components/ui/Input';
import { NumericBlurField } from '@/components/ui/NumericBlurField';
import { Button } from '@/components/ui/Button';
import { ItemAutocomplete } from '@/components/ui/ItemAutocomplete';
import { Plus, Trash2, Save, Loader2, ArrowLeft, FileUp, ScanLine } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { useLayoutData } from '@/contexts/LayoutDataContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { format } from 'date-fns';
import { Supplier, Item, Account } from '@/types/database';
import { INDIAN_STATES, getStateCode } from '@/lib/gst-utils';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { InvoiceUploader } from '@/components/invoices/InvoiceUploader';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';
import { summarizeInvoiceCorrectionDelta } from '@/lib/services/invoice-extract/invoiceExtractionCorrectionSummary';
import { normalizeExtractionEnvelope } from '@/lib/purchases/extraction-envelope-normalize';
import { matchExtractionForPurchase } from '@/lib/purchases/match-extraction-for-purchase';
import { buildReviewSnapshotFromPurchaseForm } from '@/lib/purchases/build-review-snapshot-from-purchase-form';
import {
  MobileNewPurchaseScrollForm,
  type PurchaseFormState as MobilePurchaseFormState,
  type PurchaseMobileLine,
} from '@/components/purchases/MobileNewPurchaseScrollForm';
import { CreateSupplierModal } from '@/components/modals/CreateSupplierModal';
import { useToastContext } from '@/contexts/ToastContext';
import { useOptimisticMutation } from '@/hooks/useOptimisticMutation';
import { useOfflineSync } from '@/contexts/OfflineSyncContext';
import { canQueueOfflineActions } from '@/lib/offline/connectivity/state-machine';
import { useMobileHeaderRightAccessory } from '@/contexts/MobileHeaderTitleContext';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import {
  inclusiveLineTotal,
  inclusiveLineTotalWithDiscountAmount,
  deriveUnitPriceFromInvoiceLine,
} from '@/lib/invoice-line-math';
import {
  computePurchaseDocument,
  deriveExclusiveUnitPriceFromInvoiceAnchor,
  stateCodeFromGstin,
} from '@/lib/purchase-gst-calculator';
import { round2, roundRetailQty, roundExclusiveUnitPrice } from '@/lib/numeric-precision';
import { PURCHASE_PENDING_EXTRACT_STORAGE_KEY, PURCHASE_ITEM_PICK_RESULT_KEY } from '@/lib/purchase-scan-constants';

interface PurchaseItem {
  id: string;
  item_id: string;
  item_name: string;
  item_type?: 'goods' | 'service';
  hsn_sac: string;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_percent: number;
  /** Line discount in rupees; when > 0, takes precedence over discount_percent. */
  discount_amount?: number;
  /**
   * Exclusive mode: when true, discount_amount applies to tax-inclusive line (MRP-style);
   * when false, it applies to exclusive taxable (typical B2B).
   */
  discount_on_tax_inclusive?: boolean;
  tax_rate: number;
  /** Per-line tax interpretation; defaults from header price_mode when unset. */
  tax_mode?: 'exclusive' | 'inclusive';
  /** When set (invoice fill), GST slab math uses this tax-inclusive total instead of qty×rate. Cleared when qty or unit_price are edited; kept when tax/discount change so rate can be re-derived. */
  invoice_inclusive_line_total?: number;
  manual_cgst?: number;
  manual_sgst?: number;
  manual_igst?: number;
  discount_account_id?: string; // Account ID for discount posting
  // Batch/Serial tracking fields
  batch_number?: string;
  manufacturing_date?: string;
  expiry_date?: string;
  serial_numbers?: string; // Comma or newline separated
  track_batch?: boolean;
  track_serial?: boolean;
  /**
   * True when this line was filled from bill scan / OCR extraction.
   * Used to show "Replace with catalogue item" only in that flow.
   */
  fromBillExtract?: boolean;
}

/** Snapshot after "Fill Purchase Form" for debugging extractor → form mapping. */
interface LastInvoiceFillTrace {
  at: string;
  extractionMethod?: string;
  processingTimeMs?: number;
  apiDebugSummary: {
    keys: string[];
    hasRawOcr: boolean;
    note?: string;
  } | null;
  fromReview: {
    selectedSupplierId: string | null;
    supplier: unknown;
    invoice: unknown;
    totals: unknown;
    items: unknown[];
  };
  appliedToForm: {
    matchedSupplier: { id: string; name: string } | null;
    openedCreateSupplierModal: boolean;
    mergedInvoiceFields: Record<string, unknown> | null;
    round_off_from_extract: number | null;
    purchaseLines: Array<Record<string, unknown>>;
    notSetByQuickFill: string[];
  };
}

function purchaseLineFromCatalogPick(raw: Record<string, unknown>): PurchaseItem {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const trackB = Boolean(raw.track_batch);
  const trackS = Boolean(raw.track_serial);
  const itemType: 'goods' | 'service' = raw.item_type === 'service' ? 'service' : 'goods';
  return {
    id,
    item_id: String(raw.id ?? ''),
    item_name: String(raw.name ?? ''),
    item_type: itemType,
    hsn_sac: String(raw.hsn_sac ?? ''),
    quantity: roundRetailQty(1),
    unit: String(raw.unit || (itemType === 'service' ? 'NOS' : 'pcs')),
    unit_price: roundExclusiveUnitPrice(Number(raw.purchase_price) || 0),
    tax_rate: round2(Number(raw.tax_rate) || 0),
    discount_percent: 0,
    discount_amount: 0,
    discount_on_tax_inclusive: false,
    track_batch: trackB,
    track_serial: trackS,
    batch_number: trackB ? '' : undefined,
    serial_numbers: trackS ? '' : undefined,
    fromBillExtract: false,
  };
}

export default function NewPurchasePage() {
  const router = useRouter();
  const pathname = usePathname();
  const { business, user, loading: sessionLoading } = useAuth();
  const { currentBranchId } = useBranch();
  const { warehousesEnabled } = useLayoutData();
  const { canAdd, loading: permissionsLoading } = usePermissions();
  const toast = useToastContext();
  const { mutate: queueOfflineAction } = useOptimisticMutation();
  const { connectivity } = useOfflineSync();
  
  // Check authorization before rendering form
  const { allowed: canCreate, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'purchases',
    action: 'create',
    skipCheck: !user?.id || sessionLoading,
  });
  
  // ALL HOOKS MUST BE DECLARED BEFORE ANY CONDITIONAL RETURNS
  const [loading, setLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
  const [formData, setFormData] = useState({
    supplier_id: '',
    bill_number: '',
    bill_date: format(new Date(), 'yyyy-MM-dd'),
    status: 'draft',
    place_of_supply_state_code: '',
    is_reverse_charge: false,
    document_type: 'tax_invoice',
    port_code: '',
    itc_eligible: true,
    notes: '',
    paid_amount: 0,
    round_off: 0,
    supplier_gstin: '',
    supplier_state_code: '',
    price_mode: 'exclusive' as 'exclusive' | 'inclusive',
  });
  const [showAdvancedTax, setShowAdvancedTax] = useState(false);
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>([]);
  const [showUploader, setShowUploader] = useState(false);
  const [extractedData, setExtractedData] = useState<any>(null);
  const [lastInvoiceFillTrace, setLastInvoiceFillTrace] = useState<LastInvoiceFillTrace | null>(null);
  const extractionLearnRef = useRef<{
    jobId: string | null;
    reviewBefore: {
      supplier?: unknown;
      invoice?: unknown;
      items?: unknown;
      totals?: unknown;
    } | null;
    savePingSent: boolean;
  }>({ jobId: null, reviewBefore: null, savePingSent: false });
  const offlineFinalizeKeyRef = useRef<string | null>(null);

  /**
   * True only after invoice extract supplied a supplier identity (name/GSTIN) that did not match
   * the business catalogue — not when the field is merely empty on a fresh form.
   */
  const [supplierUnmatchedFromExtraction, setSupplierUnmatchedFromExtraction] = useState(false);

  const supplierNeedsCatalogLink = useMemo(() => {
    if (!supplierUnmatchedFromExtraction) return false;
    if ((formData.supplier_id || '').trim()) return false;
    if (selectedSupplier?.id) return false;
    if (!supplierSearch.trim()) return false;
    return true;
  }, [
    supplierUnmatchedFromExtraction,
    formData.supplier_id,
    selectedSupplier?.id,
    supplierSearch,
  ]);
  const [userBranchId, setUserBranchId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string; warehouse_code?: string; is_primary?: boolean }>>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [warehousesLoading, setWarehousesLoading] = useState(false);
  const [supplierCreateModal, setSupplierCreateModal] = useState<{
    open: boolean;
    initial?: { name?: string; phone?: string; email?: string; gstin?: string };
  }>({ open: false });

  const onOpenItemPicker = useCallback(
    (kind: 'goods' | 'service') => {
      const params = new URLSearchParams();
      params.set('kind', kind);
      params.set('returnTo', encodeURIComponent('/purchases/new'));
      if (selectedWarehouseId) params.set('warehouse_id', selectedWarehouseId);
      router.push(`/purchases/new/select-item?${params.toString()}`);
    },
    [router, selectedWarehouseId],
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !isMobile || !business?.id) return;
    if (pathname !== '/purchases/new') return;
    const raw = sessionStorage.getItem(PURCHASE_ITEM_PICK_RESULT_KEY);
    if (!raw) return;
    sessionStorage.removeItem(PURCHASE_ITEM_PICK_RESULT_KEY);
    try {
      const parsed = JSON.parse(raw) as { item?: Record<string, unknown> };
      if (!parsed.item) return;
      const row = purchaseLineFromCatalogPick(parsed.item);
      setPurchaseItems((prev) => [...prev, row]);
      queueMicrotask(() => {
        document.getElementById('purchase-mobile-items')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      const trackB = Boolean(parsed.item.track_batch);
      const trackS = Boolean(parsed.item.track_serial);
      if (trackB || trackS) {
        setExpandedItems((prev) => new Set([...prev, row.id]));
      }
    } catch {
      /* ignore corrupt payload */
    }
  }, [pathname, isMobile, business?.id]);

  const effectivePurchaseBranchId = useMemo(() => {
    if (userBranchId) return userBranchId;
    if (currentBranchId && currentBranchId !== 'ALL') return currentBranchId;
    return null;
  }, [userBranchId, currentBranchId]);

  const mobileHeaderScanAccessory = useMemo(() => {
    if (!business?.id || !isMobile) return null;
    return (
      <button
        type="button"
        onClick={() =>
          router.push(`/purchases/scan-record?returnTo=${encodeURIComponent('/purchases/new')}`)
        }
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-slate-50 hover:text-text-primary dark:hover:bg-slate-800 touch-manipulation"
        aria-label="Scan and record bills"
        title="Scan &amp; record bills"
      >
        <ScanLine className="h-5 w-5 shrink-0" aria-hidden />
      </button>
    );
  }, [business?.id, isMobile, router]);

  useMobileHeaderRightAccessory(mobileHeaderScanAccessory);

  // ALL useEffect HOOKS MUST ALSO BE BEFORE CONDITIONAL RETURNS
  // Online/offline for finalize button and GST messaging
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Responsive check
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Close supplier dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (!target.closest('.supplier-dropdown-container')) {
        setShowSupplierDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (business?.id && user?.id) {
      fetchSuppliers();
      fetchItems();
      fetchAccounts();
      
      // Set default place of supply to business state
      if (business.state_code) {
        setFormData(prev => ({ ...prev, place_of_supply_state_code: business.state_code || '' }));
      }

      // Fetch user's assigned branch
      fetch(`/api/user-branches?user_id=${user.id}`)
        .then(res => res.json())
        .then(data => {
          if (data.branches && data.branches.length > 0) {
            // Use the first assigned branch (or allow selection if multiple)
            setUserBranchId(data.branches[0].branch_id);
          }
        })
        .catch(err => console.error('Error fetching user branch:', err));
    }
  }, [business, user]);

  useEffect(() => {
    async function fetchWarehouses() {
      if (!business?.id || !user?.id || !effectivePurchaseBranchId) {
        setWarehouses([]);
        setSelectedWarehouseId('');
        return;
      }
      setWarehousesLoading(true);
      try {
        const response = await fetch(
          `/api/warehouses?business_id=${business.id}&user_id=${user.id}&branch_id=${effectivePurchaseBranchId}`
        );
        if (!response.ok) {
          setWarehouses([]);
          setSelectedWarehouseId('');
          return;
        }
        const data = await response.json();
        const warehouseList = data.warehouses || [];
        setWarehouses(warehouseList);
        if (warehouseList.length > 0) {
          const defaultWh = warehouseList.find((w: { is_primary?: boolean }) => w.is_primary === true) || warehouseList[0];
          setSelectedWarehouseId(defaultWh.id);
        } else {
          setSelectedWarehouseId('');
        }
      } catch (e) {
        console.error('Error fetching warehouses:', e);
        setWarehouses([]);
        setSelectedWarehouseId('');
      } finally {
        setWarehousesLoading(false);
      }
    }
    fetchWarehouses();
  }, [business?.id, user?.id, effectivePurchaseBranchId]);

  async function fetchSuppliers() {
    try {
      if (!business?.id || !user?.id) return;
      const response = await fetch(`/api/suppliers?business_id=${business.id}&user_id=${user.id}`);
      const data = await response.json();
      setSuppliers(data.suppliers || []);
    } catch (error) {
      console.error('Error fetching suppliers:', error);
    }
  }

  function openAddSupplierModal(overrides?: { name?: string; gstin?: string }) {
    setSupplierCreateModal({
      open: true,
      initial: {
        name: ((overrides?.name ?? supplierSearch) || '').trim() || undefined,
        gstin:
          ((overrides?.gstin ?? formData.supplier_gstin) || '').trim() || undefined,
      },
    });
  }

  async function handleNewSupplierCreated(supplier: Supplier) {
    pickSupplier(supplier);
    await fetchSuppliers();
  }

  async function fetchItems() {
    try {
      const response = await fetch(`/api/items?business_id=${business!.id}&user_id=${user?.id}`);
      const data = await response.json();
      setItems(data.items || []);
    } catch (error) {
      console.error('Error fetching items:', error);
    }
  }

  async function fetchAccounts() {
    try {
      if (!business?.id || !user?.id) return;
      // Fetch income accounts (where discount accounts typically belong)
      const response = await fetch(`/api/accounts?business_id=${business.id}&user_id=${user.id}&account_type=income`);
      const data = await response.json();
      setAccounts(data.accounts || []);
    } catch (error) {
      console.error('Error fetching accounts:', error);
    }
  }

  function cloneExtractionLearnSnapshot(data: unknown) {
    try {
      return structuredClone(data);
    } catch {
      try {
        return JSON.parse(JSON.stringify(data));
      } catch {
        return data;
      }
    }
  }

  // Handle invoice extraction completion — fills the purchase form inline (no review modal).
  const handleExtractionComplete = async (result: any) => {
    const normalized = normalizeExtractionEnvelope(result);
    setExtractedData(normalized);
    setShowUploader(false);

    if (normalized?.data) {
      extractionLearnRef.current = {
        jobId: typeof normalized.job_id === 'string' ? normalized.job_id.trim() || null : null,
        reviewBefore: cloneExtractionLearnSnapshot(normalized.data) as {
          supplier?: unknown;
          invoice?: unknown;
          items?: unknown;
          totals?: unknown;
        },
        savePingSent: false,
      };
    } else {
      extractionLearnRef.current = { jobId: null, reviewBefore: null, savePingSent: false };
    }

    let matchedSupplierId: string | null = null;
    const itemMatches: Record<number, import('@/lib/matching/item-matcher').ItemMatchResult[]> = {};
    if (business?.id && normalized?.data) {
      try {
        const m = await matchExtractionForPurchase(business.id, normalized);
        matchedSupplierId = m.selectedSupplier;
        Object.assign(itemMatches, m.itemMatches);
      } catch (e) {
        console.warn('[purchase] extraction matching failed:', e);
      }
    }

    handleAcceptExtractedData(
      { data: normalized.data, selectedSupplier: matchedSupplierId, itemMatches },
      normalized,
    );

    const nItems = Array.isArray(normalized?.data?.items) ? normalized.data.items.length : 0;
    if (typeof window !== 'undefined' && window.innerWidth < 768 && nItems > 0) {
      queueMicrotask(() => {
        document.getElementById('purchase-mobile-items')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  };

  // Handle extraction errors
  const handleExtractionError = (error: string) => {
    toast.error(error);
  };

  const handleExtractionCompleteRef = useRef(handleExtractionComplete);
  handleExtractionCompleteRef.current = handleExtractionComplete;
  const pendingImportRanRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !business?.id || pendingImportRanRef.current) return;
    const raw = sessionStorage.getItem(PURCHASE_PENDING_EXTRACT_STORAGE_KEY);
    if (!raw) return;
    try {
      const payload = JSON.parse(raw);
      sessionStorage.removeItem(PURCHASE_PENDING_EXTRACT_STORAGE_KEY);
      pendingImportRanRef.current = true;
      void Promise.resolve(handleExtractionCompleteRef.current(payload));
    } catch {
      sessionStorage.removeItem(PURCHASE_PENDING_EXTRACT_STORAGE_KEY);
    }
  }, [business?.id]);

  /** Clearing the supplier search drops “New party” — avoids stale flag if user deletes the extracted name. */
  useEffect(() => {
    if (!supplierSearch.trim()) setSupplierUnmatchedFromExtraction(false);
  }, [supplierSearch]);

  useEffect(() => {
    if (typeof window === 'undefined' || !business?.id || !user?.id) return;
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get('extractionJob');
    if (!jobId || pendingImportRanRef.current) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/invoices/extract?job_id=${encodeURIComponent(jobId)}`, {
          credentials: 'include',
        });
        const data = await res.json();
        if (!res.ok || !data.job) {
          if (!cancelled) toast.error(typeof data.error === 'string' ? data.error : 'Could not load scan');
          return;
        }
        const job = data.job;
        if (job.status !== 'completed' || job.extraction_data == null) {
          if (!cancelled) toast.error('That scan is not ready to import yet');
          return;
        }
        if (cancelled) return;
        pendingImportRanRef.current = true;
        let extracted = job.extraction_data;
        if (typeof extracted === 'string') {
          try {
            extracted = JSON.parse(extracted);
          } catch {
            if (!cancelled) toast.error('Invalid scan data');
            return;
          }
        }
        const payload = {
          success: true,
          job_id: job.id,
          data: extracted,
          processing_time_ms: job.processing_time_ms,
          extraction_method: job.extraction_method,
        };
        await Promise.resolve(handleExtractionCompleteRef.current(payload));
        if (!cancelled) toast.success('Bill loaded from scan');
        const url = new URL(window.location.href);
        url.searchParams.delete('extractionJob');
        window.history.replaceState(
          {},
          '',
          url.pathname + (url.search && url.search !== '?' ? url.search : '')
        );
      } catch {
        if (!cancelled) toast.error('Could not import scan');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [business?.id, user?.id, toast]);

  /** @param envelopeForMeta — pass latest extract envelope; React state may not have updated yet. */
  const handleAcceptExtractedData = (reviewedData: any, envelopeForMeta?: any) => {
    const data = reviewedData.data;
    let matchedSupplier: Supplier | null = null;
    let openedCreateSupplierModal = false;

    // Fill supplier information
    if (data.supplier) {
      const extGstinNorm = (data.supplier.gstin || '').toString().trim().toUpperCase();
      /** Prefer catalog row that matches invoice GSTIN over a mismatched review radio (common mis-click). */
      let found: Supplier | null = null;
      if (extGstinNorm.length === 15) {
        found =
          suppliers.find(
            (s) => (s.gstin || '').toString().trim().toUpperCase() === extGstinNorm
          ) ?? null;
      }
      if (!found && reviewedData.selectedSupplier) {
        found = suppliers.find((s) => s.id === reviewedData.selectedSupplier) ?? null;
      }
      if (!found && data.supplier.name) {
        found =
          suppliers.find(
            (s) => s.name.toLowerCase() === data.supplier.name?.toLowerCase()
          ) ?? null;
      }
      matchedSupplier = found ?? null;

      const extGstin = (data.supplier.gstin || '').toString().trim().toUpperCase();
      const extStateFromGstin = stateCodeFromGstin(extGstin);
      const extStateFromField =
        data.supplier.state_code != null && String(data.supplier.state_code).trim()
          ? String(data.supplier.state_code).trim().slice(0, 2)
          : '';

      if (matchedSupplier) {
        setSelectedSupplier(matchedSupplier);
        setSupplierSearch(matchedSupplier.name);
        const gstin =
          (matchedSupplier.gstin || extGstin || '').toString().trim().toUpperCase();
        const sc =
          (matchedSupplier.state_code && String(matchedSupplier.state_code).trim().slice(0, 2)) ||
          stateCodeFromGstin(matchedSupplier.gstin || undefined) ||
          extStateFromField ||
          extStateFromGstin ||
          '';
        setFormData((prev) => ({
          ...prev,
          supplier_id: matchedSupplier!.id,
          supplier_gstin: gstin || prev.supplier_gstin,
          supplier_state_code: sc || prev.supplier_state_code,
        }));
      } else if (data.supplier.name) {
        openedCreateSupplierModal = false;
        setSupplierSearch(data.supplier.name);
        if (extGstin || extStateFromGstin || extStateFromField) {
          setFormData((prev) => ({
            ...prev,
            supplier_gstin: extGstin || prev.supplier_gstin,
            supplier_state_code: extStateFromField || extStateFromGstin || prev.supplier_state_code,
          }));
        }
      } else if (extGstin || extStateFromGstin || extStateFromField) {
        setFormData((prev) => ({
          ...prev,
          supplier_gstin: extGstin || prev.supplier_gstin,
          supplier_state_code: extStateFromField || extStateFromGstin || prev.supplier_state_code,
        }));
      }
    }

    // Fill invoice details
    if (data.invoice) {
      setFormData((prev) => ({
        ...prev,
        bill_number: data.invoice.bill_number || prev.bill_number,
        bill_date: data.invoice.bill_date || prev.bill_date,
        document_type: data.invoice.document_type || prev.document_type,
        is_reverse_charge: data.invoice.is_reverse_charge || prev.is_reverse_charge,
        price_mode:
          data.invoice.price_mode === 'inclusive' || data.invoice.price_mode === 'exclusive'
            ? data.invoice.price_mode
            : prev.price_mode,
        place_of_supply_state_code:
          (data.invoice.place_of_supply_state_code &&
            String(data.invoice.place_of_supply_state_code).trim().slice(0, 2)) ||
          getStateCode(String(data.invoice.place_of_supply || '').trim()) ||
          stateCodeFromGstin(
            (data.supplier?.gstin || prev.supplier_gstin || '').toString().trim().toUpperCase()
          ) ||
          prev.place_of_supply_state_code,
      }));
    }

    // Fill document-level round off (if provided by extraction)
    if (data.totals && typeof data.totals.round_off === 'number') {
      setFormData((prev) => ({
        ...prev,
        round_off: round2(data.totals.round_off),
      }));
    }

    let newItems: PurchaseItem[] = [];
    // Fill line items — derive pre-tax unit_price from tax-inclusive line amount so purchase totals don't double-count GST
    if (data.items && data.items.length > 0) {
      newItems = data.items.map((item: any, index: number) => {
        let qty = roundRetailQty(Number(item.quantity));
        if (!(qty > 0)) qty = 1;
        const discAmt = round2(Number(item.discount_amount) || 0);
        const discPct = round2(Number(item.discount_percent) || 0);
        const rawUp = roundExclusiveUnitPrice(Number(item.unit_price) || 0);
        const tr = round2(Number(item.tax_rate) || 0);
        const gross = qty * rawUp;
        const discForDerive =
          discAmt > 0 && gross > 0
            ? Math.min(100, round2((discAmt / gross) * 100))
            : discPct;
        const offInc = item.discount_on_tax_inclusive === true;
        const amt =
          typeof item.amount === 'number' && item.amount !== 0
            ? round2(item.amount)
            : discAmt > 0
              ? round2(inclusiveLineTotalWithDiscountAmount(qty, rawUp, discAmt, tr, offInc))
              : round2(inclusiveLineTotal(qty, rawUp, discPct, tr));
        let unitPrice = rawUp;
        let derivedPreGstApplied = false;
        if (amt > 0 && qty > 0) {
          const derived = deriveUnitPriceFromInvoiceLine(amt, qty, discForDerive, tr, rawUp);
          if (derived > 0) {
            unitPrice = roundExclusiveUnitPrice(derived);
            derivedPreGstApplied = true;
          }
        }
        const lineTaxMode: 'exclusive' | 'inclusive' | undefined =
          derivedPreGstApplied && tr > 0
            ? 'exclusive'
            : item.tax_mode === 'inclusive' || item.tax_mode === 'exclusive'
              ? item.tax_mode
              : undefined;
        return {
          id: `item-${Date.now()}-${index}`,
          item_id: reviewedData.itemMatches?.[index]?.[0]?.itemId || '',
          item_name: item.item_name || '',
          hsn_sac: item.hsn_sac || '',
          quantity: qty,
          unit: item.unit || 'PCS',
          unit_price: roundExclusiveUnitPrice(Number(unitPrice) || 0),
          discount_percent: discAmt > 0 ? 0 : discPct,
          discount_amount: discAmt,
          discount_on_tax_inclusive: item.discount_on_tax_inclusive === true,
          tax_rate: tr,
          tax_mode: lineTaxMode,
          invoice_inclusive_line_total:
            amt !== 0 && Number.isFinite(amt) ? round2(amt) : undefined,
          fromBillExtract: true,
        };
      });

      setPurchaseItems(newItems);
    }

    const hasExtractSupplierIdentity =
      data.supplier &&
      (String(data.supplier.name || '').trim().length > 0 ||
        String(data.supplier.gstin || '').trim().length > 0);
    setSupplierUnmatchedFromExtraction(Boolean(hasExtractSupplierIdentity && !matchedSupplier));

    const envMeta = envelopeForMeta ?? extractedData;
    const dbg = envMeta?.debug;
    setLastInvoiceFillTrace({
      at: new Date().toISOString(),
      extractionMethod: envMeta?.extraction_method,
      processingTimeMs: envMeta?.processing_time_ms,
      apiDebugSummary: dbg
        ? {
            keys: Object.keys(dbg),
            hasRawOcr: typeof dbg.raw_ocr_text === 'string' && dbg.raw_ocr_text.length > 0,
            note: typeof dbg.note === 'string' ? dbg.note : undefined,
          }
        : null,
      fromReview: {
        selectedSupplierId: reviewedData.selectedSupplier ?? null,
        supplier: data.supplier ?? null,
        invoice: data.invoice ?? null,
        totals: data.totals ?? null,
        items: Array.isArray(data.items) ? data.items : [],
      },
      appliedToForm: {
        matchedSupplier: matchedSupplier
          ? { id: matchedSupplier.id, name: matchedSupplier.name }
          : null,
        openedCreateSupplierModal,
        mergedInvoiceFields: data.invoice
          ? {
              bill_number: data.invoice.bill_number ?? null,
              bill_date: data.invoice.bill_date ?? null,
              document_type: data.invoice.document_type ?? null,
              is_reverse_charge: data.invoice.is_reverse_charge ?? null,
              place_of_supply_state_code:
                data.invoice.place_of_supply_state_code ?? data.supplier?.state_code ?? null,
            }
          : null,
        round_off_from_extract:
          data.totals && typeof data.totals.round_off === 'number' ? data.totals.round_off : null,
        purchaseLines: newItems.map((row, i) => ({
          catalog_item_id: row.item_id || null,
          item_name: row.item_name,
          quantity: row.quantity,
          unit: row.unit,
          unit_price_pre_tax: row.unit_price,
          discount_percent: row.discount_percent,
          discount_amount: row.discount_amount ?? 0,
          discount_on_tax_inclusive: row.discount_on_tax_inclusive === true,
          tax_rate: row.tax_rate,
          first_catalog_match_id: reviewedData.itemMatches?.[i]?.[0]?.itemId ?? null,
        })),
        notSetByQuickFill: [
          'price_mode',
          'paid_amount',
          'notes',
        ],
      },
    });

    toast.success('Invoice data loaded into the purchase form — review and edit as needed.');
  };

  const filteredSuppliers = suppliers.filter(s =>
    s.name.toLowerCase().includes(supplierSearch.toLowerCase()) ||
    s.phone?.includes(supplierSearch)
  );

  /** Resolves supplier UUID for the API — list shows "Unknown Supplier" when this is missing on save. */
  function resolveSupplierId(): string | null {
    const fromForm = (formData.supplier_id || '').trim();
    if (fromForm) return fromForm;
    if (selectedSupplier?.id) return selectedSupplier.id;
    const q = supplierSearch.trim().toLowerCase();
    if (!q || suppliers.length === 0) return null;
    const exact = suppliers.find((s) => s.name.trim().toLowerCase() === q);
    if (exact) return exact.id;
    const matches = suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (supplierSearch.trim() && s.phone?.includes(supplierSearch.trim()))
    );
    if (matches.length === 1) return matches[0].id;
    return null;
  }

  function addItem(isService = false) {
    const newItem: PurchaseItem = {
      id: Date.now().toString(),
      item_id: '',
      item_name: '',
      item_type: isService ? 'service' : 'goods',
      hsn_sac: '',
      quantity: 1,
      unit: isService ? 'NOS' : 'pcs',
      unit_price: 0,
      discount_percent: 0,
      discount_amount: 0,
      discount_on_tax_inclusive: false,
      tax_rate: 0,
      fromBillExtract: false,
    };
    setPurchaseItems([...purchaseItems, newItem]);
  }

  function removeItem(id: string) {
    setPurchaseItems(purchaseItems.filter(item => item.id !== id));
  }

  function applyInvoiceAnchorDeriveUnitPrice(item: PurchaseItem): PurchaseItem {
    const anchor = item.invoice_inclusive_line_total;
    if (anchor == null || !Number.isFinite(anchor) || Math.abs(anchor) < 1e-9) return item;
    const up = deriveExclusiveUnitPriceFromInvoiceAnchor({
      anchorInclusiveLineTotal: anchor,
      quantity: item.quantity,
      discountAmount: item.discount_amount ?? 0,
      discountPercent: item.discount_percent ?? 0,
      discountOnTaxInclusive: item.discount_on_tax_inclusive === true,
      gstRate: item.tax_rate ?? 0,
    });
    return { ...item, unit_price: roundExclusiveUnitPrice(up) };
  }

  function setLineItemInvoiceTotal(id: string, raw: string) {
    const trimmed = raw.trim();
    setPurchaseItems(
      purchaseItems.map((item) => {
        if (item.id !== id) return item;
        if (trimmed === '') {
          return { ...item, invoice_inclusive_line_total: undefined };
        }
        const v = parseFloat(trimmed);
        if (!Number.isFinite(v)) return item;
        const anchor = round2(v);
        let next: PurchaseItem = {
          ...item,
          invoice_inclusive_line_total: anchor,
          manual_cgst: undefined,
          manual_sgst: undefined,
          manual_igst: undefined,
        };
        return applyInvoiceAnchorDeriveUnitPrice(next);
      })
    );
  }

  function updateItem(id: string, field: keyof PurchaseItem, value: any) {
    const clearsInvoiceAnchor: Partial<Record<keyof PurchaseItem, true>> = {
      quantity: true,
      unit_price: true,
    };
    const reDeriveFromAnchor: Partial<Record<keyof PurchaseItem, true>> = {
      tax_rate: true,
      discount_percent: true,
      discount_amount: true,
      discount_on_tax_inclusive: true,
    };
    setPurchaseItems(
      purchaseItems.map((item) => {
        if (item.id !== id) return item;

        let coercedValue = value;

        const optionalManual: (keyof PurchaseItem)[] = ['manual_cgst', 'manual_sgst', 'manual_igst'];
        if (optionalManual.includes(field)) {
          if (value === undefined || value === '' || value === null) {
            coercedValue = undefined;
          } else {
            const n = typeof value === 'number' ? value : parseFloat(value);
            coercedValue = Number.isFinite(n) ? round2(n) : undefined;
          }
        } else if (
          field === 'quantity' ||
          field === 'unit_price' ||
          field === 'discount_percent' ||
          field === 'discount_amount' ||
          field === 'tax_rate'
        ) {
          const n = typeof value === 'number' ? value : parseFloat(value);
          if (field === 'quantity') {
            coercedValue = roundRetailQty(Number.isFinite(n) ? n : 0);
          } else if (field === 'unit_price') {
            coercedValue = roundExclusiveUnitPrice(Number.isFinite(n) ? n : 0);
          } else {
            coercedValue = round2(Number.isFinite(n) ? n : 0);
          }
        }

        let next: PurchaseItem = { ...item, [field]: coercedValue };
        if (clearsInvoiceAnchor[field]) {
          delete next.invoice_inclusive_line_total;
        } else if (next.invoice_inclusive_line_total != null && reDeriveFromAnchor[field]) {
          next = applyInvoiceAnchorDeriveUnitPrice(next);
        }
        return next;
      })
    );
  }

  function pickSupplier(s: Supplier) {
    setSupplierUnmatchedFromExtraction(false);
    setSelectedSupplier(s);
    setSupplierSearch(s.name);
    const sc =
      (s.state_code && String(s.state_code).trim().slice(0, 2)) ||
      stateCodeFromGstin(s.gstin || undefined) ||
      '';
    setFormData((prev) => ({
      ...prev,
      supplier_id: s.id,
      supplier_gstin: (s.gstin || '').toString().trim().toUpperCase(),
      supplier_state_code: sc || prev.supplier_state_code,
    }));
    setShowSupplierDropdown(false);
  }

  const purchaseGstDoc = useMemo(() => {
    if (!business) return null;
    const supplierStRaw =
      formData.supplier_state_code ||
      selectedSupplier?.state_code ||
      stateCodeFromGstin(formData.supplier_gstin || selectedSupplier?.gstin);
    const posFallback =
      formData.place_of_supply_state_code ||
      business.state_code ||
      getStateCode(business.state || '') ||
      '';
    const supplierSt =
      supplierStRaw && String(supplierStRaw).trim().length >= 2
        ? String(supplierStRaw).trim().slice(0, 2)
        : String(posFallback || '').trim().slice(0, 2);
    const doc = computePurchaseDocument(
      purchaseItems.map((it) => ({
        quantity: it.quantity,
        unit_price: it.unit_price,
        discount_percent: it.discount_percent,
        discount_amount: it.discount_amount ?? 0,
        discount_on_tax_inclusive: it.discount_on_tax_inclusive === true,
        tax_rate: it.tax_rate,
        tax_mode: it.tax_mode,
        manual_cgst: it.manual_cgst,
        manual_sgst: it.manual_sgst,
        manual_igst: it.manual_igst,
        invoice_inclusive_line_total: it.invoice_inclusive_line_total,
      })),
      {
        supplierStateCode: supplierSt || '',
        /**
         * Prefer persisted `state_code`; else profile state name (user-selected in settings);
         * else POS on this bill; else GSTIN prefix. GSTIN last avoids a stale/wrong GSTIN
         * overriding an explicit Karnataka address when `state_code` was never backfilled.
         */
        companyStateCode:
          (business.state_code && String(business.state_code).trim().slice(0, 2)) ||
          getStateCode(business.state || '') ||
          (formData.place_of_supply_state_code &&
            String(formData.place_of_supply_state_code).trim().slice(0, 2)) ||
          stateCodeFromGstin(business.gstin || undefined) ||
          '',
        headerPriceMode: formData.price_mode === 'inclusive' ? 'inclusive' : 'exclusive',
      }
    );
    return doc;
  }, [
    purchaseItems,
    formData.supplier_state_code,
    formData.supplier_gstin,
    formData.place_of_supply_state_code,
    formData.price_mode,
    selectedSupplier,
    business,
  ]);

  const totals = useMemo(() => {
    const ro = Number(formData.round_off) || 0;
    const d = purchaseGstDoc;
    if (!d) {
      return {
        subtotal: 0,
        taxTotal: 0,
        cgstTotal: 0,
        sgstTotal: 0,
        igstTotal: 0,
        grandTotal: ro,
        intraState: true,
        slabSummary: [] as { gst_rate: number; taxable_value: number; cgst: number; sgst: number; igst: number; total_tax: number }[],
      };
    }
    return {
      subtotal: d.subtotal,
      taxTotal: d.taxTotal,
      cgstTotal: d.cgstTotal,
      sgstTotal: d.sgstTotal,
      igstTotal: d.igstTotal,
      grandTotal: d.grandTotalLines + ro,
      intraState: d.intraState,
      slabSummary: d.slabSummary,
    };
  }, [purchaseGstDoc, formData.round_off]);

  const invoiceFillTracePanel =
    lastInvoiceFillTrace ? (
      <details className="mt-3 rounded-lg border border-border bg-white text-left">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-text-primary select-none">
          Last invoice fill trace (debug)
        </summary>
        <div className="border-t border-border px-3 py-3 space-y-3 text-xs text-text-secondary max-h-[min(70vh,520px)] overflow-auto">
          <p className="text-text-muted">
            Filled at {new Date(lastInvoiceFillTrace.at).toLocaleString()}
            {lastInvoiceFillTrace.extractionMethod ? (
              <>
                {' '}
                · extractor{' '}
                <span className="font-mono text-text-primary">{lastInvoiceFillTrace.extractionMethod}</span>
              </>
            ) : null}
          </p>
          {lastInvoiceFillTrace.apiDebugSummary && (
            <p className="text-text-muted">
              API debug keys:{' '}
              <span className="font-mono text-text-primary">
                {lastInvoiceFillTrace.apiDebugSummary.keys.join(', ') || '—'}
              </span>
              {lastInvoiceFillTrace.apiDebugSummary.hasRawOcr ? ' · raw OCR was included in response' : ''}
            </p>
          )}
          <div>
            <div className="font-medium text-text-primary mb-1">Extractor payload (supplier / invoice / lines)</div>
            <pre className="text-[11px] leading-snug font-mono border border-border rounded-md p-2 bg-gray-50 text-text-primary whitespace-pre-wrap break-words max-h-[220px] overflow-auto">
              {JSON.stringify(lastInvoiceFillTrace.fromReview, null, 2)}
            </pre>
          </div>
          <div>
            <div className="font-medium text-text-primary mb-1">What was written into this purchase form</div>
            <pre className="text-[11px] leading-snug font-mono border border-border rounded-md p-2 bg-gray-50 text-text-primary whitespace-pre-wrap break-words max-h-[220px] overflow-auto">
              {JSON.stringify(lastInvoiceFillTrace.appliedToForm, null, 2)}
            </pre>
          </div>
          <p className="text-text-muted border-t border-border pt-2">
            Fields never set by quick fill:{' '}
            <span className="font-mono">{lastInvoiceFillTrace.appliedToForm.notSetByQuickFill.join(', ')}</span>.
            Supplier GSTIN and state are filled from the invoice when the extractor provides a GSTIN (needed for
            CGST/SGST vs IGST). Set <span className="font-mono">INVOICE_EXTRACT_DEBUG=true</span> in{' '}
            <span className="font-mono">.env</span> for raw Google Vision OCR in the extract API.
          </p>
        </div>
      </details>
    ) : null;

  // After all hooks: gate render when user cannot create purchases
  if (sessionLoading || authLoading || permissionsLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (!business?.id || !user?.id) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 px-4 text-center text-sm text-text-secondary">
        <p>Session data is still loading. If this persists offline, open the app once while online.</p>
      </div>
    );
  }

  if (!canCreate) {
    return (
      <AccessDenied
        module="purchases"
        action="create"
        details={reason}
        code="PURCHASE_CREATE_DENIED"
      />
    );
  }

  async function handleSubmit(status: 'draft' | 'final') {
    if (!business) return;
    if (purchaseItems.length === 0) {
      toast.warning('Please add at least one item');
      return;
    }

    const hasNonServiceLine = purchaseItems.some((i) => i.item_type !== 'service');
    if (status === 'final' && warehouses.length > 0 && hasNonServiceLine && !selectedWarehouseId) {
      toast.warning('Select a warehouse (receiving location) before finalizing — stock is tracked per warehouse.');
      return;
    }

    const supplierId = resolveSupplierId();
    if (!supplierId) {
      toast.warning(
        'Choose a supplier from the dropdown list (click a row). Typing the name alone does not link the supplier record.'
      );
      return;
    }

    setLoading(true);
    try {
      const doc = purchaseGstDoc;
      if (!doc || doc.lineComputeds.length !== purchaseItems.length) {
        toast.error('Unable to compute GST totals. Please refresh and try again.');
        setLoading(false);
        return;
      }

      const payload = {
        ...formData,
        supplier_id: supplierId,
        status,
        business_id: business.id,
        branch_id:
          (currentBranchId && currentBranchId !== 'ALL' ? currentBranchId : userBranchId) || undefined,
        invoice_number: formData.bill_number?.trim() || null,
        supplier_gstin: formData.supplier_gstin?.trim() || null,
        supplier_state_code: formData.supplier_state_code?.trim() || null,
        price_mode: formData.price_mode,
        round_off: Number(formData.round_off) || 0,
        items: purchaseItems.map((item, idx) => {
          const c = doc.lineComputeds[idx];
          const payloadItem: any = {
            item_id: item.item_id || null,
            item_name: item.item_name,
            item_type: item.item_type === 'service' ? 'service' : 'goods',
            hsn_sac: item.hsn_sac,
            quantity: item.quantity,
            unit: item.unit,
            unit_price: item.unit_price,
            discount_percent: c.discountPercent,
            discount_amount: c.discountAmount,
            discount_account_id: item.discount_account_id || null,
            tax_rate: item.tax_rate,
            tax_mode: item.tax_mode || formData.price_mode,
            taxable_value: c.taxableValue,
            tax_amount: c.taxAmount,
            cgst_amount: c.cgstAmount,
            sgst_amount: c.sgstAmount,
            igst_amount: c.igstAmount,
            line_total: c.lineTotal,
            manual_cgst: item.manual_cgst,
            manual_sgst: item.manual_sgst,
            manual_igst: item.manual_igst,
            location_id: selectedWarehouseId || null,
          };

          if ((item as any).track_batch && item.batch_number) {
            payloadItem.batch_number = item.batch_number;
            payloadItem.manufacturing_date = item.manufacturing_date || null;
            payloadItem.expiry_date = item.expiry_date || null;
          }

          if ((item as any).track_serial && item.serial_numbers) {
            const serials = item.serial_numbers
              .split(/[,\n]/)
              .map((s: string) => s.trim())
              .filter((s: string) => s.length > 0);
            payloadItem.serial_numbers = serials;
          }
          return payloadItem;
        }),
        subtotal: totals.subtotal,
        tax_total: totals.taxTotal,
        grand_total: totals.grandTotal,
        place_of_supply_state_code: formData.place_of_supply_state_code || business.state_code,
        created_by: user?.id,
      };

      if (canQueueOfflineActions(connectivity.state)) {
        if (status === 'draft') {
          toast.warning('Saving a draft requires an internet connection.');
          setLoading(false);
          return;
        }

        if (!offlineFinalizeKeyRef.current) {
          offlineFinalizeKeyRef.current =
            typeof crypto !== 'undefined' && crypto.randomUUID
              ? `purchase.finalize:${business.id}:${crypto.randomUUID()}`
              : `purchase.finalize:${business.id}:${Date.now()}`;
        }

        const { queued } = await queueOfflineAction({
          type: 'purchase.finalize',
          payload,
          idempotencyKey: offlineFinalizeKeyRef.current,
        });

        if (queued) {
          toast.success(
            'Purchase saved offline. It will finalize and update stock when you reconnect.'
          );
          router.push('/purchases');
          return;
        }
      }

      const response = await fetch('/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const resBody = await safeJsonParse<{ purchase?: { id?: string } }>(response);
        const purchaseId =
          resBody?.purchase?.id && typeof resBody.purchase.id === 'string'
            ? resBody.purchase.id
            : null;
        const learn = extractionLearnRef.current;
        if (learn.jobId && learn.reviewBefore && !learn.savePingSent) {
          learn.savePingSent = true;
          const reviewAfter = buildReviewSnapshotFromPurchaseForm({
            formData,
            supplierSearch,
            selectedSupplier,
            purchaseItems,
            purchaseGstDoc: doc,
            computedGrandTotal: totals.grandTotal,
            extraSupplierSnapshot: extractedData?.data?.supplier ?? null,
          });
          const summary = summarizeInvoiceCorrectionDelta(learn.reviewBefore, reviewAfter);
          void fetch('/api/invoices/extract/learning', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              job_id: learn.jobId,
              source: 'purchase_form_save',
              correction_summary: summary,
              review_before: learn.reviewBefore,
              review_after: reviewAfter,
              ...(purchaseId ? { invoice_id: purchaseId } : {}),
              ...(user?.id ? { user_id: user.id } : {}),
            }),
          }).catch(() => {
            extractionLearnRef.current.savePingSent = false;
          });
        }

        router.push('/purchases');
        router.refresh();
      } else {
        const data = await safeJsonParse(response);
        toast.error(getApiErrorMessage(data, 'Failed to create purchase'));
      }
    } catch (error) {
      console.error('Error creating purchase:', error);
      toast.error('Failed to create purchase');
    } finally {
      setLoading(false);
    }
  }

  const renderDesktopForm = () => (
    <Card className="p-6 sm:p-8 lg:p-10">
      <form onSubmit={(e) => { e.preventDefault(); handleSubmit('draft'); }}>
        <div className="form-page-shell">
        <FormSection
          title="Quick fill from invoice"
          description="Upload a supplier bill — extracted supplier, lines, and amounts are filled straight into this form for you to edit (no separate review popup)."
        >
        <div className="bg-gradient-to-r from-slate-50 to-indigo-50 border border-primary-200 rounded-lg p-4 dark:from-primary-900/40 dark:to-indigo-950/40 dark:border-primary-800">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <FileUp className="w-5 h-5 text-primary-600" />
              <h3 className="text-sm font-semibold text-gray-900">Quick Fill from Invoice</h3>
            </div>
            <button
              type="button"
              onClick={() => setShowUploader(!showUploader)}
              className="text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              {showUploader ? 'Hide' : 'Upload Invoice'}
            </button>
          </div>
          
          {showUploader && (
            <InvoiceUploader
              businessId={business!.id}
              onExtractionComplete={handleExtractionComplete}
              onError={handleExtractionError}
            />
          )}
          
          {!showUploader && (
            <p className="text-xs text-text-secondary">
              Upload a bill — data is applied to this form directly so you can edit supplier and lines here.
            </p>
          )}
          {invoiceFillTracePanel}
        </div>
        </FormSection>

        <FormSection
          title="Supplier and bill"
          description="Pick a supplier from the list (click a row). Enter bill ID, dates, place of supply, and document type."
        >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 gap-y-6">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <label className="block text-sm font-medium text-text-secondary">Supplier *</label>
              {supplierNeedsCatalogLink && (
                <span className="text-xs font-medium rounded border border-green-200 bg-green-50 px-2 py-0.5 text-green-800">
                  New party
                </span>
              )}
            </div>
            <div className="relative supplier-dropdown-container">
              <input
                type="text"
                className="input w-full"
                placeholder="Search supplier..."
                value={supplierSearch}
                onChange={(e) => {
                  setSupplierSearch(e.target.value);
                  setShowSupplierDropdown(true);
                }}
                onFocus={() => setShowSupplierDropdown(true)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  if (filteredSuppliers.length !== 1) return;
                  e.preventDefault();
                  const s = filteredSuppliers[0];
                  pickSupplier(s);
                }}
              />
              {showSupplierDropdown && (filteredSuppliers.length > 0 || supplierSearch.trim().length > 0) && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto flex flex-col">
                  {filteredSuppliers.length === 0 && supplierSearch.trim().length > 0 && (
                    <div className="px-4 py-3 text-sm text-gray-600 border-b border-gray-100">
                      No supplier matches &quot;{supplierSearch.trim()}&quot;
                    </div>
                  )}
                  {filteredSuppliers.map((supplier) => (
                    <div
                      key={supplier.id}
                      className="px-4 py-2 hover:bg-gray-50 cursor-pointer text-sm"
                      onClick={() => pickSupplier(supplier)}
                    >
                      <div className="font-medium">{supplier.name}</div>
                      {supplier.phone && (
                        <div className="text-xs text-gray-500">{supplier.phone}</div>
                      )}
                    </div>
                  ))}
                  <div className="border-t border-gray-100 bg-slate-50 px-3 py-2 shrink-0">
                    <button
                      type="button"
                      className="text-sm font-medium text-primary-600 hover:text-primary-700"
                      onClick={() => {
                        setShowSupplierDropdown(false);
                        openAddSupplierModal();
                      }}
                    >
                      + Add new supplier{supplierSearch.trim() ? ` (“${supplierSearch.trim()}”)` : ''}
                    </button>
                  </div>
                </div>
              )}
            </div>
            {supplierNeedsCatalogLink && supplierSearch.trim().length > 0 && (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary">
                <span>Not linked to your supplier list yet.</span>
                <button
                  type="button"
                  className="link-primary font-medium whitespace-nowrap focus:outline-none focus:ring-2 rounded focus:ring-primary-500"
                  onClick={() => setShowSupplierDropdown(true)}
                >
                  Choose existing supplier
                </button>
                <span className="text-text-muted" aria-hidden>
                  ·
                </span>
                <button
                  type="button"
                  className="link-primary font-medium whitespace-nowrap focus:outline-none focus:ring-2 rounded focus:ring-primary-500"
                  onClick={() => openAddSupplierModal()}
                >
                  Create supplier
                </button>
              </p>
            )}
          </div>

          <Input
            label="Invoice / Bill number"
            value={formData.bill_number}
            onChange={(e) => setFormData({ ...formData, bill_number: e.target.value })}
            placeholder="Invoice number"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 gap-y-6">
          <Input
            label="Supplier GSTIN"
            value={formData.supplier_gstin}
            onChange={(e) =>
              setFormData({ ...formData, supplier_gstin: e.target.value.toUpperCase().replace(/\s/g, '') })
            }
            placeholder="15-character GSTIN"
          />
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Supplier state (GST)</label>
            <select
              className="input w-full"
              value={formData.supplier_state_code || ''}
              onChange={(e) => setFormData({ ...formData, supplier_state_code: e.target.value })}
            >
              <option value="">Select / auto from GSTIN</option>
              {INDIAN_STATES.map((state) => (
                <option key={state} value={getStateCode(state)}>
                  {state}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Price mode</label>
            <select
              className="input w-full"
              value={formData.price_mode}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  price_mode: e.target.value === 'inclusive' ? 'inclusive' : 'exclusive',
                })
              }
            >
              <option value="exclusive">Exclusive (rate before GST)</option>
              <option value="inclusive">Inclusive (rate includes GST)</option>
            </select>
          </div>
        </div>
        <p className="text-xs text-text-secondary -mt-2 mb-2">
          Tax type is automatic:{' '}
          {totals.intraState
            ? 'intra-state (CGST + SGST) when supplier state matches your business state.'
            : 'inter-state (IGST) when supplier state differs.'}
        </p>
        <label className="flex items-center gap-2 text-sm text-text-secondary mb-2">
          <input
            type="checkbox"
            checked={showAdvancedTax}
            onChange={(e) => setShowAdvancedTax(e.target.checked)}
            className="rounded border-border"
          />
          Advanced tax edit (manual CGST / SGST / IGST per line)
        </label>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 gap-y-6">
          <Input
            label="Bill Date *"
            type="date"
            value={formData.bill_date}
            onChange={(e) => setFormData({ ...formData, bill_date: e.target.value })}
            required
          />

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">
              Place of Supply
            </label>
            <select
              className="input w-full"
              value={formData.place_of_supply_state_code || business?.state_code || ''}
              onChange={(e) => {
                setFormData({
                  ...formData,
                  place_of_supply_state_code: e.target.value,
                });
              }}
            >
              <option value="">Select State</option>
              {INDIAN_STATES.map(state => (
                <option key={state} value={getStateCode(state)}>
                  {state}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">
              Document Type
            </label>
            <select
              className="input w-full"
              value={formData.document_type}
              onChange={(e) => setFormData({ ...formData, document_type: e.target.value })}
            >
              <option value="tax_invoice">Tax Invoice</option>
              <option value="bill_of_supply">Bill of Supply</option>
              <option value="bill_of_entry">Bill of Entry (Import of Goods)</option>
              <option value="import_service">Import of Services</option>
            </select>
          </div>
        </div>

        {/* Port Code - Only for Bill of Entry (Imports) */}
        {formData.document_type === 'bill_of_entry' && (
          <div>
            <Input
              label="Port Code"
              placeholder="Enter port code (e.g., INMAA, INBOM)"
              value={formData.port_code}
              onChange={(e) => setFormData({ ...formData, port_code: e.target.value })}
            />
            <p className="text-xs text-gray-500 mt-1">
              Port code where goods were imported (required for Bill of Entry)
            </p>
          </div>
        )}

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={formData.is_reverse_charge}
              onChange={(e) => setFormData({ ...formData, is_reverse_charge: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300"
            />
            <span className="text-sm text-text-secondary">Reverse Charge</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={formData.itc_eligible}
              onChange={(e) => setFormData({ ...formData, itc_eligible: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300"
            />
            <span className="text-sm text-text-secondary">ITC Eligible</span>
          </label>
        </div>
        </FormSection>

        {warehouses.length > 0 && (
        <FormSection
          title="Receiving warehouse"
          description="Stock for goods lines is received here when you finalize (branch follows your access)."
        >
          <div className="rounded-lg border border-border bg-surface p-4 space-y-2">
            <label className="block text-sm font-medium text-text-secondary">Receiving warehouse *</label>
            {warehousesLoading ? (
              <p className="text-sm text-gray-500">Loading warehouses…</p>
            ) : (
              <>
                <select
                  className="input w-full"
                  value={selectedWarehouseId}
                  onChange={(e) => setSelectedWarehouseId(e.target.value)}
                >
                  {warehouses.map((wh) => (
                    <option key={wh.id} value={wh.id}>
                      {wh.name}
                      {wh.warehouse_code ? ` (${wh.warehouse_code})` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-text-secondary">Finalized goods are received into this warehouse (branch: resolved from your access).</p>
              </>
            )}
          </div>
        </FormSection>
        )}
        {warehousesEnabled && effectivePurchaseBranchId && !warehousesLoading && warehouses.length === 0 && (
          <FormSection title="Receiving warehouse" description="Set up storage locations before finalizing goods purchases.">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            No warehouses are linked to this branch. If warehouse stock is enabled, finalize may fail for goods until you add warehouses in Settings.
          </div>
          </FormSection>
        )}

        <FormSection
          title="Line items"
          description="Add goods or services, adjust quantities, tax, and discounts. Expand rows for batch or serial details when tracking is enabled."
        >
        <div>
          <div className="flex flex-wrap justify-end gap-2 mb-4">
            <div className="flex gap-2 flex-wrap">
              <Button type="button" variant="secondary" onClick={() => addItem(false)} className="flex items-center gap-2">
                <Plus className="w-4 h-4" /> Add Goods
              </Button>
              <Button type="button" variant="secondary" onClick={() => addItem(true)} className="flex items-center gap-2">
                <Plus className="w-4 h-4" /> Add Service
              </Button>
            </div>
          </div>

          {purchaseItems.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No items added.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left py-2 px-3">Item</th>
                    <th className="text-left py-2 px-3">HSN/SAC</th>
                    <th className="text-right py-2 px-3">Qty</th>
                    <th className="text-right py-2 px-3">Rate</th>
                    <th className="text-right py-2 px-3">Disc %</th>
                    <th className="text-right py-2 px-3">Disc ₹</th>
                    <th className="text-left py-2 px-3">Discount Account</th>
                    <th className="text-right py-2 px-3">GST %</th>
                    <th className="text-right py-2 px-3">Taxable ₹</th>
                    {showAdvancedTax && (
                      <>
                        <th className="text-right py-2 px-3">CGST ₹</th>
                        <th className="text-right py-2 px-3">SGST ₹</th>
                        <th className="text-right py-2 px-3">IGST ₹</th>
                      </>
                    )}
                    <th className="text-right py-2 px-3">Line total</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {purchaseItems.map((item, itemIdx) => {
                    const hasTracking = (item as any).track_batch || (item as any).track_serial;
                    const isExpanded = expandedItems.has(item.id);
                    const lineComputed = purchaseGstDoc?.lineComputeds[itemIdx];
                    return (
                      <React.Fragment key={item.id}>
                        <tr className="border-b">
                          <td className="py-2 px-3">
                            <div className="space-y-1 min-w-[10rem]">
                              {!(item.item_id || '').trim() && (item.item_name || '').trim().length > 0 && (
                                <span className="inline-block text-[10px] font-semibold uppercase rounded border border-green-200 bg-green-50 px-1.5 py-0.5 text-green-800">
                                  New item
                                </span>
                              )}
                              <ItemAutocomplete
                              value={item.item_name}
                              onChange={(value) => updateItem(item.id, 'item_name', value)}
                              onSelect={(selectedItem) => {
                                const isBarcodeScan = !item.item_id && item.item_name === ''; // Detect if this is a new/empty row
                                
                                // Batch all updates in a single state update to avoid race conditions
                                setPurchaseItems(purchaseItems.map(pItem => {
                                  if (pItem.id === item.id) {
                                    return {
                                      ...pItem,
                                      item_id: selectedItem.id,
                                      item_name: selectedItem.name,
                                      item_type: selectedItem.item_type || 'goods',
                                      hsn_sac: selectedItem.hsn_sac || '',
                                      unit: selectedItem.unit || (selectedItem.item_type === 'service' ? 'NOS' : 'pcs'),
                                      unit_price: roundExclusiveUnitPrice(
                                        Number(selectedItem.purchase_price) || 0,
                                      ),
                                      tax_rate: round2(Number(selectedItem.tax_rate) || 0),
                                      quantity: isBarcodeScan ? 1 : pItem.quantity,
                                      invoice_inclusive_line_total: undefined,
                                      fromBillExtract: false,
                                      // Set tracking flags if item has batch/serial tracking
                                      track_batch: (selectedItem as any).track_batch || false,
                                      track_serial: (selectedItem as any).track_serial || false,
                                      // Initialize batch/serial fields if tracking is enabled
                                      batch_number: (selectedItem as any).track_batch ? (pItem.batch_number || '') : undefined,
                                      serial_numbers: (selectedItem as any).track_serial ? (pItem.serial_numbers || '') : undefined,
                                    };
                                  }
                                  return pItem;
                                }));
                                
                                // Auto-expand if tracking is enabled
                                if ((selectedItem as any).track_batch || (selectedItem as any).track_serial) {
                                  setExpandedItems(prev => new Set([...prev, item.id]));
                                }
                                
                                // Auto-focus quantity field after barcode scan
                                if (isBarcodeScan) {
                                  setTimeout(() => {
                                    const quantityInput = document.querySelector(`input[data-purchase-item-id="${item.id}"][data-field="quantity"]`) as HTMLInputElement;
                                    quantityInput?.focus();
                                    quantityInput?.select();
                                  }, 100);
                                }
                              }}
                              warehouseId={selectedWarehouseId || undefined}
                            />
                            {!(item.item_id || '').trim() && (
                              <p className="text-[11px] text-text-secondary leading-snug">
                                Not in catalogue — search above to link to inventory.
                              </p>
                            )}
                          </div>
                          </td>
                          <td className="py-2 px-3"><input type="text" className="w-full border-none bg-transparent outline-none" value={item.hsn_sac} onChange={(e) => updateItem(item.id, 'hsn_sac', e.target.value)} /></td>
                          <td className="py-2 px-3">
                            <input 
                              type="number" 
                              inputMode="decimal"
                              step="any" 
                              className="w-full text-right border-none bg-transparent outline-none" 
                              value={item.quantity} 
                              onChange={(e) => updateItem(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                              data-purchase-item-id={item.id}
                              data-field="quantity"
                            />
                          </td>
                          <td className="py-2 px-3"><input type="number" inputMode="decimal" step="any" className="w-full text-right border-none bg-transparent outline-none" value={item.unit_price} onChange={(e) => updateItem(item.id, 'unit_price', parseFloat(e.target.value) || 0)} /></td>
                          <td className="py-2 px-3"><input type="number" inputMode="decimal" className="w-full text-right border-none bg-transparent outline-none" value={item.discount_percent} onChange={(e) => {
                            const v = round2(parseFloat(e.target.value) || 0);
                            setPurchaseItems(purchaseItems.map(pItem => {
                              if (pItem.id !== item.id) return pItem;
                              let next: PurchaseItem = {
                                ...pItem,
                                discount_percent: v,
                                discount_amount: v > 0 ? 0 : (pItem.discount_amount ?? 0),
                                discount_on_tax_inclusive: v > 0 ? false : pItem.discount_on_tax_inclusive,
                              };
                              if (next.invoice_inclusive_line_total != null) {
                                next = applyInvoiceAnchorDeriveUnitPrice(next);
                              }
                              return next;
                            }));
                          }} /></td>
                          <td className="py-2 px-3">
                            <input
                              type="number"
                              inputMode="decimal"
                              className="w-full text-right border-none bg-transparent outline-none"
                              value={item.discount_amount ?? 0}
                              onChange={(e) => {
                                const v = round2(parseFloat(e.target.value) || 0);
                                setPurchaseItems(purchaseItems.map(pItem => {
                                  if (pItem.id !== item.id) return pItem;
                                  let next: PurchaseItem = {
                                    ...pItem,
                                    discount_amount: v,
                                    discount_percent: v > 0 ? 0 : pItem.discount_percent,
                                    discount_on_tax_inclusive:
                                      v > 0 ? (pItem.discount_on_tax_inclusive ?? false) : false,
                                  };
                                  if (next.invoice_inclusive_line_total != null) {
                                    next = applyInvoiceAnchorDeriveUnitPrice(next);
                                  }
                                  return next;
                                }));
                              }}
                            />
                            {formData.price_mode === 'exclusive' && (item.discount_amount ?? 0) > 0 && (
                              <label className="mt-1 flex cursor-pointer items-center gap-1.5 text-[10px] leading-tight text-text-secondary">
                                <input
                                  type="checkbox"
                                  className="rounded border-border text-primary-600 focus:ring-primary-500"
                                  checked={item.discount_on_tax_inclusive === true}
                                  onChange={(e) =>
                                    updateItem(item.id, 'discount_on_tax_inclusive', e.target.checked)
                                  }
                                />
                                <span>Discount applies to price incl. GST (MRP-style)</span>
                              </label>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            <select
                              className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                              value={item.discount_account_id || ''}
                              onChange={(e) => updateItem(item.id, 'discount_account_id', e.target.value || undefined)}
                            >
                              <option value="">No Account</option>
                              {accounts
                                .filter(acc => acc.account_type === 'income' && acc.is_active)
                                .map(account => (
                                  <option key={account.id} value={account.id}>
                                    {account.account_code} - {account.account_name}
                                  </option>
                                ))}
                            </select>
                          </td>
                          <td className="py-2 px-3"><input type="number" inputMode="decimal" className="w-full text-right border-none bg-transparent outline-none" value={item.tax_rate} onChange={(e) => updateItem(item.id, 'tax_rate', parseFloat(e.target.value) || 0)} /></td>
                          <td className="py-2 px-3 text-right tabular-nums text-text-secondary whitespace-nowrap">
                            {lineComputed != null ? lineComputed.taxableValue.toFixed(2) : '—'}
                          </td>
                          {showAdvancedTax && (
                            <>
                              <td className="py-2 px-3">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  className="w-full text-right border-none bg-transparent outline-none text-xs"
                                  value={item.manual_cgst ?? ''}
                                  placeholder="auto"
                                  onChange={(e) => {
                                    const v = e.target.value === '' ? undefined : parseFloat(e.target.value);
                                    updateItem(item.id, 'manual_cgst', v);
                                  }}
                                />
                              </td>
                              <td className="py-2 px-3">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  className="w-full text-right border-none bg-transparent outline-none text-xs"
                                  value={item.manual_sgst ?? ''}
                                  placeholder="auto"
                                  onChange={(e) => {
                                    const v = e.target.value === '' ? undefined : parseFloat(e.target.value);
                                    updateItem(item.id, 'manual_sgst', v);
                                  }}
                                />
                              </td>
                              <td className="py-2 px-3">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  className="w-full text-right border-none bg-transparent outline-none text-xs"
                                  value={item.manual_igst ?? ''}
                                  placeholder="auto"
                                  onChange={(e) => {
                                    const v = e.target.value === '' ? undefined : parseFloat(e.target.value);
                                    updateItem(item.id, 'manual_igst', v);
                                  }}
                                />
                              </td>
                            </>
                          )}
                          <td className="py-2 px-3 text-right">
                            <input
                              type="number"
                              inputMode="decimal"
                              className="w-full text-right border-none bg-transparent outline-none min-w-[4.5rem]"
                              title="Tax-inclusive line total from the bill; edits adjust Rate to match GST & discount."
                              value={
                                item.invoice_inclusive_line_total != null
                                  ? item.invoice_inclusive_line_total
                                  : (lineComputed?.lineTotal ?? '')
                              }
                              onChange={(e) => setLineItemInvoiceTotal(item.id, e.target.value)}
                            />
                            <p className="text-[10px] text-text-muted leading-tight mt-0.5 max-w-[8rem] ml-auto">
                              From invoice; edit to match bill — Rate updates.
                            </p>
                          </td>
                          <td className="py-2 px-3 text-center">
                            <div className="flex items-center gap-1">
                              {hasTracking && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExpandedItems(prev => {
                                      const newSet = new Set(prev);
                                      if (isExpanded) {
                                        newSet.delete(item.id);
                                      } else {
                                        newSet.add(item.id);
                                      }
                                      return newSet;
                                    });
                                  }}
                                  className="text-primary-500 hover:text-primary-700 text-xs px-2 py-1"
                                  title={isExpanded ? 'Hide batch/serial fields' : 'Show batch/serial fields'}
                                >
                                  {isExpanded ? '−' : '+'}
                                </button>
                              )}
                              <button type="button" onClick={() => removeItem(item.id)} className="text-red-500 hover:text-red-700">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {hasTracking && isExpanded && (
                          <tr className="border-b bg-gray-50">
                            <td colSpan={showAdvancedTax ? 14 : 11} className="py-3 px-3">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                {(item as any).track_batch && (
                                  <>
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 mb-1">Batch Number *</label>
                                      <input
                                        type="text"
                                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                                        value={item.batch_number || ''}
                                        onChange={(e) => updateItem(item.id, 'batch_number', e.target.value)}
                                        placeholder="Enter batch number"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 mb-1">Manufacturing Date</label>
                                      <input
                                        type="date"
                                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                                        value={item.manufacturing_date || ''}
                                        onChange={(e) => updateItem(item.id, 'manufacturing_date', e.target.value)}
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 mb-1">Expiry Date</label>
                                      <input
                                        type="date"
                                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                                        value={item.expiry_date || ''}
                                        onChange={(e) => updateItem(item.id, 'expiry_date', e.target.value)}
                                      />
                                    </div>
                                  </>
                                )}
                                {(item as any).track_serial && (
                                  <div className={(item as any).track_batch ? '' : 'md:col-span-2'}>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">
                                      Serial Numbers * (one per line or comma-separated)
                                    </label>
                                    <textarea
                                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                                      rows={3}
                                      value={item.serial_numbers || ''}
                                      onChange={(e) => updateItem(item.id, 'serial_numbers', e.target.value)}
                                      placeholder="SN001&#10;SN002&#10;SN003"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                      Enter {item.quantity} serial number(s) for quantity {item.quantity}
                                    </p>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </FormSection>

        <FormSection title="Amount summary" description="Totals follow Indian GST: supplier state vs your business state sets CGST+SGST vs IGST. Use price mode for inclusive retail bills.">
        <div className="border-t border-border pt-4 flex justify-end">
          <div className="w-full max-w-2xl space-y-3 text-sm">
            <div className="flex justify-between text-text-secondary"><span>Subtotal (taxable):</span><span>₹{totals.subtotal.toFixed(2)}</span></div>
            {(totals.cgstTotal > 0.005 || totals.sgstTotal > 0.005) && (
              <>
                <div className="flex justify-between text-text-secondary"><span>CGST:</span><span>₹{totals.cgstTotal.toFixed(2)}</span></div>
                <div className="flex justify-between text-text-secondary"><span>SGST:</span><span>₹{totals.sgstTotal.toFixed(2)}</span></div>
              </>
            )}
            {totals.igstTotal > 0.005 && totals.cgstTotal < 0.005 && totals.sgstTotal < 0.005 && (
              <div className="flex justify-between text-text-secondary"><span>IGST:</span><span>₹{totals.igstTotal.toFixed(2)}</span></div>
            )}
            {totals.taxTotal > 0.005 && totals.cgstTotal < 0.005 && totals.sgstTotal < 0.005 && totals.igstTotal < 0.005 && (
              <div className="flex justify-between text-text-secondary"><span>GST:</span><span>₹{totals.taxTotal.toFixed(2)}</span></div>
            )}
            {totals.slabSummary.length > 0 && (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-text-secondary uppercase tracking-wide">
                  GST summary (by rate)
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-text-secondary">
                      <th className="text-left py-2 px-3">Rate</th>
                      <th className="text-right py-2 px-3">Taxable</th>
                      <th className="text-right py-2 px-3">CGST</th>
                      <th className="text-right py-2 px-3">SGST</th>
                      <th className="text-right py-2 px-3">IGST</th>
                      <th className="text-right py-2 px-3">Tax</th>
                    </tr>
                  </thead>
                  <tbody>
                    {totals.slabSummary.map((row) => (
                      <tr key={row.gst_rate} className="border-b border-border last:border-0">
                        <td className="py-2 px-3">{row.gst_rate}%</td>
                        <td className="text-right py-2 px-3">₹{row.taxable_value.toFixed(2)}</td>
                        <td className="text-right py-2 px-3">₹{row.cgst.toFixed(2)}</td>
                        <td className="text-right py-2 px-3">₹{row.sgst.toFixed(2)}</td>
                        <td className="text-right py-2 px-3">₹{row.igst.toFixed(2)}</td>
                        <td className="text-right py-2 px-3 font-medium">₹{row.total_tax.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {Math.abs(Number(formData.round_off) || 0) > 0.005 && (
              <div className="flex justify-between text-text-secondary">
                <span>Round off:</span>
                <span>₹{(Number(formData.round_off) || 0).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-lg font-bold text-text-primary border-t border-border pt-2"><span>Grand Total:</span><span>₹{totals.grandTotal.toFixed(2)}</span></div>
          </div>
        </div>
        </FormSection>

        <FormSection title="Payment and notes" description="Optional payment recorded now and internal notes for this bill.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 gap-y-6">
          <NumericBlurField
            label="Paid Amount"
            variant="boxed"
            mode="money"
            value={formData.paid_amount}
            onCommit={(v) => setFormData((prev) => ({ ...prev, paid_amount: v }))}
          />
          <NumericBlurField
            label="Round off"
            variant="boxed"
            mode="money"
            value={formData.round_off}
            onCommit={(v) => setFormData((prev) => ({ ...prev, round_off: v }))}
          />
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Notes</label>
            <textarea className="input w-full min-h-[5rem]" rows={3} value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} />
          </div>
        </div>
        </FormSection>

        </div>

        <div className="flex justify-end gap-4 pt-4 mt-6 border-t border-border">
          <Button type="button" variant="secondary" onClick={() => handleSubmit('draft')} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 mr-2" />} Save as Draft
          </Button>
          <div className="flex flex-col gap-1">
            <Button 
              type="button" 
              onClick={() => handleSubmit('final')} 
              disabled={loading || !isOnline}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 mr-2" />} {isOnline ? 'Save & Finalize' : 'Sync Required'}
            </Button>
            <p className="text-[10px] text-center text-text-muted">
              {isOnline ? '⚠️ This will affect GST filing' : '⚠️ Offline: Sync to file GST'}
            </p>
          </div>
        </div>
      </form>
    </Card>
  );


  return (
    <>
    <div className="w-full min-w-0 max-w-none space-y-4">
        <MobileDuplicatePageChrome
          className="mb-4"
          title="New Purchase"
          onBack={() => router.back()}
          trailing={formData.status ? <StatusBadge status={formData.status} className="hidden md:flex" /> : undefined}
        />

        {isMobile && business?.id ? (
          <MobileNewPurchaseScrollForm
            businessStateCode={business.state_code ?? null}
            formData={formData as unknown as MobilePurchaseFormState}
            setFormData={setFormData as unknown as React.Dispatch<React.SetStateAction<MobilePurchaseFormState>>}
            supplierSearch={supplierSearch}
            setSupplierSearch={setSupplierSearch}
            supplierNeedsCatalogLink={supplierNeedsCatalogLink}
            showSupplierDropdown={showSupplierDropdown}
            setShowSupplierDropdown={setShowSupplierDropdown}
            filteredSuppliers={filteredSuppliers}
            pickSupplier={pickSupplier}
            openAddSupplierModal={openAddSupplierModal}
            invoiceFillTracePanel={invoiceFillTracePanel}
            selectedWarehouseId={selectedWarehouseId}
            setSelectedWarehouseId={setSelectedWarehouseId}
            warehousesLoading={warehousesLoading}
            warehouses={warehouses}
            warehousesEnabled={warehousesEnabled}
            effectivePurchaseBranchId={effectivePurchaseBranchId}
            accounts={accounts}
            purchaseItems={purchaseItems as unknown as PurchaseMobileLine[]}
            setPurchaseItems={setPurchaseItems as unknown as React.Dispatch<React.SetStateAction<PurchaseMobileLine[]>>}
            onOpenItemPicker={onOpenItemPicker}
            removeItem={removeItem}
            updateItem={(id, field, value) =>
              updateItem(id, field as keyof PurchaseItem, value as never)
            }
            expandedItems={expandedItems}
            setExpandedItems={setExpandedItems}
            applyInvoiceAnchorDeriveUnitPrice={(line) =>
              applyInvoiceAnchorDeriveUnitPrice(line as PurchaseItem) as PurchaseMobileLine
            }
            setLineItemInvoiceTotal={setLineItemInvoiceTotal}
            purchaseGstDoc={purchaseGstDoc}
            totals={totals}
            loading={loading}
            isOnline={isOnline}
            onSubmitDraft={() => void handleSubmit('draft')}
            onSubmitFinal={() => void handleSubmit('final')}
          />
        ) : (
          renderDesktopForm()
        )}
      </div>

      <CreateSupplierModal
        isOpen={supplierCreateModal.open}
        onClose={() => setSupplierCreateModal({ open: false })}
        onSuccess={handleNewSupplierCreated}
        initialData={supplierCreateModal.initial ?? {}}
      />

    </>
  );
}

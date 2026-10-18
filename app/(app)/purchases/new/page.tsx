'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { NumericBlurField } from '@/components/ui/NumericBlurField';
import { ItemAutocomplete } from '@/components/ui/ItemAutocomplete';
import { Trash2, Loader2, ScanLine, Upload, FileText, CheckCircle2, ChevronRight, X, Search, MoreVertical } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { useLayoutData } from '@/contexts/LayoutDataContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { format, formatDistanceToNow } from 'date-fns';
import { Supplier, Item, Account } from '@/types/database';
import { INDIAN_STATES, getStateCode } from '@/lib/gst-utils';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PurchaseBillUploadModal, type PurchaseBillSource } from '@/components/purchases/PurchaseBillUploadModal';
import { RcmCoverageNotice } from '@/components/gst/RcmCoverageNotice';
import { calculateItemNameSimilarity } from '@/lib/matching/item-name-similarity';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';
import { summarizeInvoiceCorrectionDelta } from '@/lib/services/invoice-extract/invoiceExtractionCorrectionSummary';
import { normalizeExtractionEnvelope } from '@/lib/purchases/extraction-envelope-normalize';
import { matchExtractionForPurchase } from '@/lib/purchases/match-extraction-for-purchase';
import {
  findAutoLinkLocalSupplierMatch,
  hasStrongLocalSupplierSuggestions,
} from '@/lib/matching/find-local-supplier-match';
import { extractionJobReadyForImport } from '@/lib/purchases/extraction-job-purchase-link';
import { purchaseCessTotal, purchaseLineCess } from '@/lib/purchases/cess';
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
import { MobileItemPickerPanel, type ItemLite } from '@/components/invoices/MobileItemPickerPanel';
import {
  inclusiveLineTotal,
  inclusiveLineTotalWithDiscountAmount,
} from '@/lib/invoice-line-math';
import {
  computePurchaseDocument,
  deriveExclusiveUnitPriceFromInvoiceAnchor,
  stateCodeFromGstin,
} from '@/lib/purchase-gst-calculator';
import { round2, roundRetailQty, roundExclusiveUnitPrice } from '@/lib/numeric-precision';
import { resolvePurchaseFormLineFromExtractItem } from '@/lib/purchases/map-extracted-line';
import { PURCHASE_PENDING_EXTRACT_STORAGE_KEY, PURCHASE_ITEM_PICK_RESULT_KEY } from '@/lib/purchase-scan-constants';

interface PurchaseItem {
  id: string;
  item_id: string;
  item_name: string;
  item_type?: 'goods' | 'service';
  is_capital_goods?: boolean;
  /** Compensation cess amount from the supplier's bill (on top of GST). */
  cess_amount?: number;
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
  const [itemPickerKind, setItemPickerKind] = useState<'goods' | 'service' | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
  const [formData, setFormData] = useState({
    supplier_id: '',
    bill_number: '',
    bill_date: format(new Date(), 'yyyy-MM-dd'),
    due_date: '',
    status: 'draft',
    place_of_supply_state_code: '',
    is_reverse_charge: false,
    supplier_registration_status: 'unknown' as 'registered' | 'unregistered' | 'unknown',
    supply_received_on: '',
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
  const [editingPurchaseId, setEditingPurchaseId] = useState<string | null>(null);
  const [showUploader, setShowUploader] = useState(false);
  /** Bill the desktop form was last filled from (drives the "Filled from" banner). */
  const [billSource, setBillSource] = useState<PurchaseBillSource | null>(null);
  const [fillAt, setFillAt] = useState<Date | null>(null);
  const [fillBannerOpen, setFillBannerOpen] = useState(true);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogueBusy, setCatalogueBusy] = useState(false);
  /** Desktop action bar is fixed (app shell's overflow-x-hidden breaks sticky), so it tracks the form's box. */
  const [desktopFormEl, setDesktopFormEl] = useState<HTMLFormElement | null>(null);
  const [footerBox, setFooterBox] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    if (!desktopFormEl) return;
    const measure = () => {
      const r = desktopFormEl.getBoundingClientRect();
      setFooterBox({ left: r.left, width: r.width });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(desktopFormEl);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [desktopFormEl]);
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
    if (hasStrongLocalSupplierSuggestions(suppliers, supplierSearch)) return false;
    return true;
  }, [
    supplierUnmatchedFromExtraction,
    formData.supplier_id,
    selectedSupplier?.id,
    supplierSearch,
    suppliers,
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

  const onOpenItemPicker = useCallback((kind: 'goods' | 'service') => {
    setItemPickerKind(kind);
  }, []);

  const handlePurchasePickerApply = useCallback(
    (selections: Array<{ item: ItemLite; quantity: number }>) => {
      const merged = new Map<string, { item: ItemLite; quantity: number }>();
      for (const sel of selections) {
        const vid = sel.item.variantId ? String(sel.item.variantId) : '';
        const key = `${String(sel.item.id)}::${vid}`;
        const prev = merged.get(key);
        merged.set(key, {
          item: sel.item,
          quantity: (prev?.quantity || 0) + sel.quantity,
        });
      }

      setPurchaseItems((prev) => {
        const next = [...prev];
        const trackedIds: string[] = [];
        for (const { item, quantity } of merged.values()) {
          if (quantity <= 0) continue;
          const variantName = item.variantName?.trim();
          const displayName = variantName ? `${item.name} — ${variantName}` : String(item.name || '');
          const itemId = String(item.id || '');
          const existingIndex = next.findIndex(
            (row) => row.item_id === itemId && row.item_name === displayName
          );
          if (existingIndex >= 0) {
            next[existingIndex] = {
              ...next[existingIndex],
              quantity: roundRetailQty(Number(next[existingIndex].quantity) + quantity),
            };
            continue;
          }
          const row = purchaseLineFromCatalogPick({
            ...(item as unknown as Record<string, unknown>),
            id: item.id,
            name: displayName,
            purchase_price: item.purchase_price,
            item_type: item.item_type,
          });
          row.quantity = roundRetailQty(quantity);
          next.push(row);
          if (row.track_batch || row.track_serial) trackedIds.push(row.id);
        }
        if (trackedIds.length > 0) {
          const ids = trackedIds;
          queueMicrotask(() => {
            setExpandedItems((open) => new Set([...open, ...ids]));
          });
        }
        return next;
      });
      setItemPickerKind(null);
      queueMicrotask(() => {
        document.getElementById('purchase-mobile-items')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      const added = merged.size;
      toast.success(added === 1 ? 'Added to purchase' : `Added ${added} items to purchase`);
    },
    [toast]
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const id = new URLSearchParams(window.location.search).get('edit');
    if (!id || !business?.id) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/purchases/${id}`, { credentials: 'include' });
      if (!res.ok || cancelled) return;
      const data = await res.json();
      const purchase = data.purchase;
      if (!purchase || purchase.status !== 'draft' || cancelled) return;
      setEditingPurchaseId(purchase.id);
      setSupplierSearch(purchase.supplier_name || '');
      setFormData((prev) => ({
        ...prev,
        supplier_id: purchase.supplier_id || '',
        bill_number: purchase.bill_number || '',
        bill_date: String(purchase.bill_date || prev.bill_date).slice(0, 10),
        due_date: purchase.due_date ? String(purchase.due_date).slice(0, 10) : '',
        notes: purchase.notes || '',
        place_of_supply_state_code: purchase.place_of_supply_state_code || prev.place_of_supply_state_code,
        is_reverse_charge: Boolean(purchase.is_reverse_charge),
        supplier_registration_status: purchase.supplier_registration_status || 'unknown',
        supply_received_on: purchase.supply_received_on ? String(purchase.supply_received_on).slice(0, 10) : '',
        supplier_gstin: purchase.supplier_gstin || '',
        itc_eligible: purchase.itc_eligible !== false,
      }));
      setPurchaseItems(
        (purchase.items || []).map((item: { id: string; item_id?: string; item_name?: string; hsn_sac?: string; quantity?: number; unit?: string; unit_price?: number; discount_percent?: number; tax_rate?: number; line_item_type?: string }, index: number) => ({
          id: item.id || `item-${index}`,
          item_id: item.item_id || '',
          item_name: item.item_name || '',
          item_type: item.line_item_type === 'service' ? 'service' : 'goods',
          hsn_sac: item.hsn_sac || '',
          quantity: Number(item.quantity) || 1,
          unit: item.unit || 'pcs',
          unit_price: Number(item.unit_price) || 0,
          discount_percent: Number(item.discount_percent) || 0,
          discount_amount: 0,
          discount_on_tax_inclusive: false,
          tax_rate: Number(item.tax_rate) || 0,
          fromBillExtract: false,
        }))
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [business?.id]);

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
  const handleExtractionComplete = async (result: any, source?: PurchaseBillSource) => {
    const normalized = normalizeExtractionEnvelope(result);
    setExtractedData(normalized);
    setShowUploader(false);
    setBillSource((prev) => {
      if (prev?.url && prev.url !== source?.url) URL.revokeObjectURL(prev.url);
      return source ?? { name: 'scanned bill', size: null, type: '', url: null };
    });
    setFillAt(new Date());
    setFillBannerOpen(true);

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
  const itemPrefillRanRef = useRef(false);

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
        if (!extractionJobReadyForImport(job.status) || job.extraction_data == null) {
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

  useEffect(() => {
    if (typeof window === 'undefined' || !business?.id || itemPrefillRanRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const itemId = (params.get('item_id') || '').trim();
    if (!itemId) return;
    itemPrefillRanRef.current = true;
    const qty = parseFloat(params.get('qty') || '') || 1;

    void (async () => {
      try {
        const res = await fetch(`/api/items/${encodeURIComponent(itemId)}?business_id=${business.id}`, {
          credentials: 'include',
        });
        const data = await res.json();
        if (!res.ok || !data.item) return;
        const row = purchaseLineFromCatalogPick(data.item as Record<string, unknown>);
        row.quantity = roundRetailQty(qty);
        setPurchaseItems((prev) => (prev.length > 0 ? prev : [row]));
        if (row.track_batch || row.track_serial) {
          setExpandedItems((open) => new Set([...open, row.id]));
        }
      } catch {
        /* leave the form empty if the item cannot be loaded */
      }
    })();
  }, [business?.id]);

  /** @param envelopeForMeta — pass latest extract envelope; React state may not have updated yet. */
  const handleAcceptExtractedData = (reviewedData: any, envelopeForMeta?: any) => {
    const data = reviewedData.data;
    let matchedSupplier: Supplier | null = null;
    let openedCreateSupplierModal = false;

    // Fill supplier information
    if (data.supplier) {
      let found: Supplier | null = null;

      const autoLink = findAutoLinkLocalSupplierMatch(suppliers, {
        name: data.supplier.name,
        gstin: data.supplier.gstin,
      });
      if (autoLink) {
        found = suppliers.find((s) => s.id === autoLink.supplier.id) ?? null;
      }

      if (!found && reviewedData.selectedSupplier) {
        found = suppliers.find((s) => s.id === reviewedData.selectedSupplier) ?? null;
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
    // Fill line items — mapper already emits exclusive unit_price; do not re-derive when provenance exists.
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
        const resolved = resolvePurchaseFormLineFromExtractItem(item, {
          quantity: qty,
          unitPrice: rawUp,
          taxRate: tr,
          discountPercentForDerive: discForDerive,
          amount: amt,
        });
        return {
          id: `item-${Date.now()}-${index}`,
          item_id: reviewedData.itemMatches?.[index]?.[0]?.itemId || '',
          item_name: item.item_name || '',
          hsn_sac: item.hsn_sac || '',
          quantity: qty,
          unit: item.unit || 'PCS',
          unit_price: roundExclusiveUnitPrice(Number(resolved.unitPrice) || 0),
          discount_percent: discAmt > 0 ? 0 : discPct,
          discount_amount: discAmt,
          discount_on_tax_inclusive: item.discount_on_tax_inclusive === true,
          tax_rate: tr,
          tax_mode: resolved.taxMode,
          invoice_inclusive_line_total: resolved.invoiceInclusiveLineTotal,
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
    const cessTotal = purchaseCessTotal(purchaseItems);
    const d = purchaseGstDoc;
    if (!d) {
      return {
        subtotal: 0,
        taxTotal: 0,
        cgstTotal: 0,
        sgstTotal: 0,
        igstTotal: 0,
        cessTotal,
        grandTotal: ro + cessTotal,
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
      cessTotal,
      grandTotal: d.grandTotalLines + cessTotal + ro,
      intraState: d.intraState,
      slabSummary: d.slabSummary,
    };
  }, [purchaseGstDoc, purchaseItems, formData.round_off]);

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
            <pre className="text-caption leading-snug font-mono border border-border rounded-md p-2 bg-gray-50 text-text-primary whitespace-pre-wrap break-words max-h-[220px] overflow-auto">
              {JSON.stringify(lastInvoiceFillTrace.fromReview, null, 2)}
            </pre>
          </div>
          <div>
            <div className="font-medium text-text-primary mb-1">What was written into this purchase form</div>
            <pre className="text-caption leading-snug font-mono border border-border rounded-md p-2 bg-gray-50 text-text-primary whitespace-pre-wrap break-words max-h-[220px] overflow-auto">
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
        ...(editingPurchaseId ? { id: editingPurchaseId } : {}),
        supplier_id: supplierId,
        status,
        business_id: business.id,
        branch_id:
          (currentBranchId && currentBranchId !== 'ALL' ? currentBranchId : userBranchId) || undefined,
        invoice_number: formData.bill_number?.trim() || null,
        due_date: formData.due_date || null,
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
            itc_type: item.item_type !== 'service' && item.is_capital_goods ? 'capital_goods' : undefined,
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
            cess_amount: purchaseLineCess(item),
            manual_cgst: item.manual_cgst,
            manual_sgst: item.manual_sgst,
            manual_igst: item.manual_igst,
            invoice_inclusive_line_total: item.invoice_inclusive_line_total,
            discount_on_tax_inclusive: item.discount_on_tax_inclusive === true,
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
        extraction_job_id: extractionLearnRef.current.jobId,
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

  const unlinkedLines = purchaseItems.filter(
    (i) => !(i.item_id || '').trim() && (i.item_name || '').trim().length > 0
  );
  const linkedSupplierId = resolveSupplierId();
  const billGstinMissing =
    Boolean(billSource) &&
    !String(extractedData?.data?.supplier?.gstin || '').trim() &&
    !(formData.supplier_gstin || '').trim();
  const needsWarehouse =
    warehouses.length > 0 && purchaseItems.some((i) => i.item_type !== 'service') && !selectedWarehouseId;
  const checks: Array<{ key: string; label: string; target: string }> = [];
  if (!linkedSupplierId) checks.push({ key: 'supplier', label: supplierSearch.trim() ? 'Supplier not linked' : 'Pick a supplier', target: 'purchase-supplier-card' });
  if (billGstinMissing) checks.push({ key: 'gstin', label: 'GSTIN not found on bill', target: 'purchase-supplier-card' });
  if (unlinkedLines.length > 0)
    checks.push({
      key: 'items',
      label: `${unlinkedLines.length} item${unlinkedLines.length === 1 ? '' : 's'} not in catalogue`,
      target: 'purchase-items-card',
    });
  if (needsWarehouse) checks.push({ key: 'warehouse', label: 'Pick a receiving warehouse', target: 'purchase-supplier-card' });
  const discountTotal = round2(
    (purchaseGstDoc?.lineComputeds || []).reduce((s, c) => s + (Number(c.discountAmount) || 0), 0)
  );
  const discountAccounts = accounts.filter(
    (acc) =>
      acc.is_active &&
      ((acc.account_type === 'income' && /discount/i.test(acc.account_name)) ||
        (acc.account_type === 'expense' && /purchase/i.test(acc.account_name)))
  );
  const fieldClass =
    'h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text-primary placeholder:text-text-muted focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100';
  const labelClass = 'mb-1.5 block text-sm font-medium text-text-primary';
  const cellInputClass =
    'w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-right tabular-nums text-text-primary hover:border-border focus:border-primary-400 focus:bg-surface focus:outline-none';

  function scrollToCard(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function toggleLineDetails(id: string) {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setLineDiscountPercent(id: string, raw: string) {
    const v = round2(parseFloat(raw) || 0);
    setPurchaseItems(
      purchaseItems.map((pItem) => {
        if (pItem.id !== id) return pItem;
        let next: PurchaseItem = {
          ...pItem,
          discount_percent: v,
          discount_amount: v > 0 ? 0 : (pItem.discount_amount ?? 0),
          discount_on_tax_inclusive: v > 0 ? false : pItem.discount_on_tax_inclusive,
        };
        if (next.invoice_inclusive_line_total != null) next = applyInvoiceAnchorDeriveUnitPrice(next);
        return next;
      })
    );
  }

  function setLineDiscountAmount(id: string, raw: string) {
    const v = round2(parseFloat(raw) || 0);
    setPurchaseItems(
      purchaseItems.map((pItem) => {
        if (pItem.id !== id) return pItem;
        let next: PurchaseItem = {
          ...pItem,
          discount_amount: v,
          discount_percent: v > 0 ? 0 : pItem.discount_percent,
          discount_on_tax_inclusive: v > 0 ? (pItem.discount_on_tax_inclusive ?? false) : false,
        };
        if (next.invoice_inclusive_line_total != null) next = applyInvoiceAnchorDeriveUnitPrice(next);
        return next;
      })
    );
  }

  function linkLineToCatalogItem(lineId: string, selectedItem: any) {
    const isBarcodeScan = purchaseItems.some((p) => p.id === lineId && !p.item_id && p.item_name === '');
    setPurchaseItems(
      purchaseItems.map((pItem) => {
        if (pItem.id !== lineId) return pItem;
        return {
          ...pItem,
          item_id: selectedItem.id,
          item_name: selectedItem.name,
          item_type: selectedItem.item_type || 'goods',
          hsn_sac: selectedItem.hsn_sac || '',
          unit: selectedItem.unit || (selectedItem.item_type === 'service' ? 'NOS' : 'pcs'),
          unit_price: roundExclusiveUnitPrice(Number(selectedItem.purchase_price) || 0),
          tax_rate: round2(Number(selectedItem.tax_rate) || 0),
          quantity: isBarcodeScan ? 1 : pItem.quantity,
          invoice_inclusive_line_total: undefined,
          fromBillExtract: false,
          track_batch: selectedItem.track_batch || false,
          track_serial: selectedItem.track_serial || false,
          batch_number: selectedItem.track_batch ? (pItem.batch_number || '') : undefined,
          serial_numbers: selectedItem.track_serial ? (pItem.serial_numbers || '') : undefined,
        };
      })
    );
    if (selectedItem.track_batch || selectedItem.track_serial) {
      setExpandedItems((prev) => new Set([...prev, lineId]));
    }
    if (isBarcodeScan) {
      setTimeout(() => {
        const q = document.querySelector(
          `input[data-purchase-item-id="${lineId}"][data-field="quantity"]`
        ) as HTMLInputElement | null;
        q?.focus();
        q?.select();
      }, 100);
    }
  }

  /** Links bill lines to existing catalogue items by close name match; keeps the bill's qty, rate and tax. */
  function matchUnlinkedAutomatically() {
    const catalogue = items.filter((it) => (it as { is_active?: boolean }).is_active !== false);
    let linked = 0;
    const next = purchaseItems.map((line) => {
      if ((line.item_id || '').trim() || !(line.item_name || '').trim()) return line;
      let best: Item | null = null;
      let bestScore = 0;
      for (const it of catalogue) {
        const score = calculateItemNameSimilarity(line.item_name, it.name);
        if (score > bestScore) {
          best = it;
          bestScore = score;
        }
      }
      if (!best || bestScore < 85) return line;
      linked += 1;
      return {
        ...line,
        item_id: best.id,
        item_name: best.name,
        hsn_sac: line.hsn_sac || String((best as { hsn_sac?: string }).hsn_sac || ''),
      };
    });
    setPurchaseItems(next);
    if (linked === 0) toast.warning('No close matches in your catalogue. Link the items one by one, or add them.');
    else toast.success(`Linked ${linked} of ${unlinkedLines.length} items. Check the names before saving.`);
  }

  async function addUnlinkedToCatalogue() {
    if (!business?.id || catalogueBusy) return;
    setCatalogueBusy(true);
    const created = new Map<string, string>();
    let failed = 0;
    try {
      for (const line of unlinkedLines) {
        try {
          const res = await fetch('/api/items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              business_id: business.id,
              name: line.item_name.trim(),
              hsn_sac: line.hsn_sac || '',
              unit: line.unit || 'PCS',
              tax_rate: line.tax_rate || 0,
              purchase_price: line.unit_price || 0,
              item_type: line.item_type === 'service' ? 'service' : 'goods',
              is_active: true,
            }),
          });
          const data = await safeJsonParse<{ item?: { id?: string } }>(res);
          if (res.ok && data?.item?.id) created.set(line.id, data.item.id);
          else failed += 1;
        } catch {
          failed += 1;
        }
      }
      if (created.size > 0) {
        setPurchaseItems((prev) =>
          prev.map((p) => (created.has(p.id) ? { ...p, item_id: created.get(p.id)!, fromBillExtract: false } : p))
        );
        void fetchItems();
      }
      if (failed > 0) toast.error(`Added ${created.size} items; ${failed} could not be added.`);
      else toast.success(`Added ${created.size} items to your catalogue.`);
    } finally {
      setCatalogueBusy(false);
    }
  }

  const renderDesktopForm = () => (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit('draft');
      }}
      ref={setDesktopFormEl}
      className="mx-auto w-full max-w-[1300px] pb-28"
    >
      <nav className="text-sm text-text-secondary" aria-label="Breadcrumb">
        <button type="button" onClick={() => router.push('/purchases')} className="hover:text-text-primary">
          Purchases
        </button>
        <span className="mx-1.5 text-text-muted">/</span>
        <span>New purchase</span>
      </nav>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-text-primary">{editingPurchaseId ? 'Edit draft purchase' : 'New purchase'}</h1>
          <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-medium text-text-secondary dark:bg-white/10">
            {editingPurchaseId ? 'Draft' : 'Draft · not saved yet'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowUploader(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-primary-500 bg-surface px-5 py-2.5 text-sm font-semibold text-primary-500 hover:bg-primary-50 dark:border-primary-300 dark:text-primary-200"
        >
          <Upload className="h-4 w-4" /> Upload bill
        </button>
      </div>

      <div className="mt-5 space-y-5">
        {billSource && fillBannerOpen && (
          <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-surface px-4 py-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-border bg-[#f1eee6] dark:bg-white/5" aria-hidden>
              <FileText className="h-5 w-5 text-text-muted" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-1.5 text-sm">
                <CheckCircle2 className="h-4 w-4 text-primary-500" />
                <span className="font-semibold text-text-primary">Filled from {billSource.name}</span>
                <span className="text-xs text-text-muted">
                  · {purchaseItems.length} item{purchaseItems.length === 1 ? '' : 's'} · ₹{totals.grandTotal.toFixed(2)}
                  {fillAt ? ` · ${formatDistanceToNow(fillAt, { addSuffix: true })}` : ''}
                </span>
              </p>
              {checks.some((c) => c.key !== 'warehouse') && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {checks
                    .filter((c) => c.key !== 'warehouse')
                    .map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => scrollToCard(c.target)}
                        className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-200"
                      >
                        {c.label}
                      </button>
                    ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-5 text-sm font-semibold">
              {billSource.url && (
                <a href={billSource.url} target="_blank" rel="noreferrer" className="text-primary-500 hover:underline dark:text-primary-200">
                  View bill
                </a>
              )}
              <button type="button" onClick={() => setShowUploader(true)} className="text-primary-500 hover:underline dark:text-primary-200">
                Replace
              </button>
              <button
                type="button"
                onClick={() => setFillBannerOpen(false)}
                className="rounded p-1 text-text-muted hover:bg-black/5 hover:text-text-primary"
                aria-label="Hide bill summary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        <section id="purchase-supplier-card" className="scroll-mt-4 rounded-2xl border border-border bg-surface p-6">
          <h2 className="text-base font-semibold text-text-primary">Supplier &amp; bill</h2>
          <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-4 md:grid-cols-3">
            <div className="md:col-span-2">
              <label className={labelClass}>
                Supplier <span className="text-red-600">*</span>
              </label>
              <div className="supplier-dropdown-container relative">
                <input
                  type="text"
                  className={`${fieldClass} ${supplierNeedsCatalogLink ? 'border-amber-300 bg-amber-50/60 dark:bg-amber-900/20' : ''}`}
                  placeholder="Search your suppliers"
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
                    pickSupplier(filteredSuppliers[0]);
                  }}
                />
                {showSupplierDropdown && (filteredSuppliers.length > 0 || supplierSearch.trim().length > 0) && (
                  <div className="absolute z-50 mt-1 flex max-h-60 w-full flex-col overflow-auto rounded-lg border border-border bg-surface shadow-lg">
                    {filteredSuppliers.length === 0 && supplierSearch.trim().length > 0 && (
                      <div className="border-b border-border px-4 py-3 text-sm text-text-secondary">
                        No supplier matches &quot;{supplierSearch.trim()}&quot;
                      </div>
                    )}
                    {filteredSuppliers.map((supplier) => (
                      <div
                        key={supplier.id}
                        className="cursor-pointer px-4 py-2 text-sm hover:bg-black/5"
                        onClick={() => pickSupplier(supplier)}
                      >
                        <div className="font-medium text-text-primary">{supplier.name}</div>
                        {supplier.phone && <div className="text-xs text-text-muted">{supplier.phone}</div>}
                      </div>
                    ))}
                    <div className="shrink-0 border-t border-border px-3 py-2">
                      <button
                        type="button"
                        className="text-sm font-medium text-primary-500 hover:underline dark:text-primary-200"
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
                <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-amber-800 dark:text-amber-200">
                  <span>New party — not in your supplier list.</span>
                  <button type="button" className="font-semibold text-primary-500 underline dark:text-primary-200" onClick={() => setShowSupplierDropdown(true)}>
                    Link existing
                  </button>
                  <button type="button" className="font-semibold text-primary-500 underline dark:text-primary-200" onClick={() => openAddSupplierModal()}>
                    Create supplier
                  </button>
                </p>
              )}
            </div>

            <div>
              <label className={labelClass}>Bill number</label>
              <input
                className={fieldClass}
                value={formData.bill_number}
                onChange={(e) => setFormData({ ...formData, bill_number: e.target.value })}
                placeholder="As printed on the bill"
              />
            </div>

            <div>
              <label className={labelClass}>
                Bill date <span className="text-red-600">*</span>
              </label>
              <input
                type="date"
                className={fieldClass}
                value={formData.bill_date}
                onChange={(e) => setFormData({ ...formData, bill_date: e.target.value })}
                required
              />
            </div>
            <div>
              <label className={labelClass}>Due date</label>
              <input
                type="date"
                className={fieldClass}
                value={formData.due_date}
                min={formData.bill_date}
                onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                title="Leave blank if due on the bill date"
                data-testid="purchase-due-date"
              />
            </div>
            <div>
              <label className={labelClass}>Document type</label>
              <select
                className={fieldClass}
                value={formData.document_type}
                onChange={(e) => setFormData({ ...formData, document_type: e.target.value })}
              >
                <option value="tax_invoice">Tax invoice</option>
                <option value="bill_of_supply">Bill of supply</option>
                <option value="bill_of_entry">Bill of entry (import of goods)</option>
                <option value="import_service">Import of services</option>
              </select>
            </div>

            <div>
              <label className={labelClass}>Supplier GSTIN</label>
              <input
                className={fieldClass}
                value={formData.supplier_gstin}
                onChange={(e) =>
                  setFormData({ ...formData, supplier_gstin: e.target.value.toUpperCase().replace(/\s/g, '') })
                }
                placeholder="15-character GSTIN"
              />
            </div>
            <div>
              <label className={labelClass}>Supplier state</label>
              <select
                className={fieldClass}
                value={formData.supplier_state_code || ''}
                onChange={(e) => setFormData({ ...formData, supplier_state_code: e.target.value })}
              >
                <option value="">Auto from GSTIN</option>
                {INDIAN_STATES.map((state) => (
                  <option key={state} value={getStateCode(state)}>
                    {state}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Place of supply</label>
              <select
                className={fieldClass}
                value={formData.place_of_supply_state_code || business?.state_code || ''}
                onChange={(e) => setFormData({ ...formData, place_of_supply_state_code: e.target.value })}
              >
                <option value="">Select state</option>
                {INDIAN_STATES.map((state) => (
                  <option key={state} value={getStateCode(state)}>
                    {state}
                  </option>
                ))}
              </select>
            </div>

            {formData.document_type === 'bill_of_entry' && (
              <div>
                <label className={labelClass}>Port code</label>
                <input
                  className={fieldClass}
                  placeholder="e.g. INMAA, INBOM"
                  value={formData.port_code}
                  onChange={(e) => setFormData({ ...formData, port_code: e.target.value })}
                />
                <p className="mt-1 text-xs text-text-muted">Port where the goods came in (needed for a bill of entry).</p>
              </div>
            )}
            {warehouses.length > 0 && (
              <div>
                <label className={labelClass}>
                  Receiving warehouse <span className="text-red-600">*</span>
                </label>
                {warehousesLoading ? (
                  <p className="py-3 text-sm text-text-muted">Loading warehouses…</p>
                ) : (
                  <select
                    className={`${fieldClass} ${needsWarehouse ? 'border-amber-300' : ''}`}
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
                )}
              </div>
            )}
          </div>

          {warehousesEnabled && effectivePurchaseBranchId && !warehousesLoading && warehouses.length === 0 && (
            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              No warehouses are linked to this branch. Finalizing goods may fail until you add one in Settings.
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border pt-5">
            <div className="flex items-center gap-3">
              <span className="text-sm text-text-secondary">Prices are</span>
              <div className="inline-flex rounded-lg bg-black/5 p-1 dark:bg-white/10" role="radiogroup" aria-label="Prices are">
                {(['exclusive', 'inclusive'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={formData.price_mode === mode}
                    onClick={() => setFormData({ ...formData, price_mode: mode })}
                    className={`rounded-md px-4 py-1.5 text-sm font-medium ${
                      formData.price_mode === mode
                        ? 'bg-surface text-text-primary shadow-sm'
                        : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {mode === 'exclusive' ? 'Before GST' : 'GST inclusive'}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                checked={formData.itc_eligible}
                onChange={(e) => setFormData({ ...formData, itc_eligible: e.target.checked })}
                className="h-4 w-4 rounded border-border text-primary-500 focus:ring-primary-500"
              />
              ITC eligible
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                checked={formData.is_reverse_charge}
                onChange={(e) => setFormData({ ...formData, is_reverse_charge: e.target.checked })}
                className="h-4 w-4 rounded border-border text-primary-500 focus:ring-primary-500"
              />
              Reverse charge
            </label>
            <span className="ml-auto rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-500 dark:bg-primary-900/40 dark:text-primary-200">
              {totals.intraState ? 'Intra-state · CGST + SGST' : 'Inter-state · IGST'}
            </span>
          </div>
          <div className="mt-3 max-w-3xl">
            <RcmCoverageNotice kind="purchase" />
          </div>

          <details className="group mt-5 border-t border-border pt-4">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-primary-500 dark:text-primary-200">
              <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
              More details — registration, received date, manual tax
            </summary>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className={labelClass}>Supplier registration on this supply</label>
                <select
                  className={fieldClass}
                  value={formData.supplier_registration_status}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      supplier_registration_status: e.target.value as 'registered' | 'unregistered' | 'unknown',
                    })
                  }
                >
                  <option value="unknown">Unknown</option>
                  <option value="registered">Registered</option>
                  <option value="unregistered">Unregistered</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Date goods or services were received</label>
                <input
                  type="date"
                  className={fieldClass}
                  value={formData.supply_received_on}
                  onChange={(e) => setFormData({ ...formData, supply_received_on: e.target.value })}
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 self-end pb-3 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={showAdvancedTax}
                  onChange={(e) => setShowAdvancedTax(e.target.checked)}
                  className="h-4 w-4 rounded border-border text-primary-500 focus:ring-primary-500"
                />
                Enter CGST / SGST / IGST by hand per line
              </label>
            </div>
          </details>
        </section>

        <section id="purchase-items-card" className="scroll-mt-4 overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="flex flex-wrap items-center gap-3 px-6 pt-5">
            <h2 className="text-base font-semibold text-text-primary">Items</h2>
            <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-semibold text-text-secondary dark:bg-white/10">
              {purchaseItems.length}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <div className="flex h-11 w-[360px] max-w-full items-center gap-2 rounded-lg border border-border px-3 focus-within:border-primary-400">
                <Search className="h-4 w-4 shrink-0 text-text-muted" />
                <ItemAutocomplete
                  value={catalogQuery}
                  onChange={setCatalogQuery}
                  placeholder="Add item — search catalogue"
                  className="!min-h-0 !py-1 !text-sm !font-normal"
                  warehouseId={selectedWarehouseId || undefined}
                  onSelect={(picked) => {
                    const row = purchaseLineFromCatalogPick(picked as unknown as Record<string, unknown>);
                    setPurchaseItems((prev) => [...prev, row]);
                    if (row.track_batch || row.track_serial) setExpandedItems((open) => new Set([...open, row.id]));
                    setCatalogQuery('');
                  }}
                />
              </div>
              <button
                type="button"
                onClick={() => addItem(true)}
                className="h-11 rounded-lg border border-border px-4 text-sm font-semibold text-text-primary hover:bg-black/5"
              >
                + Service
              </button>
            </div>
          </div>

          {unlinkedLines.length > 0 && (
            <div className="mx-6 mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-100">
              <span>
                {unlinkedLines.length} item{unlinkedLines.length === 1 ? '' : 's'}
                {billSource ? ' from the bill' : ''} {unlinkedLines.length === 1 ? "isn't" : "aren't"} in your catalogue. Link them so
                stock updates on save.
              </span>
              <span className="ml-auto flex gap-4 font-semibold">
                <button type="button" onClick={matchUnlinkedAutomatically} className="text-primary-500 underline dark:text-primary-200">
                  Match automatically
                </button>
                <button
                  type="button"
                  onClick={() => void addUnlinkedToCatalogue()}
                  disabled={catalogueBusy}
                  className="inline-flex items-center gap-1.5 text-primary-500 underline disabled:opacity-60 dark:text-primary-200"
                >
                  {catalogueBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Add all to catalogue
                </button>
              </span>
            </div>
          )}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-y border-border bg-black/[0.02] text-xs font-semibold uppercase tracking-wide text-text-secondary dark:bg-white/5">
                  <th className="w-12 py-3 pl-6 text-left">#</th>
                  <th className="py-3 text-left">Item</th>
                  <th className="w-28 py-3 text-left">HSN / SAC</th>
                  <th className="w-24 py-3 text-right">Qty</th>
                  <th className="w-28 py-3 text-right">Rate ₹</th>
                  <th className="w-20 py-3 text-right">Disc %</th>
                  <th className="w-20 py-3 text-right">GST</th>
                  <th className="w-32 py-3 text-right">Amount ₹</th>
                  <th className="w-24 py-3 pr-4" aria-label="Row actions" />
                </tr>
              </thead>
              <tbody>
                {purchaseItems.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-6 py-10 text-center text-text-muted">
                      No items yet. Search the catalogue above, add a line, or upload the bill.
                    </td>
                  </tr>
                )}
                {purchaseItems.map((item, itemIdx) => {
                  const isExpanded = expandedItems.has(item.id);
                  const lineComputed = purchaseGstDoc?.lineComputeds[itemIdx];
                  const isUnlinked = !(item.item_id || '').trim() && (item.item_name || '').trim().length > 0;
                  return (
                    <React.Fragment key={item.id}>
                      <tr className={isExpanded ? '' : 'border-b border-border'}>
                        <td className="py-2.5 pl-6 align-middle text-text-muted">{itemIdx + 1}</td>
                        <td className="py-2.5 pr-3 align-middle">
                          <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <ItemAutocomplete
                                value={item.item_name}
                                onChange={(value) => updateItem(item.id, 'item_name', value)}
                                onSelect={(selectedItem) => linkLineToCatalogItem(item.id, selectedItem)}
                                placeholder={item.item_type === 'service' ? 'Service name' : 'Item name'}
                                className="!min-h-0 !py-1 !text-sm !font-medium"
                                warehouseId={selectedWarehouseId || undefined}
                              />
                            </div>
                            {isUnlinked && (
                              <span
                                className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                                title="Search in the name box to link this line to a catalogue item"
                              >
                                Not linked
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 align-middle">
                          <input
                            type="text"
                            className={`${cellInputClass} !text-left`}
                            placeholder="Add"
                            value={item.hsn_sac}
                            onChange={(e) => updateItem(item.id, 'hsn_sac', e.target.value)}
                          />
                        </td>
                        <td className="py-2.5 align-middle">
                          <input
                            type="number"
                            inputMode="decimal"
                            step="any"
                            className={cellInputClass}
                            value={item.quantity}
                            onChange={(e) => updateItem(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                            data-purchase-item-id={item.id}
                            data-field="quantity"
                          />
                        </td>
                        <td className="py-2.5 align-middle">
                          <input
                            type="number"
                            inputMode="decimal"
                            step="any"
                            className={cellInputClass}
                            value={item.unit_price}
                            onChange={(e) => updateItem(item.id, 'unit_price', parseFloat(e.target.value) || 0)}
                          />
                        </td>
                        <td className="py-2.5 align-middle">
                          <input
                            type="number"
                            inputMode="decimal"
                            className={cellInputClass}
                            value={item.discount_percent}
                            onChange={(e) => setLineDiscountPercent(item.id, e.target.value)}
                            title={(item.discount_amount ?? 0) > 0 ? `₹${item.discount_amount} discount set in line details` : undefined}
                          />
                        </td>
                        <td className="py-2.5 align-middle">
                          <div className="flex items-center justify-end">
                            <input
                              type="number"
                              inputMode="decimal"
                              className={`${cellInputClass} w-14`}
                              value={item.tax_rate}
                              onChange={(e) => updateItem(item.id, 'tax_rate', parseFloat(e.target.value) || 0)}
                              aria-label="GST rate percent"
                            />
                            <span className="text-text-secondary">%</span>
                          </div>
                        </td>
                        <td className="py-2.5 align-middle">
                          <input
                            type="number"
                            inputMode="decimal"
                            className={`${cellInputClass} font-semibold`}
                            title="Line total as on the bill (incl. GST). Editing it adjusts the rate."
                            value={
                              item.invoice_inclusive_line_total != null
                                ? item.invoice_inclusive_line_total
                                : (lineComputed?.lineTotal ?? '')
                            }
                            onChange={(e) => setLineItemInvoiceTotal(item.id, e.target.value)}
                          />
                        </td>
                        <td className="py-2.5 pr-4 align-middle">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => toggleLineDetails(item.id)}
                              className={`rounded-md p-2 text-text-secondary hover:bg-black/5 ${isExpanded ? 'bg-black/5 text-text-primary' : ''}`}
                              aria-expanded={isExpanded}
                              aria-label={isExpanded ? 'Hide line details' : 'Show line details'}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeItem(item.id)}
                              className="rounded-md p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                              aria-label="Remove line"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="border-b border-border">
                          <td />
                          <td colSpan={8} className="pb-3 pr-6">
                            <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-[#faf8f3] p-4 md:grid-cols-4 dark:bg-white/5">
                              <div>
                                <label className="mb-1 block text-xs font-medium text-text-secondary">Unit</label>
                                <input
                                  className={`${fieldClass} !h-10`}
                                  list="purchase-unit-options"
                                  value={item.unit}
                                  onChange={(e) => updateItem(item.id, 'unit', e.target.value)}
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-xs font-medium text-text-secondary">Discount account</label>
                                <select
                                  className={`${fieldClass} !h-10`}
                                  value={item.discount_account_id || ''}
                                  onChange={(e) => updateItem(item.id, 'discount_account_id', e.target.value || undefined)}
                                >
                                  <option value="">None</option>
                                  {discountAccounts.map((account) => (
                                    <option key={account.id} value={account.id}>
                                      {account.account_code} - {account.account_name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="mb-1 block text-xs font-medium text-text-secondary">Discount ₹</label>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  className={`${fieldClass} !h-10`}
                                  value={item.discount_amount ?? 0}
                                  onChange={(e) => setLineDiscountAmount(item.id, e.target.value)}
                                />
                                {formData.price_mode === 'exclusive' && (item.discount_amount ?? 0) > 0 && (
                                  <label className="mt-1 flex cursor-pointer items-center gap-1.5 text-xs text-text-secondary">
                                    <input
                                      type="checkbox"
                                      className="rounded border-border text-primary-500"
                                      checked={item.discount_on_tax_inclusive === true}
                                      onChange={(e) => updateItem(item.id, 'discount_on_tax_inclusive', e.target.checked)}
                                    />
                                    On price incl. GST (MRP-style)
                                  </label>
                                )}
                              </div>
                              {item.item_type !== 'service' ? (
                                <div>
                                  <label
                                    className="mb-1 block text-xs font-medium text-text-secondary"
                                    title="Compensation cess on the supplier's bill (tobacco, aerated drinks, motor vehicles, coal)"
                                  >
                                    Cess ₹
                                  </label>
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    step="any"
                                    min={0}
                                    placeholder="0.00"
                                    className={`${fieldClass} !h-10`}
                                    value={item.cess_amount ?? ''}
                                    onChange={(e) =>
                                      updateItem(item.id, 'cess_amount', e.target.value === '' ? undefined : Number(e.target.value))
                                    }
                                  />
                                </div>
                              ) : (
                                <div />
                              )}
                              <p className="self-center text-xs text-text-secondary">
                                Taxable value:{' '}
                                <span className="font-semibold tabular-nums text-text-primary">
                                  ₹{lineComputed != null ? lineComputed.taxableValue.toFixed(2) : '—'}
                                </span>
                              </p>
                              {item.item_type !== 'service' && (
                                <label
                                  className="flex cursor-pointer items-center gap-2 self-center text-sm text-text-primary"
                                  title="Machinery or equipment used in business (GSTR-9 Table 6B capital goods)"
                                >
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-border text-primary-500"
                                    checked={!!item.is_capital_goods}
                                    onChange={(e) => updateItem(item.id, 'is_capital_goods', e.target.checked)}
                                  />
                                  Capital goods
                                </label>
                              )}
                              {showAdvancedTax &&
                                (['manual_cgst', 'manual_sgst', 'manual_igst'] as const).map((field) => (
                                  <div key={field}>
                                    <label className="mb-1 block text-xs font-medium text-text-secondary">
                                      {field.replace('manual_', '').toUpperCase()} ₹
                                    </label>
                                    <input
                                      type="number"
                                      inputMode="decimal"
                                      placeholder="auto"
                                      className={`${fieldClass} !h-10`}
                                      value={item[field] ?? ''}
                                      onChange={(e) =>
                                        updateItem(item.id, field, e.target.value === '' ? undefined : parseFloat(e.target.value))
                                      }
                                    />
                                  </div>
                                ))}
                              {item.track_batch && (
                                <>
                                  <div>
                                    <label className="mb-1 block text-xs font-medium text-text-secondary">Batch number *</label>
                                    <input
                                      className={`${fieldClass} !h-10`}
                                      value={item.batch_number || ''}
                                      onChange={(e) => updateItem(item.id, 'batch_number', e.target.value)}
                                      placeholder="Enter batch number"
                                    />
                                  </div>
                                  <div>
                                    <label className="mb-1 block text-xs font-medium text-text-secondary">Manufacturing date</label>
                                    <input
                                      type="date"
                                      className={`${fieldClass} !h-10`}
                                      value={item.manufacturing_date || ''}
                                      onChange={(e) => updateItem(item.id, 'manufacturing_date', e.target.value)}
                                    />
                                  </div>
                                  <div>
                                    <label className="mb-1 block text-xs font-medium text-text-secondary">Expiry date</label>
                                    <input
                                      type="date"
                                      className={`${fieldClass} !h-10`}
                                      value={item.expiry_date || ''}
                                      onChange={(e) => updateItem(item.id, 'expiry_date', e.target.value)}
                                    />
                                  </div>
                                </>
                              )}
                              {item.track_serial && (
                                <div className="col-span-2">
                                  <label className="mb-1 block text-xs font-medium text-text-secondary">
                                    Serial numbers * (one per line or comma-separated)
                                  </label>
                                  <textarea
                                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                                    rows={3}
                                    value={item.serial_numbers || ''}
                                    onChange={(e) => updateItem(item.id, 'serial_numbers', e.target.value)}
                                    placeholder="SN001&#10;SN002"
                                  />
                                  <p className="mt-1 text-xs text-text-muted">Enter {item.quantity} serial number(s).</p>
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
            <datalist id="purchase-unit-options">
              {['pcs', 'kg', 'g', 'l', 'ml', 'box', 'pack', 'dozen', 'm', 'NOS'].map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </div>

          <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-4">
            <button type="button" onClick={() => addItem(false)} className="text-sm font-semibold text-primary-500 hover:underline dark:text-primary-200">
              + Add line
            </button>
            {totals.slabSummary.some((r) => r.total_tax > 0.005) && (
              <details className="w-full max-w-xl text-xs">
                <summary className="cursor-pointer text-right font-semibold text-text-secondary">GST by rate</summary>
                <table className="mt-2 w-full">
                  <thead>
                    <tr className="border-b border-border text-text-secondary">
                      <th className="py-1.5 text-left">Rate</th>
                      <th className="py-1.5 text-right">Taxable</th>
                      <th className="py-1.5 text-right">CGST</th>
                      <th className="py-1.5 text-right">SGST</th>
                      <th className="py-1.5 text-right">IGST</th>
                      <th className="py-1.5 text-right">Tax</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {totals.slabSummary.map((row) => (
                      <tr key={row.gst_rate} className="border-b border-border last:border-0">
                        <td className="py-1.5">{row.gst_rate}%</td>
                        <td className="py-1.5 text-right">₹{row.taxable_value.toFixed(2)}</td>
                        <td className="py-1.5 text-right">₹{row.cgst.toFixed(2)}</td>
                        <td className="py-1.5 text-right">₹{row.sgst.toFixed(2)}</td>
                        <td className="py-1.5 text-right">₹{row.igst.toFixed(2)}</td>
                        <td className="py-1.5 text-right font-semibold">₹{row.total_tax.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-surface p-6">
          <h2 className="text-base font-semibold text-text-primary">Payment &amp; notes</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <NumericBlurField
              label="Amount paid now ₹"
              variant="boxed"
              mode="money"
              value={formData.paid_amount}
              onCommit={(v) => setFormData((prev) => ({ ...prev, paid_amount: v }))}
            />
            <div>
              <label className={labelClass}>Paid via</label>
              <select className={fieldClass} value="cash" disabled title="Payments recorded here go to cash. Record bank or UPI payments after saving.">
                <option value="cash">Cash</option>
              </select>
              <p className="mt-1 text-xs text-text-muted">Recorded when you finalize. For bank or UPI, record a payment after saving.</p>
            </div>
            <div className="md:col-span-3">
              <label className={labelClass}>Internal notes</label>
              <textarea
                className="min-h-[5rem] w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
                rows={3}
                placeholder="Only visible to your team"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              />
            </div>
          </div>
        </section>

        {invoiceFillTracePanel}
      </div>

      <div
        className={`fixed bottom-0 z-30 border-t border-border bg-surface/95 py-3 shadow-[0_-6px_20px_rgba(0,0,0,0.05)] backdrop-blur ${footerBox ? '' : 'invisible'}`}
        style={footerBox ? { left: footerBox.left, width: footerBox.width } : undefined}
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4">
          {checks.length > 0 ? (
            <button
              type="button"
              onClick={() => scrollToCard(checks[0].target)}
              title={checks.map((c) => c.label).join(' · ')}
              className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3.5 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-200"
            >
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              {checks.length} thing{checks.length === 1 ? '' : 's'} to check
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full bg-primary-50 px-3.5 py-2 text-sm font-semibold text-primary-500 dark:bg-primary-900/40 dark:text-primary-200">
              <CheckCircle2 className="h-4 w-4" /> Ready to save
            </span>
          )}
          <dl className="flex flex-wrap items-end gap-x-6 gap-y-2 text-sm">
            <div>
              <dt className="text-xs text-text-secondary">
                Subtotal · {purchaseItems.length} item{purchaseItems.length === 1 ? '' : 's'}
              </dt>
              <dd className="font-semibold tabular-nums text-text-primary">₹{totals.subtotal.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-secondary">Discount</dt>
              <dd className="font-semibold tabular-nums text-text-primary">₹{discountTotal.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-secondary">{totals.intraState ? 'CGST + SGST' : 'IGST'}</dt>
              <dd className="font-semibold tabular-nums text-text-primary">₹{totals.taxTotal.toFixed(2)}</dd>
            </div>
            {totals.cessTotal > 0.005 && (
              <div>
                <dt className="text-xs text-text-secondary">Cess</dt>
                <dd className="font-semibold tabular-nums text-text-primary">₹{totals.cessTotal.toFixed(2)}</dd>
              </div>
            )}
            <div className="w-24">
              <NumericBlurField
                label="Round off"
                variant="boxed"
                mode="money"
                compact
                value={formData.round_off}
                onCommit={(v) => setFormData((prev) => ({ ...prev, round_off: v }))}
              />
            </div>
          </dl>
          <div className="ml-auto flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs text-text-secondary">Grand total</p>
              <p className="text-2xl font-bold tabular-nums text-text-primary">₹{totals.grandTotal.toFixed(2)}</p>
            </div>
            <button
              type="button"
              onClick={() => handleSubmit('draft')}
              disabled={loading}
              className="h-12 rounded-lg border border-border bg-surface px-5 text-sm font-semibold text-text-primary hover:bg-black/5 disabled:opacity-60"
            >
              Save as draft
            </button>
            <button
              type="button"
              onClick={() => handleSubmit('final')}
              disabled={loading || !isOnline}
              title={isOnline ? 'Finalizing updates stock and counts in your GST returns' : 'You are offline — connect to finalize'}
              className="inline-flex h-12 items-center gap-2 rounded-lg bg-primary-500 px-6 text-sm font-semibold text-white hover:bg-primary-600 disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {isOnline ? 'Save & finalize' : 'Sync required'}
            </button>
          </div>
        </div>
      </div>
    </form>
  );


  return (
    <>
    <div className="w-full min-w-0 max-w-none space-y-4">
        {isMobile && (
          <MobileDuplicatePageChrome
            className="mb-4"
            title="New Purchase"
            onBack={() => router.back()}
            trailing={formData.status ? <StatusBadge status={formData.status} className="hidden md:flex" /> : undefined}
          />
        )}

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

      {business?.id && (
        <MobileItemPickerPanel
          open={itemPickerKind !== null}
          onClose={() => setItemPickerKind(null)}
          businessId={business.id}
          userId={user?.id}
          warehouseId={selectedWarehouseId || undefined}
          branchId={currentBranchId && currentBranchId !== 'ALL' ? currentBranchId : undefined}
          itemType={itemPickerKind ?? undefined}
          priceField="purchase_price"
          confirmLabel="Add to purchase"
          onApply={handlePurchasePickerApply}
        />
      )}

      {business?.id && user?.id && !isMobile && (
        <PurchaseBillUploadModal
          open={showUploader}
          onClose={() => setShowUploader(false)}
          businessId={business.id}
          userId={user.id}
          onExtractionComplete={handleExtractionComplete}
          onError={handleExtractionError}
        />
      )}

      <CreateSupplierModal
        isOpen={supplierCreateModal.open}
        onClose={() => setSupplierCreateModal({ open: false })}
        onSuccess={handleNewSupplierCreated}
        initialData={supplierCreateModal.initial ?? {}}
      />

    </>
  );
}

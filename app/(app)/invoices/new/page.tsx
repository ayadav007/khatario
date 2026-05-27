'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ContinuousBarcodeScanner } from '@/components/ui/ContinuousBarcodeScanner';
import { Search, Plus, Save, Printer, Eye, X, ChevronDown, Send, CreditCard, ArrowLeft, ScanLine, Bluetooth } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { useLayoutData } from '@/contexts/LayoutDataContext';
import { buildApiUrl } from '@/lib/api-helpers';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { format, addDays, parseISO } from 'date-fns';
import { Customer, Item } from '@/types/database';
import { prepareInvoiceForRendering } from '@/lib/invoice-presenter';
import {
  calculateRow as engineCalculateRow,
  calculateTotals as engineCalculateTotals,
  determineTaxType as engineDetermineTaxType,
  numberToWords as engineNumberToWords,
  getStateCode as engineGetStateCode,
} from '@/lib/invoice-engine';
import { useToastContext } from '@/contexts/ToastContext';
import { useOfflineSalesFinalize } from '@/hooks/useOfflineSalesFinalize';
import { ShareInvoiceModal } from '@/components/modals/ShareInvoiceModal';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { InvoicePaymentModal } from '@/components/modals/InvoicePaymentModal';
import { UpgradeModal } from '@/components/subscription/UpgradeModal';
import { CreateCustomerModal } from '@/components/modals/CreateCustomerModal';
import { CreateItemModal } from '@/components/modals/CreateItemModal';
import { CustomFieldValuesForm } from '@/components/custom-fields/CustomFieldValuesForm';
import { useCustomFieldDefinitions, parseItemCustomFieldsFromApi } from '@/components/custom-fields/CustomFieldsManager';
import type { CustomFieldValues } from '@/types/custom-fields';
import {
  isThermalTemplateId,
  thermalPreviewIframeWidthClass,
} from '@/lib/thermal-preview';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { getPosMode, getPosAutoBluetoothPrint, setPosAutoBluetoothPrint } from '@/lib/pos-settings';
import { registerMobileBackInterceptor } from '@/lib/navigation/mobile-back-registry';
import { POSLayout } from '@/components/pos/POSLayout';
import { useBluetoothPrinter } from '@/hooks/useBluetoothPrinter';
import { useFeatureRegistry } from '@/hooks/useFeatureRegistry';
import type { ReceiptData } from '@/lib/bluetooth/invoice-to-escpos';
import { toast as hotToast } from 'react-hot-toast';
import TotalsPanel from '@/components/invoices/TotalsPanel';
import ActionsBar from '@/components/invoices/ActionsBar';
import CustomerSection from '@/components/invoices/CustomerSection';
import ItemsTable from '@/components/invoices/ItemsTable';
import { MobileItemPickerPanel } from '@/components/invoices/MobileItemPickerPanel';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { CreditWarningBanner } from '@/components/credit/CreditWarningBanner';
import { CreditMetrics, calculateProjectedCreditMetrics, calculateCreditMetrics } from '@/lib/credit-utils';
import { searchCustomersForBilling, listCatalogCustomersLocal, OFFLINE_CATALOG_EMPTY_HINT } from '@/lib/offline/catalog/client-search';
import { isAppOffline } from '@/lib/network/offline-state';

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'
];

const getStateCode = (stateName: string): string => {
  if (!stateName) return '';
  const name = stateName.trim().toLowerCase();
  const stateCodeMap: Record<string, string> = {
    'andhra pradesh': '37', 'karnataka': '29', 'tamil nadu': '33', 'maharashtra': '27',
    'gujarat': '24', 'rajasthan': '08', 'uttar pradesh': '09', 'west bengal': '19',
    'delhi': '07', 'telangana': '36', 'haryana': '06', 'punjab': '03', 'odisha': '21',
    'bihar': '10', 'madhya pradesh': '23', 'assam': '18', 'jharkhand': '20',
    'kerala': '32', 'chhattisgarh': '22', 'uttarakhand': '05', 'himachal pradesh': '02',
    'tripura': '16', 'manipur': '14', 'meghalaya': '17', 'mizoram': '15',
    'nagaland': '13', 'arunachal pradesh': '12', 'goa': '30', 'sikkim': '11',
    'andaman and nicobar islands': '35', 'chandigarh': '04',
    'dadra and nagar haveli and daman and diu': '26', 'jammu and kashmir': '01',
    'ladakh': '38', 'lakshadweep': '31', 'puducherry': '34'
  };
  return stateCodeMap[name] || '';
};

interface CustomerAutocompleteProps {
  customers: Customer[];
  value: string;
  onChange: (value: string) => void;
  onSelect: (customer: Customer) => void;
  disabled?: boolean;
  onAddNew?: () => void;
  /** Underline-style field (mobile invoice bill details). */
  compact?: boolean;
}

function CustomerAutocomplete({ customers, value, onChange, onSelect, disabled = false, onAddNew, compact = false }: CustomerAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<Customer[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);
  const { business, user } = useAuth();
  const cacheRef = useRef<Map<string, Customer[]>>(new Map());
  const [catalogBrowse, setCatalogBrowse] = useState<Customer[]>([]);
  const selectedCustomer = customers.find(c => c.id === value) || searchResults.find(c => c.id === value);
  useEffect(() => { if (selectedCustomer) setQuery(selectedCustomer.name); }, [selectedCustomer]);
  useEffect(() => {
    if (!business?.id || !user?.id) return;
    void listCatalogCustomersLocal({ businessId: business.id, userId: user.id }, 50).then((rows) => {
      if (rows?.length) setCatalogBrowse(rows as Customer[]);
    });
  }, [business?.id, user?.id]);
  useEffect(() => {
    if (searchTimeout) clearTimeout(searchTimeout);
    if (!query.trim() || !business?.id) { setSearchResults([]); return; }
    if (query.length === 1) { setSearchResults([]); return; }
    const cacheKey = `${business.id}:${query.toLowerCase()}`;
    if (cacheRef.current.has(cacheKey)) { setSearchResults(cacheRef.current.get(cacheKey) || []); return; }
    setIsSearching(true);
    const timeout = setTimeout(async () => {
      try {
        const scope = { businessId: business.id, userId: user!.id };
        const fromCatalog = await searchCustomersForBilling(scope, query);
        if (fromCatalog != null) {
          cacheRef.current.set(cacheKey, fromCatalog as Customer[]);
          setSearchResults(fromCatalog as Customer[]);
          return;
        }
        if (isAppOffline()) {
          hotToast.error(OFFLINE_CATALOG_EMPTY_HINT, { duration: 5000 });
          setSearchResults([]);
          return;
        }
        const res = await fetch(`/api/customers?business_id=${business.id}&search=${encodeURIComponent(query)}&limit=20&user_id=${user?.id}`);
        if (res.ok) { const data = await res.json(); const result = data.customers || []; cacheRef.current.set(cacheKey, result); setSearchResults(result); }
        else {
          const fallback = await searchCustomersForBilling(scope, query);
          if (fallback?.length) {
            cacheRef.current.set(cacheKey, fallback as Customer[]);
            setSearchResults(fallback as Customer[]);
          }
        }
      } catch (err) { console.error(err); setSearchResults([]); } finally { setIsSearching(false); }
    }, 200);
    setSearchTimeout(timeout);
    return () => { if (timeout) clearTimeout(timeout); };
  }, [query, business?.id, user?.id]);
  useEffect(() => { cacheRef.current.clear(); }, [business?.id]);
  const filtered = query.trim().length >= 2 ? searchResults : (query === '' ? catalogBrowse.slice(0, 20) : customers.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()) || c.company_name?.toLowerCase().includes(query.toLowerCase()) || c.phone?.includes(query)).slice(0, 20));
  return (
    <div className="relative w-full">
        <div className="relative">
            <input
              type="text"
              className={
                compact
                  ? 'focus-primary w-full border-0 border-b border-border bg-transparent pb-1.5 pl-0 pr-7 pt-0.5 text-[14px] font-medium text-text-primary placeholder:text-text-muted shadow-none outline-none ring-0 focus-visible:border-border disabled:cursor-not-allowed disabled:opacity-60'
                  : 'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-60'
              }
              placeholder={compact ? 'Search customer…' : 'Search Customer...'}
              value={query}
              disabled={disabled}
              onChange={(e) => { setQuery(e.target.value); setIsOpen(true); if (e.target.value === '') onChange(''); }}
              onFocus={() => setIsOpen(true)}
              onBlur={() => setTimeout(() => setIsOpen(false), 200)}
            />
            <ChevronDown
              className={
                compact
                  ? 'pointer-events-none absolute right-0 top-1/2 w-4 -translate-y-1/2 text-text-muted'
                  : 'pointer-events-none absolute right-3 top-2.5 w-4 text-text-muted'
              }
            />
        </div>
        {isOpen && !disabled && (filtered.length > 0 || query.trim().length > 0) && (
            <div className="absolute z-50 w-full mt-1 bg-surface border border-border rounded-md shadow-lg max-h-60 overflow-auto dark:shadow-xl">
                {filtered.length > 0 ? (
                    <>{filtered.map((c) => (<div key={c.id} className="px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer text-sm" onMouseDown={(e) => { e.preventDefault(); setQuery(c.name); onChange(c.id); onSelect(c); setIsOpen(false); }}>
                        <div className="font-medium text-text-primary">{c.name}</div>
                        {c.company_name && <div className="text-xs text-text-secondary">{c.company_name}</div>}
                        <div className="text-xs text-text-muted">{c.phone || 'No phone'}</div>
                    </div>))}
                    <div className="px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer text-sm text-primary-600 dark:text-sky-400 border-t border-border" onMouseDown={(e) => { e.preventDefault(); if (onAddNew) { onAddNew(); } else { window.location.href = '/customers/new'; } }}>+ Add New Customer</div></>
                ) : (
                    <div className="px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer text-sm text-primary-600 dark:text-sky-400" onMouseDown={(e) => { e.preventDefault(); if (onAddNew) { onAddNew(); } else { window.location.href = '/customers/new'; } }}>
                        {isSearching ? <div className="font-medium text-text-muted">Searching...</div> : <><div className="font-medium text-text-primary">No customer found for "{query}"</div><div className="text-xs text-text-muted mt-1">+ Add New Customer</div></>}
                    </div>
                )}
            </div>
        )}
    </div>
  );
}

interface InvoiceItemRow {
  itemId: string;
  name: string;
  variantId?: string;
  variantName?: string;
  quantity: number;
  freeQty: number;
  unit: string;
  price: number;
  discountPercent: number;
  discountAmount: number;
  taxPercent: number;
  taxAmount: number;
  hsnSac: string;
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  total: number;
  gstIncluded?: boolean;
  priceUserOverride?: boolean;
}

/** Convert GST-inclusive stored price into taxable-exclusive unit rate (matches catalog item picker logic). */
function partyPriceDbToExclusiveUnit(price: number, gstIncluded: boolean | undefined, taxPercent: number) {
  const tr = Number(taxPercent || 0);
  if (gstIncluded && tr > 0) return price / (1 + tr / 100);
  return price;
}

const Toast = ({ message, type, onClose }: { message: string, type: 'success' | 'error', onClose: () => void }) => (
  <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded shadow-lg flex items-center gap-3 animate-in slide-in-from-right-5 ${type === 'success' ? 'bg-success-50 text-success-700 border border-success-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
    <span>{message}</span>
    <button onClick={onClose} className="hover:opacity-70"><X className="w-4 h-4" /></button>
  </div>
);

const EditCustomerModal = ({ customer, onClose, onSave, businessId }: any) => {
    const editToast = useToastContext();
    const [saving, setSaving] = useState(false);
    const [formData, setFormData] = useState({ billing_address: customer.billing_address || customer.address || '', shipping_address: customer.shipping_address || customer.address || '', city: customer.city || '', state: customer.state || '', pincode: customer.pincode || '', gstin: customer.gstin || '' });
    const handleChange = (e: any) => { const { name, value } = e.target; setFormData(prev => ({ ...prev, [name]: value })); };
    const handleSubmit = async (e: any) => { e.preventDefault(); setSaving(true); try { const res = await fetch(`/api/customers/${customer.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData) }); if (res.ok) { const data = await res.json(); onSave(data.customer); onClose(); } else { editToast.error('Failed to update'); } } catch (e) { editToast.error('Error updating'); } finally { setSaving(false); } };
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
                <h2 className="text-xl font-bold mb-4">Edit Customer Address</h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <textarea name="billing_address" value={formData.billing_address} onChange={handleChange} placeholder="Billing Address" className="input w-full px-3 py-2 border rounded" />
                    <textarea name="shipping_address" value={formData.shipping_address} onChange={handleChange} placeholder="Shipping Address" className="input w-full px-3 py-2 border rounded" />
                    <div className="flex gap-2">
                        <input name="city" value={formData.city} onChange={handleChange} placeholder="City" className="input w-1/3 px-3 py-2 border rounded" />
                        <select name="state" value={formData.state} onChange={handleChange} className="input w-1/3 px-3 py-2 border rounded">
                            <option value="">State</option>
                            {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <input name="pincode" value={formData.pincode} onChange={handleChange} placeholder="Pin" className="input w-1/3 px-3 py-2 border rounded" />
                    </div>
                    <div className="flex justify-end gap-2 mt-4">
                        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
                        <Button type="submit" isLoading={saving}>Save</Button>
                    </div>
                </form>
            </div>
        </div>
    );
};

function NewInvoiceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { business, user } = useAuth();
  const { canAdd, loading: permissionsLoading } = usePermissions();
  const toastCtx = useToastContext();
  const { canQueueOffline, queueSalesFinalize, resetIdempotency } =
    useOfflineSalesFinalize();
  const bt = useBluetoothPrinter();
  const { hasFeature } = useFeatureRegistry();
  const canBtPrint = hasFeature('barcode_thermal_printer');

  // All state declarations first
  const [loading, setLoading] = useState(false);
  const [btPrinting, setBtPrinting] = useState(false);
  const [autoBluetoothPrint, setAutoBluetoothPrint] = useState(false);
  useEffect(() => {
    setAutoBluetoothPrint(getPosAutoBluetoothPrint());
  }, []);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [toastMessage, setToastMessage] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [limitInfo, setLimitInfo] = useState<{ current: number; limit: number } | null>(null);
  const [limitCheckDone, setLimitCheckDone] = useState(false);
  // PHASE 6: Use global branch context - check if branch context is ready
  const { currentBranchId, isLoading: branchLoading, accessibleBranches, isAdmin } = useBranch();
  const { warehousesEnabled } = useLayoutData();
  
  // Debug: Log branch context state
  useEffect(() => {
    console.log('[Invoice Page] Branch context state:', {
      currentBranchId,
      branchLoading,
      accessibleBranchesCount: accessibleBranches.length,
      accessibleBranches: accessibleBranches.map(b => ({ id: b.id, name: b.name })),
      isAdmin
    });
  }, [currentBranchId, branchLoading, accessibleBranches, isAdmin]);
  const [showContinuousScanner, setShowContinuousScanner] = useState(false);
  const [creditMetrics, setCreditMetrics] = useState<{ current?: CreditMetrics; projected?: CreditMetrics } | null>(null);
  const [customerId, setCustomerId] = useState('');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string; warehouse_code?: string; is_primary?: boolean }>>([]);
  const [warehousesLoading, setWarehousesLoading] = useState(false);
  const [invoiceDate, setInvoiceDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dueDate, setDueDate] = useState('');
  /** Skip auto-fill from Customer.credit_days after the user edits the due date field manually */
  const dueDateUserEditedRef = useRef(false);
  const [expiryDate, setExpiryDate] = useState('');
  const [estimateStatus, setEstimateStatus] = useState<'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'converted'>('draft');
  const [placeOfSupply, setPlaceOfSupply] = useState(business?.state || '');
  const [invoiceTemplate, setInvoiceTemplate] = useState<string | null>(null);
  const [templateSettings, setTemplateSettings] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewTemplateId, setPreviewTemplateId] = useState<string | null>(null);
  const [isExport, setIsExport] = useState(false);
  const [exportType, setExportType] = useState<'wp' | 'wop'>('wop');
  const [portCode, setPortCode] = useState('');
  const [shippingBillNumber, setShippingBillNumber] = useState('');
  const [shippingBillDate, setShippingBillDate] = useState('');
  const [invoiceCurrency, setInvoiceCurrency] = useState('INR');
  const [exchangeRate, setExchangeRate] = useState<number | ''>('');
  const [countryOfOrigin, setCountryOfOrigin] = useState('India');
  const [portOfLoading, setPortOfLoading] = useState('');
  const [portOfDischarge, setPortOfDischarge] = useState('');
  const [placeOfDelivery, setPlaceOfDelivery] = useState('');
  const [incoterms, setIncoterms] = useState('');
  const [transportMode, setTransportMode] = useState('');
  const [awbNumber, setAwbNumber] = useState('');
  const [blNumber, setBlNumber] = useState('');
  const [buyerTaxId, setBuyerTaxId] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [ewayBillNumber, setEwayBillNumber] = useState('');
  const [ewayBillDate, setEwayBillDate] = useState('');
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState('');
  const [purchaseOrderDate, setPurchaseOrderDate] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [otherReferences, setOtherReferences] = useState('');
  const [dispatchedThrough, setDispatchedThrough] = useState('');
  const [destination, setDestination] = useState('');
  const [termsOfDelivery, setTermsOfDelivery] = useState('');
  const { definitions: invoiceCustomFieldDefs } = useCustomFieldDefinitions('invoice');
  const [invoiceCustomFieldValues, setInvoiceCustomFieldValues] = useState<CustomFieldValues>({});
  const [enableRoundOff, setEnableRoundOff] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ id: string; name: string; url: string; size?: number }>>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [showAdditionalInfo, setShowAdditionalInfo] = useState(false);
  const [rows, setRows] = useState<InvoiceItemRow[]>([]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const customerIdRef = useRef(customerId);
  customerIdRef.current = customerId;
  const partyPriceCacheRef = useRef<Map<string, number | null>>(new Map());
  const [notes, setNotes] = useState('');
  const [extraCharges, setExtraCharges] = useState<any[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [pendingTypeChange, setPendingTypeChange] = useState<any | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [invoiceMobileLayout, setInvoiceMobileLayout] = useState(false);
  const [showMobileItemPicker, setShowMobileItemPicker] = useState(false);
  const [mobileAdjustmentsOpen, setMobileAdjustmentsOpen] = useState(true);
  const [fetchedNextNumber, setFetchedNextNumber] = useState(false);
  const [prefilled, setPrefilled] = useState(false);
  const [payments, setPayments] = useState<any[]>([]);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [savedStatus, setSavedStatus] = useState<'draft' | 'final' | null>(null);
  const [savedInvoiceId, setSavedInvoiceId] = useState<string | null>(null);
  const [offlineSyncPending, setOfflineSyncPending] = useState(false);
  const [offlineDisplayNumber, setOfflineDisplayNumber] = useState<string | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [isInvoiceLocked, setIsInvoiceLocked] = useState(false);
  const [lockReason, setLockReason] = useState<string | null>(null);
  const [createCustomerModalOpen, setCreateCustomerModalOpen] = useState(false);
  const [createItemModalOpen, setCreateItemModalOpen] = useState(false);
  const [posMode, setPosMode] = useState(false);
  const [customerPhone, setCustomerPhone] = useState('');
  const [showNavigationWarning, setShowNavigationWarning] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const prevPathnameRef = useRef(pathname);

  // Read POS mode from localStorage on mount and when it changes
  useEffect(() => {
    setPosMode(getPosMode());
    // Listen for storage changes (when POS mode is toggled in settings)
    const handleStorageChange = () => {
      setPosMode(getPosMode());
    };
    window.addEventListener('storage', handleStorageChange);
    // Also listen for custom event (for same-tab updates)
    window.addEventListener('posModeChanged', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('posModeChanged', handleStorageChange);
    };
  }, []);

  // Fetch warehouses when branch changes
  useEffect(() => {
    async function fetchWarehouses() {
      if (!business?.id || !user?.id) {
        setWarehouses([]);
        setSelectedWarehouseId('');
        return;
      }

      // Don't fetch warehouses if no specific branch is selected or if 'All Branches' is selected
      // currentBranchId could be null, undefined, or a special 'all' value
      if (!currentBranchId || currentBranchId === 'all' || currentBranchId === '') {
        console.log('[Warehouses] No specific branch selected, hiding warehouse selector');
        setWarehouses([]);
        setSelectedWarehouseId('');
        return;
      }

      setWarehousesLoading(true);
      try {
        const response = await fetch(
          `/api/warehouses?business_id=${business.id}&user_id=${user.id}&branch_id=${currentBranchId}`
        );
        
        if (response.ok) {
          const data = await response.json();
          const warehouseList = data.warehouses || [];
          setWarehouses(warehouseList);
          
          console.log('[Warehouses] Fetched for branch:', currentBranchId, 'Count:', warehouseList.length);
          
          // Auto-select primary warehouse (is_primary = true) or fallback to first
          if (warehouseList.length > 0) {
            const defaultWarehouse = warehouseList.find((w: any) => w.is_primary === true) || warehouseList[0];
            if (defaultWarehouse) {
              setSelectedWarehouseId(prev => prev || defaultWarehouse.id);
              console.log('[Warehouses] Auto-selected:', defaultWarehouse.name, 'is_primary:', defaultWarehouse.is_primary);
            }
          } else {
            console.log('[Warehouses] No warehouses linked to this branch');
            setSelectedWarehouseId('');
          }
        }
      } catch (error) {
        console.error('Error fetching warehouses:', error);
        setWarehouses([]);
        setSelectedWarehouseId('');
      } finally {
        setWarehousesLoading(false);
      }
    }

    fetchWarehouses();
  }, [business?.id, user?.id, currentBranchId]);

  // Track form dirty state when customer or items are added
  useEffect(() => {
    const hasItems = rows.length > 0 && rows.some(r => r.name && r.itemId);
    const hasCustomer = !!customerId;
    const hasData = hasItems || hasCustomer;
    
    
    setIsDirty(hasData);
  }, [rows, customerId]);

  // Block navigation when form is dirty
  useEffect(() => {
    if (!isDirty || savedInvoiceId) return;

    // Handle browser navigation (back button, close tab, etc.)
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ''; // Required for Chrome
      return ''; // Required for some browsers
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isDirty, savedInvoiceId]);

  // Intercept Next.js Link clicks and router navigation
  useEffect(() => {
    
    if (!isDirty || savedInvoiceId) {
      prevPathnameRef.current = pathname;
      return;
    }

    // Intercept all link clicks (including Next.js Link components)
    const handleLinkClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      
      
      // Check for any anchor tag with href (including Next.js Link)
      const link = target.closest('a[href]') as HTMLAnchorElement;
      
      
      if (link && link.href) {
        const url = new URL(link.href);
        const currentPath = window.location.pathname;
        const currentSearch = window.location.search;
        const urlSearch = url.search;
        
        // Check if pathname changed OR if same pathname but query params changed (e.g., /invoices/new -> /invoices/new?type=proforma_invoice)
        const pathnameChanged = url.pathname !== currentPath;
        const queryParamsChanged = url.pathname === currentPath && urlSearch !== currentSearch;
        const isNavigationAway = pathnameChanged || queryParamsChanged;
        
        
        // Only intercept if navigating away from invoice page (different pathname OR same pathname with different query params)
        // Skip if it's a hash link, external link, or explicitly allowed
        if (isNavigationAway && 
            currentPath === '/invoices/new' && 
            url.origin === window.location.origin &&
            !link.hasAttribute('data-allow-navigation') &&
            !url.hash) {
          
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation(); // Prevent Next.js from handling the click
          
          setPendingNavigation(url.pathname + url.search + url.hash);
          setShowNavigationWarning(true);
          
        } else {
        }
      } else {
      }
    };

    // Use capture phase to intercept before Next.js handles the click
    document.addEventListener('click', handleLinkClick, true);
    
    
    return () => {
      document.removeEventListener('click', handleLinkClick, true);
    };
  }, [isDirty, savedInvoiceId, pathname]);

  // Track previous search params to detect query parameter changes
  const prevSearchParamsRef = useRef(searchParams.toString());

  // Also detect pathname and searchParams changes (for programmatic navigation via router.push)
  useEffect(() => {
    const currentSearch = searchParams.toString();
    const prevSearch = prevSearchParamsRef.current;
    
    
    if (!isDirty || savedInvoiceId) {
      prevPathnameRef.current = pathname;
      prevSearchParamsRef.current = currentSearch;
      return;
    }

    // If pathname changed and we're navigating away from /invoices/new
    const pathnameChanged = pathname !== '/invoices/new' && prevPathnameRef.current === '/invoices/new';
    // If pathname is same but search params changed (e.g., ?type=proforma_invoice)
    const searchParamsChanged = pathname === '/invoices/new' && prevPathnameRef.current === '/invoices/new' && currentSearch !== prevSearch;
    
    if (pathnameChanged || searchParamsChanged) {
      
      // Navigation happened - show warning and navigate back
      const targetUrl = pathname + (currentSearch ? `?${currentSearch}` : '');
      setPendingNavigation(targetUrl);
      setShowNavigationWarning(true);
      
      // Navigate back to prevent the navigation
      router.back();
      
    } else {
      prevPathnameRef.current = pathname;
      prevSearchParamsRef.current = currentSearch;
    }
  }, [pathname, searchParams, isDirty, savedInvoiceId, router]);

  // Mobile / Android back: confirm before leaving an unsaved draft
  useEffect(() => {
    if (!invoiceMobileLayout || posMode) return;
    return registerMobileBackInterceptor(() => {
      if (!isDirty || savedInvoiceId) return 'pass';
      try {
        window.history.pushState({ invoiceDraftGuard: true }, '', window.location.href);
      } catch {
        // ignore
      }
      setPendingNavigation(null);
      setShowNavigationWarning(true);
      return 'handled';
    });
  }, [invoiceMobileLayout, posMode, isDirty, savedInvoiceId]);
  
  type DocumentType = 'tax_invoice' | 'proforma_invoice' | 'bill_of_supply';
  const allowedDocTypes: DocumentType[] = ['tax_invoice', 'proforma_invoice', 'bill_of_supply'];
  const DOCUMENT_TYPE_NAMES: Record<DocumentType, string> = { 'tax_invoice': 'Tax Invoice', 'proforma_invoice': 'Proforma Invoice', 'bill_of_supply': 'Bill of Supply' };

  // Branch context is now handled globally - no need to fetch manually

  const initialDocType: DocumentType = useMemo(() => {
    const gstType = (business as any)?.gst_registration_type || 'unregistered';
    if (gstType === 'composition') return 'bill_of_supply';
    const param = searchParams.get('type') as DocumentType | null;
    if (param && allowedDocTypes.includes(param)) return param;
    return gstType === 'regular' ? 'tax_invoice' : 'bill_of_supply';
  }, [business, searchParams]);

  const [documentType, setDocumentType] = useState<DocumentType>(initialDocType);
  
  // Derived variables - must be after documentType declaration
  // For proforma invoices, only 'converted' estimate_status should prevent editing
  // Since estimates always have status='draft', we check estimate_status instead
  // For regular invoices, 'final' status prevents editing
  const isFinal = documentType === 'proforma_invoice' 
    ? (estimateStatus === 'converted')
    : (savedStatus === 'final');
  
  // PHASE 1: Initialize prefix and number as null - API is the single source of truth
  const [invoicePrefix, setInvoicePrefix] = useState<string | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState<string | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);

  const getSeriesCacheKey = useCallback(
    (docType: DocumentType) => {
      if (!business?.id || !currentBranchId) return null;
      return `khatario_doc_series:${business.id}:${currentBranchId}:${docType}`;
    },
    [business?.id, currentBranchId]
  );
  
  // PHASE 3: Check if series is resolved - block save until both are non-null
  const isSeriesResolved = invoicePrefix !== null && invoiceNumber !== null;

  // PHASE 2: API is the single source of truth - fetch series from backend
  const fetchDocumentSeries = useCallback(async (docType: DocumentType) => {
    // PHASE 6: Don't fetch if branch context is not ready
    if (branchLoading || !business?.id) {
      return;
    }
    
    // PHASE 5: Require branch_id - don't proceed if currentBranchId is ALL or missing
    if (!currentBranchId || currentBranchId === 'ALL') {
      setSeriesError('Branch selection is required to generate document number');
      setInvoicePrefix(null);
      setInvoiceNumber(null);
      return;
    }
    
    setSeriesLoading(true);
    setSeriesError(null);
    // Avoid flicker: don't blank the UI while fetching.
    // If we have a cached value and current is empty, prefill it immediately.
    try {
      if (invoicePrefix === null || invoiceNumber === null) {
        const key = getSeriesCacheKey(docType);
        if (key) {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw) as { prefix?: string; invoice_number?: string };
            if (parsed?.prefix && parsed?.invoice_number) {
              if (invoicePrefix === null) setInvoicePrefix(parsed.prefix);
              if (invoiceNumber === null) setInvoiceNumber(parsed.invoice_number);
            }
          }
        }
      }
    } catch {
      /* ignore */
    }
    
    try {
      // PHASE 5: Explicitly pass branch_id - don't rely on buildApiUrl's localStorage read
      // This ensures we use the current React state, not stale localStorage
      // buildApiUrl will add it to params if not excluded, so we pass it explicitly
      const apiUrl = buildApiUrl('/api/invoices/next-number', { 
        business_id: business.id, 
        document_type: docType,
        branch_id: currentBranchId // Explicitly pass branch_id from React state
      });
      
      console.log('[fetchDocumentSeries] Fetching series:', {
        businessId: business.id,
        branchId: currentBranchId,
        documentType: docType,
        apiUrl
      });
      
      const res = await fetch(apiUrl);
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Failed to fetch document series' }));
        console.error('[fetchDocumentSeries] API error:', {
          status: res.status,
          statusText: res.statusText,
          error: errorData
        });
        throw new Error(errorData.error || `Failed to fetch document series (${res.status})`);
      }
      
      const data = await res.json();
      console.log('[fetchDocumentSeries] API response:', data);
      
      // PHASE 2: Only set prefix and number from API response
      if (data.prefix && data.invoice_number) {
        setInvoicePrefix(data.prefix);
        setInvoiceNumber(data.invoice_number);
        try {
          const key = getSeriesCacheKey(docType);
          if (key) {
            localStorage.setItem(
              key,
              JSON.stringify({ prefix: data.prefix, invoice_number: data.invoice_number, ts: Date.now() })
            );
          }
        } catch {
          /* ignore */
        }
        console.log('[fetchDocumentSeries] Successfully set prefix and number:', {
          prefix: data.prefix,
          number: data.invoice_number
        });
      } else {
        console.error('[fetchDocumentSeries] Invalid response:', data);
        throw new Error('Invalid response from series API: missing prefix or invoice_number');
      }
    } catch (err: any) {
      console.error('Error fetching document series:', err);
      console.error('Error details:', { 
        businessId: business?.id, 
        currentBranchId, 
        branchLoading, 
        documentType: docType,
        error: err.message 
      });
      setSeriesError(err.message || 'Failed to fetch document series');
      // PHASE 2: Do NOT set any prefix on failure
      setInvoicePrefix(null);
      setInvoiceNumber(null);
    } finally {
      setSeriesLoading(false);
    }
  }, [business?.id, currentBranchId, branchLoading]);

  // Prefill series from cache on first paint (prevents initial empty flicker)
  useEffect(() => {
    if (branchLoading || !business?.id || !currentBranchId || currentBranchId === 'ALL') return;
    if (invoicePrefix !== null && invoiceNumber !== null) return;
    try {
      const key = getSeriesCacheKey(documentType);
      if (!key) return;
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { prefix?: string; invoice_number?: string };
      if (parsed?.prefix && parsed?.invoice_number) {
        if (invoicePrefix === null) setInvoicePrefix(parsed.prefix);
        if (invoiceNumber === null) setInvoiceNumber(parsed.invoice_number);
      }
    } catch {
      /* ignore */
    }
  }, [branchLoading, business?.id, currentBranchId, documentType, getSeriesCacheKey, invoicePrefix, invoiceNumber]);

  // Authorization Hook
  const { allowed: canCreate, loading: authLoading, reason } = useAuthorizationGuard({ 
    resource: 'invoices', 
    action: 'create', 
    skipCheck: !user?.id || !business?.id 
  });

  const itemInputRefs = useRef<(React.RefObject<HTMLInputElement> | null)[]>([]);

  // Callbacks and Memos
  const calculateRow = useCallback((row: InvoiceItemRow, skipDiscountRecalc: boolean = false): InvoiceItemRow => {
    return engineCalculateRow(row, { businessStateCode: business?.state_code, businessState: business?.state, placeOfSupply, isExport, exportType: exportType as any, documentType }, skipDiscountRecalc);
  }, [business?.state, business?.state_code, placeOfSupply, isExport, exportType, documentType]);

  const fetchPartyPriceCached = useCallback(async (partyId: string, itemId: string): Promise<number | null> => {
    const cache = partyPriceCacheRef.current;
    const key = `${partyId}:${itemId}`;
    if (cache.has(key)) return cache.get(key)!;
    try {
      const res = await fetch(
        `/api/pricing/party-item?party_id=${encodeURIComponent(partyId)}&item_id=${encodeURIComponent(itemId)}`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        return null;
      }
      const data = await res.json();
      const raw = data?.price;
      if (raw == null || raw === '') {
        cache.set(key, null);
        return null;
      }
      const n = typeof raw === 'number' ? raw : Number(raw);
      const resolved = Number.isFinite(n) ? n : null;
      cache.set(key, resolved);
      return resolved;
    } catch (e) {
      console.warn('[invoice] Party price lookup failed:', e);
      return null;
    }
  }, []);

  const rowsPartyTriggerKey = useMemo(
    () =>
      rows
        .map((r, i) =>
          r.itemId
            ? `${i}:${r.itemId}:${r.variantId ?? ''}:${r.priceUserOverride ? '1' : '0'}`
            : ''
        )
        .filter(Boolean)
        .join('|'),
    [rows]
  );

  /** When customer + line identity changes, fetch party overrides (cached); skip manual edits and finalized/loaded invoice lines. */
  useEffect(() => {
    if (!customerId || isFinal || isInvoiceLocked) return;

    let cancelled = false;
    const custAtStart = customerId;

    (async () => {
      const snapshot = rowsRef.current;
      const pairs = snapshot
        .map((row, idx) => ({ row, idx }))
        .filter(({ row }) => !!row.itemId && !row.priceUserOverride);

      if (pairs.length === 0) return;

      const fetched = await Promise.all(
        pairs.map(async ({ row, idx }) => {
          const pp = await fetchPartyPriceCached(custAtStart, row.itemId);
          return { idx, pp, itemId: row.itemId, rowSnap: row };
        })
      );

      if (cancelled || custAtStart !== customerIdRef.current) return;

      setRows((prev) => {
        let next = prev;
        let changed = false;

        for (const { idx, pp, itemId, rowSnap } of fetched) {
          if (pp == null) continue;
          const current = prev[idx];
          if (
            !current ||
            String(current.itemId) !== itemId ||
            current.priceUserOverride
          ) {
            continue;
          }

          const newPriceExclusive = partyPriceDbToExclusiveUnit(
            pp,
            rowSnap.gstIncluded ?? current.gstIncluded,
            current.taxPercent ?? rowSnap.taxPercent
          );

          if (typeof current.price === 'number' && Math.abs(current.price - newPriceExclusive) < 1e-9) {
            continue;
          }

          const updated = calculateRow({ ...current, price: newPriceExclusive });
          if (!changed) next = [...prev];
          changed = true;
          next[idx] = updated;
        }

        return changed ? next : prev;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    customerId,
    rowsPartyTriggerKey,
    fetchPartyPriceCached,
    calculateRow,
    isFinal,
    isInvoiceLocked,
  ]);

  const handleItemSelect = useCallback((item: any, rowIndex?: number) => {
    const variantId = item.variantId, variantName = item.variantName, itemId = item.id, itemIdStr = String(itemId || ''), variantIdStr = variantId ? String(variantId) : null;
    setRows(currentRows => {
      const existingRowIndex = currentRows.findIndex(r => String(r.itemId || '') === itemIdStr && (variantIdStr ? String(r.variantId || '') === variantIdStr : !r.variantId));
      const newRows = [...currentRows];
      if (existingRowIndex >= 0) {
        newRows[existingRowIndex] = calculateRow({ ...newRows[existingRowIndex], quantity: newRows[existingRowIndex].quantity + 1 });
        if (rowIndex !== undefined && rowIndex !== existingRowIndex && rowIndex < newRows.length && !newRows[rowIndex]?.itemId) {
          newRows[rowIndex] = { ...newRows[rowIndex], name: '' };
        }
        // In POS mode, focus item search after adding
        if (posMode) {
          setTimeout(() => {
            const nextEmptyIndex = newRows.findIndex(r => !r.itemId && !r.name);
            const refIndex = nextEmptyIndex >= 0 ? nextEmptyIndex : newRows.length;
            if (itemInputRefs.current[refIndex]?.current) {
              itemInputRefs.current[refIndex].current.focus();
            }
          }, 50);
        }
        return newRows;
      }
      let targetIndex = rowIndex;
      if (targetIndex === undefined) targetIndex = newRows.findIndex(r => !r.itemId && !r.name);
      // If no empty row found (empty array or all rows filled), add new row
      if (targetIndex === -1) {
        targetIndex = newRows.length;
        newRows.push({ itemId: '', name: '', quantity: 1, freeQty: 0, unit: 'PCS', price: 0, discountPercent: 0, discountAmount: 0, taxPercent: 0, taxAmount: 0, hsnSac: '', taxableValue: 0, cgstAmount: 0, sgstAmount: 0, igstAmount: 0, total: 0 });
      }
      // Check if targetIndex is valid and row exists before accessing properties
      if (targetIndex !== -1 && targetIndex < newRows.length && newRows[targetIndex]?.itemId && String(newRows[targetIndex].itemId) !== itemIdStr) {
        targetIndex = newRows.findIndex(r => !r.itemId && !r.name);
        // If still no empty row, add new one
        if (targetIndex === -1) {
          targetIndex = newRows.length;
          newRows.push({ itemId: '', name: '', quantity: 1, freeQty: 0, unit: 'PCS', price: 0, discountPercent: 0, discountAmount: 0, taxPercent: 0, taxAmount: 0, hsnSac: '', taxableValue: 0, cgstAmount: 0, sgstAmount: 0, igstAmount: 0, total: 0 });
        }
      }
      let displayName = variantName ? `${item.name} - ${variantName}` : item.name;
      if (displayName === item.barcode && item.code && item.code !== item.barcode) displayName = variantName ? `${item.code} - ${variantName}` : item.code;
      let price = Number(item.selling_price), tr = Number(item.tax_rate || 0);
      if (item.gst_included && tr > 0) price = price / (1 + tr / 100);
      const newRowData = calculateRow({ itemId, name: displayName, variantId, variantName, hsnSac: item.hsn_sac || '', price, taxPercent: tr, quantity: 1, freeQty: 0, unit: item.unit || 'PCS', discountPercent: 0, discountAmount: 0, taxAmount: 0, taxableValue: 0, cgstAmount: 0, sgstAmount: 0, igstAmount: 0, total: 0, gstIncluded: !!item.gst_included, priceUserOverride: false });
      if (targetIndex >= 0 && targetIndex < newRows.length) newRows[targetIndex] = newRowData; else newRows.push(newRowData);
      // In POS mode, focus item search after adding
      if (posMode) {
        setTimeout(() => {
          const nextEmptyIndex = newRows.findIndex(r => !r.itemId && !r.name);
          const refIndex = nextEmptyIndex >= 0 ? nextEmptyIndex : newRows.length;
          if (itemInputRefs.current[refIndex]?.current) {
            itemInputRefs.current[refIndex].current.focus();
          } else if (itemInputRefs.current[0]?.current) {
            itemInputRefs.current[0].current.focus();
          }
        }, 50);
      }
      return newRows;
    });
  }, [calculateRow, posMode]);

  /** Mobile item picker: apply multiple products with quantities in one batch (reference-style cart). */
  const handleMobilePickerApply = useCallback(
    (selections: Array<{ item: any; quantity: number }>) => {
      const merged = new Map<string, { item: any; quantity: number }>();
      for (const sel of selections) {
        const vid = sel.item.variantId ? String(sel.item.variantId) : '';
        const k = `${String(sel.item.id)}::${vid}`;
        const prev = merged.get(k);
        merged.set(k, {
          item: sel.item,
          quantity: (prev?.quantity || 0) + sel.quantity,
        });
      }

      setRows((currentRows) => {
        let newRows = [...currentRows];
        const emptyTemplate = (): InvoiceItemRow => ({
          itemId: '',
          name: '',
          quantity: 1,
          freeQty: 0,
          unit: 'PCS',
          price: 0,
          discountPercent: 0,
          discountAmount: 0,
          taxPercent: 0,
          taxAmount: 0,
          hsnSac: '',
          taxableValue: 0,
          cgstAmount: 0,
          sgstAmount: 0,
          igstAmount: 0,
          total: 0,
        });

        for (const { item, quantity } of merged.values()) {
          if (quantity <= 0) continue;
          const variantId = item.variantId;
          const variantName = item.variantName;
          const itemIdStr = String(item.id);
          const variantIdStr = variantId ? String(variantId) : null;

          const existingRowIndex = newRows.findIndex(
            (r) =>
              String(r.itemId || '') === itemIdStr &&
              (variantIdStr ? String(r.variantId || '') === variantIdStr : !r.variantId)
          );
          if (existingRowIndex >= 0) {
            newRows[existingRowIndex] = calculateRow({
              ...newRows[existingRowIndex],
              quantity: newRows[existingRowIndex].quantity + quantity,
            });
            continue;
          }

          let targetIndex = newRows.findIndex((r) => !r.itemId && !r.name);
          if (targetIndex === -1) {
            targetIndex = newRows.length;
            newRows.push(emptyTemplate());
          }

          let displayName = variantName ? `${item.name} - ${variantName}` : item.name;
          if (displayName === item.barcode && item.code && item.code !== item.barcode) {
            displayName = variantName ? `${item.code} - ${variantName}` : item.code;
          }
          let price = Number(item.selling_price);
          const tr = Number(item.tax_rate || 0);
          if (item.gst_included && tr > 0) price = price / (1 + tr / 100);
          const newRowData = calculateRow({
            itemId: item.id,
            name: displayName,
            variantId,
            variantName,
            hsnSac: item.hsn_sac || '',
            price,
            taxPercent: tr,
            quantity,
            freeQty: 0,
            unit: item.unit || 'PCS',
            discountPercent: 0,
            discountAmount: 0,
            taxAmount: 0,
            taxableValue: 0,
            cgstAmount: 0,
            sgstAmount: 0,
            igstAmount: 0,
            total: 0,
            gstIncluded: !!item.gst_included,
            priceUserOverride: false,
          });
          if (targetIndex >= 0 && targetIndex < newRows.length) {
            newRows[targetIndex] = newRowData;
          } else {
            newRows.push(newRowData);
          }
        }
        return newRows;
      });

      setShowMobileItemPicker(false);
      const n = merged.size;
      toastCtx.success(n === 1 ? 'Added to invoice' : `Added ${n} products to invoice`);
    },
    [calculateRow, toastCtx]
  );

  const handleGlobalBarcodeScan = useCallback(async (barcode: string) => {
    if (!business?.id) return;
    try {
      const res = await fetch(`/api/items/search?business_id=${business.id}&q=${encodeURIComponent(barcode)}`);
      if (res.ok) {
        const data = await res.json(), foundItems = data.items || [];
        if (foundItems.length === 1) {
          const item = foundItems[0];
          if (item.has_variants && item.variants?.length) {
            const { normalizeBarcode } = await import('@/lib/barcode-validator');
            const norm = normalizeBarcode(barcode), variant = item.variants.find((v: any) => v.barcode && normalizeBarcode(v.barcode) === norm);
            if (variant) { handleItemSelect({ ...item, selling_price: variant.selling_price ?? item.selling_price, current_stock: variant.current_stock, tax_rate: item.tax_rate, variantId: variant.id, variantName: variant.variant_name, variantAttributes: variant.attributes }); toastCtx.success(`Variant added!`); return; }
          }
          handleItemSelect(item); toastCtx.success(`Item added!`);
        } else if (foundItems.length > 1) {
          const { normalizeBarcode } = await import('@/lib/barcode-validator');
          const norm = normalizeBarcode(barcode); let match: any = null, vMatch: any = null;
          for (const item of foundItems) {
            if (item.barcode && normalizeBarcode(item.barcode) === norm) { match = item; break; }
            if (item.has_variants && item.variants?.length) { const v = item.variants.find((x: any) => x.barcode && normalizeBarcode(x.barcode) === norm); if (v) { match = item; vMatch = v; break; } }
          }
          if (match) { if (vMatch) handleItemSelect({ ...match, selling_price: vMatch.selling_price ?? match.selling_price, current_stock: vMatch.current_stock, tax_rate: match.tax_rate, variantId: vMatch.id, variantName: vMatch.variant_name }); else handleItemSelect(match); toastCtx.success('Item added!'); }
          else hotToast(`Multiple items match "${barcode}". Please select from list.`, { icon: '🔍' });
        } else toastCtx.error(`Barcode not found.`);
      }
    } catch (err) { console.error(err); }
  }, [business?.id, handleItemSelect]);

  const focusFirstEmptyItemField = useCallback(() => {
    const idx = rows.findIndex(r => !r.itemId && !r.name), target = idx >= 0 ? idx : 0, ref = itemInputRefs.current[target];
    if (ref?.current) { ref.current.focus(); ref.current.select(); }
  }, [rows]);

  useBarcodeScanner({ onScan: handleGlobalBarcodeScan, onScanStart: focusFirstEmptyItemField, enabled: !loading && !showContinuousScanner, minLength: 3 });

  const performDocumentTypeChange = useCallback((newDocType: DocumentType) => {
    setDocumentType(newDocType);
    // PHASE 1: Remove hardcoded prefix - clear prefix/number, let API set it
    setInvoicePrefix(null);
    setInvoiceNumber(null);
    setCustomerId(''); setSelectedCustomer(null); setRows([]);
    setNotes(''); setExtraCharges([]); setPayments([]); setBillingAddress(''); setShippingAddress(''); setIsExport(false); setExportType('wop'); setPortCode(''); setShippingBillNumber(''); setShippingBillDate(''); setInvoiceCurrency('INR'); setExchangeRate(''); setCountryOfOrigin('India'); setPortOfLoading(''); setPortOfDischarge(''); setPlaceOfDelivery(''); setIncoterms(''); setTransportMode(''); setAwbNumber(''); setBlNumber(''); setBuyerTaxId(''); setEwayBillNumber(''); setEwayBillDate(''); setPurchaseOrderNumber(''); setPurchaseOrderDate(''); setReferenceNumber(''); setDeliveryNote(''); setPaymentTerms(''); setOtherReferences(''); setDispatchedThrough(''); setDestination(''); setTermsOfDelivery(''); setEnableRoundOff(false); setAttachments([]);
    setExpiryDate(''); setEstimateStatus('draft');
    setPlaceOfSupply(business?.state || ''); setIsDirty(false); setFormKey(prev => prev + 1);
    if (business?.id) {
      // buildApiUrl automatically includes branch_id from global context
      // PHASE 2: Fetch series from API
      fetchDocumentSeries(newDocType);
      const assignmentDocType = newDocType === 'bill_of_supply' ? 'bill_of_supply' : newDocType === 'proforma_invoice' ? 'proforma_invoice' : 'tax_invoice';
      fetch(`/api/template-assignments?business_id=${business.id}`).then(res => res.json()).then(data => {
        if (data.assignments) { const assignment = data.assignments.find((a: any) => a.document_type === assignmentDocType); if (assignment?.template_id) setInvoiceTemplate(assignment.template_id); else setInvoiceTemplate(null); }
      }).catch(err => console.error(err));
    }
  }, [business?.id, business?.state]);

  const resetFormForNewInvoice = useCallback(() => {
    setCustomerId(''); setSelectedCustomer(null); setNotes(''); setExtraCharges([]); setPayments([]); setBillingAddress(''); setShippingAddress(''); setIsExport(false); setExportType('wop'); setPortCode(''); setShippingBillNumber(''); setShippingBillDate(''); setInvoiceCurrency('INR'); setExchangeRate(''); setCountryOfOrigin('India'); setPortOfLoading(''); setPortOfDischarge(''); setPlaceOfDelivery(''); setIncoterms(''); setTransportMode(''); setAwbNumber(''); setBlNumber(''); setBuyerTaxId(''); setEwayBillNumber(''); setEwayBillDate(''); setPurchaseOrderNumber(''); setPurchaseOrderDate(''); setReferenceNumber(''); setDeliveryNote(''); setPaymentTerms(''); setOtherReferences(''); setDispatchedThrough(''); setDestination(''); setTermsOfDelivery(''); setEnableRoundOff(false); setAttachments([]);
    setExpiryDate(''); setEstimateStatus('draft');
    setRows([]);
    setPlaceOfSupply(business?.state || ''); setSavedInvoiceId(null); setSavedStatus(null); setIsInvoiceLocked(false); setLockReason(null); setFetchedNextNumber(false); setIsDirty(false); setFormKey(prev => prev + 1);
    
    // PHASE 1: Clear prefix/number - let API set it
    setInvoicePrefix(null);
    setInvoiceNumber(null);
    
    // PHASE 2: Fetch series from API
    fetchDocumentSeries(documentType);
    
    setShareModalOpen(false); setPaymentModalOpen(false); setToastMessage({ message: 'Ready to create a new invoice', type: 'success' });
  }, [business?.id, business?.state, documentType, currentBranchId, fetchDocumentSeries]);

  // POS Mode: Start New Bill (clears items, customer, payments, focuses item search)
  const startNewBill = useCallback(() => {
    // Clear items (start with zero items)
    setRows([]);
    // Reset customer
    setCustomerId('');
    setSelectedCustomer(null);
    setCustomerPhone('');
    setBillingAddress('');
    setShippingAddress('');
    // Reset payments
    setPayments([]);
    // Reset other POS-specific state
    setNotes('');
    setExtraCharges([]);
    // Must clear saved invoice flags — otherwise isFinal stays true and POS hides the scan/search bar
    setSavedInvoiceId(null);
    setSavedStatus(null);
    setIsInvoiceLocked(false);
    setLockReason(null);
    setEstimateStatus('draft');
    // PHASE 1: Clear prefix/number - let API set it
    setInvoicePrefix(null);
    setInvoiceNumber(null);
    setFetchedNextNumber(false);
    
    // PHASE 2: Fetch series from API
    if (business?.id) {
      fetchDocumentSeries(documentType).then(() => {
        setFetchedNextNumber(true);
      }).catch(() => {
        setFetchedNextNumber(false);
      });
    }
    // Focus item search after a brief delay
    setTimeout(() => {
      if (itemInputRefs.current[0]?.current) {
        itemInputRefs.current[0].current.focus();
      }
    }, 100);
  }, [business?.id, documentType]);

  // Get invoice state for parking
  const getInvoiceState = useCallback(() => {
    return {
      rows,
      customerId,
      selectedCustomer,
      customerPhone,
      invoiceDate,
      dueDate,
      invoiceNumber,
      invoicePrefix,
      placeOfSupply,
      billingAddress,
      shippingAddress,
      notes,
      extraCharges,
      payments,
      documentType,
      isExport,
      exportType,
      portCode,
      shippingBillNumber,
      shippingBillDate,
      invoiceCurrency,
      exchangeRate,
      countryOfOrigin,
      portOfLoading,
      portOfDischarge,
      placeOfDelivery,
      incoterms,
      transportMode,
      awbNumber,
      blNumber,
      buyerTaxId,
      ewayBillNumber,
      ewayBillDate,
      purchaseOrderNumber,
      purchaseOrderDate,
      referenceNumber,
      deliveryNote,
      paymentTerms,
      otherReferences,
      dispatchedThrough,
      destination,
      termsOfDelivery,
      invoiceCustomFieldValues,
      enableRoundOff,
      attachments,
    };
  }, [rows, customerId, selectedCustomer, customerPhone, invoiceDate, dueDate, invoiceNumber, invoicePrefix, placeOfSupply, billingAddress, shippingAddress, notes, extraCharges, payments, documentType, isExport, exportType, portCode, shippingBillNumber, shippingBillDate, invoiceCurrency, exchangeRate, countryOfOrigin, portOfLoading, portOfDischarge, placeOfDelivery, incoterms, transportMode, awbNumber, blNumber, buyerTaxId, ewayBillNumber, ewayBillDate, purchaseOrderNumber, purchaseOrderDate, referenceNumber, deliveryNote, paymentTerms, otherReferences, dispatchedThrough, destination, termsOfDelivery, invoiceCustomFieldValues, enableRoundOff, attachments]);

  // Restore invoice state from parked bill
  const restoreInvoiceState = useCallback((state: any) => {
    if (state.rows) setRows(state.rows);
    if (state.customerId !== undefined) setCustomerId(state.customerId);
    if (state.selectedCustomer) setSelectedCustomer(state.selectedCustomer);
    if (state.customerPhone !== undefined) setCustomerPhone(state.customerPhone);
    if (state.invoiceDate) setInvoiceDate(state.invoiceDate);
    if (state.dueDate !== undefined) setDueDate(state.dueDate);
    if (state.invoiceNumber) setInvoiceNumber(state.invoiceNumber);
    if (state.invoicePrefix) setInvoicePrefix(state.invoicePrefix);
    if (state.placeOfSupply) setPlaceOfSupply(state.placeOfSupply);
    if (state.billingAddress !== undefined) setBillingAddress(state.billingAddress);
    if (state.shippingAddress !== undefined) setShippingAddress(state.shippingAddress);
    if (state.notes !== undefined) setNotes(state.notes);
    if (state.extraCharges) setExtraCharges(state.extraCharges);
    if (state.payments) setPayments(state.payments);
    if (state.documentType) setDocumentType(state.documentType);
    if (state.isExport !== undefined) setIsExport(state.isExport);
    if (state.exportType) setExportType(state.exportType);
    if (state.portCode !== undefined) setPortCode(state.portCode);
    if (state.shippingBillNumber !== undefined) setShippingBillNumber(state.shippingBillNumber);
    if (state.shippingBillDate) setShippingBillDate(state.shippingBillDate);
    if (state.invoiceCurrency) setInvoiceCurrency(state.invoiceCurrency);
    if (state.exchangeRate !== undefined) setExchangeRate(state.exchangeRate);
    if (state.countryOfOrigin) setCountryOfOrigin(state.countryOfOrigin);
    if (state.portOfLoading) setPortOfLoading(state.portOfLoading);
    if (state.portOfDischarge) setPortOfDischarge(state.portOfDischarge);
    if (state.placeOfDelivery) setPlaceOfDelivery(state.placeOfDelivery);
    if (state.incoterms) setIncoterms(state.incoterms);
    if (state.transportMode) setTransportMode(state.transportMode);
    if (state.awbNumber !== undefined) setAwbNumber(state.awbNumber);
    if (state.blNumber !== undefined) setBlNumber(state.blNumber);
    if (state.buyerTaxId !== undefined) setBuyerTaxId(state.buyerTaxId);
    if (state.ewayBillNumber !== undefined) setEwayBillNumber(state.ewayBillNumber);
    if (state.ewayBillDate) setEwayBillDate(state.ewayBillDate);
    if (state.purchaseOrderNumber !== undefined) setPurchaseOrderNumber(state.purchaseOrderNumber);
    if (state.purchaseOrderDate) setPurchaseOrderDate(state.purchaseOrderDate);
    if (state.referenceNumber !== undefined) setReferenceNumber(state.referenceNumber);
    if (state.deliveryNote !== undefined) setDeliveryNote(state.deliveryNote);
    if (state.paymentTerms !== undefined) setPaymentTerms(state.paymentTerms);
    if (state.otherReferences !== undefined) setOtherReferences(state.otherReferences);
    if (state.dispatchedThrough !== undefined) setDispatchedThrough(state.dispatchedThrough);
    if (state.destination !== undefined) setDestination(state.destination);
    if (state.termsOfDelivery !== undefined) setTermsOfDelivery(state.termsOfDelivery);
    if (state.invoiceCustomFieldValues) setInvoiceCustomFieldValues(state.invoiceCustomFieldValues);
    if (state.enableRoundOff !== undefined) setEnableRoundOff(state.enableRoundOff);
    if (state.attachments) setAttachments(state.attachments);
  }, []);


  // Handle customer phone change (POS mode)
  const handleCustomerPhoneChange = useCallback((phone: string) => {
    setCustomerPhone(phone);
    if (!phone.trim()) {
      setCustomerId('');
      setSelectedCustomer(null);
    }
  }, []);

  // Handle customer select from phone search (POS mode)
  const handleCustomerSelectFromPhone = useCallback((customer: any) => {
    if (customer) {
      setCustomerId(customer.id);
      setSelectedCustomer(customer);
      setCustomerPhone(customer.phone || '');
      if (customer.billing_address || customer.address) {
        setBillingAddress(customer.billing_address || customer.address || '');
      }
      if (customer.shipping_address || customer.address) {
        setShippingAddress(customer.shipping_address || customer.address || '');
      }
      if (customer.state) {
        setPlaceOfSupply(customer.state);
        setRows(prev => prev.map(r => calculateRow(r, true)));
      }
    } else {
      setCustomerId('');
      setSelectedCustomer(null);
      setCustomerPhone('');
    }
  }, [calculateRow]);

  const totals = useMemo(() => {
    const calculated = engineCalculateTotals({ rows, extraCharges: extraCharges as any, context: { businessStateCode: business?.state_code, businessState: business?.state, placeOfSupply, isExport, exportType: exportType as any, documentType } });
    if (enableRoundOff) { const rounded = Math.round(calculated.grandTotal); return { ...calculated, grandTotal: rounded, roundOff: rounded - calculated.grandTotal }; }
    return { ...calculated, roundOff: 0 };
  }, [rows, extraCharges, business?.state_code, business?.state, placeOfSupply, isExport, exportType, documentType, enableRoundOff]);

  const { itemSubtotal, totalDiscount, subtotal, itemTax, itemCGST, itemSGST, itemIGST, totalExtraCharges, taxableAmount, grandTotal, roundOff = 0, totalTax, totalCGST, totalSGST, totalIGST } = totals;
  const bStateCode = business?.state_code || engineGetStateCode(business?.state || ''), pStateCode = engineGetStateCode(placeOfSupply || ''), isIntraState = !!bStateCode && !!pStateCode && bStateCode === pStateCode;
  const totalPaid = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0), balance = grandTotal - totalPaid, recordPayment = payments.length > 0 && totalPaid > 0;

  // Build a ReceiptData object from the current in-memory POS state.
  // Used by Bluetooth auto-print / manual BT print so we don't need to
  // re-fetch the just-created invoice.
  const buildReceiptFromState = useCallback(
    (invoiceIdentifier: string): ReceiptData => {
      const mode = payments[0]?.mode || undefined;
      return {
        business: {
          name: business?.name || 'Store',
          address: (business as any)?.address || null,
          phone: (business as any)?.phone || null,
          gstin: (business as any)?.gstin || null,
          fssai:
            (business as any)?.fssai_licence_no ||
            (business as any)?.fssai ||
            null,
        },
        customer:
          selectedCustomer
            ? {
                name: selectedCustomer.name || null,
                phone: (selectedCustomer as any).phone || null,
                gstin: (selectedCustomer as any).gstin || null,
              }
            : null,
        invoiceNumber: invoiceIdentifier,
        invoiceDate: invoiceDate ? new Date(invoiceDate) : new Date(),
        items: rows
          .filter((r) => r.name)
          .map((r) => {
            const qty = Number(r.quantity) || 0;
            const price = Number(r.price) || 0;
            const line =
              Number(r.total) ||
              Number(r.taxableValue) + Number(r.taxAmount || 0) ||
              qty * price;
            return {
              name: r.name,
              hsn: r.hsnSac || null,
              quantity: qty,
              unit: r.unit || null,
              unitPrice: price,
              amount: line,
            };
          }),
        subtotal,
        taxTotal: totalTax,
        cgstTotal: totalCGST,
        sgstTotal: totalSGST,
        igstTotal: totalIGST,
        roundOff,
        grandTotal,
        paidAmount: totalPaid,
        balance,
        paymentMode: mode,
        notes: notes || null,
      };
    },
    [
      business,
      selectedCustomer,
      invoiceDate,
      rows,
      subtotal,
      totalTax,
      totalCGST,
      totalSGST,
      totalIGST,
      roundOff,
      grandTotal,
      totalPaid,
      balance,
      payments,
      notes,
    ]
  );

  // Manual "Print to Bluetooth" (doesn't save invoice, just reprints the
  // current on-screen order). Used as a fallback or when auto-print is off.
  const handleBluetoothReprint = useCallback(async () => {
    if (!canBtPrint) return;
    if (!bt.supported) {
      toastCtx.error(
        'Bluetooth printing is not supported in this browser. Use Chrome on Android or desktop Chrome/Edge.'
      );
      return;
    }
    if (bt.savedPrinters.length === 0) {
      toastCtx.error(
        'No Bluetooth printer paired. Go to Settings → Print & devices to pair one.'
      );
      return;
    }
    if (rows.filter((r) => r.name).length === 0) {
      toastCtx.error('Add items before printing');
      return;
    }
    setBtPrinting(true);
    try {
      const identifier =
        invoicePrefix && invoiceNumber
          ? `${invoicePrefix}-${invoiceNumber}`
          : invoiceNumber || 'DRAFT';
      const receipt = buildReceiptFromState(identifier);
      await bt.printReceipt(receipt);
      toastCtx.success('Sent to Bluetooth printer');
    } catch (err: any) {
      toastCtx.error(err?.message || 'Bluetooth print failed');
    } finally {
      setBtPrinting(false);
    }
  }, [
    canBtPrint,
    bt,
    toastCtx,
    rows,
    invoicePrefix,
    invoiceNumber,
    buildReceiptFromState,
  ]);

  // Handle print bill (POS mode) - must be after totals calculation
  const handlePrintBill = useCallback(async () => {
    console.log('[POS] handlePrintBill called', { savedInvoiceId, rowsCount: rows.length, businessId: business?.id });
    
    if (!savedInvoiceId) {
      // Save as final first, then print
      let loadingTimeout: NodeJS.Timeout | null = null;
      try {
        setLoading(true);
        console.log('[POS] Starting invoice save...');
        
        // Set a timeout to prevent infinite loading (40 seconds - longer than fetch timeout)
        loadingTimeout = setTimeout(() => {
          console.error('[POS] Request timeout after 40 seconds');
          setLoading(false);
          toastCtx.error('Request timed out. Please check your connection and try again.');
        }, 40000);
        
        // Validate required fields
        if (!business?.id) {
          console.error('[POS] Validation failed: missing business ID');
          setLoading(false);
          if (loadingTimeout) clearTimeout(loadingTimeout);
          throw new Error('Business information is missing');
        }
        if (rows.length === 0) {
          console.error('[POS] Validation failed: no items');
          setLoading(false);
          if (loadingTimeout) clearTimeout(loadingTimeout);
          throw new Error('Please add at least one item');
        }
        
        console.log('[POS] Validation passed, preparing payload...');
        console.log('[POS] Invoice data:', {
          invoiceNumber,
          invoiceDate,
          customerId,
          rowsCount: rows.length,
          subtotal,
          totalTax,
          grandTotal,
          totalPaid,
          balance,
          paymentsCount: payments.length,
        });
        
        const payload = {
          business_id: business.id, 
          branch_id: currentBranchId !== 'ALL' ? currentBranchId : undefined, // Use current branch from global context, or let API resolve to default
          customer_id: customerId || null, 
          invoice_date: invoiceDate, 
          status: 'final', 
          billing_address: billingAddress, 
          shipping_address: shippingAddress, 
          place_of_supply_state_code: isExport ? '96' : getStateCode(placeOfSupply), 
          document_type: documentType, 
          is_export: isExport, 
          template_id: isExport ? 'export_invoice' : invoiceTemplate || null, 
          export_type: isExport ? exportType : undefined, 
          port_code: isExport ? portCode : undefined, 
          shipping_bill_number: isExport ? shippingBillNumber : undefined, 
          shipping_bill_date: isExport && shippingBillDate ? shippingBillDate : undefined, 
          invoice_currency: isExport ? invoiceCurrency : undefined, 
          exchange_rate: isExport && exchangeRate ? exchangeRate : undefined, 
          country_of_origin: isExport ? countryOfOrigin : undefined, 
          port_of_loading: isExport ? portOfLoading : undefined, 
          port_of_discharge: isExport ? portOfDischarge : undefined, 
          place_of_delivery: isExport ? placeOfDelivery : undefined, 
          incoterms: isExport ? incoterms : undefined, 
          transport_mode: isExport ? transportMode : undefined, 
          awb_number: isExport ? awbNumber : undefined, 
          bl_number: isExport ? blNumber : undefined, 
          buyer_tax_id: isExport ? buyerTaxId : undefined, 
          lut_declaration: isExport && exportType === 'wop', 
          eway_bill_number: ewayBillNumber || undefined, 
          eway_bill_date: ewayBillDate || undefined, 
          purchase_order_number: purchaseOrderNumber || undefined, 
          purchase_order_date: purchaseOrderDate || undefined, 
          reference_number: referenceNumber || undefined, 
          delivery_note: deliveryNote || undefined, 
          payment_terms: paymentTerms || undefined, 
          other_references: otherReferences || undefined, 
          dispatched_through: dispatchedThrough || undefined, 
          destination: destination || undefined, 
          terms_of_delivery: termsOfDelivery || undefined,
          custom_fields: invoiceCustomFieldValues,
          enable_round_off: enableRoundOff, 
          attachments: attachments.map(a => ({ id: a.id, name: a.name, url: a.url })), 
          notes, 
          items: rows.map(r => ({ 
            item_id: r.itemId || null, 
            variant_id: r.variantId || null, 
            item_name: r.name, 
            quantity: r.quantity, 
            unit: r.unit,
            location_id: selectedWarehouseId || null, 
            unit_price: r.price, 
            discount_percent: r.discountPercent, 
            tax_rate: r.taxPercent, 
            hsn_sac: r.hsnSac 
          })), 
          subtotal, 
          additional_charges: totalExtraCharges, 
          tax_total: totalTax, 
          round_off: roundOff, 
          grand_total: grandTotal, 
          payments: payments.length > 0 ? payments.map(p => ({ amount: p.amount, mode: p.mode, date: p.date, reference: p.reference })) : undefined, 
          payment_status: totalPaid >= grandTotal ? 'paid' : (totalPaid > 0 ? 'partially_paid' : 'unpaid'), 
          paid_amount: totalPaid, 
          balance_amount: balance, 
          created_by: user?.id || null,
          expiry_date: documentType === 'proforma_invoice' ? (expiryDate || undefined) : undefined,
          estimate_status: documentType === 'proforma_invoice' ? estimateStatus : undefined
        };
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          console.error('[POS] Fetch timeout after 35 seconds');
          controller.abort();
        }, 35000); // 35 second timeout (backend can take ~25-30 seconds)
        
        // PHASE 2: Construct full invoice number from prefix + number
        const fullInvoiceNumber = invoicePrefix && invoiceNumber ? `${invoicePrefix}-${invoiceNumber}` : invoiceNumber;
        const requestPayload = { ...payload, invoice_number: fullInvoiceNumber };

        if (canQueueOffline) {
          const { invoice_number: _omit, ...offlinePayload } = requestPayload as Record<
            string,
            unknown
          > & { invoice_number?: string };
          const offlineResult = await queueSalesFinalize({
            payload: offlinePayload,
            stockLines: rows
              .filter((r) => r.itemId)
              .map((r) => ({
                itemId: r.itemId!,
                quantity: r.quantity,
                variantId: r.variantId || null,
                locationId: selectedWarehouseId || null,
              })),
            customerId: customerId || null,
            balanceDue: balance,
          });

          if (offlineResult.queued && offlineResult.displayInvoiceNumber) {
            if (loadingTimeout) clearTimeout(loadingTimeout);
            setOfflineSyncPending(true);
            setOfflineDisplayNumber(offlineResult.displayInvoiceNumber);
            setSavedStatus('final');

            if (offlineResult.stockWarnings?.length) {
              toastCtx.warning(offlineResult.stockWarnings[0]);
            }

            toastCtx.success(
              `Invoice ${offlineResult.displayInvoiceNumber} saved offline — will sync automatically`
            );

            const useBluetooth =
              canBtPrint &&
              getPosAutoBluetoothPrint() &&
              bt.supported &&
              bt.savedPrinters.length > 0;

            if (useBluetooth) {
              try {
                const receipt = buildReceiptFromState(offlineResult.displayInvoiceNumber);
                await bt.printReceipt(receipt);
              } catch (btErr: unknown) {
                toastCtx.warning(
                  (btErr as Error)?.message || 'Bluetooth print failed for offline bill'
                );
              }
            }

            setTimeout(() => {
              resetIdempotency();
              setOfflineSyncPending(false);
              setOfflineDisplayNumber(null);
              startNewBill();
              setLoading(false);
            }, 500);
            return;
          }
        }

        console.log('[POS] ========== PAYLOAD BEING SENT TO API ==========');
        console.log('[POS] Full payload:', JSON.stringify(requestPayload, null, 2));
        console.log('[POS] Payload summary:', {
          business_id: requestPayload.business_id,
          customer_id: requestPayload.customer_id,
          invoice_number: requestPayload.invoice_number,
          invoice_date: requestPayload.invoice_date,
          status: requestPayload.status,
          items_count: requestPayload.items?.length || 0,
          items: requestPayload.items?.map((i: any) => ({
            item_name: i.item_name,
            quantity: i.quantity,
            unit_price: i.unit_price,
            tax_rate: i.tax_rate,
          })),
          subtotal: requestPayload.subtotal,
          tax_total: requestPayload.tax_total,
          grand_total: requestPayload.grand_total,
          payments_count: requestPayload.payments?.length || 0,
          payments: requestPayload.payments,
          paid_amount: requestPayload.paid_amount,
          balance_amount: requestPayload.balance_amount,
        });
        console.log('[POS] ================================================');
        
        console.log('[POS] Sending API request...', { invoiceNumber, itemsCount: rows.length });
        
        const requestStartTime = Date.now();
        console.log('[POS] Fetch call initiated at:', new Date().toISOString());
        
        let res;
        try {
          res = await fetch('/api/invoices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload),
            signal: controller.signal,
          });
          const requestDuration = Date.now() - requestStartTime;
          console.log('[POS] ✅ Fetch promise resolved', { 
            duration: `${requestDuration}ms`,
            status: res.status,
            statusText: res.statusText,
            ok: res.ok,
            headers: Object.fromEntries(res.headers.entries()),
          });
        } catch (fetchError: any) {
          const requestDuration = Date.now() - requestStartTime;
          console.error('[POS] ❌ Fetch promise rejected', {
            duration: `${requestDuration}ms`,
            error: fetchError.message,
            name: fetchError.name,
            stack: fetchError.stack,
          });
          throw fetchError;
        }
        
        clearTimeout(timeoutId);
        if (loadingTimeout) clearTimeout(loadingTimeout);
        
        console.log('[POS] API response received', { status: res.status, ok: res.ok, statusText: res.statusText });
        console.log('[POS] Starting to read response body...');
        
        let data;
        try {
          const responseTextStartTime = Date.now();
          const responseText = await res.text();
          const responseTextDuration = Date.now() - responseTextStartTime;
          console.log('[POS] ✅ Response text read', {
            duration: `${responseTextDuration}ms`,
            length: responseText.length,
            preview: responseText.substring(0, 500),
          });
          
          const parseStartTime = Date.now();
          data = JSON.parse(responseText);
          const parseDuration = Date.now() - parseStartTime;
          console.log('[POS] ✅ JSON parsed', { duration: `${parseDuration}ms` });
          console.log('[POS] ========== API RESPONSE RECEIVED ==========');
          console.log('[POS] Response data:', JSON.stringify(data, null, 2));
          console.log('[POS] Response summary:', {
            success: res.ok,
            status: res.status,
            invoice_id: data?.invoice?.id,
            invoice_number: data?.invoice?.invoice_number,
            error: data?.error,
            message: data?.message,
          });
          console.log('[POS] ============================================');
        } catch (parseError) {
          console.error('[POS] Failed to parse response:', parseError);
          setLoading(false);
          throw new Error('Invalid response from server');
        }
        
        if (!res.ok) {
          const errorMessage = data?.error || data?.message || `Server error: ${res.status}`;
          console.error('[POS] API error response:', {
            status: res.status,
            error: errorMessage,
            fullData: data,
          });
          setLoading(false);
          throw new Error(errorMessage);
        }
        
        if (!data?.invoice?.id) {
          console.error('[POS] Missing invoice ID in response:', data);
          setLoading(false);
          throw new Error('Invoice was created but no ID was returned');
        }
        
        const invoiceId = data.invoice.id;
        console.log('[POS] ✅ Invoice saved successfully', { 
          invoiceId, 
          invoiceNumber: data.invoice.invoice_number,
          status: data.invoice.status,
        });
        
        setSavedInvoiceId(invoiceId);
        setSavedStatus('final');

        // Decide whether to route to Bluetooth or the classic PDF popup.
        // We read the localStorage value fresh to avoid stale-closure issues.
        const useBluetooth =
          canBtPrint &&
          getPosAutoBluetoothPrint() &&
          bt.supported &&
          bt.savedPrinters.length > 0;

        if (useBluetooth) {
          console.log('[POS] Auto-sending receipt to Bluetooth printer...');
          try {
            const identifier =
              data.invoice.invoice_number ||
              (invoicePrefix && invoiceNumber
                ? `${invoicePrefix}-${invoiceNumber}`
                : invoiceNumber);
            const receipt = buildReceiptFromState(identifier);
            await bt.printReceipt(receipt);
            toastCtx.success('Bill sent to Bluetooth printer');
          } catch (btErr: any) {
            console.error('[POS] Bluetooth print failed:', btErr);
            toastCtx.error(
              `Bluetooth print failed: ${btErr?.message || 'unknown error'}`
            );
            // Fall back to PDF popup so the user still gets a printable copy.
            if (user?.id) {
              window.open(
                `/api/invoices/${invoiceId}/pdf?user_id=${user.id}`,
                '_blank'
              );
            }
          }
        } else {
          if (user?.id) {
            console.log('[POS] Opening print dialog...');
            window.open(
              `/api/invoices/${invoiceId}/pdf?user_id=${user.id}`,
              '_blank'
            );
          }
          toastCtx.success('Bill printed successfully');
        }

        // Start new bill after print
        setTimeout(() => {
          console.log('[POS] Starting new bill...');
          startNewBill();
          setLoading(false);
        }, 500);
      } catch (error: any) {
        if (loadingTimeout) clearTimeout(loadingTimeout);
        console.error('Failed to save invoice:', error);
        
        // Handle abort/timeout errors
        if (error.name === 'AbortError') {
          toastCtx.error('Request timed out. Please check your connection and try again.');
        } else {
          const errorMessage = error?.message || 'Failed to save invoice. Please try again.';
          toastCtx.error(errorMessage);
        }
        
        setLoading(false);
      }
    } else if (user?.id && savedInvoiceId) {
      // Invoice already saved, just print.
      const useBluetooth =
        canBtPrint &&
        getPosAutoBluetoothPrint() &&
        bt.supported &&
        bt.savedPrinters.length > 0;

      try {
        if (useBluetooth) {
          const identifier =
            invoicePrefix && invoiceNumber
              ? `${invoicePrefix}-${invoiceNumber}`
              : (invoiceNumber || 'INVOICE');
          const receipt = buildReceiptFromState(identifier);
          await bt.printReceipt(receipt);
          toastCtx.success('Bill sent to Bluetooth printer');
        } else {
          window.open(
            `/api/invoices/${savedInvoiceId}/pdf?user_id=${user.id}`,
            '_blank'
          );
          toastCtx.success('Bill printed');
        }
        // Start new bill after print (POS mode)
        setTimeout(() => {
          startNewBill();
        }, 500);
      } catch (error: any) {
        console.error('Failed to print invoice:', error);
        toastCtx.error(
          error?.message || 'Failed to print bill'
        );
      }
    } else {
      // No invoice saved and no user - should not happen
      console.error('Cannot print: missing savedInvoiceId or user');
      toastCtx.error('Cannot print: Invoice not saved');
    }
  }, [savedInvoiceId, user?.id, business?.id, customerId, invoiceDate, billingAddress, shippingAddress, placeOfSupply, documentType, isExport, exportType, portCode, shippingBillNumber, shippingBillDate, invoiceCurrency, exchangeRate, countryOfOrigin, portOfLoading, portOfDischarge, placeOfDelivery, incoterms, transportMode, awbNumber, blNumber, buyerTaxId, invoiceTemplate, invoiceNumber, invoicePrefix, rows, subtotal, totalExtraCharges, totalTax, roundOff, grandTotal, payments, totalPaid, balance, notes, attachments, enableRoundOff, ewayBillNumber, ewayBillDate, purchaseOrderNumber, purchaseOrderDate, referenceNumber, deliveryNote, paymentTerms, otherReferences, dispatchedThrough, destination, termsOfDelivery, startNewBill, canBtPrint, bt, buildReceiptFromState, toastCtx]);

  // PHASE 6: Calculate projected credit metrics when invoice total changes
  useEffect(() => {
    if (!selectedCustomer || !creditMetrics?.current || !customerId) {
      // Clear projected metrics if no customer or metrics
      if (creditMetrics?.projected) {
        setCreditMetrics(prev => prev ? { ...prev, projected: undefined } : null);
      }
      return;
    }
    
    // Use the totals that are already calculated
    const invoiceBalance = grandTotal - totalPaid;
    
    if (invoiceBalance > 0 || rows.length > 0) {
      const projectedMetrics = calculateProjectedCreditMetrics(
        creditMetrics.current.credit_limit,
        creditMetrics.current.current_balance,
        invoiceBalance
      );
      
      console.log('[Credit Warning] Projected metrics:', {
        invoiceBalance,
        grandTotal,
        totalPaid,
        currentBalance: creditMetrics.current.current_balance,
        creditLimit: creditMetrics.current.credit_limit,
        projectedMetrics,
      });
      
      setCreditMetrics(prev => prev ? { ...prev, projected: projectedMetrics } : null);
    } else {
      // If balance is 0 or negative, clear projected metrics
      setCreditMetrics(prev => prev ? { ...prev, projected: undefined } : null);
    }
  }, [grandTotal, totalPaid, selectedCustomer, customerId, creditMetrics?.current, rows]);

  const handleSave = useCallback(async (targetStatus: 'draft' | 'final') => {
    const canFinalizeOffline =
      canQueueOffline &&
      targetStatus === 'final' &&
      documentType !== 'proforma_invoice' &&
      !savedInvoiceId;

    // Draft saves always require a live API connection — queue only supports finals.
    if (targetStatus === 'draft' && canQueueOffline) {
      setToastMessage({
        message: 'Draft saves require internet. Your items are safe — tap Finalize to save offline.',
        type: 'error',
      });
      return;
    }

    if (!isSeriesResolved && !canFinalizeOffline) {
      setToastMessage({ message: 'Document number is not ready. Please wait...', type: 'error' });
      return;
    }
    if (!invoicePrefix || !invoiceNumber) {
      setToastMessage({ message: 'Document number is missing. Please wait for it to load...', type: 'error' });
      return;
    }
    
    // CRITICAL SECURITY: Ensure branch is set for non-admin users
    if (!isAdmin && (!currentBranchId || currentBranchId === 'ALL')) {
      setToastMessage({ message: 'Branch selection is required to create invoices. Please select a branch.', type: 'error' });
      console.error('[Invoice Save] Non-admin user attempted to create invoice without branch selection');
      return;
    }
    
    if (!savedInvoiceId && limitInfo && limitInfo.limit !== -1 && limitInfo.current >= limitInfo.limit) { setShowUpgradePrompt(true); return; }
    if (savedStatus === 'final' && targetStatus === 'final') { setShareModalOpen(true); return; }
    if (rows.length === 0 || !rows.some(r => r.name && r.itemId)) return setToastMessage({ message: 'Add items', type: 'error' });
    setLoading(true);
    try {
      // For proforma invoices: always keep status as 'draft' (estimates are always editable)
      // Use estimate_status to track lifecycle (draft, sent, accepted, rejected, expired, converted)
      // When "Finalize & Send" is clicked, set estimate_status to 'sent'
      const finalEstimateStatus = documentType === 'proforma_invoice' 
        ? (targetStatus === 'final' ? 'sent' : estimateStatus)
        : undefined;
      
      // For proforma invoices, always use 'draft' status (they remain editable)
      // For regular invoices, use targetStatus ('draft' or 'final')
      const finalInvoiceStatus = documentType === 'proforma_invoice' ? 'draft' : targetStatus;

      // CRITICAL: Include branch_id to ensure invoice is created under the correct branch
      // For non-admin users, currentBranchId should never be 'ALL' (enforced by BranchContext)
      // If it is 'ALL', we should not allow creation (this should be caught by validation above)
      const payload = {
        business_id: business?.id, 
        branch_id: currentBranchId !== 'ALL' ? currentBranchId : undefined, // Use current branch from global context
        customer_id: customerId || null, 
        invoice_date: invoiceDate,
        due_date: dueDate || null,
        status: finalInvoiceStatus, 
        billing_address: billingAddress, 
        shipping_address: shippingAddress, 
        place_of_supply_state_code: isExport ? '96' : getStateCode(placeOfSupply), 
        document_type: documentType, 
        is_export: isExport, 
        template_id: isExport ? 'export_invoice' : invoiceTemplate || null, 
        export_type: isExport ? exportType : undefined, 
        port_code: isExport ? portCode : undefined, 
        shipping_bill_number: isExport ? shippingBillNumber : undefined, 
        shipping_bill_date: isExport && shippingBillDate ? shippingBillDate : undefined, 
        invoice_currency: isExport ? invoiceCurrency : undefined, 
        exchange_rate: isExport && exchangeRate ? exchangeRate : undefined, 
        country_of_origin: isExport ? countryOfOrigin : undefined, 
        port_of_loading: isExport ? portOfLoading : undefined, 
        port_of_discharge: isExport ? portOfDischarge : undefined, 
        place_of_delivery: isExport ? placeOfDelivery : undefined, 
        incoterms: isExport ? incoterms : undefined, 
        transport_mode: isExport ? transportMode : undefined, 
        awb_number: isExport ? awbNumber : undefined, 
        bl_number: isExport ? blNumber : undefined, 
        buyer_tax_id: isExport ? buyerTaxId : undefined, 
        lut_declaration: isExport && exportType === 'wop', 
        eway_bill_number: ewayBillNumber || undefined, 
        eway_bill_date: ewayBillDate || undefined, 
        purchase_order_number: purchaseOrderNumber || undefined, 
        purchase_order_date: purchaseOrderDate || undefined, 
        reference_number: referenceNumber || undefined, 
        delivery_note: deliveryNote || undefined, 
        payment_terms: paymentTerms || undefined, 
        other_references: otherReferences || undefined, 
        dispatched_through: dispatchedThrough || undefined, 
        destination: destination || undefined, 
        terms_of_delivery: termsOfDelivery || undefined,
        custom_fields: invoiceCustomFieldValues,
        enable_round_off: enableRoundOff, 
        attachments: attachments.map(a => ({ id: a.id, name: a.name, url: a.url })), 
        notes, 
        items: rows.map(r => ({ item_id: r.itemId || null, variant_id: r.variantId || null, item_name: r.name, quantity: r.quantity, unit_price: r.price, unit: r.unit, discount_percent: r.discountPercent, tax_rate: r.taxPercent, hsn_sac: r.hsnSac, location_id: selectedWarehouseId || null })), 
        subtotal, 
        additional_charges: totalExtraCharges, 
        tax_total: totalTax, 
        round_off: roundOff, 
        grand_total: grandTotal, 
        payments: payments.length > 0 ? payments.map(p => ({ amount: p.amount, mode: p.mode, date: p.date, reference: p.reference })) : undefined, 
        payment_status: totalPaid >= grandTotal ? 'paid' : (totalPaid > 0 ? 'partially_paid' : 'unpaid'), 
        paid_amount: totalPaid, 
        balance_amount: balance, 
        created_by: user?.id || null, 
        expiry_date: documentType === 'proforma_invoice' ? (expiryDate || undefined) : undefined, 
        estimate_status: finalEstimateStatus
      };
      // PHASE 2: Construct full invoice number from prefix + number
      const fullInvoiceNumber = invoicePrefix && invoiceNumber ? `${invoicePrefix}-${invoiceNumber}` : invoiceNumber;

      if (canFinalizeOffline) {
        const { invoice_number: _omit, ...offlinePayload } = {
          ...payload,
          invoice_number: fullInvoiceNumber,
        } as Record<string, unknown> & { invoice_number?: string };
        const offlineResult = await queueSalesFinalize({
          payload: offlinePayload,
          stockLines: rows
            .filter((r) => r.itemId)
            .map((r) => ({
              itemId: r.itemId!,
              quantity: r.quantity,
              variantId: r.variantId || null,
              locationId: selectedWarehouseId || null,
            })),
          customerId: customerId || null,
          balanceDue: balance,
        });

        if (offlineResult.queued && offlineResult.displayInvoiceNumber) {
          setOfflineSyncPending(true);
          setOfflineDisplayNumber(offlineResult.displayInvoiceNumber);
          setSavedStatus('final');
          setIsDirty(false);
          if (offlineResult.stockWarnings?.length) {
            toastCtx.warning(offlineResult.stockWarnings[0]);
          }
          toastCtx.success(
            `Invoice ${offlineResult.displayInvoiceNumber} saved offline — will sync automatically`
          );
          setTimeout(() => {
            resetIdempotency();
            setOfflineSyncPending(false);
            setOfflineDisplayNumber(null);
            resetFormForNewInvoice();
            setLoading(false);
          }, 500);
          return;
        }
      }

      // Existing drafts must use POST with id — PATCH /api/invoices/[id] only supports proforma estimate_status.
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          savedInvoiceId
            ? { ...payload, id: savedInvoiceId, invoice_number: fullInvoiceNumber }
            : { ...payload, invoice_number: fullInvoiceNumber }
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { if (res.status === 403 && data.code === 'SUBSCRIPTION_LIMIT_EXCEEDED') { setLimitInfo({ current: data.current, limit: data.limit }); setShowUpgradePrompt(true); return; } throw new Error(data.error || 'Failed to save'); }
      setSavedInvoiceId(data.invoice.id); 
      // For proforma invoices, always track as 'draft' (they remain editable unless converted)
      // But if estimate_status is 'converted', track as 'final' to prevent editing
      // For regular invoices, track the actual status
      let trackedStatus: 'draft' | 'final';
      if (documentType === 'proforma_invoice') {
        // Check if the saved invoice has estimate_status = 'converted'
        const savedEstimateStatus = data.invoice?.estimate_status || finalEstimateStatus;
        trackedStatus = savedEstimateStatus === 'converted' ? 'final' : 'draft';
      } else {
        trackedStatus = targetStatus;
      }
      setSavedStatus(trackedStatus); 
      setIsDirty(false); 
      const successMessage = documentType === 'proforma_invoice' 
        ? (targetStatus === 'final' ? 'Estimate Sent!' : 'Draft Saved')
        : (targetStatus === 'draft' ? 'Draft Saved' : 'Invoice Finalized!');
      // No top-right toast when generating/finalizing a tax invoice (mobile redirects to view).
      if (targetStatus === 'draft' || documentType === 'proforma_invoice') {
        setToastMessage({ message: successMessage, type: 'success' });
      }
      
      // Display stock warnings for proforma invoices (if any)
      
      if (data.stock_warnings && Array.isArray(data.stock_warnings) && data.stock_warnings.length > 0) {
        const warningMessages = data.stock_warnings.map((w: any) => {
          let msg = `${w.item_name}: ${w.warehouse_name || 'Selected warehouse'} has ${w.available_stock}, Requested ${w.requested_quantity}`;
          if (w.other_warehouses && Array.isArray(w.other_warehouses) && w.other_warehouses.length > 0) {
            const otherStock = w.other_warehouses.map((ow: any) => 
              `${ow.warehouse_name} (${ow.available_stock})`
            ).join(', ');
            msg += `. Available in: ${otherStock}`;
          }
          return msg;
        }).join('; ');
        
        
        hotToast(`⚠️ Low stock warning: ${warningMessages}`, {
          duration: 12000,
          icon: '⚠️',
          style: {
            background: '#FEF3C7',
            color: '#92400E',
            border: '1px solid #FCD34D',
            maxWidth: '600px'
          }
        });
      }
      
      if (targetStatus === 'final' && !posMode) {
        const mobilePost =
          typeof window !== 'undefined' &&
          window.matchMedia('(max-width: 1023px)').matches;
        if (mobilePost && data.invoice?.id) {
          router.push(
            `/invoices/${data.invoice.id}/view?from=generate&type=${encodeURIComponent(documentType)}`
          );
        } else {
          setShareModalOpen(true);
        }
      }
    } catch (e: any) { 
      console.error(e); 
      // Enhanced error message with warehouse stock info
      let errorMsg = e.message || 'Error';
      if (e.response) {
        try {
          const errorData = await e.response.json();
          if (errorData.other_warehouses && Array.isArray(errorData.other_warehouses) && errorData.other_warehouses.length > 0) {
            const otherStock = errorData.other_warehouses.map((w: any) => 
              `${w.warehouse_name}: ${w.available_stock} units`
            ).join(', ');
            errorMsg = `${errorData.error || errorMsg}\n\nStock available in other warehouses:\n${otherStock}`;
          } else {
            errorMsg = errorData.error || errorMsg;
          }
        } catch (parseError) {
          // Use original error message
        }
      }
      setToastMessage({ message: errorMsg, type: 'error' }); 
      hotToast.error(errorMsg, { duration: 8000 });
    } finally { setLoading(false); }
  }, [business?.id, customerId, invoiceDate, billingAddress, shippingAddress, placeOfSupply, documentType, exportType, portCode, shippingBillNumber, shippingBillDate, notes, rows, subtotal, totalTax, grandTotal, recordPayment, payments, totalPaid, balance, invoiceNumber, savedInvoiceId, savedStatus, limitInfo, ewayBillNumber, ewayBillDate, purchaseOrderNumber, purchaseOrderDate, referenceNumber, deliveryNote, paymentTerms, otherReferences, dispatchedThrough, destination, termsOfDelivery, enableRoundOff, attachments, isExport, invoiceCurrency, exchangeRate, countryOfOrigin, portOfLoading, portOfDischarge, placeOfDelivery, incoterms, transportMode, awbNumber, blNumber, buyerTaxId, invoiceTemplate, user?.id, totalExtraCharges, roundOff, router, estimateStatus, posMode, currentBranchId, isAdmin, isSeriesResolved, invoicePrefix, selectedWarehouseId, canQueueOffline, queueSalesFinalize, resetIdempotency, resetFormForNewInvoice, toastCtx]);

  const handlePreview = useCallback(async () => {
    if (rows.length === 0 || !rows.some(r => r.name && r.itemId)) { setToastMessage({ message: 'Add items', type: 'error' }); return; }
    // PHASE 1: Don't use hardcoded prefix check - use documentType directly
    const effDoc = documentType;
    const title = effDoc === 'proforma_invoice' ? 'PROFORMA INVOICE' : isExport ? 'EXPORT INVOICE' : effDoc === 'bill_of_supply' ? 'BILL OF SUPPLY' : 'TAX INVOICE';
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setPreviewLoading(true);
    try {
      const items = rows.map((r, i) => ({ index: i + 1, item_name: r.name, quantity: r.quantity, unit: r.unit, unit_price: r.price.toFixed(2), discount_percent: r.discountPercent, discount_amount: r.discountAmount.toFixed(2), tax_rate: r.taxPercent, cgst_rate: (isExport ? 0 : (isIntraState ? r.taxPercent/2 : 0)).toFixed(2), sgst_rate: (isExport ? 0 : (isIntraState ? r.taxPercent/2 : 0)).toFixed(2), igst_rate: (isExport || !isIntraState ? r.taxPercent : 0).toFixed(2), tax_amount: r.taxAmount.toFixed(2), cgst_amount: r.cgstAmount.toFixed(2), sgst_amount: r.sgstAmount.toFixed(2), igst_amount: r.igstAmount.toFixed(2), taxable_value: (r.quantity * r.price - (r.quantity * r.price * (r.discountPercent || 0)) / 100).toFixed(2), hsn_sac: r.hsnSac, line_total: r.total.toFixed(2) }));
      const data = { business: { id: business?.id || '', name: business?.name || '', address: business?.address || '', city: business?.city || '', state: business?.state || '', state_code: business?.state_code || getStateCode(business?.state || ''), pincode: business?.pincode || '', phone: business?.phone || '', email: business?.email || '', gstin: business?.gstin || '', logo_url: business?.logo_url || null }, customer: selectedCustomer ? { name: selectedCustomer.name, address: billingAddress || selectedCustomer.address, phone: selectedCustomer.phone, gstin: selectedCustomer.gstin, state: selectedCustomer.state } : { name: '', address: '', state: '' }, invoice: { invoice_number: invoiceNumber || 'PREVIEW', invoice_date: format(new Date(invoiceDate), 'dd-MM-yyyy'), due_date: format(new Date(dueDate || invoiceDate), 'dd-MM-yyyy'), invoice_title: title, document_type: effDoc, is_export: isExport, is_igst: isExport || !isIntraState, place_of_supply: placeOfSupply, subtotal: subtotal.toFixed(2), discount_total: rows.reduce((s, r) => s + r.discountAmount, 0).toFixed(2), additional_charges: totalExtraCharges.toFixed(2), tax_total: totalTax.toFixed(2), grand_total: grandTotal.toFixed(2), amount_in_words: engineNumberToWords(grandTotal), billing_address: billingAddress, shipping_address: shippingAddress }, items, settings: templateSettings || {} };
      const res = await fetch('/api/invoices/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templateId: isExport ? 'export_invoice' : (invoiceTemplate || null), data }) });
      if (res.ok) {
        const resp = await res.json();
        setPreviewHtml(resp.html || '');
        setPreviewTemplateId(resp.templateId || (isExport ? 'export_invoice' : invoiceTemplate) || null);
        setPreviewModalOpen(true);
      }
    } catch (e) { console.error(e); } finally { setPreviewLoading(false); }
  }, [rows, invoiceNumber, invoiceDate, dueDate, selectedCustomer, subtotal, totalExtraCharges, totalTax, grandTotal, notes, billingAddress, shippingAddress, invoiceTemplate, business, isExport, exportType, portCode, shippingBillNumber, shippingBillDate, invoiceCurrency, exchangeRate, countryOfOrigin, portOfLoading, portOfDischarge, placeOfDelivery, incoterms, transportMode, awbNumber, blNumber, buyerTaxId, templateSettings, documentType, placeOfSupply, isIntraState, invoicePrefix]);

  const handleConfirmReset = (action: 'save' | 'discard' | 'cancel') => {
    if (action === 'cancel') { setShowResetConfirm(false); setPendingTypeChange(null); return; }
    if (action === 'save') { handleSave('draft').then(() => { if (pendingTypeChange) performDocumentTypeChange(pendingTypeChange); setShowResetConfirm(false); setPendingTypeChange(null); }); return; }
    if (pendingTypeChange) performDocumentTypeChange(pendingTypeChange); setShowResetConfirm(false); setPendingTypeChange(null);
  };

  // Effects
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const apply = () => setInvoiceMobileLayout(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // Sync documentType with query params when they change (e.g., navigating from /invoices/new to /invoices/new?type=proforma_invoice)
  useEffect(() => {
    const newDocType = initialDocType;
    
    if (newDocType !== documentType) {
      performDocumentTypeChange(newDocType);
    }
  }, [searchParams, initialDocType, documentType, performDocumentTypeChange]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); if (!isFinal && !loading) handleSave('draft'); return; }
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); if (!loading) handleSave('final'); return; }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); if (!isFinal && !loading) handleSave('draft'); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); if (!loading) handleSave('final'); }
      else if (((e.ctrlKey || e.metaKey) && e.key === 'p') || e.key === 'P') { e.preventDefault(); if (!isFinal && documentType !== 'proforma_invoice') setPaymentModalOpen(true); }
    };
    window.addEventListener('keydown', handleKeyDown); return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFinal, loading, handleSave, documentType]);

  useEffect(() => {
    const init = async () => {
      // PHASE 6: Don't initialize if branch context is not ready
      if (branchLoading || !business?.id) {
        console.log('[Invoice Init] Waiting for branch context:', { branchLoading, businessId: business?.id });
        return;
      }
      
      // PHASE 5: Require branch_id - don't proceed if currentBranchId is ALL or missing
      if (!currentBranchId || currentBranchId === 'ALL') {
        console.warn('[Invoice Init] Branch selection required:', { currentBranchId });
        setSeriesError('Branch selection is required to generate document number');
        setInvoicePrefix(null);
        setInvoiceNumber(null);
        return;
      }
      
      console.log('[Invoice Init] Initializing with branch:', { currentBranchId, businessId: business.id });
      const editId = searchParams.get('edit');
      let custData: any[] = [];

      // Pre-populate customer list from local catalog immediately — this makes the
      // customer dropdown available even before the API responds (or if offline).
      if (user?.id) {
        const localCusts = await listCatalogCustomersLocal(
          { businessId: business.id, userId: user.id },
          500
        );
        if (localCusts?.length) {
          custData = localCusts as any[];
          setCustomers(custData);
        }
      }

      const [limitRes, tempRes, custRes] = await Promise.allSettled([fetch(`/api/subscriptions/check-limit?business_id=${business.id}&limit_type=invoices`), fetch(`/api/template-assignments?business_id=${business.id}`), fetch(`/api/customers?business_id=${business.id}&limit=500&user_id=${user?.id}`)]);
      if (!editId && limitRes.status === 'fulfilled' && limitRes.value.ok) { const data = await limitRes.value.json(); setLimitInfo({ current: data.current, limit: data.limit }); if (!data.allowed) setShowUpgradePrompt(true); }
      setLimitCheckDone(true);
      if (tempRes.status === 'fulfilled' && tempRes.value.ok) { 
        const data = await tempRes.value.json();
        const docTypeForTemplate = (searchParams.get('type') as DocumentType) || documentType || 'tax_invoice';
        const assignment = data.assignments?.find((a: any) => a.document_type === docTypeForTemplate); 
        if (assignment?.template_id) { 
          setInvoiceTemplate(assignment.template_id); 
          if (assignment.settings) setTemplateSettings(typeof assignment.settings === 'string' ? JSON.parse(assignment.settings) : assignment.settings); 
        } 
      }
      if (custRes.status === 'fulfilled' && custRes.value.ok) {
        const data = await custRes.value.json();
        const apiCusts = data.customers || [];
        // API data is fresher — overwrite catalog prefill only when API returns results
        if (apiCusts.length > 0) custData = apiCusts;
      }
      setCustomers(custData);
      if (editId) {
        const res = await fetch(`/api/invoices/${editId}?user_id=${user?.id}`);
        if (res.ok) {
          const data = await res.json();
          const inv = data.invoice || data;
          setSavedInvoiceId(editId); 
          // For proforma invoices, use estimate_status; for others, use status
          // Map estimate_status to savedStatus: 'converted' -> 'final' (prevents editing), others -> 'draft' (allows editing)
          const statusToSave = inv.document_type === 'proforma_invoice' 
            ? (inv.estimate_status === 'converted' ? 'final' : 'draft')
            : (inv.status || 'draft');
          setSavedStatus(statusToSave as 'draft' | 'final'); 
          setCustomerId(inv.customer_id || ''); 
          setInvoiceDate(inv.invoice_date?.split('T')[0] || '');
          setDueDate(inv.due_date?.split('T')[0] || '');
          // PHASE 1: Parse invoice number from saved invoice (edit mode only)
          if (inv.invoice_number?.includes('-')) { 
            const parts = inv.invoice_number.split('-'); 
            setInvoicePrefix(parts[0]); 
            setInvoiceNumber(parts.slice(1).join('-')); 
          } else { 
            // If no prefix in saved invoice, don't assume - let API resolve it
            // But for edit mode, we need to show something, so parse what we have
            setInvoicePrefix(null);
            setInvoiceNumber(inv.invoice_number || '');
          }
          setPlaceOfSupply(inv.place_of_supply_state_code || ''); 
          // Set document type but don't trigger form reset in edit mode
          const newDocType = inv.document_type || 'tax_invoice';
          if (documentType !== newDocType) {
            setDocumentType(newDocType);
            // PHASE 1: Remove hardcoded prefix - let API set it
            setInvoicePrefix(null);
            setInvoiceNumber(null);
            // PHASE 2: Fetch series from API for new document type
            fetchDocumentSeries(newDocType as DocumentType);
          }
          setBillingAddress(inv.billing_address || ''); setShippingAddress(inv.shipping_address || ''); setNotes(inv.notes || ''); setIsExport(!!inv.is_export);
          setInvoiceCustomFieldValues(parseItemCustomFieldsFromApi(inv));
          if (inv.is_export) { setExportType(inv.export_type); setPortCode(inv.port_code); setShippingBillNumber(inv.shipping_bill_number); setShippingBillDate(inv.shipping_bill_date?.split('T')[0] || ''); }
          if (inv.items) {
            setRows(inv.items.map((i: any) => ({ itemId: i.item_id || '', variantId: i.variant_id || undefined, variantName: i.variant_name || undefined, name: i.item_name || '', quantity: Number(i.quantity || 1), freeQty: 0, unit: i.unit || 'PCS', price: Number(i.unit_price || 0), discountPercent: Number(i.discount_percent || 0), discountAmount: Number(i.discount_amount || 0), taxPercent: Number(i.tax_rate || 0), taxAmount: Number(i.tax_amount || 0), hsnSac: i.hsn_sac || '', taxableValue: 0, cgstAmount: 0, sgstAmount: 0, igstAmount: 0, total: 0, gstIncluded: !!i.gst_included, priceUserOverride: true })));
          }
          if (inv.document_type === 'proforma_invoice') {
            if (inv.expiry_date) setExpiryDate(inv.expiry_date.split('T')[0]);
            if (inv.estimate_status) setEstimateStatus(inv.estimate_status);
          }
          setFetchedNextNumber(true);
        } else {
        }
      } else if (!fetchedNextNumber) {
        fetchDocumentSeries(documentType).then(() => {
          setFetchedNextNumber(true);
        }).catch(() => {
          setFetchedNextNumber(false);
        });
      }
    };
    init();
    // PHASE 4: Include currentBranchId and documentType in dependencies to react to branch/document type changes
    // PHASE 6: Wait for branch context to be ready before initializing
  }, [business?.id, fetchedNextNumber, searchParams, user?.id, currentBranchId, documentType, branchLoading, fetchDocumentSeries]);

  // PHASE 4: React to branch changes - re-fetch series when branch changes
  useEffect(() => {
    if (!business?.id || branchLoading || !currentBranchId || currentBranchId === 'ALL' || savedInvoiceId) {
      return;
    }
    // Re-fetch series when branch changes
    console.log('[Branch Change] Re-fetching series for branch:', currentBranchId);
    fetchDocumentSeries(documentType);
  }, [currentBranchId, business?.id, documentType, branchLoading, savedInvoiceId, fetchDocumentSeries]);

  useEffect(() => { if (business?.state && !placeOfSupply && !savedInvoiceId) setPlaceOfSupply(business.state); }, [business?.state, savedInvoiceId, placeOfSupply]);

  useEffect(() => {
    if (!customerId || !business) { if (!savedInvoiceId) { setSelectedCustomer(null); setBillingAddress(''); setShippingAddress(''); setPlaceOfSupply(business?.state || ''); setCreditMetrics(null); } return; }
    fetch(`/api/customers/${customerId}?user_id=${user?.id}`).then(r => r.json()).then(d => {
      const c = d.customer;
      if (!c) { console.error('Customer not found:', customerId); return; }
      setSelectedCustomer(c);
      setBillingAddress(c.billing_address || c.address || '');
      setShippingAddress(c.shipping_address || c.address || '');
      setPlaceOfSupply(c.state || business.state || '');
      setRows(prev => prev.map(r => calculateRow(r, true)));
      
      // PHASE 6: Fetch credit metrics for customer
      if (c.credit_limit !== undefined && c.current_balance !== undefined) {
        const creditLimit = parseFloat(c.credit_limit ?? '0');
        const currentBalance = parseFloat(c.current_balance ?? '0');
        
        // Use the proper calculateCreditMetrics function
        const currentMetrics = calculateCreditMetrics(creditLimit, currentBalance);
        
        console.log('[Credit Warning] Customer credit data:', {
          customerName: c.name,
          creditLimit,
          currentBalance,
          currentMetrics,
        });
        
        setCreditMetrics({ current: currentMetrics });
      } else {
        console.log('[Credit Warning] Customer missing credit data:', {
          customerName: c.name,
          hasCreditLimit: c.credit_limit !== undefined,
          hasCurrentBalance: c.current_balance !== undefined,
        });
      }
    });
  }, [customerId, business, calculateRow, savedInvoiceId, user?.id]);

  useEffect(() => {
    dueDateUserEditedRef.current = false;
  }, [customerId]);

  useEffect(() => {
    if (savedInvoiceId) return;
    const raw = selectedCustomer?.credit_days;
    const days =
      raw != null && String(raw).trim() !== '' ? Number(raw) : NaN;
    if (!invoiceDate || !Number.isFinite(days) || days <= 0) return;
    if (dueDateUserEditedRef.current) return;
    const base = parseISO(`${invoiceDate}T12:00:00`);
    if (Number.isNaN(base.getTime())) return;
    setDueDate(format(addDays(base, days), 'yyyy-MM-dd'));
  }, [invoiceDate, selectedCustomer?.credit_days, selectedCustomer?.id, savedInvoiceId]);

  useEffect(() => {
    if (!business?.id || savedInvoiceId || prefilled) return;
    const cid = searchParams.get('customer_id');
    const iid = searchParams.get('item_id');
    const qty = searchParams.get('qty');

    // Preselect customer from ?customer_id= — must NOT set prefilled until this runs or we'd skip
    // applying the customer when the customers list loads after the first paint (race with init()).
    if (cid && !customerId) {
      if (customers.length > 0) {
        const c = customers.find((x) => x.id === cid);
        if (c) {
          setCustomerId(cid);
          setSelectedCustomer(c);
          setBillingAddress(c.billing_address || c.address || '');
          setShippingAddress(c.shipping_address || c.address || '');
          setPrefilled(true);
        } else {
          fetch(`/api/customers/${cid}?user_id=${user?.id}`)
            .then((r) => r.json())
            .then((d) => {
              const cust = d.customer;
              if (cust?.id) {
                setCustomerId(cid);
                setSelectedCustomer(cust);
                setBillingAddress(cust.billing_address || cust.address || '');
                setShippingAddress(cust.shipping_address || cust.address || '');
                setCustomers((prev) => (prev.some((p) => p.id === cust.id) ? prev : [...prev, cust]));
              }
              setPrefilled(true);
            })
            .catch(() => setPrefilled(true));
        }
      }
      return;
    }

    if (iid && qty && rows.length === 0) {
      fetch(`/api/items/${iid}?business_id=${business.id}`)
        .then((r) => r.json())
        .then((d) => {
          const i = d.item;
          if (i?.id) {
            let p = Number(i.selling_price || 0),
              tr = Number(i.tax_rate || 0);
            if (i.gst_included && tr > 0) p = p / (1 + tr / 100);
            setRows([
              calculateRow({
                itemId: i.id,
                name: i.name,
                quantity: parseFloat(qty) || 1,
                freeQty: 0,
                unit: i.unit || 'PCS',
                price: p,
                discountPercent: 0,
                discountAmount: 0,
                taxPercent: tr,
                taxAmount: 0,
                hsnSac: i.hsn_sac || '',
                taxableValue: 0,
                cgstAmount: 0,
                sgstAmount: 0,
                igstAmount: 0,
                total: 0,
                gstIncluded: !!i.gst_included,
                priceUserOverride: false,
              }),
            ]);
            setPrefilled(true);
          }
        })
        .catch(() => setPrefilled(true));
      return;
    }

    if (!iid) setPrefilled(true);
  }, [searchParams, customers, business?.id, savedInvoiceId, customerId, rows, calculateRow, prefilled, user?.id]);

  const showMobileInvoiceUi = invoiceMobileLayout && !posMode;

  const handleConfirmLeavePage = useCallback(() => {
    let targetDocType: DocumentType | null = null;
    if (pendingNavigation) {
      try {
        const url = new URL(pendingNavigation, window.location.origin);
        const typeParam = url.searchParams.get('type');
        if (typeParam && allowedDocTypes.includes(typeParam as DocumentType)) {
          targetDocType = typeParam as DocumentType;
        }
      } catch {
        // ignore invalid URL
      }
    }
    if (targetDocType && targetDocType !== documentType) {
      performDocumentTypeChange(targetDocType);
    } else {
      resetFormForNewInvoice();
    }
    setShowNavigationWarning(false);
    const target = pendingNavigation;
    setPendingNavigation(null);
    if (target) {
      router.push(target);
    } else {
      router.back();
    }
  }, [pendingNavigation, documentType, performDocumentTypeChange, resetFormForNewInvoice, router]);

  const tryBlockNavigation = useCallback((targetUrl: string | null = null) => {
    if (isDirty && !savedInvoiceId) {
      setPendingNavigation(targetUrl);
      setShowNavigationWarning(true);
      return false;
    }
    return true;
  }, [isDirty, savedInvoiceId]);

  const handleComposerBack = useCallback(() => {
    if (!tryBlockNavigation(null)) return;
    router.back();
  }, [tryBlockNavigation, router]);

  // Early returns
  if (!canCreate) return <AccessDenied module="invoices" action="create" details={reason} code="INVOICE_CREATE_DENIED" />;

  // Helper functions
  const updateRow = (index: number, field: keyof InvoiceItemRow, value: any) => {
    const nr = [...rows];
    const pricePatch = field === 'price' ? { priceUserOverride: true as const } : {};
    nr[index] = { ...nr[index], [field]: value, ...pricePatch };
    if (['quantity', 'price', 'discountPercent', 'taxPercent'].includes(field)) nr[index] = calculateRow(nr[index], false);
    else if (field === 'discountAmount') nr[index] = calculateRow(nr[index], true);
    setRows(nr);
  };

  const isEditMode = !!searchParams.get('edit');

  const renderDesktopForm = () => (
    <div className="space-y-4">
      {isInvoiceLocked && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5"><svg className="w-5 h-5 text-amber-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg></div>
          <div className="flex-1"><h3 className="text-sm font-semibold text-amber-900 mb-1">Invoice Locked</h3><p className="text-sm text-amber-700">{lockReason || 'This invoice is locked and cannot be edited because it was included in a GSTR-1 filing.'}</p></div>
        </div>
      )}
      {!posMode && (
        <div className="bg-surface rounded-lg border border-border p-3 lg:p-4 shadow-sm">
          <div className="flex flex-wrap gap-x-3 gap-y-3 items-end min-w-0">
            <CustomerSection 
              customers={customers} 
              customerId={customerId} 
              onCustomerChange={setCustomerId} 
              onCustomerSelect={(c) => { 
                if (c) {
                  setBillingAddress(c.billing_address || c.address || ''); 
                  setShippingAddress(c.shipping_address || c.address || ''); 
                }
              }} 
              onAddNewCustomer={() => setCreateCustomerModalOpen(true)}
              placeOfSupply={placeOfSupply} 
              onPlaceOfSupplyChange={(v) => { setPlaceOfSupply(v); setRows(prev => prev.map(r => calculateRow(r, true))); }} 
              isFinal={isFinal} 
              isExport={isExport} 
              isInvoiceLocked={isInvoiceLocked} 
              indianStates={INDIAN_STATES} 
            />
            {warehouses && warehouses.length > 0 && (
              <div className="w-[160px] lg:w-[200px] min-w-0">
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-secondary">Warehouse</label>
                <select 
                  value={selectedWarehouseId} 
                  onChange={(e) => setSelectedWarehouseId(e.target.value)}
                  disabled={isFinal || isInvoiceLocked || warehousesLoading}
                  className="input w-full !px-3 !py-2 !text-sm"
                >
                  {warehousesLoading ? (
                    <option>Loading...</option>
                  ) : (
                    <>
                      {(!warehouses || warehouses.length === 0) && <option value="">No warehouses</option>}
                      {warehouses && warehouses.map((wh) => (
                        <option key={wh.id} value={wh.id}>
                          {wh.name}{wh.warehouse_code ? ` (${wh.warehouse_code})` : ''}
                          {wh.is_primary ? ' ⭐' : ''}
                        </option>
                      ))}
                    </>
                  )}
                </select>
                {warehouses.length > 1 && (
                  <p className="text-xs text-text-muted mt-1">
                    ⭐ = Primary warehouse for this branch
                  </p>
                )}
              </div>
            )}
          {currentBranchId && warehousesEnabled && (!warehouses || warehouses.length === 0) && !warehousesLoading && (
            <div className="w-full col-span-full">
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-2">
                <svg className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-yellow-800">No warehouses linked to this branch</p>
                  <p className="text-xs text-yellow-700 mt-1">
                    Please link warehouses to this branch in Settings → Warehouses, or stock tracking won't apply to these items.
                  </p>
                </div>
              </div>
            </div>
          )}
          <div className="w-[138px] lg:w-[160px] min-w-0">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-secondary">Date</label>
            <Input
              type="date"
              value={invoiceDate}
              onChange={e => setInvoiceDate(e.target.value)}
              disabled={isFinal || isInvoiceLocked}
              className="!px-3 !py-2 !text-sm"
            />
          </div>
          <div className="w-[138px] lg:w-[160px] min-w-0">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-secondary">Due Date</label>
            <Input
              type="date"
              value={dueDate}
              onChange={e => { dueDateUserEditedRef.current = true; setDueDate(e.target.value); }}
              disabled={isFinal || isInvoiceLocked}
              className="!px-3 !py-2 !text-sm"
              placeholder="Optional"
            />
          </div>
          {invoiceCustomFieldDefs.length > 0 && !isFinal && (
            <div className="w-full col-span-full pt-2 border-t border-border mt-2">
              <p className="text-xs font-semibold uppercase text-text-secondary mb-2">Custom invoice fields</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <CustomFieldValuesForm
                  definitions={invoiceCustomFieldDefs}
                  values={invoiceCustomFieldValues}
                  onChange={setInvoiceCustomFieldValues}
                  disabled={isFinal}
                />
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-[92px] lg:w-[120px] min-w-0">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-secondary">Prefix</label>
              <Input value={invoicePrefix ?? ''} readOnly className="cursor-default !px-3 !py-2 !text-sm text-center" />
            </div>
            <div className="w-[84px] lg:w-[96px] min-w-0">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-secondary">No.</label>
              <Input value={invoiceNumber ?? ''} readOnly className="cursor-default !px-3 !py-2 !text-sm text-center" />
            </div>
          </div>
          {!isFinal && (
            <label className="flex h-9 lg:h-11 cursor-pointer select-none items-center gap-2">
              <input type="checkbox" checked={isExport} onChange={e => { setIsExport(e.target.checked); setRows(prev => prev.map(r => calculateRow(r, true))); if (!e.target.checked) { setPortCode(''); setShippingBillNumber(''); setShippingBillDate(''); } }} className="h-4 w-4 rounded border-border bg-surface text-primary-600 focus:ring-primary-500 dark:border-slate-500" disabled={isFinal || isInvoiceLocked} />
              <span className="text-[11px] lg:text-xs font-semibold uppercase tracking-wide text-text-secondary whitespace-nowrap">{documentType === 'bill_of_supply' ? 'Export' : 'Export invoice'}</span>
            </label>
          )}
          </div>
        </div>
      )}
      {(business as any)?.gst_registration_type === 'composition' && (<div className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded-r-lg shadow-sm"><div className="flex"><div className="flex-shrink-0"><svg className="h-5 w-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg></div><div className="ml-3"><p className="text-sm font-medium text-amber-800">Composition Taxable Person - Not Eligible to Collect Tax on Supplies</p><p className="text-xs text-amber-700 mt-1">As per Section 10 of CGST Act, you are registered under the Composition Scheme. All documents will be issued as Bill of Supply without GST charges.</p></div></div></div>)}
      {/* PHASE 6: Credit Warning Banner */}
      {customerId && selectedCustomer && creditMetrics && creditMetrics.current && (
        <CreditWarningBanner
          metrics={creditMetrics.current}
          projectedMetrics={creditMetrics.projected}
          partyType="customer"
          partyName={selectedCustomer.name}
        />
      )}
      {!posMode && selectedCustomer && (
        <div className="bg-surface rounded-lg border border-border px-4 py-3 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            <div>
              <label className="text-xs font-medium mb-1 block text-text-secondary uppercase tracking-wide">Bill To</label>
              <textarea
                className="w-full min-h-[80px] h-[100px] px-2 py-1.5 text-sm border border-gray-200 rounded-md resize-none bg-background text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-gray-300"
                value={billingAddress}
                onChange={(e) => setBillingAddress(e.target.value)}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = `${el.scrollHeight}px`;
                }}
                placeholder="Billing Address"
                disabled={isFinal}
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block text-text-secondary uppercase tracking-wide">Ship To</label>
              <textarea
                className="w-full min-h-[80px] h-[100px] px-2 py-1.5 text-sm border border-gray-200 rounded-md resize-none bg-background text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-gray-300"
                value={shippingAddress}
                onChange={(e) => setShippingAddress(e.target.value)}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = `${el.scrollHeight}px`;
                }}
                placeholder="Shipping Address"
                disabled={isFinal}
              />
            </div>
          </div>
        </div>
      )}
      {!posMode && !isFinal && (
        <div className="bg-transparent rounded-lg border border-transparent">
          <button type="button" onClick={() => setShowAdditionalInfo(!showAdditionalInfo)} className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-50 dark:hover:bg-slate-800/80 rounded-lg transition-colors"><h3 className="text-sm font-semibold text-text-primary">Additional Information</h3><ChevronDown className={`w-5 h-5 text-text-muted transition-transform ${showAdditionalInfo ? 'transform rotate-180' : ''}`} /></button>
          {showAdditionalInfo && (
            <div className="mt-2 p-4 bg-surface rounded-lg border border-border shadow-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div><label className="block text-xs font-semibold uppercase text-text-secondary mb-1">E-way Bill Number <span className="text-red-500">*</span></label><Input type="text" value={ewayBillNumber} onChange={(e) => setEwayBillNumber(e.target.value)} placeholder="E-way bill number" disabled={isFinal} className={!ewayBillNumber ? 'border-red-500' : ''} /></div>
                <div><label className="block text-xs font-semibold uppercase text-text-secondary mb-1">E-way Bill Date <span className="text-red-500">*</span></label><Input type="date" value={ewayBillDate} onChange={(e) => setEwayBillDate(e.target.value)} disabled={isFinal} className={!ewayBillDate ? 'border-red-500' : ''} /></div>
                <div><label className="block text-xs font-semibold uppercase text-text-secondary mb-1">Purchase Order Number</label><Input type="text" value={purchaseOrderNumber} onChange={(e) => setPurchaseOrderNumber(e.target.value)} placeholder="PO number" disabled={isFinal} /></div>
                <div><label className="block text-xs font-semibold uppercase text-text-secondary mb-1">Purchase Order Date</label><Input type="date" value={purchaseOrderDate} onChange={(e) => setPurchaseOrderDate(e.target.value)} disabled={isFinal} /></div>
                <div><label className="block text-xs font-semibold uppercase text-text-secondary mb-1">Reference Number</label><Input type="text" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="Reference number" disabled={isFinal} /></div>
                <div><label className="block text-xs font-semibold uppercase text-text-secondary mb-1">Delivery Note</label><Input type="text" value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} placeholder="Delivery note number" disabled={isFinal} /></div>
                <div><label className="block text-xs font-semibold uppercase text-text-secondary mb-1">Mode/Terms of Payment</label><Input type="text" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="Payment terms" disabled={isFinal} /></div>
                <div><label className="block text-xs font-semibold uppercase text-text-secondary mb-1">Other References</label><Input type="text" value={otherReferences} onChange={(e) => setOtherReferences(e.target.value)} placeholder="Other references" disabled={isFinal} /></div>
                <div><label className="block text-xs font-semibold uppercase text-text-secondary mb-1">Dispatched through</label><Input type="text" value={dispatchedThrough} onChange={(e) => setDispatchedThrough(e.target.value)} placeholder="Dispatched through" disabled={isFinal} /></div>
                <div><label className="block text-xs font-semibold uppercase text-text-secondary mb-1">Destination</label><Input type="text" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Destination" disabled={isFinal} /></div>
                <div><label className="block text-xs font-semibold uppercase text-text-secondary mb-1">Terms of Delivery</label><textarea value={termsOfDelivery} onChange={(e) => setTermsOfDelivery(e.target.value)} placeholder="Terms of delivery" disabled={isFinal} className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent" rows={2} /></div>
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <label className="block text-xs font-semibold uppercase text-text-secondary mb-2">Attachments</label>
                <div className="space-y-2">
                  {attachments.length > 0 && (<div className="space-y-2">{attachments.map((f) => (<div key={f.id} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-slate-800/80 rounded border border-border"><div className="flex items-center gap-2 flex-1 min-w-0"><span className="text-sm text-text-primary truncate">{f.name}</span>{f.size && <span className="text-xs text-text-muted">({(f.size/1024).toFixed(1)} KB)</span>}</div><div className="flex items-center gap-2"><a href={f.url} target="_blank" rel="noopener noreferrer" className="text-primary-600 dark:text-sky-400 hover:text-primary-700 dark:hover:text-sky-300 text-sm">View</a><button type="button" onClick={() => setAttachments(attachments.filter(x => x.id !== f.id))} className="text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm" disabled={isFinal}>Remove</button></div></div>))}</div>)}
                  <label className="flex items-center gap-2 px-4 py-2 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary-500 transition-colors">
                    <input type="file" multiple onChange={async (e) => {
                      const files = Array.from(e.target.files || []); if (!files.length) return; setUploadingFiles(true);
                      try { const fd = new FormData(); files.forEach(f => fd.append('files', f)); fd.append('business_id', business?.id || ''); fd.append('document_type', 'invoice'); const res = await fetch('/api/upload/attachments', { method: 'POST', body: fd }); if (res.ok) { const data = await res.json(); setAttachments([...attachments, ...data.files.map((f: any) => ({ id: f.id || Math.random().toString(), name: f.file_name, url: f.file_path, size: f.file_size }))]); } else toastCtx.error('Upload failed'); } catch (err) { console.error(err); toastCtx.error('Upload failed'); } finally { setUploadingFiles(false); e.target.value = ''; }
                    }} className="hidden" disabled={isFinal || uploadingFiles} />
                    {uploadingFiles ? <span className="text-sm text-text-muted">Uploading...</span> : <><Plus className="w-4 h-4 text-text-muted" /><span className="text-sm text-text-secondary">Upload Attachments</span></>}
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {!posMode && isExport && !isFinal && (
          <div className="bg-slate-50 dark:bg-primary-900/35 rounded-lg border border-primary-200 dark:border-primary-800 p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-primary-900 dark:text-primary-100 mb-3">{documentType === 'bill_of_supply' ? 'Export details' : 'Export invoice details'}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div><label className="text-xs font-semibold uppercase text-primary-700 dark:text-primary-200">Export Type</label><select className="input w-full mt-1 border px-3 py-2 rounded" value={exportType} onChange={e => { setExportType(e.target.value as 'wp' | 'wop'); setRows(prev => prev.map(r => calculateRow(r, true))); }}><option value="wop">Without Payment (WOP)</option><option value="wp">With Payment (WP)</option></select></div>
                  <div><label className="text-xs font-semibold uppercase text-primary-700 dark:text-primary-200">Port Code</label><Input type="text" value={portCode} onChange={e => setPortCode(e.target.value)} placeholder="e.g., INNSA1" /></div>
                  <div><label className="text-xs font-semibold uppercase text-primary-700 dark:text-primary-200">Shipping Bill No.</label><Input type="text" value={shippingBillNumber} onChange={e => setShippingBillNumber(e.target.value)} placeholder="Shipping bill number" /></div>
                  <div><label className="text-xs font-semibold uppercase text-primary-700 dark:text-primary-200">Shipping Bill Date</label><Input type="date" value={shippingBillDate} onChange={e => setShippingBillDate(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
                  <div><label className="text-xs font-semibold uppercase text-primary-700 dark:text-primary-200">Invoice Currency *</label><select className="input w-full mt-1 border px-3 py-2 rounded" value={invoiceCurrency} onChange={e => setInvoiceCurrency(e.target.value)}><option value="INR">INR - Indian Rupee</option><option value="USD">USD - US Dollar</option><option value="EUR">EUR - Euro</option><option value="GBP">GBP - British Pound</option><option value="AED">AED - UAE Dirham</option><option value="SGD">SGD - Singapore Dollar</option></select></div>
                  {invoiceCurrency !== 'INR' && (<div><label className="text-xs font-semibold uppercase text-primary-700 dark:text-primary-200">Exchange Rate</label><Input type="number" step="0.0001" value={exchangeRate} onChange={e => setExchangeRate(e.target.value ? parseFloat(e.target.value) : '')} placeholder="e.g., 83.25" /></div>)}
                  <div><label className="text-xs font-semibold uppercase text-primary-700 dark:text-primary-200">Country of Origin</label><Input type="text" value={countryOfOrigin} onChange={e => setCountryOfOrigin(e.target.value)} placeholder="India" /></div>
                  <div><label className="text-xs font-semibold uppercase text-primary-700 dark:text-primary-200">Port of Loading</label><Input type="text" value={portOfLoading} onChange={e => setPortOfLoading(e.target.value)} placeholder="Mumbai Port" /></div>
                  <div><label className="text-xs font-semibold uppercase text-primary-700 dark:text-primary-200">Port of Discharge</label><Input type="text" value={portOfDischarge} onChange={e => setPortOfDischarge(e.target.value)} placeholder="New York Port" /></div>
                  <div><label className="text-xs font-semibold uppercase text-primary-700 dark:text-primary-200">Place of Delivery</label><Input type="text" value={placeOfDelivery} onChange={e => setPlaceOfDelivery(e.target.value)} placeholder="Final delivery location" /></div>
                  <div><label className="text-xs font-semibold uppercase text-primary-700 dark:text-primary-200">Incoterms</label><select className="input w-full mt-1 border px-3 py-2 rounded" value={incoterms} onChange={e => setIncoterms(e.target.value)}><option value="">Select Incoterms</option><option value="EXW">EXW - Ex Works</option><option value="FOB">FOB - Free On Board</option><option value="CIF">CIF - Cost, Insurance & Freight</option><option value="CFR">CFR - Cost and Freight</option><option value="DDP">DDP - Delivered Duty Paid</option><option value="FCA">FCA - Free Carrier</option></select></div>
                  <div><label className="text-xs font-semibold uppercase text-primary-700 dark:text-primary-200">Transport Mode</label><select className="input w-full mt-1 border px-3 py-2 rounded" value={transportMode} onChange={e => setTransportMode(e.target.value)}><option value="">Select Mode</option><option value="Air">Air</option><option value="Sea">Sea</option><option value="Road">Road</option><option value="Courier">Courier</option></select></div>
                  <div><label className="text-xs font-semibold uppercase text-primary-700 dark:text-primary-200">AWB Number (Air)</label><Input type="text" value={awbNumber} onChange={e => setAwbNumber(e.target.value)} placeholder="Air Waybill" /></div>
                  <div><label className="text-xs font-semibold uppercase text-primary-700 dark:text-primary-200">BL Number (Sea)</label><Input type="text" value={blNumber} onChange={e => setBlNumber(e.target.value)} placeholder="Bill of Lading" /></div>
                  <div><label className="text-xs font-semibold uppercase text-primary-700 dark:text-primary-200">Buyer Tax/VAT ID</label><Input type="text" value={buyerTaxId} onChange={e => setBuyerTaxId(e.target.value)} placeholder="Tax ID" /></div>
              </div>
              {exportType === 'wop' && (<div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-900 rounded"><p className="text-xs text-yellow-800 dark:text-yellow-200"><strong>LUT Export:</strong> This invoice is for export under LUT without payment of IGST. IGST at 0%.</p></div>)}
          </div>
      )}
      <ItemsTable rows={rows} onUpdateRow={updateRow} onItemSelect={handleItemSelect} onAddRow={() => setRows([...rows, { itemId: '', name: '', quantity: 1, freeQty: 0, unit: 'PCS', price: 0, discountPercent: 0, discountAmount: 0, taxPercent: 0, taxAmount: 0, hsnSac: '', taxableValue: 0, cgstAmount: 0, sgstAmount: 0, igstAmount: 0, total: 0 }])} onRemoveRow={(idx) => setRows(rows.filter((_, i) => i !== idx))} isFinal={isFinal} documentType={documentType} itemInputRefs={itemInputRefs.current} onAddNewItem={() => setCreateItemModalOpen(true)} posMode={posMode} subtotal={subtotal} totalTax={totalTax} grandTotal={grandTotal} warehouseId={selectedWarehouseId} />
      {!posMode && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1 bg-surface rounded-lg border border-border p-4 shadow-sm"><label className="block text-xs font-semibold uppercase text-text-secondary mb-2">Notes / Terms</label><textarea placeholder="Add notes or terms..." className="w-full h-24 rounded border border-border bg-background p-2 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:ring-2 focus:ring-primary-500" value={notes} onChange={e => setNotes(e.target.value)} disabled={isFinal} /></div>
          <TotalsPanel itemSubtotal={itemSubtotal} totalDiscount={totalDiscount} subtotal={subtotal} totalExtraCharges={totalExtraCharges} taxableAmount={taxableAmount} totalCGST={totalCGST} totalSGST={totalSGST} totalIGST={totalIGST} grandTotal={grandTotal} totalPaid={totalPaid} balance={balance} recordPayment={recordPayment} roundOff={roundOff} enableRoundOff={enableRoundOff} onEnableRoundOffChange={setEnableRoundOff} extraCharges={extraCharges} onExtraChargesChange={setExtraCharges} onAddExtraCharge={() => setExtraCharges([...extraCharges, { id: Date.now().toString(), purpose: '', amount: 0 }])} onPaymentClick={() => setPaymentModalOpen(true)} isFinal={isFinal} documentType={documentType} isExport={isExport} isIntraState={isIntraState} />
          <ActionsBar
            onPreview={handlePreview}
            onSaveDraft={() => handleSave('draft')}
            onSaveFinal={() => handleSave('final')}
            onShare={() => setShareModalOpen(true)}
            previewLoading={previewLoading}
            saving={loading}
            isFinal={isFinal}
            isOnline={true}
            savedInvoiceId={savedInvoiceId}
            invoicePrefix={invoicePrefix}
            invoiceNumber={invoiceNumber}
            credit={
              creditMetrics?.current
                ? {
                    availableCredit: creditMetrics.current.available_credit,
                    creditLimit: creditMetrics.current.credit_limit,
                  }
                : null
            }
          />
        </div>
      )}

    </div>
  );

  const renderMobileComposer = () => (
    <div className="relative pb-44">
      <div className="space-y-3">
        {isInvoiceLocked && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5"><svg className="w-5 h-5 text-amber-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg></div>
            <div className="flex-1"><h3 className="text-sm font-semibold text-amber-900 mb-1">Invoice Locked</h3><p className="text-sm text-amber-700">{lockReason || 'This invoice is locked and cannot be edited because it was included in a GSTR-1 filing.'}</p></div>
          </div>
        )}
        <Card padding="sm" className="space-y-3 border-border">
          <h2 className="border-b border-border pb-1.5 text-[11px] font-bold uppercase tracking-wider text-text-primary">Bill details</h2>
          <div className="space-y-3">
            <div className="space-y-0.5 border-b border-border pb-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Customer</div>
              <CustomerAutocomplete
                compact
                customers={customers}
                value={customerId}
                onChange={setCustomerId}
                onSelect={(c) => {
                  if (c) {
                    setBillingAddress(c.billing_address || c.address || '');
                    setShippingAddress(c.shipping_address || c.address || '');
                  }
                }}
                disabled={isFinal}
                onAddNew={() => setCreateCustomerModalOpen(true)}
              />
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-b border-border pb-2">
              <div className="min-w-0 space-y-0.5">
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Invoice date</label>
                <Input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  disabled={isFinal || isInvoiceLocked}
                  className="h-9 min-h-0 border-0 border-b border-border rounded-none bg-transparent px-0 py-1 text-[14px] shadow-none focus-visible:ring-2 focus-visible:ring-primary-500"
                />
              </div>
              <div className="min-w-0 space-y-0.5">
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                  Due date <span className="text-text-muted normal-case font-normal">(optional)</span>
                </label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => {
                    dueDateUserEditedRef.current = true;
                    setDueDate(e.target.value);
                  }}
                  disabled={isFinal || isInvoiceLocked}
                  className="h-9 min-h-0 border-0 border-b border-border rounded-none bg-transparent px-0 py-1 text-[14px] shadow-none focus-visible:ring-2 focus-visible:ring-primary-500"
                />
              </div>
            </div>
            <div className="space-y-0.5 border-b border-border pb-2">
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Place of supply</label>
              <select
                className="input h-9 w-full min-h-0 cursor-pointer border-0 border-b border-border rounded-none bg-transparent px-0 py-1 text-[14px] text-text-primary shadow-none focus-visible:ring-2 focus-visible:ring-primary-500"
                value={placeOfSupply}
                onChange={(e) => {
                  setPlaceOfSupply(e.target.value);
                  setRows((prev) => prev.map((r) => calculateRow(r, true)));
                }}
                disabled={isFinal || isExport}
              >
                <option value="">State</option>
                {INDIAN_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-b border-border pb-2">
              <div className="min-w-0 space-y-0.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Prefix</div>
                <Input
                  value={invoicePrefix ?? ''}
                  readOnly
                  className="h-9 border-0 border-b border-border rounded-none bg-transparent px-0 py-1 text-[14px] font-semibold"
                />
              </div>
              <div className="min-w-0 space-y-0.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Number</div>
                <Input
                  value={invoiceNumber ?? ''}
                  readOnly
                  className="h-9 border-0 border-b border-border rounded-none bg-transparent px-0 py-1 text-[14px] font-semibold"
                />
              </div>
            </div>
            {documentType === 'proforma_invoice' && !isFinal && (
              <div className="space-y-0.5 border-b border-border pb-2">
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                  Estimate valid until
                </label>
                <Input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="h-9 border-0 border-b border-border rounded-none bg-transparent px-0 py-1 text-[14px]"
                />
              </div>
            )}
            {warehouses && warehouses.length > 0 && (
              <div className="space-y-0.5 border-b border-border pb-2">
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Warehouse</label>
                <select
                  value={selectedWarehouseId}
                  onChange={(e) => setSelectedWarehouseId(e.target.value)}
                  disabled={isFinal || isInvoiceLocked || warehousesLoading}
                  className="input h-9 w-full min-h-0 cursor-pointer border-0 border-b border-border rounded-none bg-transparent px-0 py-1 text-[14px] shadow-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  {warehousesLoading ? (
                    <option>Loading...</option>
                  ) : (
                    warehouses.map((wh) => (
                      <option key={wh.id} value={wh.id}>
                        {wh.name}
                        {wh.warehouse_code ? ` (${wh.warehouse_code})` : ''}
                        {wh.is_primary ? ' ⭐' : ''}
                      </option>
                    ))
                  )}
                </select>
              </div>
            )}
            {currentBranchId && warehousesEnabled && (!warehouses || warehouses.length === 0) && !warehousesLoading && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                No warehouses linked to this branch. Stock may not apply.
              </div>
            )}
            {!isFinal && (
              <label className="flex cursor-pointer items-center gap-2 py-0.5 select-none">
                <input
                  type="checkbox"
                  checked={isExport}
                  onChange={(e) => {
                    setIsExport(e.target.checked);
                    setRows((prev) => prev.map((r) => calculateRow(r, true)));
                    if (!e.target.checked) {
                      setPortCode('');
                      setShippingBillNumber('');
                      setShippingBillDate('');
                    }
                  }}
                  className="h-4 w-4 rounded border-border bg-surface text-primary-600 focus:ring-primary-500 dark:border-slate-500"
                  disabled={isFinal || isInvoiceLocked}
                />
                <span className="text-xs font-medium text-text-primary">
                  {documentType === 'bill_of_supply' ? 'Export' : 'Export invoice'}
                </span>
              </label>
            )}
          </div>
        </Card>
        {(business as any)?.gst_registration_type === 'composition' && (
          <div className="bg-amber-50 border-l-4 border-amber-400 p-3 rounded-r-lg text-sm text-amber-800">Composition scheme: documents are Bill of Supply without GST on supplies.</div>
        )}
        {customerId && selectedCustomer && creditMetrics?.current && (
          <CreditWarningBanner metrics={creditMetrics.current} projectedMetrics={creditMetrics.projected} partyType="customer" partyName={selectedCustomer.name} />
        )}
        {selectedCustomer && (
          <Card padding="sm" className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-primary">Addresses</h3>
            <div>
              <label className="mb-0.5 block text-[10px] font-semibold uppercase text-text-secondary">Bill To</label>
              <textarea className="min-h-[68px] w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-muted" value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} disabled={isFinal} />
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] font-semibold uppercase text-text-secondary">Ship To</label>
              <textarea className="min-h-[68px] w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-muted" value={shippingAddress} onChange={(e) => setShippingAddress(e.target.value)} disabled={isFinal} />
            </div>
          </Card>
        )}
        {!isFinal && (
          <div className="rounded-lg border border-border bg-surface">
            <button type="button" onClick={() => setShowAdditionalInfo(!showAdditionalInfo)} className="w-full flex items-center justify-between p-3 text-left"><h3 className="text-sm font-semibold text-text-primary">More details</h3><ChevronDown className={`w-5 h-5 text-text-muted transition-transform ${showAdditionalInfo ? 'rotate-180' : ''}`} /></button>
            {showAdditionalInfo && (
              <div className="px-3 pb-3 pt-0 space-y-3 border-t border-border">
                <div className="grid grid-cols-1 gap-3 pt-3">
                  <div><label className="text-xs font-semibold uppercase text-text-secondary mb-1 block">E-way Bill Number</label><Input type="text" value={ewayBillNumber} onChange={(e) => setEwayBillNumber(e.target.value)} disabled={isFinal} /></div>
                  <div><label className="text-xs font-semibold uppercase text-text-secondary mb-1 block">E-way Bill Date</label><Input type="date" value={ewayBillDate} onChange={(e) => setEwayBillDate(e.target.value)} disabled={isFinal} /></div>
                  <div><label className="text-xs font-semibold uppercase text-text-secondary mb-1 block">Purchase Order Number</label><Input type="text" value={purchaseOrderNumber} onChange={(e) => setPurchaseOrderNumber(e.target.value)} disabled={isFinal} /></div>
                  <div><label className="text-xs font-semibold uppercase text-text-secondary mb-1 block">Purchase Order Date</label><Input type="date" value={purchaseOrderDate} onChange={(e) => setPurchaseOrderDate(e.target.value)} disabled={isFinal} /></div>
                  <div><label className="text-xs font-semibold uppercase text-text-secondary mb-1 block">Reference Number</label><Input type="text" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} disabled={isFinal} /></div>
                  <div><label className="text-xs font-semibold uppercase text-text-secondary mb-1 block">Delivery Note</label><Input type="text" value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} disabled={isFinal} /></div>
                  <div><label className="text-xs font-semibold uppercase text-text-secondary mb-1 block">Mode/Terms of Payment</label><Input type="text" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} disabled={isFinal} /></div>
                  <div><label className="text-xs font-semibold uppercase text-text-secondary mb-1 block">Other References</label><Input type="text" value={otherReferences} onChange={(e) => setOtherReferences(e.target.value)} disabled={isFinal} /></div>
                  <div><label className="text-xs font-semibold uppercase text-text-secondary mb-1 block">Dispatched through</label><Input type="text" value={dispatchedThrough} onChange={(e) => setDispatchedThrough(e.target.value)} disabled={isFinal} /></div>
                  <div><label className="text-xs font-semibold uppercase text-text-secondary mb-1 block">Destination</label><Input type="text" value={destination} onChange={(e) => setDestination(e.target.value)} disabled={isFinal} /></div>
                  <div><label className="text-xs font-semibold uppercase text-text-secondary mb-1 block">Terms of Delivery</label><textarea value={termsOfDelivery} onChange={(e) => setTermsOfDelivery(e.target.value)} disabled={isFinal} className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background text-text-primary" rows={2} /></div>
                </div>
                <div className="pt-2 border-t border-border">
                  <label className="text-xs font-semibold uppercase text-text-secondary mb-2 block">Attachments</label>
                  <div className="space-y-2">
                    {attachments.map((f) => (
                      <div key={f.id} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-slate-800/80 rounded border border-border text-sm">
                        <span className="truncate">{f.name}</span>
                        <button type="button" className="text-red-500" onClick={() => setAttachments(attachments.filter(x => x.id !== f.id))} disabled={isFinal}>Remove</button>
                      </div>
                    ))}
                    <label className="flex items-center gap-2 px-3 py-2 border-2 border-dashed rounded-lg cursor-pointer">
                      <input type="file" multiple onChange={async (e) => {
                        const files = Array.from(e.target.files || []); if (!files.length) return; setUploadingFiles(true);
                        try { const fd = new FormData(); files.forEach(f => fd.append('files', f)); fd.append('business_id', business?.id || ''); fd.append('document_type', 'invoice'); const res = await fetch('/api/upload/attachments', { method: 'POST', body: fd }); if (res.ok) { const data = await res.json(); setAttachments([...attachments, ...data.files.map((f: any) => ({ id: f.id || Math.random().toString(), name: f.file_name, url: f.file_path, size: f.file_size }))]); } else toastCtx.error('Upload failed'); } catch (err) { console.error(err); toastCtx.error('Upload failed'); } finally { setUploadingFiles(false); e.target.value = ''; }
                      }} className="hidden" disabled={isFinal || uploadingFiles} />
                      {uploadingFiles ? 'Uploading...' : 'Upload attachments'}
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {!isFinal && isExport && (
          <Card padding="md" className="bg-slate-50 dark:bg-primary-900/35 border-primary-200 dark:border-primary-800 space-y-3">
            <h3 className="text-sm font-semibold text-primary-900 dark:text-primary-100">Export details</h3>
            <div className="grid grid-cols-1 gap-2">
              <div><label className="text-xs text-primary-800 dark:text-primary-200">Export type</label><select className="input w-full mt-0.5 border rounded px-2 py-1.5 text-sm" value={exportType} onChange={e => { setExportType(e.target.value as 'wp' | 'wop'); setRows(prev => prev.map(r => calculateRow(r, true))); }}><option value="wop">Without Payment (WOP)</option><option value="wp">With Payment (WP)</option></select></div>
              <div><label className="text-xs text-primary-800 dark:text-primary-200">Port code</label><Input value={portCode} onChange={e => setPortCode(e.target.value)} /></div>
              <div><label className="text-xs text-primary-800 dark:text-primary-200">Shipping bill no.</label><Input value={shippingBillNumber} onChange={e => setShippingBillNumber(e.target.value)} /></div>
              <div><label className="text-xs text-primary-800 dark:text-primary-200">Shipping bill date</label><Input type="date" value={shippingBillDate} onChange={e => setShippingBillDate(e.target.value)} /></div>
              <div><label className="text-xs text-primary-800 dark:text-primary-200">Invoice currency</label><select className="input w-full border rounded px-2 py-1.5 text-sm" value={invoiceCurrency} onChange={e => setInvoiceCurrency(e.target.value)}><option value="INR">INR</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option><option value="AED">AED</option><option value="SGD">SGD</option></select></div>
              {invoiceCurrency !== 'INR' && <div><label className="text-xs text-primary-800 dark:text-primary-200">Exchange rate</label><Input type="number" step="0.0001" value={exchangeRate} onChange={e => setExchangeRate(e.target.value ? parseFloat(e.target.value) : '')} /></div>}
              <div><label className="text-xs text-primary-800 dark:text-primary-200">Country of origin</label><Input value={countryOfOrigin} onChange={e => setCountryOfOrigin(e.target.value)} /></div>
              <div><label className="text-xs text-primary-800 dark:text-primary-200">Port of loading</label><Input value={portOfLoading} onChange={e => setPortOfLoading(e.target.value)} /></div>
              <div><label className="text-xs text-primary-800 dark:text-primary-200">Port of discharge</label><Input value={portOfDischarge} onChange={e => setPortOfDischarge(e.target.value)} /></div>
              <div><label className="text-xs text-primary-800 dark:text-primary-200">Place of delivery</label><Input value={placeOfDelivery} onChange={e => setPlaceOfDelivery(e.target.value)} /></div>
              <div><label className="text-xs text-primary-800 dark:text-primary-200">Incoterms</label><select className="input w-full border rounded px-2 py-1.5 text-sm" value={incoterms} onChange={e => setIncoterms(e.target.value)}><option value="">Select</option><option value="EXW">EXW</option><option value="FOB">FOB</option><option value="CIF">CIF</option><option value="CFR">CFR</option><option value="DDP">DDP</option><option value="FCA">FCA</option></select></div>
              <div><label className="text-xs text-primary-800 dark:text-primary-200">Transport mode</label><select className="input w-full border rounded px-2 py-1.5 text-sm" value={transportMode} onChange={e => setTransportMode(e.target.value)}><option value="">Select</option><option value="Air">Air</option><option value="Sea">Sea</option><option value="Road">Road</option><option value="Courier">Courier</option></select></div>
              <div><label className="text-xs text-primary-800 dark:text-primary-200">AWB number</label><Input value={awbNumber} onChange={e => setAwbNumber(e.target.value)} /></div>
              <div><label className="text-xs text-primary-800 dark:text-primary-200">BL number</label><Input value={blNumber} onChange={e => setBlNumber(e.target.value)} /></div>
              <div><label className="text-xs text-primary-800 dark:text-primary-200">Buyer tax / VAT ID</label><Input value={buyerTaxId} onChange={e => setBuyerTaxId(e.target.value)} /></div>
            </div>
          </Card>
        )}
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold text-text-primary">Items</h2>
          <div className="flex gap-2">
            {!isFinal && (
              <>
                <Button type="button" variant="secondary" size="sm" onClick={() => setShowMobileItemPicker(true)} className="flex items-center gap-1"><Search className="w-4 h-4" /> Search</Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setShowContinuousScanner(true)} className="flex items-center gap-1"><ScanLine className="w-4 h-4" /> Scan</Button>
              </>
            )}
          </div>
        </div>
        <ItemsTable
          rows={rows}
          onUpdateRow={updateRow}
          onItemSelect={handleItemSelect}
          onAddRow={() => setShowMobileItemPicker(true)}
          onRemoveRow={(idx) => setRows(rows.filter((_, i) => i !== idx))}
          isFinal={isFinal}
          documentType={documentType}
          itemInputRefs={itemInputRefs.current}
          onAddNewItem={() => setCreateItemModalOpen(true)}
          posMode={false}
          subtotal={subtotal}
          totalTax={totalTax}
          grandTotal={grandTotal}
          warehouseId={selectedWarehouseId}
          layout="compact"
          recalculateRow={calculateRow}
          onReplaceRow={(idx, row) => setRows((prev) => { const next = [...prev]; next[idx] = row; return next; })}
        />
        <Card padding="md">
          <label className="text-xs font-semibold uppercase text-text-secondary mb-2 block">Notes / Terms</label>
          <textarea placeholder="Add notes or terms..." className="w-full h-24 rounded border border-border bg-background p-2 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:ring-2 focus:ring-primary-500" value={notes} onChange={e => setNotes(e.target.value)} disabled={isFinal} />
        </Card>
        <div className="rounded-lg border border-border">
          <button type="button" onClick={() => setMobileAdjustmentsOpen(!mobileAdjustmentsOpen)} className="w-full flex items-center justify-between p-3 text-left bg-surface rounded-t-lg"><span className="text-sm font-semibold">Adjustments & taxes</span><ChevronDown className={`w-5 h-5 transition-transform ${mobileAdjustmentsOpen ? 'rotate-180' : ''}`} /></button>
          {mobileAdjustmentsOpen && (
            <div className="p-3 pt-0 border-t border-border bg-surface">
              <TotalsPanel className="w-full max-w-full" itemSubtotal={itemSubtotal} totalDiscount={totalDiscount} subtotal={subtotal} totalExtraCharges={totalExtraCharges} taxableAmount={taxableAmount} totalCGST={totalCGST} totalSGST={totalSGST} totalIGST={totalIGST} grandTotal={grandTotal} totalPaid={totalPaid} balance={balance} recordPayment={recordPayment} roundOff={roundOff} enableRoundOff={enableRoundOff} onEnableRoundOffChange={setEnableRoundOff} extraCharges={extraCharges} onExtraChargesChange={setExtraCharges} onAddExtraCharge={() => setExtraCharges([...extraCharges, { id: Date.now().toString(), purpose: '', amount: 0 }])} onPaymentClick={() => setPaymentModalOpen(true)} isFinal={isFinal} documentType={documentType} isExport={isExport} isIntraState={isIntraState} />
            </div>
          )}
        </div>
        {isFinal && (
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => window.open(`/api/invoices/${savedInvoiceId}/pdf?user_id=${user?.id}`, '_blank')}><Printer className="w-4 h-4 mr-2" /> Print</Button>
            <Button variant="primary" className="flex-1" onClick={() => setShareModalOpen(true)}><Send className="w-4 h-4 mr-2" /> Share</Button>
          </div>
        )}
      </div>
      {!isFinal && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 backdrop-blur supports-[padding:max(0px)]:pb-[max(12px,env(safe-area-inset-bottom))] px-3 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
          <div className="max-w-[1600px] mx-auto space-y-2">
            <Button variant="secondary" className="h-11 w-full" onClick={handlePreview} isLoading={previewLoading} disabled={previewLoading || !isSeriesResolved}>Preview</Button>
            <Button variant="primary" className="w-full h-12 font-bold" onClick={() => handleSave('final')} isLoading={loading} disabled={!isSeriesResolved && !canQueueOffline}><Send className="w-5 h-5 mr-2" /> Generate</Button>
            <p className="text-[10px] text-center text-text-muted">Generate finalizes the document for GST.</p>
            <Button variant="ghost" className="w-full h-10 text-sm" onClick={async () => { await handleSave('draft'); resetFormForNewInvoice(); }} disabled={!isSeriesResolved}>Save &amp; new</Button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      {toastMessage && <Toast message={toastMessage.message} type={toastMessage.type} onClose={() => setToastMessage(null)} />}
      {showNavigationWarning && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
          <div className="bg-surface rounded-lg border border-border p-6 max-w-md w-full mx-4 text-text-primary shadow-xl">
            <h3 className="text-lg font-semibold mb-2">Unsaved changes</h3>
            <p className="text-text-secondary mb-4">
              You have unsaved changes on this invoice. Are you sure you want to leave without saving?
              Your customer and item data will be lost.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowNavigationWarning(false);
                  setPendingNavigation(null);
                }}
                className="px-4 py-2 border border-border rounded-md hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Stay on page
              </button>
              <button
                type="button"
                onClick={handleConfirmLeavePage}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
              >
                Leave without saving
              </button>
            </div>
          </div>
        </div>
      )}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 text-center">
            <h3 className="text-xl font-bold text-text-primary mb-2">Discard changes?</h3>
            <p className="text-text-secondary mb-6">Switching will clear current progress.</p>
            <div className="flex flex-col gap-2"><Button onClick={() => handleConfirmReset('save')} variant="primary" className="w-full">Save Draft & Switch</Button><Button onClick={() => handleConfirmReset('discard')} variant="secondary" className="w-full text-red-600">Discard & Switch</Button><Button onClick={() => handleConfirmReset('cancel')} variant="ghost" className="w-full">Stay</Button></div>
          </div>
        </div>
      )}
      {editModalOpen && selectedCustomer && <EditCustomerModal customer={selectedCustomer} onClose={() => setEditModalOpen(false)} onSave={() => {}} />}
      <POSLayout
        invoiceNumber={`${invoicePrefix}-${invoiceNumber}`}
        invoiceDate={invoiceDate}
        grandTotal={grandTotal}
        subtotal={subtotal}
        totalTax={totalTax}
        payments={payments.map(p => ({ mode: p.mode, amount: Number(p.amount) || 0 }))}
        onPaymentsChange={(newPayments) => {
          setPayments(newPayments.map((p, idx) => ({
            id: payments[idx]?.id || Date.now().toString() + idx,
            amount: p.amount,
            mode: p.mode,
            date: payments[idx]?.date || format(new Date(), 'yyyy-MM-dd'),
            reference: payments[idx]?.reference || ''
          })));
        }}
        onPrintBill={handlePrintBill}
        isPrinting={loading}
        offlinePending={offlineSyncPending}
        offlineInvoiceLabel={offlineDisplayNumber}
        onParkBill={() => {
          // Park bill clears the screen - handled in POSLayout
        }}
        customerName={selectedCustomer?.name}
        customerPhone={customerPhone}
        onCustomerPhoneChange={handleCustomerPhoneChange}
        onCustomerSelect={handleCustomerSelectFromPhone}
        onAddNewCustomer={() => setCreateCustomerModalOpen(true)}
        onResumeBill={(bill) => {
          restoreInvoiceState(bill.data);
        }}
        getInvoiceState={getInvoiceState}
        restoreInvoiceState={restoreInvoiceState}
        onStartNewBill={startNewBill}
        itemSearchInputRef={itemInputRefs.current[0] || undefined}
        itemCount={rows.length}
        itemRows={rows.map(r => ({ itemId: r.itemId, name: r.name, quantity: r.quantity }))}
        bluetooth={{
          enabled: canBtPrint,
          supported: bt.supported,
          pairedCount: bt.savedPrinters.length,
          autoPrint: autoBluetoothPrint,
          onAutoPrintChange: (next) => {
            setAutoBluetoothPrint(next);
            setPosAutoBluetoothPrint(next);
          },
          onReprint: handleBluetoothReprint,
          isReprinting: btPrinting,
        }}
      >
        <div
          key={`${documentType}-${formKey}`}
          className="max-w-[1600px] mx-auto space-y-3 md:space-y-4 -mt-2 md:-mt-1"
        >
          {!posMode && (
            <MobileDuplicatePageChrome
              className="mb-0 mt-0"
              onBack={handleComposerBack}
              title={(() => {
                const urlType = searchParams.get('type') as DocumentType | null;
                const docType =
                  urlType && allowedDocTypes.includes(urlType)
                    ? urlType
                    : documentType || initialDocType;
                return isEditMode
                  ? docType === 'proforma_invoice'
                    ? 'Edit Estimate'
                    : `Edit ${DOCUMENT_TYPE_NAMES[docType]}`
                  : docType === 'proforma_invoice'
                    ? 'New Estimate'
                    : `New ${DOCUMENT_TYPE_NAMES[docType]}`;
              })()}
              trailing={savedStatus ? <StatusBadge status={savedStatus} /> : undefined}
            />
          )}
          {showMobileInvoiceUi ? renderMobileComposer() : renderDesktopForm()}
        </div>
      </POSLayout>
      {previewModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) setPreviewModalOpen(false); }}>
          <div
            className={`bg-white rounded-lg shadow-xl flex flex-col ${
              isThermalTemplateId(previewTemplateId)
                ? 'max-w-fit max-h-[95vh] w-auto'
                : 'w-full max-w-[95vw] h-[95vh]'
            }`}
          >
            <div className="flex items-center justify-between p-4 border-b flex-shrink-0 gap-3">
              <div>
                <h2 className="text-xl font-bold">Preview</h2>
                {isThermalTemplateId(previewTemplateId) && (
                  <p className="text-xs text-text-secondary mt-0.5">
                    {previewTemplateId === 'thermal_58mm' ? '58mm' : '80mm'} thermal — preview matches print width
                  </p>
                )}
              </div>
              <button type="button" onClick={() => setPreviewModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full shrink-0" aria-label="Close preview">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div
              className={`flex-1 overflow-auto bg-gray-200 dark:bg-slate-800 ${
                isThermalTemplateId(previewTemplateId) ? 'flex justify-center items-start py-4 px-3' : ''
              }`}
            >
              <iframe
                srcDoc={previewHtml}
                title="Invoice Preview"
                className={`border-0 bg-transparent ${
                  isThermalTemplateId(previewTemplateId)
                    ? `${thermalPreviewIframeWidthClass(previewTemplateId)} min-h-[120px]`
                    : 'w-full min-h-[70vh]'
                }`}
                style={
                  isThermalTemplateId(previewTemplateId)
                    ? { height: 'calc(95vh - 140px)', maxHeight: 'calc(95vh - 140px)' }
                    : undefined
                }
              />
            </div>
            <div className="p-4 border-t flex justify-end flex-shrink-0">
              <Button variant="secondary" onClick={() => setPreviewModalOpen(false)}>Close</Button>
            </div>
          </div>
        </div>
      )}
      {shareModalOpen && savedInvoiceId && <ShareInvoiceModal invoiceId={savedInvoiceId} invoiceNumber={invoicePrefix && invoiceNumber ? `${invoicePrefix}-${invoiceNumber}` : 'N/A'} customerEmail={selectedCustomer?.email} customerPhone={selectedCustomer?.phone} onClose={() => setShareModalOpen(false)} onCreateAnother={resetFormForNewInvoice} />}
      {paymentModalOpen && <InvoicePaymentModal grandTotal={grandTotal} payments={payments} onSave={setPayments} onClose={() => setPaymentModalOpen(false)} />}
      {showUpgradePrompt && limitInfo && <UpgradeModal limitType="invoices" currentCount={limitInfo.current} limit={limitInfo.limit} onClose={() => setShowUpgradePrompt(false)} onUpgradeSuccess={() => window.location.reload()} />}
      {showContinuousScanner && business?.id && (<ContinuousBarcodeScanner businessId={business.id} onItemScanned={(item) => { if (!item?.id) return; handleItemSelect(item); }} onClose={() => setShowContinuousScanner(false)} />)}
      {createCustomerModalOpen && (
        <CreateCustomerModal
          isOpen={createCustomerModalOpen}
          onClose={() => setCreateCustomerModalOpen(false)}
          onSuccess={(customer) => {
            // Add the new customer to the customers list
            setCustomers(prev => [...prev, customer]);
            // Auto-select the newly created customer
            setCustomerId(customer.id);
            setSelectedCustomer(customer);
            // Set phone number in POS mode
            if (posMode && customer.phone) {
              setCustomerPhone(customer.phone);
            }
            // Set addresses from customer data
            setBillingAddress(customer.billing_address || customer.address || '');
            setShippingAddress(customer.shipping_address || customer.address || '');
            // Update place of supply if customer has state
            if (customer.state) {
              setPlaceOfSupply(customer.state);
              setRows(prev => prev.map(r => calculateRow(r, true)));
            }
            // Close modal
            setCreateCustomerModalOpen(false);
            // Show success message
            toastCtx.success(`Customer "${customer.name}" added and selected`);
            // Focus item search in POS mode
            if (posMode) {
              setTimeout(() => {
                if (itemInputRefs.current[0]?.current) {
                  itemInputRefs.current[0].current.focus();
                }
              }, 100);
            }
          }}
          initialData={posMode && customerPhone ? { phone: customerPhone } : {}}
        />
      )}

      {createItemModalOpen && (
        <CreateItemModal
          isOpen={createItemModalOpen}
          onClose={() => setCreateItemModalOpen(false)}
          onSuccess={(item) => {
            // Automatically add the new item to the invoice
            handleItemSelect(item);
            
            setCreateItemModalOpen(false);
            // Show success message
            toastCtx.success(`Item "${item.name}" added to invoice`);
          }}
        />
      )}
      {business?.id && (
        <MobileItemPickerPanel
          open={showMobileItemPicker}
          onClose={() => setShowMobileItemPicker(false)}
          businessId={business.id}
          userId={user?.id}
          warehouseId={selectedWarehouseId || undefined}
          branchId={currentBranchId && currentBranchId !== 'ALL' ? currentBranchId : undefined}
          onApply={handleMobilePickerApply}
          onCreateNewItem={() => {
            setShowMobileItemPicker(false);
            setCreateItemModalOpen(true);
          }}
          onOpenScanner={() => {
            setShowMobileItemPicker(false);
            setShowContinuousScanner(true);
          }}
        />
      )}
    </>
  );
}

export default function NewInvoicePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-text-secondary">Loading...</p>
        </div>
      </div>
    }>
      <NewInvoiceContent />
    </Suspense>
  );
}

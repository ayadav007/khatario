'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { ProfileSection } from '@/components/settings/business-profile/ProfileSection';
import { Button } from '@/components/ui/Button';
import { HSNLookup } from '@/components/ui/HSNLookup';
import { GST_RATE_SLABS, isAllowedGstRate } from '@/lib/gst/rates';
import { GST_UQC_CODES, toGstUqc } from '@/lib/gst/uqc';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { UpgradeModal } from '@/components/subscription/UpgradeModal';
import { Tag, Camera, Plus, Trash2, ChevronDown, ChevronUp, Layers, Check, X, Printer, RefreshCw, Package, Loader2, ImagePlus, Upload } from 'lucide-react';
import { validateBarcode, normalizeBarcode, detectBarcodeType, generateRandomBarcode as generateBarcode } from '@/lib/barcode-validator';
import { BarcodeScanner } from '@/components/ui/BarcodeScanner';
import { useToastContext } from '@/contexts/ToastContext';
import type { Item } from '@/types/database';
import { CustomFieldValuesForm } from '@/components/custom-fields/CustomFieldValuesForm';
import { ItemSeoFields } from '@/components/items/ItemSeoFields';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import {
  useCustomFieldDefinitions,
  parseItemCustomFieldsFromApi,
} from '@/components/custom-fields/CustomFieldsManager';
import type { CustomFieldValues } from '@/types/custom-fields';
import { extraGalleryUrls, sanitizeGalleryUrls } from '@/lib/store/item-gallery';

interface Supplier {
  id: string;
  name: string;
  phone?: string;
  email?: string;
}

interface ItemCategory {
  id: string;
  name: string;
}

const ITEM_TYPES = [
  { value: 'goods', label: 'Goods', hint: 'Physical products. Stock is tracked.' },
  { value: 'service', label: 'Service', hint: 'Work or time you bill for. No stock.' },
] as const;

function ItemSection({
  title,
  description,
  children,
}: {
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <ProfileSection title={title} description={description}>
      <div className="card space-y-4 p-4 md:p-5">{children}</div>
    </ProfileSection>
  );
}

export default function NewItemPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('edit');
  const isEditMode = !!editId;
  
  const { business, user } = useAuth();
  const toast = useToastContext();
  const { canAdd, canModify, loading: permissionsLoading } = usePermissions();
  const [loading, setLoading] = useState(false);
  const [loadingItem, setLoadingItem] = useState(isEditMode);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<ItemCategory[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [limitInfo, setLimitInfo] = useState<{ current: number; limit: number } | null>(null);
  const [productVariantsEnabled, setProductVariantsEnabled] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    barcode: '',
    barcode_type: '',
    unit: 'PCS',
    uqc: '',
    item_type: 'goods' as 'goods' | 'service',
    selling_price: '',
    purchase_price: '',
    tax_rate: '',
    hsn_sac: '',
    opening_stock: '',
    min_stock: '',
    description: '',
    category_id: '',
    default_supplier_id: '',
    image_url: '',
    gallery_urls: [] as string[],
    has_variants: false,
    track_batch: false,
    track_serial: false,
    valuation_method: 'simple' as 'fifo' | 'weighted_avg' | 'simple',
    gst_included: false,
    mrp: '',
    fssai_licence_no: '',
    net_quantity: '',
    country_of_origin: 'IN',
    brand: '',
    is_weighed: false,
    plu_code: '',
    weight_barcode_mode: 'weight' as 'weight' | 'price',
    /** inherit = use business default; block/allow = override for invoices */
    sales_stock_policy: 'inherit' as 'inherit' | 'block' | 'allow',
    is_bundle: false,
    show_in_store: false,
    featured_in_store: false,
    seo_title: '',
    seo_description: '',
    seo_image_url: '',
  });

  const [businessDefaultAllowOversell, setBusinessDefaultAllowOversell] = useState(false);
  const { definitions: itemCustomFieldDefs } = useCustomFieldDefinitions('item');
  const [itemCustomFieldValues, setItemCustomFieldValues] = useState<CustomFieldValues>({});

  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const [barcodeValid, setBarcodeValid] = useState(false);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);

  const [bundleComponents, setBundleComponents] = useState<
    { item_id: string; quantity: string }[]
  >([]);
  const [catalogItems, setCatalogItems] = useState<Item[]>([]);
  const [bundleErrors, setBundleErrors] = useState<{
    general?: string;
    rowQty?: Record<number, string>;
  }>({});

  const selectableCatalogItems = useMemo(() => {
    return catalogItems.filter((it) => {
      if (editId && it.id === editId) return false;
      if (it.item_type !== 'goods') return false;
      if ((it as Item).is_bundle) return false;
      if ((it as Item).has_variants) return false;
      return true;
    });
  }, [catalogItems, editId]);

  const bundleEstimatedCost = useMemo(() => {
    if (!formData.is_bundle) return 0;
    let sum = 0;
    for (const row of bundleComponents) {
      if (!row.item_id || !(Number(row.quantity) > 0)) continue;
      const it = catalogItems.find((x) => x.id === row.item_id);
      const pp = Number(it?.purchase_price ?? 0);
      if (!Number.isFinite(pp)) continue;
      sum += pp * Number(row.quantity);
    }
    return sum;
  }, [formData.is_bundle, bundleComponents, catalogItems]);

  const bundleMarginHintPct = useMemo(() => {
    const selling = Number(formData.selling_price) || 0;
    if (!formData.is_bundle || selling <= 0) return null;
    return ((selling - bundleEstimatedCost) / selling) * 100;
  }, [formData.is_bundle, formData.selling_price, bundleEstimatedCost]);

  /** Min over components of floor(stock / qty); null if bundle mode off or no complete component rows. */
  const bundleMaxPossibleCount = useMemo(() => {
    if (!formData.is_bundle) return null;
    const perComponent: number[] = [];
    for (const row of bundleComponents) {
      if (!row.item_id || !(Number(row.quantity) > 0)) continue;
      const it = catalogItems.find((x) => x.id === row.item_id);
      const stockRaw = Number(it?.current_stock ?? 0);
      const stock = Number.isFinite(stockRaw) ? Math.max(0, stockRaw) : 0;
      const req = Number(row.quantity);
      if (!Number.isFinite(req) || req <= 0) continue;
      perComponent.push(Math.floor(stock / req));
    }
    if (perComponent.length === 0) return null;
    return Math.min(...perComponent);
  }, [formData.is_bundle, bundleComponents, catalogItems]);

  function bundleComponentOptionLabel(it: Item): string {
    const stock = Number(it.current_stock ?? 0);
    const safeStock = Number.isFinite(stock) ? stock : 0;
    const stockPart = ` (Stock: ${safeStock})`;
    const zeroWarn = safeStock <= 0 ? '⚠ Out of stock — ' : '';
    return `${zeroWarn}${it.name}${it.code ? ` (${it.code})` : ''}${stockPart}`;
  }

  const [variants, setVariants] = useState<any[]>([]);
  const [variantAttributes, setVariantAttributes] = useState<any[]>([
    { name: 'Size', values: [] },
    { name: 'Color', values: [] }
  ]);
  
  // Pre-fill from query parameters
  const returnUrl = searchParams?.get('return_url') || '';
  
  useEffect(() => {
    // Pre-fill item name from query parameters
    const name = searchParams?.get('name');
    if (name && !isEditMode) {
      setFormData(prev => ({
        ...prev,
        name: decodeURIComponent(name)
      }));
    }
  }, [searchParams, isEditMode]);

  const addAttribute = () => {
    setVariantAttributes([...variantAttributes, { name: '', values: [] }]);
  };

  const removeAttribute = (index: number) => {
    const newAttrs = [...variantAttributes];
    newAttrs.splice(index, 1);
    setVariantAttributes(newAttrs);
    generateVariants(newAttrs);
  };

  const updateAttributeName = (index: number, name: string) => {
    const newAttrs = [...variantAttributes];
    newAttrs[index].name = name;
    setVariantAttributes(newAttrs);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        toast.error('Image size should be less than 2MB');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, image_url: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGalleryUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Image size should be less than 2MB');
      return;
    }
    if (formData.gallery_urls.length >= 7) {
      toast.error('You can add up to 7 extra photos');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const url = reader.result as string;
      setFormData((prev) => ({
        ...prev,
        gallery_urls: prev.gallery_urls.includes(url) ? prev.gallery_urls : [...prev.gallery_urls, url],
      }));
    };
    reader.readAsDataURL(file);
  };

  const addAttributeValue = (attrIndex: number, value: string) => {
    if (!value.trim()) return;
    const newAttrs = [...variantAttributes];
    const row = newAttrs[attrIndex];
    if (!row) return;
    if (!Array.isArray(row.values)) row.values = [];
    if (!row.values.includes(value)) {
      row.values.push(value);
      setVariantAttributes(newAttrs);
      generateVariants(newAttrs);
    }
  };

  const removeAttributeValue = (attrIndex: number, valIndex: number) => {
    const newAttrs = [...variantAttributes];
    const row = newAttrs[attrIndex];
    if (!row || !Array.isArray(row.values)) return;
    row.values.splice(valIndex, 1);
    setVariantAttributes(newAttrs);
    generateVariants(newAttrs);
  };

  const generateVariants = (attrs: any[]) => {
    const enabledAttrs = attrs.filter(
      (a) => Array.isArray(a?.values) && a.values.length > 0
    );
    if (enabledAttrs.length === 0) {
      setVariants([]);
      return;
    }

    const combinations = (acc: any[], current: any) => {
      const vals = Array.isArray(current?.values) ? current.values : [];
      const attrName = current?.name ?? '';
      if (acc.length === 0) return vals.map((v: string) => ({ [attrName]: v }));
      const result: any[] = [];
      acc.forEach(a => {
        vals.forEach((v: string) => {
          result.push({ ...a, [attrName]: v });
        });
      });
      return result;
    };

    const combined = enabledAttrs.reduce(combinations, []);
    const newVariants = combined.map((c: any) => {
      const name = Object.values(c).join(' / ');
      const existing = variants.find(v => v.name === name);
      return existing || {
        name,
        attributes: c,
        sku: `${formData.code ? formData.code + '-' : ''}${name.replace(/ \/ /g, '-')}`,
        barcode: '',
        barcode_type: '',
        purchase_price: formData.purchase_price,
        selling_price: formData.selling_price,
        opening_stock: '0'
      };
    });
    setVariants(newVariants);
  };

  const updateVariant = (index: number, field: string, value: any) => {
    const newVariants = [...variants];
    newVariants[index] = { ...newVariants[index], [field]: value };
    setVariants(newVariants);
  };

  // Load suppliers and item data
  useEffect(() => {
    if (business?.id) {
      fetchSuppliers();
      if (user?.id) {
        fetchCategories();
      }

      fetch(`/api/settings/item-sales-stock?business_id=${business.id}`)
        .then((res) => res.json())
        .then((data) =>
          setBusinessDefaultAllowOversell(!!data.default_allow_sale_when_out_of_stock)
        )
        .catch(() => setBusinessDefaultAllowOversell(false));
      
      // Fetch product variants setting
      fetch(`/api/settings/product-variants?business_id=${business.id}`)
        .then(res => res.json())
        .then(data => {
          setProductVariantsEnabled(data.product_variants_enabled || false);
        })
        .catch(err => console.error('Failed to fetch product variants setting:', err));
      
      // Check subscription limits (skip for edit mode)
      if (!isEditMode) {
        const checkLimits = async () => {
          try {
            const limitRes = await fetch(`/api/subscriptions/check-limit?business_id=${business.id}&limit_type=items`);
            if (limitRes.ok) {
              const limitData = await limitRes.json();
              setLimitInfo({ current: limitData.current, limit: limitData.limit });
              
              if (!limitData.allowed) {
                setShowUpgradePrompt(true);
              }
            }
          } catch (error) {
            console.error('Failed to check limits:', error);
          }
        };
        
        checkLimits();
      }
    }
  }, [business, isEditMode, user?.id]);

  useEffect(() => {
    if (!business?.id || !user?.id) return;
    fetch(`/api/items?business_id=${business.id}&limit=500&page=1`)
      .then((res) => res.json())
      .then((data) => setCatalogItems(data.items || []))
      .catch(() => setCatalogItems([]));
  }, [business?.id, user?.id]);

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

  async function fetchSuppliers() {
    if (!business?.id) return;
    try {
      const response = await fetch(`/api/suppliers?business_id=${business.id}`);
      const data = await response.json();
      setSuppliers(data.suppliers || []);
    } catch (error) {
      console.error('Error fetching suppliers:', error);
    }
  }

  async function fetchCategories() {
    if (!business?.id || !user?.id) return;
    try {
      const response = await fetch(
        `/api/categories?business_id=${business.id}&user_id=${user.id}`
      );
      const data = await response.json();
      setCategories(data.categories || []);
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  }

  // Load item data if editing
  useEffect(() => {
    if (isEditMode && editId && business?.id) {
      const fetchItem = async () => {
        setLoadingItem(true);
        try {
          const res = await fetch(`/api/items/${editId}?business_id=${business.id}`);
          if (res.ok) {
            const data = await res.json();
            const item = data.item;
            const loadedVariants = data.variants || [];
            
            setItemCustomFieldValues(parseItemCustomFieldsFromApi(item));

            setFormData({
              name: item.name || '',
              code: item.code || '',
              barcode: item.barcode || '',
              barcode_type: item.barcode_type || '',
              unit: item.unit || 'PCS',
              uqc: (item as { uqc?: string | null }).uqc || '',
              item_type: item.item_type || 'goods',
              selling_price: item.selling_price?.toString() || '',
              purchase_price: item.purchase_price?.toString() || '',
              tax_rate: item.tax_rate?.toString() || '',
              hsn_sac: item.hsn_sac || '',
              opening_stock: item.current_stock?.toString() || '',
              min_stock: item.min_stock?.toString() || '',
              description: item.description || '',
              category_id: item.category_id || '',
              default_supplier_id: item.default_supplier_id || '',
              image_url: item.image_url || '',
              gallery_urls: extraGalleryUrls(
                sanitizeGalleryUrls((item as { gallery_urls?: unknown }).gallery_urls, item.image_url),
                item.image_url || '',
              ),
              has_variants: item.has_variants || false,
              track_batch: item.track_batch || false,
              track_serial: item.track_serial || false,
              valuation_method: item.valuation_method || 'simple',
              gst_included: item.gst_included || false,
              mrp: item.mrp?.toString() || '',
              fssai_licence_no: item.fssai_licence_no || '',
              net_quantity: item.net_quantity || '',
              country_of_origin: item.country_of_origin || 'IN',
              brand: item.brand || '',
              is_weighed: !!item.is_weighed,
              plu_code: item.plu_code || '',
              weight_barcode_mode: item.weight_barcode_mode === 'price' ? 'price' : 'weight',
              sales_stock_policy:
                (item as { allow_sale_when_out_of_stock?: boolean | null }).allow_sale_when_out_of_stock === true
                  ? 'allow'
                  : (item as { allow_sale_when_out_of_stock?: boolean | null }).allow_sale_when_out_of_stock === false
                    ? 'block'
                    : 'inherit',
              is_bundle: !!(item as { is_bundle?: boolean }).is_bundle,
              show_in_store: !!(item as any).show_in_store,
              featured_in_store: !!(item as { featured_in_store?: boolean }).featured_in_store,
              seo_title: (item as { seo_title?: string | null }).seo_title || '',
              seo_description: (item as { seo_description?: string | null }).seo_description || '',
              seo_image_url: (item as { seo_image_url?: string | null }).seo_image_url || '',
            });

            const itemIsBundle = !!(item as { is_bundle?: boolean }).is_bundle;
            if (itemIsBundle) {
              try {
                const bundleRes = await fetch(
                  `/api/items/${editId}/bundle?business_id=${business.id}`
                );
                if (bundleRes.ok) {
                  const bundleData = await bundleRes.json();
                  const comps = bundleData.components || [];
                  setBundleComponents(
                    comps.map((c: { item_id: string; quantity: number }) => ({
                      item_id: c.item_id,
                      quantity: String(c.quantity ?? 1),
                    }))
                  );
                } else {
                  const err = await bundleRes.json().catch(() => ({}));
                  toast.error(
                    typeof (err as { error?: string }).error === 'string'
                      ? (err as { error: string }).error
                      : 'Could not load bundle components'
                  );
                  setBundleComponents([{ item_id: '', quantity: '1' }]);
                }
              } catch {
                setBundleComponents([{ item_id: '', quantity: '1' }]);
              }
            } else {
              setBundleComponents([]);
            }

            // Load variants if item has variants
            if (item.has_variants && loadedVariants.length > 0) {
              // Reconstruct variant attributes from existing variants
              const attributeMap: Record<string, Set<string>> = {};
              
              loadedVariants.forEach((variant: any) => {
                const attrs = variant.attributes || {};
                Object.keys(attrs).forEach(attrName => {
                  if (!attributeMap[attrName]) {
                    attributeMap[attrName] = new Set();
                  }
                  attributeMap[attrName].add(attrs[attrName]);
                });
              });

              // Convert to variantAttributes format
              const reconstructedAttrs = Object.keys(attributeMap).map(attrName => ({
                name: attrName,
                values: Array.from(attributeMap[attrName])
              }));

              // If we have attributes, set them; otherwise use default
              if (reconstructedAttrs.length > 0) {
                setVariantAttributes(reconstructedAttrs);
              }

              // Set the variants with their data
              setVariants(loadedVariants.map((v: any) => ({
                id: v.id,
                name: v.name,
                attributes: v.attributes || {},
                sku: v.sku || '',
                barcode: v.barcode || '',
                barcode_type: v.barcode_type || '',
                purchase_price: v.purchase_price || '',
                selling_price: v.selling_price || '',
                opening_stock: v.opening_stock || '0'
              })));
            }
          } else {
            toast.error('Failed to load item');
            router.push('/items');
          }
        } catch (error) {
          console.error('Error loading item:', error);
          toast.error('Failed to load item');
          router.push('/items');
        } finally {
          setLoadingItem(false);
        }
      };
      fetchItem();
    }
  }, [isEditMode, editId, business?.id, router]);

  // Set selected supplier when suppliers are loaded and item has default_supplier_id
  useEffect(() => {
    if (formData.default_supplier_id && suppliers.length > 0 && !selectedSupplier) {
      const supplier = suppliers.find(s => s.id === formData.default_supplier_id);
      if (supplier) {
        setSelectedSupplier(supplier);
        setSupplierSearch(supplier.name);
      }
    }
  }, [suppliers, formData.default_supplier_id, selectedSupplier]);

  // Check authorization before rendering form - MUST BE AFTER ALL HOOKS (useState, useEffect, etc.)
  const { status: authStatus, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'items',
    action: isEditMode ? 'update' : 'create',
    skipCheck: !user?.id || !business?.id
  });

  if (authLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (authStatus === 'denied') {
    return (
        <AccessDenied
          module="items"
          action={isEditMode ? 'update' : 'create'}
          details={reason}
          code={isEditMode ? 'ITEM_UPDATE_DENIED' : 'ITEM_CREATE_DENIED'}
        />
    );
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleBarcodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = normalizeBarcode(e.target.value);
    setFormData({ ...formData, barcode: value });
    validateAndSetBarcode(value);
  };

  const validateAndSetBarcode = (value: string) => {
    if (!value) {
      setBarcodeError(null);
      setBarcodeValid(false);
      setFormData(prev => ({ ...prev, barcode_type: '' }));
      return;
    }
    
    const validation = validateBarcode(value);
    if (validation.isValid && validation.type) {
      setBarcodeError(null);
      setBarcodeValid(true);
      setFormData(prev => ({ ...prev, barcode_type: validation.type || '' }));
    } else {
      setBarcodeError(validation.error || 'Invalid barcode');
      setBarcodeValid(false);
      setFormData(prev => ({ ...prev, barcode_type: '' }));
    }
  };

  const handleBarcodeScan = (scannedBarcode: string) => {
    const normalized = normalizeBarcode(scannedBarcode);
    setFormData(prev => ({ ...prev, barcode: normalized }));
    validateAndSetBarcode(normalized);
    setShowBarcodeScanner(false);
  };

  const handleGenerateBarcode = () => {
    // Use the GS1 in-store range (20-29) so codes generated by retailers
    // never collide with manufacturer-assigned GTINs.
    const newBarcode = generateBarcode({ inStore: true });
    setFormData(prev => ({ ...prev, barcode: newBarcode }));
    validateAndSetBarcode(newBarcode);
  };

  /**
   * Print a single label for the in-progress item or one of its variants.
   * - In edit mode we already have an `item_id` (and possibly a variant_id),
   *   so we delegate to the proper /api/labels/print pipeline (real
   *   bwip-js SVG, server-rendered PDF).
   * - For brand-new (unsaved) items we don't have an item_id yet, so we use
   *   the API's `preview: true` mode which trusts the caller-supplied
   *   display name + barcode.
   */
  const handlePrintBarcode = async (
    barcode: string,
    name: string,
    price: string,
    opts?: { itemId?: string; variantId?: string }
  ) => {
    if (!barcode || !business?.id) return;

    const itemId = opts?.itemId;
    const variantId = opts?.variantId;

    const linePayload = itemId
      ? {
          item_id: itemId,
          variant_id: variantId || null,
          copies: 1,
        }
      : {
          display_name: name,
          barcode_override: barcode,
          price: price ? Number(price) : null,
          copies: 1,
        };

    try {
      const res = await fetch(
        `/api/labels/print?business_id=${business.id}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lines: [linePayload],
            layout: 'ROLL',
            format: 'pdf',
            purpose: 'item_create',
            preview: !itemId,
          }),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.error || `Print failed (${res.status})`);
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');
      if (!win) {
        const a = document.createElement('a');
        a.href = url;
        a.download = `label-${barcode}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: any) {
      toast.error(err?.message || 'Print failed');
    }
  };

  const filteredSuppliers = suppliers.filter((supplier) =>
    supplier.name.toLowerCase().includes(supplierSearch.toLowerCase()) ||
    supplier.phone?.toLowerCase().includes(supplierSearch.toLowerCase()) ||
    supplier.email?.toLowerCase().includes(supplierSearch.toLowerCase())
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business) return;
    
    // Check subscription limits before creating item (skip for edit mode)
    if (!isEditMode && limitInfo && limitInfo.limit !== -1 && limitInfo.current >= limitInfo.limit) {
      setShowUpgradePrompt(true);
      return;
    }
    
    setLoading(true);

    try {
      // Validate barcode before submission if provided
      if (formData.barcode) {
        const validation = validateBarcode(formData.barcode, formData.barcode_type as any);
        if (!validation.isValid) {
          setBarcodeError(validation.error || 'Invalid barcode');
          setLoading(false);
          return;
        }
      }

      const goodsBundle = formData.item_type === 'goods' && formData.is_bundle;
      const bundleRows = bundleComponents
        .filter((c) => c.item_id && Number(c.quantity) > 0)
        .map((c) => ({ item_id: c.item_id, quantity: Number(c.quantity) }));

      setBundleErrors({});
      if (goodsBundle) {
        const rowQty: Record<number, string> = {};
        const seen = new Set<string>();
        let duplicate = false;
        bundleComponents.forEach((c, i) => {
          if (c.item_id) {
            if (seen.has(c.item_id)) duplicate = true;
            seen.add(c.item_id);
          }
          if (c.item_id && !(Number(c.quantity) > 0)) {
            rowQty[i] = 'Enter a quantity greater than zero';
          }
        });
        let general: string | undefined;
        if (duplicate) {
          general =
            'Each component item can only appear once. Remove duplicate rows or change the selection.';
        }
        if (bundleRows.length < 1) {
          general =
            general ||
            'Add at least one component: choose an item and enter a quantity greater than zero.';
        }
        if (general || Object.keys(rowQty).length > 0) {
          setBundleErrors({
            general,
            rowQty: Object.keys(rowQty).length ? rowQty : undefined,
          });
          setLoading(false);
          return;
        }
      }

      const basePayload = {
        name: formData.name,
        code: formData.code || null,
        barcode: formData.barcode || null,
        barcode_type: formData.barcode_type || null,
        unit: formData.unit,
        uqc: formData.uqc || toGstUqc(formData.unit, formData.hsn_sac),
        item_type: formData.item_type,
        selling_price: formData.item_type === 'service' || formData.has_variants
          ? (formData.selling_price ? Number(formData.selling_price) : null)
          : (Number(formData.selling_price) || 0),
        purchase_price: Number(formData.purchase_price) || 0,
        tax_rate: Number(formData.tax_rate) || 0,
        hsn_sac: formData.hsn_sac || null,
        min_stock: (formData.item_type === 'service' || formData.has_variants || formData.is_bundle) ? 0 : (Number(formData.min_stock) || 0),
        description: formData.description || null,
        category_id: formData.category_id || null,
        default_supplier_id: formData.default_supplier_id || null,
        image_url: formData.image_url,
        gallery_urls: formData.gallery_urls,
        has_variants: formData.has_variants && !goodsBundle,
        track_batch: formData.item_type === 'goods' && !formData.is_bundle ? formData.track_batch : false,
        track_serial: formData.item_type === 'goods' && !formData.is_bundle ? formData.track_serial : false,
        valuation_method: formData.item_type === 'goods' && !formData.is_bundle ? formData.valuation_method : 'simple',
        gst_included: formData.gst_included || false,
        mrp: formData.mrp ? Number(formData.mrp) : null,
        fssai_licence_no: formData.fssai_licence_no || null,
        net_quantity: formData.net_quantity || null,
        country_of_origin: formData.country_of_origin || null,
        brand: formData.brand || null,
        is_weighed: !!formData.is_weighed,
        plu_code: formData.plu_code || null,
        weight_barcode_mode: formData.weight_barcode_mode || 'weight',
        show_in_store: !!formData.show_in_store,
        featured_in_store: !!formData.featured_in_store,
        seo_title: formData.seo_title || null,
        seo_description: formData.seo_description || null,
        seo_image_url: formData.seo_image_url || null,
      };

      const payload: Record<string, unknown> = {
        ...basePayload,
        custom_fields: itemCustomFieldValues,
        business_id: business.id,
        created_by: user?.id, // Required for authorization
        opening_stock: (formData.item_type === 'service' || formData.has_variants || formData.is_bundle) ? 0 : (Number(formData.opening_stock) || 0),
        variants: formData.has_variants && !formData.is_bundle ? variants : []
      };
      if (formData.item_type === 'goods') {
        payload.allow_sale_when_out_of_stock =
          formData.sales_stock_policy === 'inherit'
            ? null
            : formData.sales_stock_policy === 'allow';
      } else {
        payload.allow_sale_when_out_of_stock = null;
      }

      const patchPayload: Record<string, unknown> = {
        ...basePayload,
        custom_fields: itemCustomFieldValues,
        updated_by: user?.id,
        opening_stock: (formData.item_type === 'service' || formData.has_variants || formData.is_bundle) ? 0 : (Number(formData.opening_stock) || 0),
        variants: formData.has_variants && !formData.is_bundle ? variants : [],
        is_bundle: formData.item_type === 'goods' ? !!formData.is_bundle : false,
        bundle_components: goodsBundle ? bundleRows : [],
      };
      if (formData.item_type === 'goods') {
        patchPayload.allow_sale_when_out_of_stock = payload.allow_sale_when_out_of_stock;
      } else {
        patchPayload.allow_sale_when_out_of_stock = null;
      }

      console.log('[Item Form] Submitting payload:', {
        has_variants: formData.has_variants,
        variants_count: variants.length,
        variants: variants,
        variant_details: variants.map(v => ({
          name: v.name,
          sku: v.sku,
          barcode: v.barcode,
          purchase_price: v.purchase_price,
          selling_price: v.selling_price,
          opening_stock: v.opening_stock,
          attributes: v.attributes,
          has_all_fields: !!(v.name && v.attributes)
        })),
        payload: {
          ...payload,
          variants: (payload.variants as unknown[]).map((v: any) => ({
            name: v.name,
            sku: v.sku,
            barcode: v.barcode,
            purchase_price: v.purchase_price,
            selling_price: v.selling_price,
            opening_stock: v.opening_stock,
            attributes: v.attributes
          }))
        }
      });

      let res: Response;
      if (isEditMode && editId) {
        res = await fetch(`/api/items/${editId}?business_id=${business.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchPayload),
        });
      } else if (goodsBundle) {
        const bundleCreateBody: Record<string, unknown> = {
          ...basePayload,
          has_variants: false,
          business_id: business.id,
          created_by: user?.id,
          opening_stock: 0,
          min_stock: 0,
          bundle_components: bundleRows,
        };
        if (formData.item_type === 'goods') {
          bundleCreateBody.allow_sale_when_out_of_stock = payload.allow_sale_when_out_of_stock;
        }
        res = await fetch('/api/items/bundle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bundleCreateBody),
        });
      } else {
        res = await fetch('/api/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      if (res.ok) {
        const data = await res.json();
        const itemId = data.item?.id || data.id;
        
        console.log('[Item Form] Item saved successfully:', {
          itemId,
          has_variants: data.item?.has_variants,
          response: data
        });
        
        // If item has variants, verify they were created
        if (formData.has_variants && variants.length > 0 && itemId) {
          try {
            const verifyRes = await fetch(`/api/items/${itemId}?business_id=${business.id}`);
            if (verifyRes.ok) {
              const verifyData = await verifyRes.json();
              console.log('[Item Form] Variant verification:', {
                expected: variants.length,
                found: verifyData.variantCount || 0,
                variants: verifyData.variants
              });
              
              if ((verifyData.variantCount || 0) < variants.length) {
                console.warn('[Item Form] WARNING: Not all variants were saved!', {
                  expected: variants.length,
                  found: verifyData.variantCount || 0
                });
                toast.warning(`Warning: Only ${verifyData.variantCount || 0} out of ${variants.length} variants were saved. Please check the console for details.`);
              } else {
                console.log('[Item Form] All variants saved successfully!');
              }
            }
          } catch (verifyError) {
            console.error('[Item Form] Error verifying variants:', verifyError);
          }
        }
        
        // If return_url is provided, redirect there with the new item_id
        if (returnUrl && itemId) {
          const decodedReturnUrl = decodeURIComponent(returnUrl);
          const returnUrlObj = new URL(decodedReturnUrl, window.location.origin);
          returnUrlObj.searchParams.set('item_id', itemId);
          router.push(returnUrlObj.pathname + returnUrlObj.search);
        } else {
        router.push('/items');
        router.refresh();
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        console.error('[Item Form] Error saving item:', {
          status: res.status,
          statusText: res.statusText,
          error: errorData,
          payload: payload
        });
        
        // Check if it's a subscription limit error (only for new items, not edits)
        if (!isEditMode && res.status === 403 && errorData.code === 'SUBSCRIPTION_LIMIT_EXCEEDED' && errorData.current !== undefined && errorData.limit !== undefined) {
          setLimitInfo({ current: errorData.current, limit: errorData.limit });
          setShowUpgradePrompt(true);
        } else {
          toast.error(errorData.error || `Failed to ${isEditMode ? 'update' : 'create'} item. Check console for details.`);
        }
      }
    } catch (error) {
      console.error(error);
      toast.error(`Failed to ${isEditMode ? 'update' : 'create'} item`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
    <div className="w-full min-w-0 max-w-5xl space-y-6">
        <MobileDuplicatePageChrome
          title={isEditMode ? 'Edit item' : 'Create item'}
          description="Name, price, tax and stock details used on invoices, labels and your online store."
        />

          {loadingItem ? (
            <div className="card flex items-center justify-center py-10 text-text-secondary">
              Loading item...
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
            <div className="space-y-6">
              <ItemSection
                title="Item type"
                description="Goods are stock-tracked. Services have no stock."
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {ITEM_TYPES.map((t) => {
                    const active = formData.item_type === t.value;
                    return (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => {
                          if (t.value === 'service') {
                            setFormData({ ...formData, item_type: 'service', is_bundle: false });
                            setBundleComponents([]);
                          } else {
                            setFormData({ ...formData, item_type: 'goods' });
                          }
                        }}
                        className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                          active
                            ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                            : 'border-border hover:bg-gray-50 dark:border-border-dark dark:hover:bg-slate-800/50'
                        }`}
                        aria-pressed={active}
                      >
                        <span className={`block text-sm font-medium ${active ? 'text-primary-700 dark:text-primary-300' : 'text-text-primary'}`}>
                          {t.label}
                        </span>
                        <span className="mt-0.5 block text-xs text-text-secondary">{t.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </ItemSection>

              <ItemSection
                title="Basic details"
                description="Name and identifiers shown on invoices, labels and the catalogue."
              >
                    <Input
                      label="Item name *"
                      name="name"
                      value={formData.name}
                      onChange={handleChange}
                      required
                      placeholder="e.g. Parle-G Biscuit"
                    />
                    <div>
                      <label className="type-label mb-1.5 block">
                        Category
                      </label>
                      <select
                        name="category_id"
                        value={formData.category_id}
                        onChange={handleChange}
                        className="input w-full"
                      >
                        <option value="">No category</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-text-muted mt-1">
                        <Link href="/items/categories" className="link-primary">
                          Manage categories
                        </Link>
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div>
                        <Input
                          label="Item code"
                          name="code"
                          value={formData.code}
                          onChange={handleChange}
                          placeholder="P001"
                        />
                      </div>
                      <div className="min-w-0 md:col-span-2">
                        <label className="type-label mb-1.5 block">
                          Barcode
                        </label>
                        <div className="relative flex flex-wrap items-center gap-2">
                          <div className="relative min-w-[12rem] flex-1">
                            <Input
                              name="barcode"
                              value={formData.barcode}
                              onChange={handleBarcodeChange}
                              placeholder="Scan or enter barcode"
                              className={barcodeError ? 'border-red-500 focus:ring-red-500' : barcodeValid ? 'border-green-500 focus:ring-green-500' : ''}
                            />
                            {barcodeValid && (
                              <div className="absolute right-3 top-1/2 transform -translate-y-1/2 flex items-center gap-1 text-green-600">
                                <Check className="w-4 h-4" />
                                <span className="text-xs">{formData.barcode_type}</span>
                              </div>
                            )}
                            {barcodeError && (
                              <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-red-500">
                                <X className="w-4 h-4" />
                              </div>
                            )}
                          </div>
                          <div className="flex gap-2 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => setShowBarcodeScanner(true)}
                              className="rounded-lg border border-border p-2.5 text-text-secondary transition-colors hover:border-primary-500 hover:bg-gray-50 hover:text-primary-600 dark:border-border-dark dark:hover:bg-slate-800/50"
                              title="Scan barcode with camera"
                            >
                              <Camera className="w-5 h-5" />
                            </button>
                            <button
                              type="button"
                              onClick={handleGenerateBarcode}
                              className="rounded-lg border border-border p-2.5 text-text-secondary transition-colors hover:border-primary-500 hover:bg-gray-50 hover:text-primary-600 dark:border-border-dark dark:hover:bg-slate-800/50"
                              title="Generate unique barcode"
                            >
                              <RefreshCw className="w-5 h-5" />
                            </button>
                            {formData.barcode && barcodeValid && (
                              <button
                                type="button"
                                onClick={() =>
                                  handlePrintBarcode(formData.barcode, formData.name, formData.selling_price, { itemId: editId || undefined })
                                }
                                className="rounded-lg border border-border p-2.5 text-text-secondary transition-colors hover:border-primary-500 hover:bg-gray-50 hover:text-primary-600 dark:border-border-dark dark:hover:bg-slate-800/50"
                                title="Print barcode label"
                              >
                                <Printer className="w-5 h-5" />
                              </button>
                            )}
                          </div>
                        </div>
                        {barcodeError && <p className="text-xs text-red-500 mt-1">{barcodeError}</p>}
                        {barcodeValid && formData.barcode_type && (
                          <p className="text-xs text-green-600 mt-1">✓ Valid {formData.barcode_type} barcode</p>
                        )}
                      </div>
                    </div>
              </ItemSection>

              <ItemSection
                title="Images"
                description="Main image for catalogues and labels. Extra photos show on your online store."
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-white dark:border-border-dark">
                    {formData.image_url ? (
                      <img src={formData.image_url} alt="Item" className="h-full w-full object-cover" />
                    ) : (
                      <ImagePlus className="h-6 w-6 text-text-muted" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-text-primary">Main image</p>
                    <p className="mt-0.5 text-xs text-text-secondary">Square works best. Up to 2 MB, JPG, PNG or WebP.</p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" id="item-image-upload" />
                      <label
                        htmlFor="item-image-upload"
                        className="inline-flex cursor-pointer items-center rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-gray-50 dark:border-border-dark dark:hover:bg-slate-800/50"
                      >
                        <Upload className="mr-1.5 h-3.5 w-3.5" />
                        {formData.image_url ? 'Replace' : 'Upload'}
                      </label>
                      {formData.image_url && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setFormData((prev) => ({ ...prev, image_url: '' }))}
                        >
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="border-t border-border pt-4 dark:border-border-dark">
                  <p className="text-sm font-semibold text-text-primary">More photos</p>
                  <p className="mt-0.5 text-xs text-text-secondary">Up to 7 extra photos for the product page in your store.</p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {formData.gallery_urls.map((url) => (
                      <div key={url.slice(0, 48)} className="group relative h-16 w-16 overflow-hidden rounded-lg border border-border dark:border-border-dark">
                        <img src={url} alt="" className="h-full w-full object-cover" />
                        <button
                          type="button"
                          className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100"
                          aria-label="Remove photo"
                          onClick={() =>
                            setFormData((prev) => ({
                              ...prev,
                              gallery_urls: prev.gallery_urls.filter((u) => u !== url),
                            }))
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    {formData.gallery_urls.length < 7 ? (
                      <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border text-text-muted hover:bg-gray-50 dark:border-border-dark dark:hover:bg-slate-800/50">
                        <Plus className="h-4 w-4" />
                        <input type="file" accept="image/*" className="hidden" onChange={handleGalleryUpload} />
                      </label>
                    ) : null}
                  </div>
                </div>
              </ItemSection>

              <ItemSection
                title="Pricing"
                description="Default unit and rates when this item has no variants."
              >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="type-label mb-1.5 block">Unit</label>
                <select 
                  name="unit" 
                  className="input" 
                  value={formData.unit} 
                  onChange={handleChange}
                >
                  <option value="PCS">PCS</option>
                  <option value="KG">KG</option>
                  <option value="BOX">BOX</option>
                  <option value="LTR">LTR</option>
                  <option value="MTR">MTR</option>
                  <option value="NOS">NOS (Numbers)</option>
                  <option value="HRS">HRS (Hours)</option>
                  <option value="DAYS">DAYS (Days)</option>
                </select>
              </div>

              <div>
                <label className="type-label mb-1.5 block">GST UQC</label>
                <select
                  name="uqc"
                  className="input"
                  value={formData.uqc || toGstUqc(formData.unit, formData.hsn_sac)}
                  onChange={handleChange}
                >
                  {GST_UQC_CODES.map((code) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-text-secondary">Unit code reported in the GSTR-1 HSN summary</p>
              </div>

              {!formData.has_variants && (
                <>
                  <Input 
                    label={formData.item_type === 'service' ? 'Selling price' : 'Selling price *'}
                    name="selling_price" 
                    type="number" 
                    inputMode="decimal"
                    value={formData.selling_price} 
                    onChange={handleChange} 
                    required={formData.item_type === 'goods'} 
                    placeholder="0.00" 
                  />
                  <Input label="Purchase price" name="purchase_price" type="number" inputMode="decimal" value={formData.purchase_price} onChange={handleChange} placeholder="0.00" />
                </>
              )}
                </div>
              {formData.item_type === 'service' && (
                <p className="text-xs text-text-secondary">
                  For services you buy but don&apos;t sell, you can leave the selling price empty.
                </p>
              )}
              </ItemSection>
              
              <ItemSection
                title="Supplier and HSN/SAC"
                description="Default vendor for purchases, and the tax classification printed on GST invoices."
              >
              <div className="min-w-0">
                <label className="type-label mb-1.5 block">
                  Default supplier
                </label>
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
                  />
                  {showSupplierDropdown && filteredSuppliers.length > 0 && (
                    <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-surface shadow-lg dark:border-border-dark dark:bg-surface-dark">
                      {filteredSuppliers.map((supplier) => (
                        <div
                          key={supplier.id}
                          className="px-4 py-2 hover:bg-gray-50 cursor-pointer text-sm"
                          onClick={() => {
                            setSelectedSupplier(supplier);
                            setFormData(prev => ({ ...prev, default_supplier_id: supplier.id }));
                            setSupplierSearch(supplier.name);
                            setShowSupplierDropdown(false);
                          }}
                        >
                          <div className="font-medium">{supplier.name}</div>
                          {supplier.phone && (
                            <div className="text-xs text-gray-500">{supplier.phone}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedSupplier && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSupplier(null);
                        setFormData(prev => ({ ...prev, default_supplier_id: '' }));
                        setSupplierSearch('');
                      }}
                      className="absolute right-2 top-2 text-gray-400 hover:text-gray-600 text-sm"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              <div className="min-w-0">
                <label className="type-label mb-1.5 block">
                  HSN/SAC code
                  <span className="ml-2 text-xs font-normal text-text-secondary">
                    Search by product name or code
                  </span>
                </label>
                <HSNLookup
                  value={formData.hsn_sac}
                  onChange={(code) => setFormData({ ...formData, hsn_sac: code })}
                  onSelect={(result) => {
                    const updates: any = { hsn_sac: result.code };
                    // If SAC code (starts with 99), auto-switch to service
                    if (result.code.startsWith('99')) {
                      updates.item_type = 'service';
                    }
                    if (result.gst_rate) {
                      updates.tax_rate = result.gst_rate.toString();
                    }
                    setFormData(prev => ({ ...prev, ...updates }));
                  }}
                  placeholder="Type product name or HSN/SAC code (e.g. 'biscuit', 'software', '19053100')"
                />
              </div>
              </ItemSection>

              <ItemSection
                title="Tax and GST"
                description="GST rate and MRP used when this item is billed. Applies when the item has no variants."
              >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="type-label mb-1.5 block">GST rate (%)</label>
                <select
                  name="tax_rate"
                  className="input"
                  value={formData.tax_rate === '' ? '0' : String(Number(formData.tax_rate))}
                  onChange={handleChange}
                >
                  {[...GST_RATE_SLABS, 28].map((r) => (
                    <option key={r} value={String(r)}>{r === 28 ? '28 (cess goods only)' : r}</option>
                  ))}
                  {formData.tax_rate !== '' && !isAllowedGstRate(formData.tax_rate) ? (
                    <option value={String(Number(formData.tax_rate))} disabled>
                      {Number(formData.tax_rate)} (not a current slab)
                    </option>
                  ) : null}
                </select>
                <p className="mt-1 text-xs text-text-secondary">Auto-filled when HSN/SAC code is selected</p>
              </div>
              
              {!formData.has_variants && (
                <Input 
                  label="MRP" 
                  name="mrp" 
                  type="number" 
                  inputMode="decimal"
                  value={formData.mrp} 
                  onChange={handleChange} 
                  placeholder="0.00"
                  helperText="Final invoice price including GST should not exceed this."
                />
              )}
                </div>
                <div className="border-t border-border pt-4 dark:border-border-dark">
                  <Switch
                    id="gst_included"
                    label="Selling price includes GST"
                    description="GST is worked out backwards from the selling price instead of added on top."
                    checked={formData.gst_included}
                    onChange={(checked) => setFormData({ ...formData, gst_included: checked })}
                  />
                </div>
              </ItemSection>

              {formData.item_type === 'goods' && (
                <ItemSection
                  title="Bundle (combo)"
                  description="Sell several items as one invoice line. Stock is reduced from each component when the bundle sells."
                >
                    <div className="space-y-4 min-w-0">
                        <Switch
                          label="This item is a bundle"
                          description={
                            formData.has_variants
                              ? 'Turn off variants below to set up a bundle.'
                              : 'Pick the component items and how many of each go into one bundle.'
                          }
                          checked={formData.is_bundle}
                          disabled={!!formData.has_variants}
                          onChange={(on) => {
                            setFormData((prev) => ({
                              ...prev,
                              is_bundle: on,
                              has_variants: on ? false : prev.has_variants,
                              track_batch: on ? false : prev.track_batch,
                              track_serial: on ? false : prev.track_serial,
                            }));
                            setBundleErrors({});
                            if (on) {
                              setVariants([]);
                              setVariantAttributes([
                                { name: 'Size', values: [] },
                                { name: 'Color', values: [] },
                              ]);
                              if (bundleComponents.length === 0) {
                                setBundleComponents([{ item_id: '', quantity: '1' }]);
                              }
                            } else {
                              setBundleComponents([]);
                            }
                          }}
                        />
                      {formData.is_bundle && (
                        <div className="space-y-3 border-t border-border pt-4 dark:border-border-dark">
                          <p className="text-xs text-text-secondary">
                            Choose goods items that are not bundles or variant-parents. Each row is one component per{' '}
                            <span className="font-medium">1</span> unit of this bundle.
                          </p>
                          {bundleErrors.general && (
                            <p className="text-sm text-red-600" role="alert">
                              {bundleErrors.general}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
                            <span>
                              Estimated cost:{' '}
                              <span className="font-medium text-text-primary tabular-nums">
                                ₹
                                {bundleEstimatedCost.toLocaleString('en-IN', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                            </span>
                            {bundleMarginHintPct != null && (
                              <span>
                                Margin vs selling price (hint):{' '}
                                <span className="font-medium text-text-primary tabular-nums">
                                  {bundleMarginHintPct.toFixed(1)}%
                                </span>
                              </span>
                            )}
                          </div>
                          {bundleMaxPossibleCount !== null && (
                            <div className="text-xs space-y-1">
                              <p className="text-text-secondary">
                                You can create up to{' '}
                                <span className="font-medium text-text-primary tabular-nums">
                                  {bundleMaxPossibleCount}
                                </span>{' '}
                                bundles with current stock
                              </p>
                              {bundleMaxPossibleCount === 0 && (
                                <p className="text-amber-700 dark:text-amber-500">
                                  Insufficient stock to create this bundle
                                </p>
                              )}
                            </div>
                          )}
                          <div className="space-y-2">
                            {bundleComponents.map((row, idx) => (
                              <div
                                key={idx}
                                className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:items-end"
                              >
                                <div className="flex-1 min-w-[12rem]">
                                  <label className="block text-xs font-medium text-text-secondary mb-1">
                                    Component item
                                  </label>
                                  <select
                                    className="input w-full text-sm"
                                    value={row.item_id}
                                    onChange={(e) => {
                                      const next = [...bundleComponents];
                                      next[idx] = { ...next[idx], item_id: e.target.value };
                                      setBundleComponents(next);
                                      setBundleErrors((prev) => {
                                        const rq = { ...prev.rowQty };
                                        delete rq[idx];
                                        return {
                                          general: undefined,
                                          rowQty: Object.keys(rq).length ? rq : undefined,
                                        };
                                      });
                                    }}
                                  >
                                    <option value="">Select item…</option>
                                    {selectableCatalogItems.map((it) => {
                                      const takenElsewhere = bundleComponents.some(
                                        (r, i) => i !== idx && r.item_id === it.id
                                      );
                                      return (
                                        <option key={it.id} value={it.id} disabled={takenElsewhere}>
                                          {bundleComponentOptionLabel(it)}
                                        </option>
                                      );
                                    })}
                                  </select>
                                  {row.item_id &&
                                    Number(
                                      catalogItems.find((x) => x.id === row.item_id)?.current_stock ?? 0
                                    ) <= 0 && (
                                      <p className="text-xs text-red-600 mt-1">
                                        This component has no stock.
                                      </p>
                                    )}
                                </div>
                                <div className="w-full sm:w-28">
                                  <label className="block text-xs font-medium text-text-secondary mb-1">
                                    Qty
                                  </label>
                                  <input
                                    type="number"
                                    min={0.001}
                                    step="any"
                                    className={`input w-full text-sm ${
                                      bundleErrors.rowQty?.[idx] ? 'border-red-500' : ''
                                    }`}
                                    value={row.quantity}
                                    onChange={(e) => {
                                      const next = [...bundleComponents];
                                      next[idx] = { ...next[idx], quantity: e.target.value };
                                      setBundleComponents(next);
                                      setBundleErrors((prev) => {
                                        const rq = { ...prev.rowQty };
                                        delete rq[idx];
                                        return {
                                          general: undefined,
                                          rowQty: Object.keys(rq).length ? rq : undefined,
                                        };
                                      });
                                    }}
                                  />
                                  {bundleErrors.rowQty?.[idx] && (
                                    <p className="text-xs text-red-600 mt-1">{bundleErrors.rowQty[idx]}</p>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  className="text-sm text-text-secondary hover:text-red-600 py-2 sm:pb-3 self-end"
                                  onClick={() => {
                                    setBundleComponents((rows) => rows.filter((_, i) => i !== idx));
                                    setBundleErrors({});
                                  }}
                                  aria-label="Remove component"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            ))}
                          </div>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setBundleComponents((rows) => [...rows, { item_id: '', quantity: '1' }]);
                              setBundleErrors({});
                            }}
                          >
                            <Plus className="w-4 h-4 mr-1" />
                            Add component
                          </Button>
                        </div>
                      )}
                    </div>
                </ItemSection>
              )}

              {itemCustomFieldDefs.length > 0 && (
                <ItemSection
                  title="Custom fields"
                  description="Extra details for this item. Set up fields in Settings → Custom fields."
                >
                  <CustomFieldValuesForm
                    definitions={itemCustomFieldDefs}
                    values={itemCustomFieldValues}
                    onChange={setItemCustomFieldValues}
                  />
                </ItemSection>
              )}

              {/* Retail / Legal Metrology compliance fields (shown on labels) */}
              {formData.item_type === 'goods' && (
                <ItemSection
                  title="Retail label"
                  description="Optional. Printed on barcode labels for Legal Metrology and FSSAI rules."
                >
                  <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Input
                      label="Brand / Manufacturer"
                      name="brand"
                      value={formData.brand}
                      onChange={handleChange}
                      placeholder="e.g. Parle, Britannia"
                      helperText="Printed at the top of the label."
                    />
                    <Input
                      label="Net Quantity"
                      name="net_quantity"
                      value={formData.net_quantity}
                      onChange={handleChange}
                      placeholder='e.g. "100 g", "1 L", "12 x 50 g"'
                      helperText="Required by Legal Metrology (Packaged Commodities) Rules."
                    />
                    <Input
                      label="FSSAI Licence No."
                      name="fssai_licence_no"
                      value={formData.fssai_licence_no}
                      onChange={handleChange}
                      placeholder="14-digit FSSAI number"
                      maxLength={20}
                      helperText="Required for food products."
                    />
                    <div>
                      <label className="type-label mb-1.5 block">
                        Country of Origin
                      </label>
                      <select
                        name="country_of_origin"
                        value={formData.country_of_origin}
                        onChange={handleChange}
                        className="input w-full"
                      >
                        <option value="IN">India (IN)</option>
                        <option value="CN">China (CN)</option>
                        <option value="US">United States (US)</option>
                        <option value="GB">United Kingdom (GB)</option>
                        <option value="JP">Japan (JP)</option>
                        <option value="DE">Germany (DE)</option>
                        <option value="FR">France (FR)</option>
                        <option value="AE">UAE (AE)</option>
                        <option value="SG">Singapore (SG)</option>
                        <option value="BD">Bangladesh (BD)</option>
                        <option value="LK">Sri Lanka (LK)</option>
                        <option value="NP">Nepal (NP)</option>
                        <option value="">Other / Not specified</option>
                      </select>
                      <p className="text-xs text-text-secondary mt-1">
                        ISO 3166 alpha-2 code printed on the label.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4 border-t border-border pt-4 dark:border-border-dark">
                    <Switch
                      label="Sold by weight or variable price"
                      description={
                        <>
                          For items a weighing scale prices at the counter, like loose rice or produce. The label uses a
                          variable-measure EAN-13 (prefix <code>2</code>).
                        </>
                      }
                      checked={formData.is_weighed}
                      onChange={(checked) => setFormData((prev) => ({ ...prev, is_weighed: checked }))}
                    />

                    {formData.is_weighed && (
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <Input
                          label="PLU code"
                          name="plu_code"
                          value={formData.plu_code}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              plu_code: e.target.value
                                .replace(/\D/g, '')
                                .slice(0, 5),
                            }))
                          }
                          placeholder="e.g. 01234"
                          helperText="4-5 digit code the scale uses to look up this item."
                          maxLength={5}
                        />
                        <div>
                          <label className="type-label mb-1.5 block">
                            Barcode encodes
                          </label>
                          <select
                            name="weight_barcode_mode"
                            value={formData.weight_barcode_mode}
                            onChange={(e) =>
                              setFormData((prev) => ({
                                ...prev,
                                weight_barcode_mode: e.target.value as
                                  | 'weight'
                                  | 'price',
                              }))
                            }
                            className="input w-full"
                          >
                            <option value="weight">
                              Weight in grams (scale-side pricing)
                            </option>
                            <option value="price">
                              Price in paise (pre-pack pricing)
                            </option>
                          </select>
                          <p className="text-xs text-text-secondary mt-1">
                            Weight mode is the usual choice for counter-weighing scales.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                  </div>
                </ItemSection>
              )}

              {formData.item_type === 'goods' && !formData.has_variants && !formData.is_bundle && (
                <ItemSection
                  title="Stock"
                  description="Opening balance and the low-stock alert level. Applies when the item has no variants."
                >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {!isEditMode && (
                    <Input label="Opening stock" name="opening_stock" type="number" inputMode="decimal" value={formData.opening_stock} onChange={handleChange} placeholder="0" />
                  )}
                  {isEditMode && (
                    <div>
                      <div className="type-label mb-1.5">Current stock</div>
                      <div className="text-text-primary">
                        {formData.opening_stock} {formData.unit}
                      </div>
                      <div className="text-xs text-text-secondary mt-1">
                        Adjust stock through stock movements.
                      </div>
                    </div>
                  )}
                  <Input label="Low stock alert (qty)" name="min_stock" type="number" inputMode="decimal" value={formData.min_stock} onChange={handleChange} placeholder="5" />
                </div>
                </ItemSection>
              )}

              {formData.item_type === 'goods' && (
                <ItemSection
                  title="Invoice stock policy"
                  description="Whether final invoices can include this item when there isn't enough stock. Applies to all variants too."
                >
                  <div>
                    <label className="type-label mb-1.5 block">
                      When stock is insufficient
                    </label>
                    <select
                      value={formData.sales_stock_policy}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          sales_stock_policy: e.target.value as 'inherit' | 'block' | 'allow',
                        }))
                      }
                      className="input w-full"
                    >
                      <option value="inherit">
                        Use business default (
                        {businessDefaultAllowOversell
                          ? 'allow sale when out of stock'
                          : 'block sale when out of stock'}
                        )
                      </option>
                      <option value="block">Always block sale (require enough stock)</option>
                      <option value="allow">Always allow sale (backorder / oversell)</option>
                    </select>
                    <p className="text-xs text-text-secondary mt-2">
                      Change the default for new items in Settings → Business profile → Billing preferences.
                    </p>
                  </div>
                </ItemSection>
              )}

              {/* Advanced Inventory Settings */}
              {formData.item_type === 'goods' && !formData.is_bundle && (
                <ItemSection
                  title="Advanced inventory"
                  description="Batch, serial and valuation options for stock-tracked goods."
                >
                  <div className="divide-y divide-border dark:divide-border-dark">
                    <Switch
                      className="pb-4"
                      label="Track batch numbers"
                      description="Expiry and manufacturing dates per batch, and FIFO valuation."
                      checked={formData.track_batch}
                      onChange={(checked) => setFormData({ ...formData, track_batch: checked })}
                    />
                    <Switch
                      className="py-4"
                      label="Track serial numbers"
                      description="One serial per unit, for electronics, appliances and similar goods."
                      checked={formData.track_serial}
                      onChange={(checked) => setFormData({ ...formData, track_serial: checked })}
                    />

                    <div className="pt-4">
                      <label className="type-label mb-1.5 block">
                        Stock valuation method
                      </label>
                      <select
                        name="valuation_method"
                        value={formData.valuation_method}
                        onChange={(e) => setFormData({ ...formData, valuation_method: e.target.value as any })}
                        className="input"
                      >
                        <option value="simple">Simple (Purchase Price × Quantity)</option>
                        <option value="fifo">FIFO (First In First Out)</option>
                        <option value="weighted_avg">Weighted Average</option>
                      </select>
                      <p className="text-xs text-text-secondary mt-1">
                        {formData.valuation_method === 'fifo' && 'Uses oldest batches first for cost calculation'}
                        {formData.valuation_method === 'weighted_avg' && 'Uses average cost of all batches'}
                        {formData.valuation_method === 'simple' && 'Uses item purchase price for all stock'}
                      </p>
                    </div>
                  </div>
                </ItemSection>
              )}

              {/* Variants Section */}
              {formData.item_type === 'goods' && productVariantsEnabled && !formData.is_bundle && (
                <ItemSection
                  title="Variants"
                  description="Sizes, colours and other options, each with its own SKU, barcode, stock and price."
                >
                  <Switch
                    label="This item has variants"
                    description="Add attributes like size or colour, then set pricing for each variant."
                    checked={formData.has_variants}
                    onChange={(v) => {
                      setFormData((prev) => ({
                        ...prev,
                        has_variants: v,
                        is_bundle: v ? false : prev.is_bundle,
                      }));
                      if (v) setBundleComponents([]);
                    }}
                  />

                  {formData.has_variants && (
                    <div className="space-y-6 border-t border-border pt-4 dark:border-border-dark animate-in fade-in slide-in-from-top-2">
                      {/* Attribute Management */}
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {variantAttributes.map((attr, attrIdx) => (
                          <div key={attrIdx} className="group/attr relative rounded-lg border border-border bg-gray-50 p-4 dark:border-border-dark dark:bg-slate-800/50">
                            <div className="flex items-center gap-2 mb-2">
                              <input
                                type="text"
                                value={attr.name}
                                onChange={(e) => updateAttributeName(attrIdx, e.target.value)}
                                placeholder="Attribute Name (e.g. Size)"
                                className="bg-transparent border-none focus:ring-0 p-0 text-xs font-bold uppercase text-gray-500 w-full"
                              />
                              <button type="button" onClick={() => removeAttribute(attrIdx)} className="text-gray-400 hover:text-red-500 opacity-0 group-hover/attr:opacity-100 transition-opacity">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-2 mb-3">
                              {(Array.isArray(attr.values) ? attr.values : []).map((val: string, valIdx: number) => (
                                <span key={valIdx} className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-gray-300 rounded-lg text-sm">
                                  {val}
                                  <button type="button" onClick={() => removeAttributeValue(attrIdx, valIdx)} className="text-gray-400 hover:text-red-500">
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </span>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                placeholder={`Add value...`}
                                className="flex-1 input h-9 text-sm"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    addAttributeValue(attrIdx, (e.target as HTMLInputElement).value);
                                    (e.target as HTMLInputElement).value = '';
                                  }
                                }}
                              />
                              <Button type="button" size="sm" onClick={(e) => {
                                const input = (e.currentTarget.previousElementSibling as HTMLInputElement);
                                addAttributeValue(attrIdx, input.value);
                                input.value = '';
                              }}>Add</Button>
                            </div>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={addAttribute}
                          className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border p-4 text-sm font-medium text-text-muted transition-colors hover:border-primary-300 hover:text-primary-600 dark:border-border-dark"
                        >
                          <Plus className="w-4 h-4" />
                          Add Attribute
                        </button>
                      </div>

                      {/* Variant Table */}
                      {variants.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm text-left border-collapse">
                            <thead className="bg-gray-50 border-y border-border">
                              <tr>
                                <th className="px-3 py-2 font-bold text-gray-700">Variant Name</th>
                                <th className="px-3 py-2 font-bold text-gray-700">SKU</th>
                                <th className="px-3 py-2 font-bold text-gray-700">Barcode</th>
                                <th className="px-3 py-2 font-bold text-gray-700">Stock</th>
                                <th className="px-3 py-2 font-bold text-gray-700">Sale Price</th>
                                <th className="px-3 py-2 font-bold text-gray-700">Purchase Price</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {variants.map((v, idx) => {
                                const variantBarcode = v.barcode || '';
                                const variantBarcodeType = v.barcode_type || '';
                                const variantValidation = variantBarcode ? validateBarcode(normalizeBarcode(variantBarcode), variantBarcodeType as any) : null;
                                
                                return (
                                  <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-3 py-3 font-medium text-gray-900">{v.name}</td>
                                    <td className="px-3 py-3">
                                      <input
                                        type="text"
                                        value={v.sku}
                                        onChange={(e) => updateVariant(idx, 'sku', e.target.value)}
                                        className="w-full bg-transparent border-none focus:ring-0 p-0 text-sm text-text-secondary"
                                      />
                                    </td>
                                    <td className="px-3 py-3">
                                      <div className="relative group/barcode">
                                        <input
                                          type="text"
                                          value={variantBarcode}
                                          onChange={(e) => {
                                            const normalized = normalizeBarcode(e.target.value);
                                            const validation = normalized ? validateBarcode(normalized) : null;
                                            updateVariant(idx, 'barcode', normalized);
                                            updateVariant(idx, 'barcode_type', validation?.isValid ? validation.type || '' : '');
                                          }}
                                          placeholder="Scan or enter"
                                          className="w-full bg-transparent border-none focus:ring-0 p-0 text-sm text-text-secondary pr-16"
                                        />
                                        <div className="absolute right-0 top-0 flex items-center gap-1">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const newBarcode = generateBarcode({ inStore: true });
                                              updateVariant(idx, 'barcode', newBarcode);
                                              updateVariant(idx, 'barcode_type', 'EAN13');
                                            }}
                                            className="p-1 text-gray-400 hover:text-primary-600 transition-colors"
                                            title="Generate barcode"
                                          >
                                            <RefreshCw className="w-3.5 h-3.5" />
                                          </button>
                                          {variantBarcode && variantValidation?.isValid && (
                                            <button
                                              type="button"
                                              onClick={() => handlePrintBarcode(variantBarcode, `${formData.name} (${v.name})`, v.selling_price || formData.selling_price, { itemId: editId || undefined, variantId: v.id })}
                                              className="p-1 text-gray-400 hover:text-primary-600 transition-colors"
                                              title="Print barcode"
                                            >
                                              <Printer className="w-3.5 h-3.5" />
                                            </button>
                                          )}
                                        </div>
                                        {variantValidation?.isValid && (
                                          <span className="absolute right-0 -bottom-3 text-2xs text-green-600 opacity-0 group-hover/barcode:opacity-100 transition-opacity">
                                            {variantBarcodeType}
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-3 py-3">
                                      <input
                                        type="number"
                                        value={v.opening_stock}
                                        onChange={(e) => updateVariant(idx, 'opening_stock', e.target.value)}
                                        className="w-20 bg-transparent border-none focus:ring-0 p-0 text-sm font-bold text-primary-700"
                                      />
                                    </td>
                                    <td className="px-3 py-3">
                                      <input
                                        type="number"
                                        value={v.selling_price}
                                        onChange={(e) => updateVariant(idx, 'selling_price', e.target.value)}
                                        className="w-24 bg-transparent border-none focus:ring-0 p-0 text-sm font-bold text-success-700"
                                      />
                                    </td>
                                    <td className="px-3 py-3">
                                      <input
                                        type="number"
                                        value={v.purchase_price}
                                        onChange={(e) => updateVariant(idx, 'purchase_price', e.target.value)}
                                        className="w-24 bg-transparent border-none focus:ring-0 p-0 text-sm text-text-secondary"
                                      />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed border-border py-8 text-center dark:border-border-dark">
                          <Tag className="mx-auto mb-2 h-8 w-8 text-text-muted" />
                          <p className="text-sm text-text-secondary">Add sizes or colors above to generate variants.</p>
                        </div>
                      )}
                    </div>
                  )}
                </ItemSection>
              )}

              <ItemSection
                title="Description"
                description="Optional. The WhatsApp AI assistant uses it when customers ask about this product."
              >
                <div>
                  <label htmlFor="item-description" className="type-label mb-1.5 block">Description</label>
                  <textarea
                    id="item-description"
                    name="description"
                    value={formData.description}
                    onChange={handleChange}
                    className="input min-h-[120px] w-full resize-y"
                    rows={5}
                    placeholder="Features, benefits, specifications, usage instructions, and anything a sales person should know."
                  />
                </div>
              </ItemSection>

              <ItemSection
                title="Online store"
                description="Show this item on your public store, feature it on the homepage, and set how it looks in Google and when shared."
              >
                <div className="divide-y divide-border dark:divide-border-dark">
                  <Switch
                    className="pb-4"
                    label="Show in online store"
                    description="Customers can find and order this item from your store."
                    checked={formData.show_in_store}
                    onChange={(on) =>
                      setFormData({
                        ...formData,
                        show_in_store: on,
                        featured_in_store: on ? formData.featured_in_store : false,
                      })
                    }
                  />
                  <Switch
                    className="pt-4"
                    label="Featured item"
                    description="Shown in the Featured block on the store homepage, up to 6 items. Also turns on Show in online store."
                    checked={formData.featured_in_store}
                    onChange={(on) =>
                      setFormData({
                        ...formData,
                        featured_in_store: on,
                        show_in_store: on ? true : formData.show_in_store,
                      })
                    }
                  />
                </div>
                {formData.show_in_store ? (
                  <div className="border-t border-border pt-4 dark:border-border-dark">
                    <ItemSeoFields
                      businessId={business?.id}
                      itemId={editId}
                      itemName={formData.name}
                      itemDescription={formData.description}
                      itemImageUrl={formData.image_url}
                      itemBrand={formData.brand}
                      itemCategory={categories.find((c) => c.id === formData.category_id)?.name}
                      seoTitle={formData.seo_title}
                      seoDescription={formData.seo_description}
                      seoImageUrl={formData.seo_image_url}
                      onChange={(patch) => setFormData((prev) => ({ ...prev, ...patch }))}
                    />
                  </div>
                ) : null}
              </ItemSection>
            </div>

            <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4 dark:border-border-dark">
              <Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" isLoading={loading}>
                {isEditMode ? 'Update item' : 'Save item'}
              </Button>
            </div>
          </form>
          )}
      </div>

      {/* Upgrade Modal */}
      {showUpgradePrompt && limitInfo && (
        <UpgradeModal
          limitType="items"
          currentCount={limitInfo.current}
          limit={limitInfo.limit}
          onClose={() => {
            setShowUpgradePrompt(false);
          }}
          onUpgradeSuccess={() => {
            setShowUpgradePrompt(false);
            window.location.reload();
          }}
        />
      )}

      {/* Barcode Scanner Modal */}
      {showBarcodeScanner && (
        <BarcodeScanner
          onScan={handleBarcodeScan}
          onClose={() => setShowBarcodeScanner(false)}
        />
      )}
    </>
  );
}


'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { FormSection } from '@/components/ui/FormSection';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { HSNLookup } from '@/components/ui/HSNLookup';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { UpgradeModal } from '@/components/subscription/UpgradeModal';
import { Tag, Camera, Plus, Trash2, ChevronDown, ChevronUp, Layers, Check, X, Printer, RefreshCw, Package } from 'lucide-react';
import { validateBarcode, normalizeBarcode, detectBarcodeType, generateRandomBarcode as generateBarcode } from '@/lib/barcode-validator';
import { BarcodeScanner } from '@/components/ui/BarcodeScanner';
import { useToastContext } from '@/contexts/ToastContext';
import type { Item } from '@/types/database';
import { CustomFieldValuesForm } from '@/components/custom-fields/CustomFieldValuesForm';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import {
  useCustomFieldDefinitions,
  parseItemCustomFieldsFromApi,
} from '@/components/custom-fields/CustomFieldsManager';
import type { CustomFieldValues } from '@/types/custom-fields';

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
    has_variants: false,
    track_batch: false,
    track_serial: false,
    valuation_method: 'simple' as 'fifo' | 'lifo' | 'weighted_avg' | 'simple',
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
  const { allowed: canAccess, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'items',
    action: isEditMode ? 'update' : 'create',
    skipCheck: !user?.id || !business?.id
  });
  
  // Show authorization denied if user cannot access
  if (!canAccess) {
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
        weight_barcode_mode: formData.weight_barcode_mode || 'weight'
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
    <div className="w-full min-w-0 max-w-none">
        <MobileDuplicatePageChrome
          className="mb-0 md:mb-6"
          title={isEditMode ? 'Edit item' : 'Create item'}
        />

        <Card className="p-6 sm:p-8 lg:p-10">
          {loadingItem ? (
            <div className="flex items-center justify-center py-10 text-text-secondary">
              Loading item...
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
            <div className="form-page-shell">
              <FormSection
                title="Item type"
                description="Goods are stock-tracked; services are typically non-stock."
              >
                <div className="flex flex-wrap gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="item_type"
                      value="goods"
                      checked={formData.item_type === 'goods'}
                      onChange={() =>
                        setFormData({ ...formData, item_type: 'goods' })
                      }
                      className="w-4 h-4 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-text-primary">Goods (Track Stock)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="item_type"
                      value="service"
                      checked={formData.item_type === 'service'}
                      onChange={() => {
                        setFormData({ ...formData, item_type: 'service', is_bundle: false });
                        setBundleComponents([]);
                      }}
                      className="w-4 h-4 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-text-primary">Service (No Stock)</span>
                  </label>
                </div>
              </FormSection>

              {/* Name, code, barcode + image — Zoho-style first band */}
              <FormSection
                title="Basic details"
                description="Display name, identifiers, and an image for catalogues and labels."
              >
              <div>
                <div className="flex flex-col lg:flex-row lg:items-start gap-6 lg:gap-8 xl:gap-10">
                  <div className="min-w-0 flex-1 space-y-4 w-full max-w-full sm:max-w-xl md:max-w-2xl lg:max-w-[42rem] xl:max-w-[48rem] 2xl:max-w-[52rem]">
                    <Input
                      label="Item Name"
                      name="name"
                      value={formData.name}
                      onChange={handleChange}
                      required
                      placeholder="e.g. Parle-G Biscuit"
                    />
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1">
                        Category (optional)
                      </label>
                      <select
                        name="category_id"
                        value={formData.category_id}
                        onChange={handleChange}
                        className="input w-full max-w-md"
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-4">
                      <div className="lg:col-span-4">
                        <Input
                          label="Item Code (Optional)"
                          name="code"
                          value={formData.code}
                          onChange={handleChange}
                          placeholder="P001"
                        />
                      </div>
                      <div className="sm:col-span-2 lg:col-span-8 min-w-0">
                        <label className="block text-sm font-medium text-text-secondary mb-1">
                          Barcode (Optional)
                        </label>
                        <div className="relative flex flex-wrap items-center gap-2">
                          <div className="relative min-w-[12rem] flex-1 max-w-xl">
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
                              className="p-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-primary-500 transition-colors text-gray-600 hover:text-primary-600"
                              title="Scan barcode with camera"
                            >
                              <Camera className="w-5 h-5" />
                            </button>
                            <button
                              type="button"
                              onClick={handleGenerateBarcode}
                              className="p-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-primary-500 transition-colors text-gray-600 hover:text-primary-600"
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
                                className="p-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-primary-500 transition-colors text-gray-600 hover:text-primary-600"
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
                  </div>

                  <div className="shrink-0 w-full sm:max-w-xs lg:w-56 lg:max-w-none xl:w-64 lg:sticky lg:top-24 self-start rounded-xl border border-border bg-surface p-4 shadow-sm">
                    <label className="block text-sm font-medium text-text-secondary mb-3">Item Image</label>
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-full max-w-[11rem] aspect-square border-2 border-dashed border-gray-300 rounded-xl flex items-center justify-center overflow-hidden bg-gray-50 relative group mx-auto">
                        {formData.image_url ? (
                          <>
                            <img src={formData.image_url} alt="Item" className="w-full h-full object-cover" />
                            <button
                              type="button"
                              onClick={() => setFormData((prev) => ({ ...prev, image_url: '' }))}
                              className="absolute inset-0 bg-black/40 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                            >
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </>
                        ) : (
                          <Camera className="w-8 h-8 text-gray-400" />
                        )}
                      </div>
                      <div className="w-full text-center">
                        <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" id="item-image-upload" />
                        <label
                          htmlFor="item-image-upload"
                          className="inline-flex items-center justify-center gap-2 w-full px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 cursor-pointer text-sm font-medium transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                          {formData.image_url ? 'Change Image' : 'Upload Image'}
                        </label>
                        <p className="text-xs text-text-secondary mt-2">Max 2MB. JPG, PNG or WebP.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              </FormSection>

              <FormSection
                title="Pricing"
                description="Default unit and rates when this item has no variants."
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 gap-y-6">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Unit</label>
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

              {!formData.has_variants && (
                <>
                  <Input 
                    label={formData.item_type === 'service' ? "Selling Price (Optional)" : "Selling Price"} 
                    name="selling_price" 
                    type="number" 
                    inputMode="decimal"
                    value={formData.selling_price} 
                    onChange={handleChange} 
                    required={formData.item_type === 'goods'} 
                    placeholder="0.00" 
                  />
                  <Input label="Purchase Price" name="purchase_price" type="number" inputMode="decimal" value={formData.purchase_price} onChange={handleChange} placeholder="0.00" />
                </>
              )}
                </div>
              {formData.item_type === 'service' && (
                <div className="text-sm text-primary-600 bg-slate-50 p-3 rounded-md max-w-3xl">
                  Note: For services you buy but don't sell, you can leave the selling price empty.
                </div>
              )}
              </FormSection>
              
              <FormSection
                title="Supplier & HSN/SAC"
                description="Default vendor for purchases and tax classification for GST."
              >
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 items-start">
              <div className="min-w-0">
                <label className="block text-sm font-medium text-text-secondary mb-1.5">
                  Default Supplier (Optional)
                </label>
                <div className="relative supplier-dropdown-container max-w-xl">
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="Search supplier..."
                    value={supplierSearch}
                    onChange={(e) => {
                      setSupplierSearch(e.target.value);
                      setShowSupplierDropdown(true);
                    }}
                    onFocus={() => setShowSupplierDropdown(true)}
                  />
                  {showSupplierDropdown && filteredSuppliers.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto">
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
                <label className="block text-sm font-medium text-text-secondary mb-1.5">
                  HSN/SAC Code
                  <span className="text-xs text-text-secondary ml-2">
                    (Search by product name or code)
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
                </div>
              </FormSection>

              <FormSection
                title="Tax & GST"
                description="Default tax treatment when this item has no variants."
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 gap-y-6 items-start">
              <Input 
                label="Tax Rate (%)" 
                name="tax_rate" 
                type="number" 
                inputMode="decimal"
                value={formData.tax_rate} 
                onChange={handleChange} 
                placeholder="0"
                helperText="Auto-filled when HSN/SAC code is selected"
              />
              
              <div className="space-y-2">
              <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-md">
                <input
                  type="checkbox"
                  id="gst_included"
                  name="gst_included"
                  checked={formData.gst_included}
                  onChange={(e) => setFormData({ ...formData, gst_included: e.target.checked })}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <label htmlFor="gst_included" className="text-sm font-medium text-text-secondary cursor-pointer">
                  GST Included in Selling Price
                </label>
              </div>
              {formData.gst_included && (
                <p className="text-xs text-primary-600">
                  If checked, the selling price already includes GST. GST will be calculated backwards from the selling price.
                </p>
              )}
              </div>
              
              {!formData.has_variants && (
                <Input 
                  label="MRP (Max Retail Price) (Optional)" 
                  name="mrp" 
                  type="number" 
                  inputMode="decimal"
                  value={formData.mrp} 
                  onChange={handleChange} 
                  placeholder="0.00"
                  helperText="Maximum retail price. Final invoice price (including GST) should not exceed this."
                />
              )}
                </div>
              </FormSection>

              {formData.item_type === 'goods' && (
                <FormSection
                  title="Bundle (combo)"
                  description="Sell this SKU as one line on invoices; stock is reduced from each component when you sell a bundle."
                >
                  <div className="flex items-start gap-3">
                    <Package className="w-5 h-5 text-text-secondary shrink-0 mt-0.5" aria-hidden />
                    <div className="flex-1 space-y-4 min-w-0">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.is_bundle}
                          onChange={(e) => {
                            const on = e.target.checked;
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
                          disabled={!!formData.has_variants}
                          className="w-4 h-4 text-primary-600 rounded border-gray-300 focus:ring-primary-500"
                        />
                        <span className="text-sm font-medium text-text-primary">This item is a bundle</span>
                      </label>
                      {formData.has_variants && (
                        <p className="text-xs text-text-secondary">
                          Turn off <span className="font-medium">variants</span> below to configure a bundle.
                        </p>
                      )}
                      {formData.is_bundle && (
                        <div className="space-y-3 border border-border rounded-lg p-4 bg-surface">
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
                  </div>
                </FormSection>
              )}

              {itemCustomFieldDefs.length > 0 && (
                <FormSection
                  title="Custom fields"
                  description="Extra details for this item. Configure fields in Settings → Custom fields."
                >
                  <CustomFieldValuesForm
                    definitions={itemCustomFieldDefs}
                    values={itemCustomFieldValues}
                    onChange={setItemCustomFieldValues}
                  />
                </FormSection>
              )}

              {/* Retail / Legal Metrology compliance fields (shown on labels) */}
              {formData.item_type === 'goods' && (
                <FormSection
                  title="Retail label information"
                  description="Optional fields printed on barcode labels for Indian Legal Metrology / FSSAI compliance."
                >
                  <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
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
                      <label className="block text-sm font-medium text-text-secondary mb-1">
                        Country of Origin
                      </label>
                      <select
                        name="country_of_origin"
                        value={formData.country_of_origin}
                        onChange={handleChange}
                        className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
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

                  {/* Weighed / PLU item toggle */}
                  <div className="rounded-lg border border-border bg-surface-hover p-4 space-y-3">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.is_weighed}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            is_weighed: e.target.checked,
                          }))
                        }
                        className="mt-1"
                      />
                      <div>
                        <div className="text-sm font-medium text-text-primary">
                          Sold by weight / variable price
                        </div>
                        <div className="text-xs text-text-secondary">
                          Enable this for items a weighing scale prices at the counter (loose rice, produce, deli etc.).
                          The label will use a variable-measure EAN-13 (prefix <code>2</code>).
                        </div>
                      </div>
                    </label>

                    {formData.is_weighed && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-6">
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
                          <label className="block text-sm font-medium text-text-secondary mb-1">
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
                            className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
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
                </FormSection>
              )}

              {formData.item_type === 'goods' && !formData.has_variants && !formData.is_bundle && (
                <FormSection
                  title="Stock"
                  description="Opening balance and low-stock alerts when this item has no variants."
                >
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 gap-y-6">
                  {!isEditMode && (
                    <Input label="Opening Stock" name="opening_stock" type="number" inputMode="decimal" value={formData.opening_stock} onChange={handleChange} placeholder="0" />
                  )}
                  {isEditMode && (
                    <div>
                      <div className="text-sm font-medium text-text-secondary mb-1">Current Stock</div>
                      <div className="text-text-primary">
                        {formData.opening_stock} {formData.unit}
                      </div>
                      <div className="text-xs text-text-secondary mt-1">
                        (Stock can be adjusted via stock movements)
                      </div>
                    </div>
                  )}
                  <Input label="Low Stock Alert (Qty)" name="min_stock" type="number" inputMode="decimal" value={formData.min_stock} onChange={handleChange} placeholder="5" />
                </div>
                </FormSection>
              )}

              {formData.item_type === 'goods' && (
                <FormSection
                  title="Invoice stock policy"
                  description="Whether final invoices can include this item when branch or warehouse quantity is below the line quantity. Applies to this item (including all variants if enabled)."
                >
                  <div className="max-w-xl">
                    <label className="block text-sm font-medium text-text-secondary mb-1.5">
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
                      Change the default for new items in Settings → Business profile → Product Features.
                    </p>
                  </div>
                </FormSection>
              )}

              {/* Advanced Inventory Settings */}
              {formData.item_type === 'goods' && !formData.is_bundle && (
                <FormSection
                  title="Advanced inventory"
                  description="Batch, serial, and valuation options for stock-tracked goods."
                >
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        name="track_batch"
                        checked={formData.track_batch}
                        onChange={(e) => setFormData({ ...formData, track_batch: e.target.checked })}
                        className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                      />
                      <span className="text-sm text-text-primary">Track Batch Numbers</span>
                    </label>
                    <p className="text-xs text-text-secondary ml-6">
                      Enable batch tracking for expiry dates, manufacturing dates, and FIFO/LIFO valuation
                    </p>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        name="track_serial"
                        checked={formData.track_serial}
                        onChange={(e) => setFormData({ ...formData, track_serial: e.target.checked })}
                        className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                      />
                      <span className="text-sm text-text-primary">Track Serial Numbers</span>
                    </label>
                    <p className="text-xs text-text-secondary ml-6">
                      Enable serial number tracking for individual item units (e.g., electronics, appliances)
                    </p>

                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1">
                        Stock Valuation Method
                      </label>
                      <select
                        name="valuation_method"
                        value={formData.valuation_method}
                        onChange={(e) => setFormData({ ...formData, valuation_method: e.target.value as any })}
                        className="input"
                      >
                        <option value="simple">Simple (Purchase Price × Quantity)</option>
                        <option value="fifo">FIFO (First In First Out)</option>
                        <option value="lifo">LIFO (Last In First Out)</option>
                        <option value="weighted_avg">Weighted Average</option>
                      </select>
                      <p className="text-xs text-text-secondary mt-1">
                        {formData.valuation_method === 'fifo' && 'Uses oldest batches first for cost calculation'}
                        {formData.valuation_method === 'lifo' && 'Uses newest batches first for cost calculation'}
                        {formData.valuation_method === 'weighted_avg' && 'Uses average cost of all batches'}
                        {formData.valuation_method === 'simple' && 'Uses item purchase price for all stock'}
                      </p>
                    </div>
                  </div>
                </FormSection>
              )}

              {/* Variants Section */}
              {formData.item_type === 'goods' && productVariantsEnabled && !formData.is_bundle && (
                <FormSection
                  title="Item variants"
                  description="Sizes, colors, and other attributes when product variants are enabled for your business."
                >
                  <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <Layers className="w-5 h-5 text-primary-600 shrink-0" />
                      <span className="text-sm text-text-secondary">Define attributes and variant-level pricing below.</span>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.has_variants}
                        onChange={(e) => {
                          const v = e.target.checked;
                          setFormData((prev) => ({
                            ...prev,
                            has_variants: v,
                            is_bundle: v ? false : prev.is_bundle,
                          }));
                          if (v) setBundleComponents([]);
                        }}
                        className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                      />
                      <span className="text-sm font-medium text-text-primary">Enable Variants</span>
                    </label>
                  </div>

                  {formData.has_variants && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-top-2">
                      {/* Attribute Management */}
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
                        {variantAttributes.map((attr, attrIdx) => (
                          <div key={attrIdx} className="bg-gray-50 p-4 rounded-xl border border-gray-200 relative group/attr">
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
                          className="flex items-center justify-center gap-2 p-4 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 hover:text-primary-600 hover:border-primary-200 transition-all text-sm font-medium"
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
                                          <span className="absolute right-0 -bottom-3 text-[10px] text-green-600 opacity-0 group-hover/barcode:opacity-100 transition-opacity">
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
                        <div className="text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                          <Tag className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                          <p className="text-sm text-text-secondary">Add sizes or colors above to generate variants.</p>
                        </div>
                      )}
                    </div>
                  )}
                </FormSection>
              )}

              <FormSection
                title="Description"
                description="Optional. Shown to customers via AI when they ask about this product (e.g. WhatsApp)."
              >
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  className="input w-full max-w-5xl"
                  rows={4}
                  aria-label="Item description for AI and customers"
                  placeholder="Add detailed product information, features, benefits, specifications, usage instructions, or any other details that will help customers understand the product better. This description will be used by the AI assistant when customers ask about products via WhatsApp."
                />
                <p className="text-xs text-gray-500 mt-1 max-w-5xl">
                  💡 Tip: Include features, benefits, specifications, usage instructions, or any details that help customers make informed decisions.
                </p>
              </FormSection>
            </div>

            <div className="flex justify-end gap-4 pt-4 border-t border-border">
              <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" isLoading={loading}>
                {isEditMode ? 'Update Item' : 'Save Item'}
              </Button>
            </div>
          </form>
          )}
        </Card>
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


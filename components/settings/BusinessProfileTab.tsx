'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { IntlPhoneInput } from '@/components/ui/IntlPhoneInput';
import { Save, Upload, Loader2, Plus, Edit, Trash2, Building2, CreditCard, QrCode, Wallet, ArrowRight, CheckCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLayoutData } from '@/contexts/LayoutDataContext';
import { useFeatureRegistry } from '@/hooks/useFeatureRegistry';
import { UpgradePrompt } from '@/components/subscription/UpgradePrompt';
import { INDIAN_STATES } from '@/lib/gst-utils';
import { clsx } from 'clsx';
import { useToastContext } from '@/contexts/ToastContext';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';
import { STACK_PAGE_CLASS, STACK_SECTION_CLASS } from '@/lib/page-layout';
import { ManualPaymentMethodsSettings } from '@/components/settings/manual-payments/ManualPaymentMethodsSettings';

export const BusinessProfileTab: React.FC = () => {
  const { business, branch, user, activeBranchCount } = useAuth();
  const { refreshWarehouses } = useLayoutData();
  const featureRegistry = useFeatureRegistry();
  const searchParams = useSearchParams();
  const toast = useToastContext();
  const [loading, setLoading] = useState(false);
  const [showWarehouseUpgradePrompt, setShowWarehouseUpgradePrompt] = useState(false);
  const [saving, setSaving] = useState(false);
  const [highlightedField, setHighlightedField] = useState<string | null>(null);
  const [nextFieldName, setNextFieldName] = useState<string | null>(null);
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});
  
  // Field labels mapping
  const fieldLabels: Record<string, string> = {
    name: 'Business Name',
    email: 'Email',
    phone: 'Phone',
    address_line1: 'Address',
    city: 'City',
    state: 'State',
    pincode: 'Pincode',
    gstin: 'GSTIN',
    pan: 'PAN',
    logo_url: 'Logo URL',
  };
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingSignature, setUploadingSignature] = useState(false);
  const [productVariantsEnabled, setProductVariantsEnabled] = useState(false);
  const [loadingVariantsSetting, setLoadingVariantsSetting] = useState(false);
  const [defaultAllowSaleWhenOutOfStock, setDefaultAllowSaleWhenOutOfStock] = useState(false);
  const [loadingItemSalesStockSetting, setLoadingItemSalesStockSetting] = useState(false);
  const [warehousesEnabled, setWarehousesEnabled] = useState(false);
  const [loadingWarehousesSetting, setLoadingWarehousesSetting] = useState(false);
  const [autoAssignBranchWarehouses, setAutoAssignBranchWarehouses] = useState(true);
  const [loadingAutoAssignSetting, setLoadingAutoAssignSetting] = useState(false);
  const [posModeEnabled, setPosModeEnabled] = useState(false);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [loadingBankAccounts, setLoadingBankAccounts] = useState(false);
  const [showBankAccountForm, setShowBankAccountForm] = useState(false);
  const [editingBankAccount, setEditingBankAccount] = useState<any>(null);

  const [bankAccountForm, setBankAccountForm] = useState({
    account_name: '',
    account_number: '',
    bank_name: '',
    ifsc_code: '',
    branch_name: '',
    account_type: 'current',
    is_active: true,
    notes: ''
  });
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    address_line1: '',
    address_line2: '',
    city: '',
    state: '',
    pincode: '',
    gstin: '',
    gst_registration_type: 'unregistered',
    pan: '',
    logo_url: '',
    signature_url: '',
    business_type: '',
    industry: '',
    business_model: '',
    company_introduction: '', // For AI chatbot
    iec_code: '', // Import Export Code
    swift_code: '' // SWIFT/BIC code for international payments
  });

  useEffect(() => {
    // Single active outlet: treat company identity as business row. Multiple branches: prefer branch overlay when assigned.
    const singleOutlet = activeBranchCount <= 1;
    const profileData = singleOutlet && business ? business : (branch || business);
    
    if (profileData) {
      setFormData({
        name: profileData.name || business?.name || '',
        email: profileData.email || business?.email || '',
        phone: profileData.phone || business?.phone || '',
        address_line1: profileData.address_line1 || business?.address_line1 || '',
        address_line2: profileData.address_line2 || business?.address_line2 || '',
        city: profileData.city || business?.city || '',
        state: profileData.state || business?.state || '',
        pincode: profileData.pincode || business?.pincode || '',
        gstin: profileData.gstin || business?.gstin || '',
        gst_registration_type: (business as any)?.gst_registration_type || 'unregistered',
        pan: business?.pan || '', // PAN is business-level
        logo_url: business?.logo_url || '', // Logo is business-level
        signature_url: (business as any)?.signature_url || '', // Signature is business-level
        business_type: business?.business_type || '',
        industry: business?.industry || '',
        business_model: business?.business_model || '',
        company_introduction: (business as any)?.company_introduction || '',
        iec_code: (business as any)?.iec_code || '',
        swift_code: (business as any)?.swift_code || ''
      });
      
      // Fetch product variants setting
      fetchProductVariantsSetting();
      fetchItemSalesStockDefault();
      // Fetch warehouses setting
      fetchWarehousesSetting();
      // Fetch POS mode setting
      if (typeof window !== 'undefined') {
        setPosModeEnabled(localStorage.getItem('pos_mode_enabled') === 'true');
      }
      // Fetch bank accounts
      fetchBankAccounts();
    }
  }, [business, branch, activeBranchCount]);

  // Handle URL parameter for field highlighting
  useEffect(() => {
    const highlightParam = searchParams.get('highlight');
    if (highlightParam) {
      setHighlightedField(highlightParam);
      // Scroll to field after a short delay to ensure DOM is ready
      setTimeout(() => {
        const fieldElement = fieldRefs.current[highlightParam];
        if (fieldElement) {
          fieldElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Focus the input if it's an input/select element
          if (fieldElement instanceof HTMLInputElement || fieldElement instanceof HTMLSelectElement || fieldElement instanceof HTMLTextAreaElement) {
            fieldElement.focus();
            // Add highlight class
            fieldElement.classList.add('ring-4', 'ring-red-500', 'ring-offset-2');
            // Remove highlight after 3 seconds
            setTimeout(() => {
              fieldElement.classList.remove('ring-4', 'ring-red-500', 'ring-offset-2');
            }, 3000);
          }
        }
      }, 300);
    }
  }, [searchParams]);

  // Helper to check if a field is filled
  const isFieldFilled = (fieldName: string): boolean => {
    if (fieldName === 'address_line1') {
      return !!formData.address_line1;
    }
    return !!(formData as any)[fieldName];
  };

  // Get the next missing field
  const getNextMissingField = (): string | null => {
    const fieldOrder = ['name', 'email', 'phone', 'address_line1', 'city', 'state', 'pincode', 'gstin', 'pan', 'logo_url'];
    
    if (highlightedField) {
      const currentIndex = fieldOrder.indexOf(highlightedField);
      // Find next missing field after current
      for (let i = currentIndex + 1; i < fieldOrder.length; i++) {
        const nextField = fieldOrder[i];
        if (!isFieldFilled(nextField)) {
          return nextField;
        }
      }
    } else {
      // Find first missing field
      for (const field of fieldOrder) {
        if (!isFieldFilled(field)) {
          return field;
        }
      }
    }
    
    return null; // All fields are filled
  };

  // Track field completion and move to next missing field
  const checkAndMoveToNextField = () => {
    if (!highlightedField) return;

    // If current highlighted field is filled, move to next
    if (isFieldFilled(highlightedField)) {
      const nextField = getNextMissingField();
      
      if (nextField) {
        // Show success message
        toast.success(`${fieldLabels[highlightedField]} completed! Moving to ${fieldLabels[nextField]}...`);
        
        // Update URL to highlight next field
        const url = new URL(window.location.href);
        url.searchParams.set('highlight', nextField);
        window.history.replaceState({}, '', url.toString());
        setHighlightedField(nextField);
        setNextFieldName(fieldLabels[nextField]);
        
        // Scroll to next field
        setTimeout(() => {
          const fieldElement = fieldRefs.current[nextField];
          if (fieldElement) {
            fieldElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (fieldElement instanceof HTMLInputElement || fieldElement instanceof HTMLSelectElement || fieldElement instanceof HTMLTextAreaElement) {
              fieldElement.focus();
              fieldElement.classList.add('ring-4', 'ring-red-500', 'ring-offset-2');
              setTimeout(() => {
                fieldElement.classList.remove('ring-4', 'ring-red-500', 'ring-offset-2');
              }, 3000);
            }
          }
        }, 300);
      } else {
        // All fields completed!
        toast.success('All profile fields completed! Your profile is 100% complete.');
        setHighlightedField(null);
        setNextFieldName(null);
        // Remove highlight from URL
        const url = new URL(window.location.href);
        url.searchParams.delete('highlight');
        window.history.replaceState({}, '', url.toString());
      }
    } else {
      // Update next field name even if current isn't filled yet
      const nextField = getNextMissingField();
      if (nextField) {
        setNextFieldName(fieldLabels[nextField]);
      }
    }
  };

  // Update next field name when highlighted field or formData changes
  useEffect(() => {
    if (highlightedField) {
      const fieldOrder = ['name', 'email', 'phone', 'address_line1', 'city', 'state', 'pincode', 'gstin', 'pan', 'logo_url'];
      const currentIndex = fieldOrder.indexOf(highlightedField);
      
      // Find next missing field after current
      let nextField: string | null = null;
      for (let i = currentIndex + 1; i < fieldOrder.length; i++) {
        const field = fieldOrder[i];
        if (!isFieldFilled(field)) {
          nextField = field;
          break;
        }
      }
      
      if (nextField) {
        setNextFieldName(fieldLabels[nextField]);
      } else {
        setNextFieldName(null);
      }
    } else {
      setNextFieldName(null);
    }
  }, [highlightedField, formData.name, formData.email, formData.phone, formData.address_line1, formData.city, formData.state, formData.pincode, formData.gstin, formData.pan, formData.logo_url]);

  const fetchProductVariantsSetting = async () => {
    if (!business?.id) return;
    
    try {
      const res = await fetch(`/api/settings/product-variants?business_id=${business.id}`);
      if (res.ok) {
        const data = await res.json();
        setProductVariantsEnabled(data.product_variants_enabled || false);
      }
    } catch (error) {
      console.error('Failed to fetch product variants setting:', error);
    }
  };

  const fetchItemSalesStockDefault = async () => {
    if (!business?.id) return;
    try {
      const res = await fetch(`/api/settings/item-sales-stock?business_id=${business.id}`);
      if (res.ok) {
        const data = await res.json();
        setDefaultAllowSaleWhenOutOfStock(!!data.default_allow_sale_when_out_of_stock);
      }
    } catch (error) {
      console.error('Failed to fetch item sales stock default:', error);
    }
  };

  const toggleDefaultAllowSaleWhenOutOfStock = async () => {
    if (!business?.id) return;
    setLoadingItemSalesStockSetting(true);
    try {
      const newValue = !defaultAllowSaleWhenOutOfStock;
      const res = await fetch('/api/settings/item-sales-stock', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          default_allow_sale_when_out_of_stock: newValue,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setDefaultAllowSaleWhenOutOfStock(!!data.default_allow_sale_when_out_of_stock);
        toast.success(
          newValue
            ? 'New items will default to allowing sales when out of stock (unless overridden per item).'
            : 'New items will default to blocking sales when stock is insufficient (unless overridden per item).'
        );
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to update setting');
      }
    } catch (e) {
      console.error(e);
      toast.error('Failed to update setting');
    } finally {
      setLoadingItemSalesStockSetting(false);
    }
  };

  const fetchWarehousesSetting = async () => {
    if (!business?.id) return;
    
    try {
      const res = await fetch(`/api/settings/warehouses?business_id=${business.id}`);
      if (res.ok) {
        const data = await res.json();
        setWarehousesEnabled(data.warehouses_enabled || false);
        setAutoAssignBranchWarehouses(data.auto_assign_branch_warehouses ?? true);
      }
    } catch (error) {
      console.error('Failed to fetch warehouses setting:', error);
    }
  };

  const fetchBankAccounts = async () => {
    if (!business?.id) {
      console.warn('[Bank Accounts] No business ID available');
      return;
    }
    
    setLoadingBankAccounts(true);
    try {
      console.log('[Bank Accounts] Fetching accounts for business:', business.id);
      const res = await fetch(`/api/bank-accounts?business_id=${business.id}&user_id=${user?.id}`);
      const data = await res.json();
      console.log('[Bank Accounts] Fetched accounts:', data);
      
      if (res.ok) {
        setBankAccounts(data.accounts || []);
        console.log('[Bank Accounts] Updated state with', data.accounts?.length || 0, 'accounts');
      } else {
        console.error('[Bank Accounts] Failed to fetch:', data);
      }
    } catch (error) {
      console.error('[Bank Accounts] Error fetching bank accounts:', error);
    } finally {
      setLoadingBankAccounts(false);
    }
  };

  const handleBankAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) {
      toast.error('Business ID is missing. Please refresh the page.');
      return;
    }

    // Validate required fields
    if (!bankAccountForm.account_name || !bankAccountForm.account_number || !bankAccountForm.bank_name) {
      toast.warning('Please fill in all required fields: Account Name, Account Number, and Bank Name');
      return;
    }

    try {
      const url = '/api/bank-accounts';
      const method = editingBankAccount ? 'PUT' : 'POST';
      const body = editingBankAccount
        ? { id: editingBankAccount.id, business_id: business.id, ...bankAccountForm }
        : { business_id: business.id, ...bankAccountForm };

      console.log('[Bank Account] Submitting:', { method, url, body });

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const responseData = await res.json();
      console.log('[Bank Account] Response:', { status: res.status, data: responseData });
      
      if (res.ok) {
        toast.success(`Bank account ${editingBankAccount ? 'updated' : 'added'} successfully!`);
        setShowBankAccountForm(false);
        setEditingBankAccount(null);
        setBankAccountForm({
          account_name: '',
          account_number: '',
          bank_name: '',
          ifsc_code: '',
          branch_name: '',
          account_type: 'current',
          is_active: true,
          notes: ''
        });
        // Refresh the list
        await fetchBankAccounts();
      } else {
        console.error('Bank account save failed:', responseData);
        toast.error(`Failed to ${editingBankAccount ? 'update' : 'add'} bank account: ${responseData.error || 'Unknown error'}`);
      }
    } catch (error: any) {
      console.error('Error saving bank account:', error);
      toast.error(`Failed to save bank account: ${error.message || 'Network error'}. Please check the browser console for details.`);
    }
  };

  const handleEditBankAccount = (account: any) => {
    setEditingBankAccount(account);
    setBankAccountForm({
      account_name: account.account_name || '',
      account_number: account.account_number || '',
      bank_name: account.bank_name || '',
      ifsc_code: account.ifsc_code || '',
      branch_name: account.branch_name || '',
      account_type: account.account_type || 'current',
      is_active: account.is_active !== false,
      notes: account.notes || ''
    });
    setShowBankAccountForm(true);
  };

  const handleDeleteBankAccount = async (id: string) => {
    if (!business?.id) return;
    if (!confirm('Are you sure you want to delete this bank account?')) return;

    try {
      const res = await fetch(`/api/bank-accounts?id=${id}&business_id=${business.id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        toast.success('Bank account deleted successfully!');
        fetchBankAccounts();
      } else {
        const data = await res.json();
        toast.error(`Failed to delete bank account: ${data.error}`);
      }
    } catch (error) {
      console.error('Error deleting bank account:', error);
      toast.error('Failed to delete bank account');
    }
  };

  const toggleProductVariants = async () => {
    if (!business?.id) return;
    
    setLoadingVariantsSetting(true);
    try {
      const newValue = !productVariantsEnabled;
      const res = await fetch('/api/settings/product-variants', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          product_variants_enabled: newValue
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setProductVariantsEnabled(data.product_variants_enabled);
        if (data.warning) {
          toast.warning(data.warning);
        } else {
          toast.success(`Product variants ${newValue ? 'enabled' : 'disabled'} successfully`);
        }
      } else {
        const data = await res.json();
        toast.error(`Failed to update setting: ${data.error}`);
      }
    } catch (error) {
      console.error('Failed to toggle product variants:', error);
      toast.error('Failed to update setting');
    } finally {
      setLoadingVariantsSetting(false);
    }
  };

  const toggleWarehouses = async () => {
    if (!business?.id) return;
    
    const newValue = !warehousesEnabled;
    
    // If trying to enable, check if feature is in plan
    if (newValue && !featureRegistry.hasFeature('multi_warehouse')) {
      setShowWarehouseUpgradePrompt(true);
      return;
    }
    
    setLoadingWarehousesSetting(true);
    try {
      console.log(`[Warehouses Setting] Toggling to: ${newValue} (current: ${warehousesEnabled})`);
      
      const res = await fetch('/api/settings/warehouses', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          warehouses_enabled: newValue === true // Ensure it's a boolean
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const savedValue = data.warehouses_enabled === true;
        setWarehousesEnabled(savedValue);
        
        // Verify the value was actually saved correctly
        if (savedValue !== newValue) {
          console.error(`[Warehouses Setting] Value mismatch: expected ${newValue}, got ${savedValue}`);
          toast.warning(`Setting may not have been saved correctly. Expected ${newValue ? 'enabled' : 'disabled'}, but got ${savedValue ? 'enabled' : 'disabled'}`);
        } else {
          toast.success(`Warehouses ${newValue ? 'enabled' : 'disabled'} successfully`);
        }
        
        // Refresh warehouses setting in LayoutDataContext to update sidebar without page reload
        await refreshWarehouses();
      } else {
        const data = await res.json();
        const errorMsg = data.error || data.details || 'Unknown error';
        console.error('[Warehouses Setting] Update failed:', errorMsg);
        toast.error(`Failed to update setting: ${errorMsg}`);
      }
    } catch (error) {
      console.error('Failed to toggle warehouses:', error);
      toast.error('Failed to update setting');
    } finally {
      setLoadingWarehousesSetting(false);
    }
  };

  const toggleAutoAssignBranchWarehouses = async () => {
    if (!business?.id) return;
    
    const newValue = !autoAssignBranchWarehouses;
    setLoadingAutoAssignSetting(true);
    try {
      const res = await fetch('/api/settings/warehouses', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          auto_assign_branch_warehouses: newValue === true
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const savedValue = data.auto_assign_branch_warehouses ?? true;
        setAutoAssignBranchWarehouses(savedValue);
        
        if (savedValue !== newValue) {
          console.error(`[Auto-Assign Setting] Value mismatch: expected ${newValue}, got ${savedValue}`);
        }
      } else {
        const data = await res.json();
        const errorMsg = data.error || data.details || 'Unknown error';
        console.error('[Auto-Assign Setting] Update failed:', errorMsg);
        toast.error(`Failed to update setting: ${errorMsg}`);
      }
    } catch (error) {
      console.error('Failed to toggle auto-assign setting:', error);
      toast.error('Failed to update setting');
    } finally {
      setLoadingAutoAssignSetting(false);
    }
  };

  const togglePosMode = () => {
    if (typeof window !== 'undefined') {
      const newValue = !posModeEnabled;
      localStorage.setItem('pos_mode_enabled', newValue.toString());
      setPosModeEnabled(newValue);
      // Dispatch custom event so invoice page can update immediately
      window.dispatchEvent(new Event('posModeChanged'));
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFieldBlur = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>, fieldName: string) => {
    // Check if this field is filled and move to next if it's the highlighted field
    if (highlightedField === fieldName) {
      const value = e.target.value.trim();
      // If field has a value, check and move to next
      if (value) {
        // Small delay to ensure formData state is updated
        setTimeout(() => {
          checkAndMoveToNextField();
        }, 200);
      }
    }
  };

  const handlePhoneFieldBlur = () => {
    if (highlightedField !== 'phone') return;
    setTimeout(() => {
      checkAndMoveToNextField();
    }, 200);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'logo' | 'signature') => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Set uploading state
    if (type === 'logo') {
      setUploadingLogo(true);
    } else {
      setUploadingSignature(true);
    }

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', type);

      const res = await fetch('/api/upload/image', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (res.ok) {
        // Update form data with uploaded image URL
        setFormData(prev => ({
          ...prev,
          [type === 'logo' ? 'logo_url' : 'signature_url']: data.url
        }));
        toast.success(`${type === 'logo' ? 'Logo' : 'Signature'} uploaded successfully!`);
      } else {
        toast.error(`Failed to upload ${type}: ${data.error}`);
      }
    } catch (error) {
      console.error(`Error uploading ${type}:`, error);
      toast.error(`Failed to upload ${type}`);
    } finally {
      if (type === 'logo') {
        setUploadingLogo(false);
      } else {
        setUploadingSignature(false);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) return;

    setSaving(true);
    try {
      const singleOutlet = activeBranchCount <= 1;
      const multiBranch = featureRegistry.hasFeature('multi_branch');
      const branchIsDefault = !!(branch as { is_primary?: boolean })?.is_primary;

      if (singleOutlet) {
        const res = await fetch(`/api/business/${business.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });

        if (res.ok) {
          toast.success('Business profile updated successfully!');
          if (highlightedField) {
            setTimeout(() => checkAndMoveToNextField(), 500);
          }
          setTimeout(() => window.location.reload(), 1000);
        } else {
          const data = await res.json();
          toast.error(`Failed to update profile: ${data.error}`);
        }
        return;
      }

      const businessPayload: Record<string, unknown> = {
        pan: formData.pan,
        logo_url: formData.logo_url,
        signature_url: formData.signature_url,
        business_type: formData.business_type,
        industry: formData.industry,
        business_model: formData.business_model,
        company_introduction: formData.company_introduction,
        iec_code: formData.iec_code,
        swift_code: formData.swift_code,
        gst_registration_type: formData.gst_registration_type,
      };

      const resBusiness = await fetch(`/api/business/${business.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(businessPayload),
      });

      if (!resBusiness.ok) {
        const data = await resBusiness.json();
        toast.error(`Failed to update business profile: ${data.error}`);
        return;
      }

      if (branch?.id && (multiBranch || branchIsDefault)) {
        const branchPayload = {
          business_id: business.id,
          updated_by_user_id: user?.id,
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          address_line1: formData.address_line1,
          address_line2: formData.address_line2,
          city: formData.city,
          state: formData.state,
          pincode: formData.pincode,
          gstin: formData.gstin,
        };

        const resBranch = await fetch(`/api/branches/${branch.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(branchPayload),
        });

        if (!resBranch.ok) {
          const data = await resBranch.json();
          toast.error(`Business saved, but branch profile failed: ${data.error}`);
          return;
        }
      } else if (branch?.id && !multiBranch && !branchIsDefault) {
        toast.error(
          'This outlet cannot be edited on your current plan. Switch to your default branch or upgrade for multi-branch.'
        );
        return;
      }

      toast.success('Profile updated successfully!');
      if (highlightedField) {
        setTimeout(() => checkAndMoveToNextField(), 500);
      }
      setTimeout(() => window.location.reload(), 1000);
    } catch (error) {
      console.error('Error updating profile:', error);
      toast.error('Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className={`${SETTINGS_CONTENT_WIDTH} ${STACK_PAGE_CLASS}`}>
      {/* Guided Completion Banner — info semantics (blue) per color rules */}
      {highlightedField && nextFieldName && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
                <ArrowRight className="w-5 h-5 text-white" />
              </div>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-blue-900 mb-1">
                Complete your profile: Fill in <strong>{nextFieldName}</strong>
              </p>
              <p className="text-xs text-blue-700">
                {isFieldFilled(highlightedField) 
                  ? `Great! ${fieldLabels[highlightedField]} is completed.` 
                  : `Currently filling: ${fieldLabels[highlightedField]}`}
              </p>
            </div>
            {isFieldFilled(highlightedField) && (
              <div className="flex-shrink-0">
                <CheckCircle className="w-6 h-6 text-green-600" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Branch Profile Notice — neutral block per color rules */}
      {branch && activeBranchCount > 1 && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6" data-tour="bp-branch-notice">
          <div className="flex items-start gap-3">
            <Building2 className="w-5 h-5 text-gray-600 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-gray-900">
                Branch Profile: {branch.name}
              </p>
              <p className="text-xs text-gray-700 mt-1">
                You are viewing and editing the profile for your assigned branch. Some fields (like PAN, Logo) are business-level and cannot be changed here.
              </p>
            </div>
          </div>
        </div>
      )}
      
      <form onSubmit={handleSubmit} className={STACK_PAGE_CLASS}>
      <div className="grid grid-cols-1 gap-stack-page xl:grid-cols-2 xl:items-start">
        <div className={`min-w-0 ${STACK_PAGE_CLASS}`}>
      {/* Basic Information */}
      <section data-tour="bp-basic">
        <h3 className="settings-section-title">
          {branch && activeBranchCount > 1 ? 'Branch' : 'Business'} Information
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="md:col-span-2 lg:col-span-3">
            <Input
              label={branch && activeBranchCount > 1 ? 'Branch Name *' : 'Business Name *'}
              name="name"
              value={formData.name}
              onChange={handleChange}
              onBlur={(e) => handleFieldBlur(e, 'name')}
              placeholder={branch && activeBranchCount > 1 ? 'Enter branch name' : 'Enter business name'}
              required
              inputRef={(el) => { fieldRefs.current['name'] = el; }}
              className={highlightedField === 'name' ? 'ring-4 ring-red-500 ring-offset-2' : ''}
            />
          </div>

          <Input
            label="Email"
            name="email"
            type="email"
            value={formData.email}
            onChange={handleChange}
            onBlur={(e) => handleFieldBlur(e, 'email')}
            placeholder="business@example.com"
            inputRef={(el) => { fieldRefs.current['email'] = el; }}
            className={highlightedField === 'email' ? 'ring-4 ring-red-500 ring-offset-2' : ''}
          />

          <div
            ref={(el) => {
              fieldRefs.current['phone'] = el;
            }}
            className={highlightedField === 'phone' ? 'rounded-md ring-4 ring-red-500 ring-offset-2' : ''}
          >
            <IntlPhoneInput
              label="Phone"
              value={formData.phone}
              onChange={(full) => setFormData((prev) => ({ ...prev, phone: full }))}
              onBlur={handlePhoneFieldBlur}
              nationalPlaceholder="Mobile number"
            />
          </div>
        </div>
      </section>

      {/* Business Type & Industry */}
      <section data-tour="bp-type">
        <h3 className="settings-section-title">Business Type & Industry</h3>
        <div className="grid grid-cols-1 gap-stack-page lg:grid-cols-2 lg:items-start">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Business Type</label>
            <select
              name="business_type"
              value={formData.business_type}
              onChange={handleChange}
              className="input"
            >
              <option value="">Select Business Type</option>
              <option value="retail">Retail</option>
              <option value="wholesaler">Wholesaler</option>
              <option value="distributor">Distributor</option>
              <option value="manufacturer">Manufacturer</option>
              <option value="service">Service</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Industry</label>
            <select
              name="industry"
              value={formData.industry}
              onChange={handleChange}
              className="input"
            >
              <option value="">Select Industry</option>
              <option value="pharmaceuticals">Pharmaceuticals</option>
              <option value="textiles">Textiles</option>
              <option value="garments">Garments</option>
              <option value="electronics">Electronics</option>
              <option value="food_beverages">Food & Beverages</option>
              <option value="automotive">Automotive</option>
              <option value="construction">Construction</option>
              <option value="services">Services</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Business Model</label>
            <select
              name="business_model"
              value={formData.business_model}
              onChange={handleChange}
              className="input"
            >
              <option value="">Select Business Model</option>
              <option value="b2b">B2B (Business to Business)</option>
              <option value="b2c">B2C (Business to Consumer)</option>
              <option value="b2b2c">B2B2C (Business to Business to Consumer)</option>
              <option value="export">Export</option>
              <option value="mixed">Mixed</option>
            </select>
          </div>
        </div>

        {/* Company Introduction for AI Chatbot */}
        <div className="min-w-0">
          <label className="block text-sm font-medium text-text-secondary mb-1">
            Company Introduction / About Us
          </label>
          <textarea
            name="company_introduction"
            value={formData.company_introduction}
            onChange={handleChange}
            rows={6}
            placeholder="Describe your company, products, services, values, and unique selling points. This helps the AI chatbot answer customer questions accurately..."
            className="input min-h-[140px] resize-y"
          />
          <p className="text-xs text-text-muted mt-1">
            This introduction will be used by the AI sales agent chatbot to answer customer questions on WhatsApp. 
            Include details about your products, services, delivery, payment terms, and any other information that would help a sales representative.
          </p>
        </div>
        </div>
      </section>

      {/* Product Features */}
      <section data-tour="bp-features">
        <h3 className="settings-section-title">Product Features</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-slate-800/50 rounded-lg border border-border">
            <div className="flex-1">
              <h4 className="font-medium text-text-primary mb-1">Enable Product Variants</h4>
              <p className="text-sm text-text-secondary">
                Enable this for businesses selling products with variants (color, size, etc.) like garments and textiles.
                {business?.industry && business.industry !== 'textiles' && business.industry !== 'garments' && (
                  <span className="block mt-1 text-amber-600">
                    Note: Your industry is "{business.industry}". Product variants are typically used for textiles/garments.
                  </span>
                )}
              </p>
            </div>
            <div className="ml-4">
              <button
                type="button"
                onClick={toggleProductVariants}
                disabled={loadingVariantsSetting}
                className={`
                  relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent 
                  transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2
                  ${productVariantsEnabled ? 'bg-primary-600' : 'bg-gray-200 dark:bg-slate-600'}
                  ${loadingVariantsSetting ? 'opacity-50 cursor-not-allowed' : ''}
                `}
              >
                <span
                  className={`
                    pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 
                    transition duration-200 ease-in-out
                    ${productVariantsEnabled ? 'translate-x-5' : 'translate-x-0'}
                  `}
                />
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-slate-800/50 rounded-lg border border-border">
            <div className="flex-1">
              <h4 className="font-medium text-text-primary mb-1">Default: allow sales when out of stock</h4>
              <p className="text-sm text-text-secondary">
                Applies to <strong>new items</strong> that use “business default” on the item form. You can override
                each item to always block or always allow insufficient stock for invoices.
              </p>
            </div>
            <div className="ml-4">
              <button
                type="button"
                onClick={toggleDefaultAllowSaleWhenOutOfStock}
                disabled={loadingItemSalesStockSetting}
                className={`
                  relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent 
                  transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2
                  ${defaultAllowSaleWhenOutOfStock ? 'bg-primary-600' : 'bg-gray-200 dark:bg-slate-600'}
                  ${loadingItemSalesStockSetting ? 'opacity-50 cursor-not-allowed' : ''}
                `}
              >
                <span
                  className={`
                    pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 
                    transition duration-200 ease-in-out
                    ${defaultAllowSaleWhenOutOfStock ? 'translate-x-5' : 'translate-x-0'}
                  `}
                />
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-slate-800/50 rounded-lg border border-border">
            <div className="flex-1">
              <h4 className="font-medium text-text-primary mb-1">Enable Warehouse</h4>
              <p className="text-sm text-text-secondary">
                Enable multi-warehouse/location management for inventory tracking across multiple locations.
              </p>
              {!featureRegistry.hasFeature('multi_warehouse') && !warehousesEnabled && (
                <p className="text-sm text-amber-600 mt-2">
                  This feature requires a plan upgrade. Please upgrade your plan to enable warehouses.
                </p>
              )}
            </div>
            <div className="ml-4">
              <button
                type="button"
                onClick={toggleWarehouses}
                disabled={loadingWarehousesSetting || (!featureRegistry.hasFeature('multi_warehouse') && !warehousesEnabled)}
                className={`
                  relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent 
                  transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2
                  ${warehousesEnabled ? 'bg-primary-600' : 'bg-gray-200 dark:bg-slate-600'}
                  ${loadingWarehousesSetting || (!featureRegistry.hasFeature('multi_warehouse') && !warehousesEnabled) ? 'opacity-50 cursor-not-allowed' : ''}
                `}
              >
                <span
                  className={`
                    pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 
                    transition duration-200 ease-in-out
                    ${warehousesEnabled ? 'translate-x-5' : 'translate-x-0'}
                  `}
                />
              </button>
            </div>
          </div>

        {/* Auto-Assign Branch Warehouses */}
        {warehousesEnabled && (
          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-slate-800/50 rounded-lg border border-border md:col-span-2">
            <div className="flex-1">
              <h4 className="font-medium text-text-primary mb-1">Auto-Assign Branch Warehouses</h4>
              <p className="text-sm text-text-secondary">
                When enabled, users with branch access automatically get warehouse access for warehouses linked to that branch. 
                When disabled, warehouse access must be explicitly assigned to each user.
              </p>
            </div>
            <div className="ml-4">
              <button
                type="button"
                onClick={toggleAutoAssignBranchWarehouses}
                disabled={loadingAutoAssignSetting}
                className={`
                  relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent 
                  transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2
                  ${autoAssignBranchWarehouses ? 'bg-primary-600' : 'bg-gray-200 dark:bg-slate-600'}
                  ${loadingAutoAssignSetting ? 'opacity-50 cursor-not-allowed' : ''}
                `}
              >
                <span
                  className={`
                    pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 
                    transition duration-200 ease-in-out
                    ${autoAssignBranchWarehouses ? 'translate-x-5' : 'translate-x-0'}
                  `}
                />
              </button>
            </div>
          </div>
        )}
        </div>

        {showWarehouseUpgradePrompt && (
          <UpgradePrompt
            featureKey="settings_multi_warehouse"
            featureName="Multi-Warehouse"
            onClose={() => setShowWarehouseUpgradePrompt(false)}
          />
        )}
      </section>

      {/* POS Mode */}
      <section id="pos-mode" data-tour="bp-pos" className="scroll-mt-24">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <h4 className="font-medium text-text-primary mb-1">POS Mode</h4>
            <p className="text-sm text-text-secondary">
              Enable POS mode for a retail billing interface optimized for fast checkout with two-column layout and quick payment entry.
            </p>
          </div>
          <div className="ml-4">
            <button
              type="button"
              onClick={togglePosMode}
              className={`
                relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent 
                transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2
                ${posModeEnabled ? 'bg-primary-600' : 'bg-gray-200 dark:bg-slate-600'}
              `}
            >
              <span
                className={`
                  pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 
                  transition duration-200 ease-in-out
                  ${posModeEnabled ? 'translate-x-5' : 'translate-x-0'}
                `}
              />
            </button>
          </div>
        </div>
      </section>

        </div>
        <div className={`min-w-0 ${STACK_PAGE_CLASS}`}>
      {/* Address */}
      <section data-tour="bp-address">
        <h3 className="settings-section-title">Business Address</h3>
        <div className={STACK_SECTION_CLASS}>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Input
            label="Address Line 1"
            name="address_line1"
            value={formData.address_line1}
            onChange={handleChange}
            onBlur={(e) => handleFieldBlur(e, 'address_line1')}
            placeholder="Street address, building name"
            inputRef={(el) => { fieldRefs.current['address_line1'] = el; }}
            className={highlightedField === 'address_line1' ? 'ring-4 ring-red-500 ring-offset-2' : ''}
          />

          <Input
            label="Address Line 2"
            name="address_line2"
            value={formData.address_line2}
            onChange={handleChange}
            placeholder="Area, landmark"
          />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Input
              label="City"
              name="city"
              value={formData.city}
              onChange={handleChange}
              onBlur={(e) => handleFieldBlur(e, 'city')}
              placeholder="City"
              inputRef={(el) => { fieldRefs.current['city'] = el; }}
              className={highlightedField === 'city' ? 'ring-4 ring-red-500 ring-offset-2' : ''}
            />

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">State</label>
              <select
                name="state"
                value={formData.state}
                onChange={handleChange}
                onBlur={(e) => handleFieldBlur(e, 'state')}
                ref={(el) => { fieldRefs.current['state'] = el; }}
                className={clsx(
                  "input",
                  highlightedField === 'state' ? 'ring-4 ring-red-500 ring-offset-2' : ''
                )}
              >
                <option value="">Select state</option>
                {INDIAN_STATES.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
            </div>

            <Input
              label="Pincode"
              name="pincode"
              value={formData.pincode}
              onChange={handleChange}
              onBlur={(e) => handleFieldBlur(e, 'pincode')}
              placeholder="400001"
              maxLength={6}
              inputRef={(el) => { fieldRefs.current['pincode'] = el; }}
              className={highlightedField === 'pincode' ? 'ring-4 ring-red-500 ring-offset-2' : ''}
            />
          </div>
        </div>
      </section>

      {/* GST & Tax Details */}
      <section data-tour="bp-gst">
        <h3 className="settings-section-title">GST & Tax Information</h3>
        <div className={STACK_SECTION_CLASS}>
          {/* GST Registration Type */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              GST Registration Type <span className="text-red-500">*</span>
            </label>
            <select
              name="gst_registration_type"
              value={formData.gst_registration_type}
              onChange={handleChange}
              className="w-full border border-border dark:border-slate-600 rounded-md px-3 py-2 bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
              required
            >
              <option value="regular">Regular (Normal GST)</option>
              <option value="composition">Composition Scheme</option>
              <option value="unregistered">Unregistered (No GSTIN)</option>
            </select>
            <p className="text-xs text-text-muted mt-1">
              <strong>Regular:</strong> Standard GST registration, can charge GST and issue Tax Invoices.<br />
              <strong>Composition:</strong> Simplified scheme with lower tax rate, cannot charge GST, must issue Bill of Supply.<br />
              <strong>Unregistered:</strong> No GST registration, for businesses below threshold limit.
            </p>
          </div>

          {/* GSTIN and PAN */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="GSTIN"
              name="gstin"
              value={formData.gstin}
              onChange={handleChange}
              onBlur={(e) => handleFieldBlur(e, 'gstin')}
              placeholder="27ABCDE1234F1Z5"
              maxLength={15}
              required={formData.gst_registration_type !== 'unregistered'}
              inputRef={(el) => { fieldRefs.current['gstin'] = el; }}
              className={highlightedField === 'gstin' ? 'ring-4 ring-red-500 ring-offset-2' : ''}
            />

            <Input
              label="PAN"
              name="pan"
              value={formData.pan}
              onChange={handleChange}
              onBlur={(e) => handleFieldBlur(e, 'pan')}
              placeholder="ABCDE1234F"
              maxLength={10}
              inputRef={(el) => { fieldRefs.current['pan'] = el; }}
              className={highlightedField === 'pan' ? 'ring-4 ring-red-500 ring-offset-2' : ''}
            />
          </div>

          {/* Composition Scheme Warning */}
          {formData.gst_registration_type === 'composition' && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-amber-800">
                    ⚠️ Composition Scheme Notice
                  </p>
                  <p className="text-xs text-amber-700 mt-1">
                    All your invoices will automatically be generated as <strong>Bill of Supply</strong>.
                    You cannot charge GST or issue Tax Invoices under the Composition Scheme (Section 10 of CGST Act).
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Export & Banking Details */}
      <section data-tour="bp-export">
        <h3 className="settings-section-title">Export & Banking Details</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="IEC Code (Import Export Code)"
            name="iec_code"
            value={formData.iec_code}
            onChange={handleChange}
            placeholder="10-digit IEC code"
            maxLength={10}
          />
          <Input
            label="SWIFT Code"
            name="swift_code"
            value={formData.swift_code}
            onChange={handleChange}
            placeholder="11-character SWIFT/BIC code"
            maxLength={11}
          />
        </div>
        <p className="text-xs text-text-muted mt-2">
          IEC Code is mandatory for exporters. SWIFT Code is required for international wire transfers.
        </p>
      </section>


      <div className="grid grid-cols-1 gap-stack-page lg:grid-cols-2 lg:items-start">
      {/* Logo */}
      <section data-tour="bp-logo">
        <h3 className="settings-section-title">Business Logo</h3>
        <div className={STACK_SECTION_CLASS}>
          {formData.logo_url && (
            <div className="mb-4">
              <img
                src={formData.logo_url}
                alt="Business Logo"
                className="h-24 w-auto object-contain border border-border rounded-lg p-2 bg-surface"
              />
            </div>
          )}

          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <Input
                label="Logo URL"
                name="logo_url"
                type="url"
                value={formData.logo_url}
                onChange={handleChange}
                onBlur={(e) => handleFieldBlur(e, 'logo_url')}
                placeholder="https://example.com/logo.png"
                inputRef={(el) => { fieldRefs.current['logo_url'] = el; }}
                className={highlightedField === 'logo_url' ? 'ring-4 ring-red-500 ring-offset-2' : ''}
              />
            </div>
            <div>
              <input
                type="file"
                id="logo-upload"
                accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                onChange={(e) => handleFileUpload(e, 'logo')}
                className="hidden"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => document.getElementById('logo-upload')?.click()}
                disabled={uploadingLogo}
              >
                <Upload className="w-4 h-4 mr-2" />
                {uploadingLogo ? 'Uploading...' : 'Upload Logo'}
              </Button>
            </div>
          </div>

          <p className="text-xs text-text-muted">
            Upload an image file (JPEG, PNG, GIF, WebP) up to 2MB. Logo will be displayed on invoices.
          </p>
        </div>
      </section>

      {/* Signature */}
      <section data-tour="bp-signature">
        <h3 className="settings-section-title">Authorized Signature</h3>
        <div className={STACK_SECTION_CLASS}>
          {formData.signature_url && (
            <div className="mb-4 p-4 bg-gray-50 dark:bg-slate-800/50 border border-border rounded-lg inline-block">
              <img
                src={formData.signature_url}
                alt="Signature"
                className="h-16 w-auto object-contain"
              />
            </div>
          )}

          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <Input
                label="Signature URL"
                name="signature_url"
                type="url"
                value={formData.signature_url}
                onChange={handleChange}
                placeholder="https://example.com/signature.png"
              />
            </div>
            <div>
              <input
                type="file"
                id="signature-upload"
                accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                onChange={(e) => handleFileUpload(e, 'signature')}
                className="hidden"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => document.getElementById('signature-upload')?.click()}
                disabled={uploadingSignature}
              >
                <Upload className="w-4 h-4 mr-2" />
                {uploadingSignature ? 'Uploading...' : 'Upload Signature'}
              </Button>
            </div>
          </div>

          <p className="text-xs text-text-muted">
            Upload your signature image. This will be displayed on invoices as authorized signatory.
          </p>
        </div>
      </section>
      </div>

        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end" data-tour="bp-save">
        <Button type="submit" disabled={saving}>
          <Save className="w-4 h-4 mr-2" />
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
      </form>

      <div className="grid grid-cols-1 gap-stack-page lg:grid-cols-2 lg:items-start">
      {/* Bank Accounts Section - Outside main form to avoid nested forms */}
      <section data-tour="bp-banks">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="settings-section-title mb-0">Bank Accounts</h3>
            <p className="text-sm text-text-secondary mt-1">
              Manage bank accounts that will appear on your invoices and documents
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setEditingBankAccount(null);
              setBankAccountForm({
                account_name: '',
                account_number: '',
                bank_name: '',
                ifsc_code: '',
                branch_name: '',
                account_type: 'current',
                is_active: true,
                notes: ''
              });
              setShowBankAccountForm(true);
            }}
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Bank Account
          </Button>
        </div>

        {showBankAccountForm && (
          <div className="mb-6 p-4 bg-gray-50 dark:bg-slate-800/50 rounded-lg border border-border">
            <h4 className="font-medium text-text-primary mb-4">
              {editingBankAccount ? 'Edit Bank Account' : 'Add New Bank Account'}
            </h4>
            <form 
              onSubmit={(e) => {
                console.log('[Bank Account] Form onSubmit triggered');
                handleBankAccountSubmit(e);
              }} 
              className="space-y-4"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Account Name *"
                  name="account_name"
                  value={bankAccountForm.account_name}
                  onChange={(e) => setBankAccountForm({ ...bankAccountForm, account_name: e.target.value })}
                  placeholder="e.g., Main Account, Salary Account"
                  required
                />
                <Input
                  label="Account Number *"
                  name="account_number"
                  value={bankAccountForm.account_number}
                  onChange={(e) => setBankAccountForm({ ...bankAccountForm, account_number: e.target.value })}
                  placeholder="Account number"
                  required
                />
                <Input
                  label="Bank Name *"
                  name="bank_name"
                  value={bankAccountForm.bank_name}
                  onChange={(e) => setBankAccountForm({ ...bankAccountForm, bank_name: e.target.value })}
                  placeholder="e.g., HDFC Bank, SBI"
                  required
                />
                <Input
                  label="IFSC Code"
                  name="ifsc_code"
                  value={bankAccountForm.ifsc_code}
                  onChange={(e) => setBankAccountForm({ ...bankAccountForm, ifsc_code: e.target.value })}
                  placeholder="11-character IFSC code"
                  maxLength={11}
                />
                <Input
                  label="Branch Name"
                  name="branch_name"
                  value={bankAccountForm.branch_name}
                  onChange={(e) => setBankAccountForm({ ...bankAccountForm, branch_name: e.target.value })}
                  placeholder="Branch location"
                />
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">Account Type</label>
                  <select
                    name="account_type"
                    value={bankAccountForm.account_type}
                    onChange={(e) => setBankAccountForm({ ...bankAccountForm, account_type: e.target.value })}
                    className="input"
                  >
                    <option value="current">Current</option>
                    <option value="savings">Savings</option>
                    <option value="cc">Cash Credit</option>
                    <option value="od">Overdraft</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bankAccountForm.is_active}
                    onChange={(e) => setBankAccountForm({ ...bankAccountForm, is_active: e.target.checked })}
                    className="w-4 h-4 rounded border-border dark:border-slate-500 bg-surface text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-sm text-text-secondary">Active (will appear on invoices)</span>
                </label>
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setShowBankAccountForm(false);
                    setEditingBankAccount(null);
                  }}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit"
                  onClick={(e) => {
                    console.log('[Bank Account] Submit button clicked');
                    // Don't prevent default - let form handle it
                  }}
                >
                  <Save className="w-4 h-4 mr-2" />
                  {editingBankAccount ? 'Update' : 'Add'} Account
                </Button>
              </div>
            </form>
          </div>
        )}

        {loadingBankAccounts ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
          </div>
        ) : bankAccounts.length === 0 ? (
          <div className="text-center py-8 text-text-muted">
            <Building2 className="w-12 h-12 mx-auto mb-2 text-text-muted" />
            <p>No bank accounts added yet</p>
            <p className="text-sm mt-1">Add a bank account to display it on your invoices</p>
          </div>
        ) : (
          <div className="space-y-3">
            {bankAccounts.map((account) => (
              <div
                key={account.id}
                className={`p-4 rounded-lg border ${
                  account.is_active
                    ? 'bg-surface border-border'
                    : 'bg-gray-50 dark:bg-slate-800/40 border-border opacity-75'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium text-text-primary">{account.account_name}</h4>
                      {account.is_active && (
                        <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full">
                          Active
                        </span>
                      )}
                      {!account.is_active && (
                        <span className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-slate-700 text-text-secondary rounded-full">
                          Inactive
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-text-secondary space-y-1">
                      <p><span className="font-medium">Bank:</span> {account.bank_name}</p>
                      <p><span className="font-medium">Account No:</span> {account.account_number}</p>
                      {account.ifsc_code && (
                        <p><span className="font-medium">IFSC:</span> {account.ifsc_code}</p>
                      )}
                      {account.branch_name && (
                        <p><span className="font-medium">Branch:</span> {account.branch_name}</p>
                      )}
                      {account.account_type && (
                        <p><span className="font-medium">Type:</span> {account.account_type}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <button
                      type="button"
                      onClick={() => handleEditBankAccount(account)}
                      className="p-2 text-text-secondary hover:text-primary-600 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors"
                      title="Edit"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteBankAccount(account.id)}
                      className="p-2 text-text-secondary hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-text-muted mt-4">
          💡 The first active bank account will be automatically used on your invoices and documents.
        </p>
      </section>

      <ManualPaymentMethodsSettings
        businessId={business?.id ?? null}
        userId={user?.id ?? null}
        className="w-full"
      />
      </div>
    </div>
  );
};


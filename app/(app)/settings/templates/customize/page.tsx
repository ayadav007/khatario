'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Save, RotateCcw, Palette, Type, Layout, FileText, Image as ImageIcon, RefreshCw, Eye } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';

interface TemplateSettings {
  primary_color?: string;
  secondary_color?: string;
  text_color?: string;
  table_header_color?: string;
  font_family?: string;
  font_size?: number;
  margin_top?: number;
  margin_right?: number;
  margin_bottom?: number;
  margin_left?: number;
  
  // Business Info
  show_logo?: boolean;
  show_business_name?: boolean;
  show_business_address?: boolean;
  show_business_phone?: boolean;
  show_business_email?: boolean;
  show_business_gstin?: boolean;
  show_business_website?: boolean;
  show_business_pan?: boolean;
  show_business_cin?: boolean;
  show_business_iec?: boolean;
  show_business_swift?: boolean;
  
  // Invoice Metadata
  show_invoice_number?: boolean;
  show_invoice_date?: boolean;
  show_invoice_type?: boolean;
  show_due_date?: boolean;
  show_po_number?: boolean;
  show_reference_number?: boolean;
  show_place_of_supply?: boolean;
  show_reverse_charge?: boolean;
  show_eway_bill_number?: boolean;
  show_delivery_note?: boolean;
  show_payment_terms?: boolean;
  show_other_references?: boolean;
  show_dispatched_through?: boolean;
  show_destination?: boolean;
  show_terms_of_delivery?: boolean;
  
  // Customer Info
  show_bill_to?: boolean;
  show_ship_to?: boolean;
  show_customer_name?: boolean;
  show_customer_address?: boolean;
  show_customer_phone?: boolean;
  show_customer_email?: boolean;
  show_customer_gstin?: boolean;
  show_customer_state?: boolean;
  show_customer_state_code?: boolean;
  show_customer_pan?: boolean;
  show_contact_person?: boolean;
  show_customer_country?: boolean;
  show_buyer_tax_id?: boolean;
  show_customer_balance?: boolean;
  
  // Item Fields
  show_serial_number?: boolean;
  show_item_name?: boolean;
  show_item_image?: boolean;
  show_hsn?: boolean;
  show_quantity?: boolean;
  show_unit?: boolean;
  show_rate?: boolean;
  show_discount_percent?: boolean;
  show_discount_amount?: boolean;
  show_tax_rate?: boolean;
  show_tax_amount?: boolean;
  show_line_total?: boolean;
  show_batch_number?: boolean;
  show_expiry_date?: boolean;
  
  // Totals
  show_subtotal?: boolean;
  show_discount_total?: boolean;
  show_additional_charges?: boolean;
  show_cgst?: boolean;
  show_sgst?: boolean;
  show_igst?: boolean;
  show_cess?: boolean;
  show_tax_total?: boolean;
  show_round_off?: boolean;
  show_grand_total?: boolean;
  show_paid_amount?: boolean;
  show_balance_amount?: boolean;
  show_amount_in_words?: boolean;
  
  // Bank & Payment
  show_bank_details?: boolean;
  show_bank_name?: boolean;
  show_account_number?: boolean;
  show_ifsc_code?: boolean;
  show_branch_name?: boolean;
  show_swift_code?: boolean;
  
  // Export Fields
  show_invoice_currency?: boolean;
  show_exchange_rate?: boolean;
  show_country_of_origin?: boolean;
  show_port_of_loading?: boolean;
  show_port_of_discharge?: boolean;
  show_place_of_delivery?: boolean;
  show_incoterms?: boolean;
  show_transport_mode?: boolean;
  show_awb_number?: boolean;
  show_bl_number?: boolean;
  show_export_declaration?: boolean;
  show_lut_declaration?: boolean;
  
  // Footer
  show_terms?: boolean;
  show_notes?: boolean;
  show_signature?: boolean;
  show_authorized_signatory?: boolean;
  show_qr_code?: boolean;
  
  // Content
  terms?: string;
  notes?: string;
  payment_terms?: string;
  footer_text?: string;
}

const DEFAULT_SETTINGS: TemplateSettings = {
  primary_color: '#3949AB',
  text_color: '#333333',
  table_header_color: '#EEEEEE',
  font_family: 'Inter',
  font_size: 12,
  margin_top: 40,
  margin_right: 40,
  margin_bottom: 40,
  margin_left: 40,
  
  // Business - most shown by default
  show_logo: true,
  show_business_name: true,
  show_business_address: true,
  show_business_phone: true,
  show_business_email: false,
  show_business_website: false,
  show_business_gstin: true,
  show_business_pan: false,
  show_business_cin: false,
  show_business_iec: false,
  show_business_swift: false,
  
  // Invoice Metadata - essential shown
  show_invoice_number: true,
  show_invoice_date: true,
  show_invoice_type: false,
  show_due_date: true,
  show_po_number: false,
  show_reference_number: false,
  show_place_of_supply: true,
  show_reverse_charge: false,
  show_eway_bill_number: false,
  show_delivery_note: false,
  show_payment_terms: false,
  show_other_references: false,
  show_dispatched_through: false,
  show_destination: false,
  show_terms_of_delivery: false,
  
  // Customer - standard shown
  show_bill_to: true,
  show_ship_to: false,
  show_customer_name: true,
  show_customer_address: true,
  show_customer_phone: false,
  show_customer_email: false,
  show_customer_gstin: true,
  show_customer_state: false,
  show_customer_state_code: false,
  show_customer_pan: false,
  show_contact_person: false,
  show_customer_country: false,
  show_buyer_tax_id: false,
  show_customer_balance: false,
  
  // Items - essential shown
  show_serial_number: true,
  show_item_name: true,
  show_item_image: false,
  show_hsn: true,
  show_quantity: true,
  show_unit: true,
  show_rate: true,
  show_discount_percent: false,
  show_discount_amount: true,
  show_tax_rate: true,
  show_tax_amount: true,
  show_line_total: true,
  show_batch_number: false,
  show_expiry_date: false,
  
  // Totals - all shown
  show_subtotal: true,
  show_discount_total: true,
  show_additional_charges: true,
  show_cgst: true,
  show_sgst: true,
  show_igst: true,
  show_cess: false,
  show_tax_total: true,
  show_round_off: true,
  show_grand_total: true,
  show_paid_amount: false,
  show_balance_amount: false,
  show_amount_in_words: false,
  
  // Bank - optional
  show_bank_details: false,
  show_bank_name: false,
  show_account_number: false,
  show_ifsc_code: false,
  show_branch_name: false,
  show_swift_code: false,
  
  // Export - hidden by default
  show_invoice_currency: false,
  show_exchange_rate: false,
  show_country_of_origin: false,
  show_port_of_loading: false,
  show_port_of_discharge: false,
  show_place_of_delivery: false,
  show_incoterms: false,
  show_transport_mode: false,
  show_awb_number: false,
  show_bl_number: false,
  show_export_declaration: false,
  show_lut_declaration: false,
  
  // Footer
  show_terms: true,
  show_notes: false,
  show_signature: false,
  show_authorized_signatory: false,
  show_qr_code: false,
};

const FONT_OPTIONS = [
  { value: 'Inter', label: 'Inter (Modern)' },
  { value: 'Arial', label: 'Arial (Classic)' },
  { value: 'Helvetica', label: 'Helvetica (Clean)' },
  { value: 'Georgia', label: 'Georgia (Formal)' },
  { value: 'Times New Roman', label: 'Times New Roman (Traditional)' },
];

function CustomizeTemplateContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateId = searchParams.get('template_id') || 'modern';
  const templateName = searchParams.get('template_name') || 'Modern';
  const documentType = searchParams.get('document_type') || 'tax_invoice';

  const [settings, setSettings] = useState<TemplateSettings>(DEFAULT_SETTINGS);
  const [activeTab, setActiveTab] = useState<'colors' | 'typography' | 'layout' | 'fields' | 'content'>('colors');
  const [isSaving, setIsSaving] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const { business } = useAuth();
  const toast = useToastContext();

  // Load saved settings on mount
  useEffect(() => {
    async function loadSettings() {
      if (!business?.id) return; // Wait for business to load
      
      try {
        const businessId = business.id;
        const response = await fetch(`/api/template-assignments?business_id=${businessId}&document_type=${documentType}`);
        if (response.ok) {
          const data = await response.json();
          const assignment = data.assignments?.find((a: any) => a.document_type === documentType);
          
          if (assignment && assignment.settings) {
            // Merge saved settings with defaults, ensuring all fields are present
            const savedSettings = typeof assignment.settings === 'string' 
              ? JSON.parse(assignment.settings) 
              : assignment.settings;
            
            // Merge with defaults, ensuring all show_* fields are explicitly boolean
            const merged: any = { ...DEFAULT_SETTINGS };
            Object.keys(savedSettings).forEach(key => {
              if (key.startsWith('show_')) {
                merged[key] = savedSettings[key] !== undefined ? Boolean(savedSettings[key]) : DEFAULT_SETTINGS[key as keyof TemplateSettings];
              } else {
                merged[key] = savedSettings[key] !== undefined ? savedSettings[key] : merged[key];
              }
            });
            
            setSettings(merged);
          }
        }
      } catch (error) {
        console.error('Error loading settings:', error);
      } finally {
        setSettingsLoaded(true);
      }
    }
    
    loadSettings();
  }, [documentType, business?.id]);

  // Debounced preview refresh - only after user stops typing/clicking for 800ms
  useEffect(() => {
    if (!autoRefresh || !settingsLoaded) return;
    
    const timer = setTimeout(() => {
      setPreviewKey(prev => prev + 1);
    }, 800); // Wait 800ms after last change

    return () => clearTimeout(timer);
  }, [settings, autoRefresh, settingsLoaded]);

  const handleSettingChange = (key: keyof TemplateSettings, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!business?.id) {
      console.error('Business ID not available');
      return;
    }
    
    setIsSaving(true);
    try {
      const businessId = business.id;
      const response = await fetch('/api/template-assignments', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          document_type: documentType,
          template_id: templateId, // CRITICAL: Include template_id so assignment is updated correctly
          settings
        })
      });

      if (!response.ok) throw new Error('Failed to save');
      toast.success('Template customizations saved successfully!');
    } catch (error) {
      console.error('Error saving:', error);
      toast.error('Failed to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (confirm('Reset all customizations to default?')) {
      setSettings(DEFAULT_SETTINGS);
    }
  };

  const getPreviewUrl = () => {
    // Merge current settings with defaults to ensure ALL fields are present
    // This prevents the ifSetting helper from defaulting incorrectly
    const normalizedSettings: any = { ...DEFAULT_SETTINGS, ...settings };
    
    // Ensure all show_* fields are explicitly boolean (not undefined)
    Object.keys(normalizedSettings).forEach(key => {
      if (key.startsWith('show_')) {
        // If it's in current settings, use that (explicitly boolean)
        // Otherwise, use default (which is already boolean)
        if (settings[key as keyof TemplateSettings] !== undefined) {
          normalizedSettings[key] = Boolean(settings[key as keyof TemplateSettings]);
        } else {
          normalizedSettings[key] = Boolean(DEFAULT_SETTINGS[key as keyof TemplateSettings]);
        }
      }
    });
    
    // Get business_id from auth context (avoiding localStorage SSR issues)
    const businessId = business?.id || '';
    
    const settingsJson = encodeURIComponent(JSON.stringify(normalizedSettings));
    const businessIdParam = businessId ? `&business_id=${encodeURIComponent(businessId)}` : '';
    return `/api/template-preview?template_id=${templateId}&settings=${settingsJson}${businessIdParam}&t=${previewKey}`;
  };

  return (
    <div className="h-screen bg-gray-50 dark:bg-slate-800/40 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-surface dark:bg-slate-900/70 border-b border-border px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between max-w-[1920px] mx-auto">
          <div className="flex items-center gap-4">
            <Link href="/settings/templates">
              <button className="flex items-center gap-2 px-3 py-2 text-text-secondary hover:text-text-primary hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition">
                <ArrowLeft className="w-4 h-4" />
                <span className="font-medium">Back</span>
              </button>
            </Link>
            <div className="h-6 w-px bg-gray-300"></div>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg">
                <Palette className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-text-primary">Customize Template</h1>
                <p className="text-sm text-text-secondary">{templateName} · {documentType}</p>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button 
              variant="secondary" 
              size="sm" 
              onClick={() => setPreviewKey(prev => prev + 1)}
              title="Refresh preview manually"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Button variant="secondary" size="sm" onClick={handleReset}>
              <RotateCcw className="w-4 h-4 mr-2" />
              Reset
            </Button>
            <Button variant="primary" size="sm" onClick={handleSave} disabled={isSaving}>
              <Save className="w-4 h-4 mr-2" />
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content: Side by Side */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Left: Customization Panel */}
        <aside className="w-[400px] bg-surface dark:bg-slate-900/70 border-r border-border flex flex-col flex-shrink-0 overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-border px-4 bg-gray-50 dark:bg-slate-800/40 overflow-x-auto flex-shrink-0">
            {[
              { id: 'colors' as const, label: 'Colors', icon: Palette },
              { id: 'typography' as const, label: 'Type', icon: Type },
              { id: 'layout' as const, label: 'Layout', icon: Layout },
              { id: 'fields' as const, label: 'Fields', icon: FileText },
              { id: 'content' as const, label: 'Content', icon: ImageIcon },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center gap-2 px-3 py-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap
                  ${activeTab === tab.id
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-text-secondary hover:text-text-primary'
                  }
                `}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content - Scrollable */}
          <div className="flex-1 overflow-y-auto p-6 min-h-0">
            {activeTab === 'colors' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-text-secondary mb-2">
                    Primary Color
                  </label>
                  <div className="flex gap-3 items-center">
                    <input
                      type="color"
                      value={settings.primary_color}
                      onChange={(e) => handleSettingChange('primary_color', e.target.value)}
                      className="w-16 h-10 rounded-lg border-2 border-border cursor-pointer"
                    />
                    <input
                      type="text"
                      value={settings.primary_color}
                      onChange={(e) => handleSettingChange('primary_color', e.target.value)}
                      className="flex-1 px-3 py-2 border border-border rounded-lg text-sm font-mono bg-surface text-text-primary"
                    />
                  </div>
                  <p className="text-xs text-text-muted mt-1">Used for headers, titles, and accents</p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-text-secondary mb-2">
                    Text Color
                  </label>
                  <div className="flex gap-3 items-center">
                    <input
                      type="color"
                      value={settings.text_color}
                      onChange={(e) => handleSettingChange('text_color', e.target.value)}
                      className="w-16 h-10 rounded-lg border-2 border-border cursor-pointer"
                    />
                    <input
                      type="text"
                      value={settings.text_color}
                      onChange={(e) => handleSettingChange('text_color', e.target.value)}
                      className="flex-1 px-3 py-2 border border-border rounded-lg text-sm font-mono bg-surface text-text-primary"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-text-secondary mb-2">
                    Table Header Color
                  </label>
                  <div className="flex gap-3 items-center">
                    <input
                      type="color"
                      value={settings.table_header_color}
                      onChange={(e) => handleSettingChange('table_header_color', e.target.value)}
                      className="w-16 h-10 rounded-lg border-2 border-border cursor-pointer"
                    />
                    <input
                      type="text"
                      value={settings.table_header_color}
                      onChange={(e) => handleSettingChange('table_header_color', e.target.value)}
                      className="flex-1 px-3 py-2 border border-border rounded-lg text-sm font-mono bg-surface text-text-primary"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'typography' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-text-secondary mb-2">
                    Font Family
                  </label>
                  <select
                    value={settings.font_family}
                    onChange={(e) => handleSettingChange('font_family', e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text-primary"
                  >
                    {FONT_OPTIONS.map((font) => (
                      <option key={font.value} value={font.value}>
                        {font.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-text-secondary mb-2">
                    Font Size: {settings.font_size}px
                  </label>
                  <input
                    type="range"
                    min="10"
                    max="16"
                    value={settings.font_size}
                    onChange={(e) => handleSettingChange('font_size', parseInt(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>
            )}

            {activeTab === 'layout' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-text-secondary mb-2">
                    Top Margin: {settings.margin_top}px
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={settings.margin_top}
                    onChange={(e) => handleSettingChange('margin_top', parseInt(e.target.value))}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-text-secondary mb-2">
                    Right Margin: {settings.margin_right}px
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={settings.margin_right}
                    onChange={(e) => handleSettingChange('margin_right', parseInt(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>
            )}

            {activeTab === 'fields' && (
              <div className="space-y-6">
                {/* Business Section */}
                <div>
                  <h3 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-2">
                    <div className="w-2 h-2 bg-primary-500 rounded-full"></div>
                    Business Information
                  </h3>
                  <div className="space-y-2 pl-4">
                    {[
                      { key: 'show_logo', label: 'Logo' },
                      { key: 'show_business_name', label: 'Business Name' },
                      { key: 'show_business_address', label: 'Address' },
                      { key: 'show_business_phone', label: 'Phone' },
                      { key: 'show_business_email', label: 'Email' },
                      { key: 'show_business_website', label: 'Website' },
                      { key: 'show_business_gstin', label: 'GSTIN' },
                      { key: 'show_business_pan', label: 'PAN' },
                      { key: 'show_business_cin', label: 'CIN' },
                      { key: 'show_business_iec', label: 'IEC Code' },
                      { key: 'show_business_swift', label: 'SWIFT Code' },
                    ].map((field) => (
                      <label key={field.key} className="flex items-center gap-3 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={settings[field.key as keyof TemplateSettings] as boolean}
                          onChange={(e) => handleSettingChange(field.key as keyof TemplateSettings, e.target.checked)}
                          className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                        />
                        <span className="text-sm text-text-secondary group-hover:text-text-primary">{field.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Invoice Metadata Section */}
                <div>
                  <h3 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-2">
                    <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                    Invoice Information
                  </h3>
                  <div className="space-y-2 pl-4">
                    {[
                      { key: 'show_invoice_number', label: 'Invoice Number' },
                      { key: 'show_invoice_date', label: 'Invoice Date' },
                      { key: 'show_invoice_type', label: 'Invoice Type' },
                      { key: 'show_due_date', label: 'Due Date' },
                      { key: 'show_po_number', label: 'PO Number' },
                      { key: 'show_reference_number', label: 'Reference Number' },
                      { key: 'show_place_of_supply', label: 'Place of Supply' },
                      { key: 'show_reverse_charge', label: 'Reverse Charge' },
                      { key: 'show_eway_bill_number', label: 'E-Way Bill Number' },
                      { key: 'show_delivery_note', label: 'Delivery Note' },
                      { key: 'show_payment_terms', label: 'Mode/Terms of Payment' },
                      { key: 'show_other_references', label: 'Other References' },
                      { key: 'show_dispatched_through', label: 'Dispatched through' },
                      { key: 'show_destination', label: 'Destination' },
                      { key: 'show_terms_of_delivery', label: 'Terms of Delivery' },
                    ].map((field) => (
                      <label key={field.key} className="flex items-center gap-3 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={settings[field.key as keyof TemplateSettings] as boolean}
                          onChange={(e) => handleSettingChange(field.key as keyof TemplateSettings, e.target.checked)}
                          className="w-4 h-4 text-orange-600 rounded focus:ring-orange-500"
                        />
                        <span className="text-sm text-text-secondary group-hover:text-text-primary">{field.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Customer Section */}
                <div>
                  <h3 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-2">
                    <div className="w-2 h-2 bg-primary-500 rounded-full"></div>
                    Customer Information
                  </h3>
                  <div className="space-y-2 pl-4">
                    {[
                      { key: 'show_bill_to', label: 'Bill To Section' },
                      { key: 'show_ship_to', label: 'Ship To Section' },
                      { key: 'show_customer_name', label: 'Customer Name' },
                      { key: 'show_customer_address', label: 'Customer Address' },
                      { key: 'show_customer_phone', label: 'Customer Phone' },
                      { key: 'show_customer_email', label: 'Customer Email' },
                      { key: 'show_customer_gstin', label: 'Customer GSTIN' },
                      { key: 'show_customer_state', label: 'Customer State' },
                      { key: 'show_customer_state_code', label: 'Customer State Code' },
                      { key: 'show_customer_pan', label: 'Customer PAN' },
                      { key: 'show_contact_person', label: 'Contact Person' },
                      { key: 'show_customer_country', label: 'Customer Country' },
                      { key: 'show_buyer_tax_id', label: 'Buyer Tax ID' },
                      { key: 'show_customer_balance', label: 'Customer Balance' },
                    ].map((field) => (
                      <label key={field.key} className="flex items-center gap-3 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={settings[field.key as keyof TemplateSettings] as boolean}
                          onChange={(e) => handleSettingChange(field.key as keyof TemplateSettings, e.target.checked)}
                          className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                        />
                        <span className="text-sm text-text-secondary group-hover:text-text-primary">{field.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Item Fields */}
                <div>
                  <h3 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    Item Table Fields
                  </h3>
                  <div className="space-y-2 pl-4">
                    {[
                      { key: 'show_serial_number', label: 'Serial Number' },
                      { key: 'show_item_name', label: 'Item Name' },
                      { key: 'show_item_image', label: 'Item Image' },
                      { key: 'show_hsn', label: 'HSN/SAC Code' },
                      { key: 'show_quantity', label: 'Quantity' },
                      { key: 'show_unit', label: 'Unit' },
                      { key: 'show_rate', label: 'Rate' },
                      { key: 'show_discount_percent', label: 'Discount %' },
                      { key: 'show_discount_amount', label: 'Discount Amount' },
                      { key: 'show_tax_rate', label: 'Tax Rate' },
                      { key: 'show_tax_amount', label: 'Tax Amount' },
                      { key: 'show_line_total', label: 'Line Total' },
                      { key: 'show_batch_number', label: 'Batch Number' },
                      { key: 'show_expiry_date', label: 'Expiry Date' },
                    ].map((field) => (
                      <label key={field.key} className="flex items-center gap-3 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={settings[field.key as keyof TemplateSettings] as boolean}
                          onChange={(e) => handleSettingChange(field.key as keyof TemplateSettings, e.target.checked)}
                          className="w-4 h-4 text-green-600 rounded focus:ring-green-500"
                        />
                        <span className="text-sm text-text-secondary group-hover:text-text-primary">{field.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Totals Section */}
                <div>
                  <h3 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-2">
                    <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                    Totals & Summary
                  </h3>
                  <div className="space-y-2 pl-4">
                    {[
                      { key: 'show_subtotal', label: 'Subtotal' },
                      { key: 'show_discount_total', label: 'Total Discount' },
                      { key: 'show_additional_charges', label: 'Additional Charges' },
                      { key: 'show_cgst', label: 'CGST' },
                      { key: 'show_sgst', label: 'SGST' },
                      { key: 'show_igst', label: 'IGST' },
                      { key: 'show_cess', label: 'CESS' },
                      { key: 'show_tax_total', label: 'Total Tax' },
                      { key: 'show_round_off', label: 'Round Off' },
                      { key: 'show_grand_total', label: 'Grand Total' },
                      { key: 'show_paid_amount', label: 'Paid Amount' },
                      { key: 'show_balance_amount', label: 'Balance Due' },
                      { key: 'show_amount_in_words', label: 'Amount in Words' },
                    ].map((field) => (
                      <label key={field.key} className="flex items-center gap-3 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={settings[field.key as keyof TemplateSettings] as boolean}
                          onChange={(e) => handleSettingChange(field.key as keyof TemplateSettings, e.target.checked)}
                          className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                        />
                        <span className="text-sm text-text-secondary group-hover:text-text-primary">{field.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Bank Details Section */}
                <div>
                  <h3 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-2">
                    <div className="w-2 h-2 bg-indigo-500 rounded-full"></div>
                    Bank & Payment Details
                  </h3>
                  <div className="space-y-2 pl-4">
                    {[
                      { key: 'show_bank_details', label: 'Bank Details Section' },
                      { key: 'show_bank_name', label: 'Bank Name' },
                      { key: 'show_account_number', label: 'Account Number' },
                      { key: 'show_ifsc_code', label: 'IFSC Code' },
                      { key: 'show_branch_name', label: 'Branch Name' },
                      { key: 'show_swift_code', label: 'SWIFT Code' },
                      { key: 'show_payment_terms', label: 'Payment Terms' },
                    ].map((field) => (
                      <label key={field.key} className="flex items-center gap-3 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={settings[field.key as keyof TemplateSettings] as boolean}
                          onChange={(e) => handleSettingChange(field.key as keyof TemplateSettings, e.target.checked)}
                          className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                        />
                        <span className="text-sm text-text-secondary group-hover:text-text-primary">{field.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Export Fields Section */}
                <div>
                  <h3 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-2">
                    <div className="w-2 h-2 bg-teal-500 rounded-full"></div>
                    Export Invoice Fields
                  </h3>
                  <div className="space-y-2 pl-4">
                    {[
                      { key: 'show_invoice_currency', label: 'Invoice Currency' },
                      { key: 'show_exchange_rate', label: 'Exchange Rate' },
                      { key: 'show_country_of_origin', label: 'Country of Origin' },
                      { key: 'show_port_of_loading', label: 'Port of Loading' },
                      { key: 'show_port_of_discharge', label: 'Port of Discharge' },
                      { key: 'show_place_of_delivery', label: 'Place of Delivery' },
                      { key: 'show_incoterms', label: 'Incoterms' },
                      { key: 'show_transport_mode', label: 'Transport Mode' },
                      { key: 'show_awb_number', label: 'AWB Number' },
                      { key: 'show_bl_number', label: 'BL Number' },
                      { key: 'show_export_declaration', label: 'Export Declaration' },
                      { key: 'show_lut_declaration', label: 'LUT Declaration' },
                    ].map((field) => (
                      <label key={field.key} className="flex items-center gap-3 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={settings[field.key as keyof TemplateSettings] as boolean}
                          onChange={(e) => handleSettingChange(field.key as keyof TemplateSettings, e.target.checked)}
                          className="w-4 h-4 text-teal-600 rounded focus:ring-teal-500"
                        />
                        <span className="text-sm text-text-secondary group-hover:text-text-primary">{field.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Footer Section */}
                <div>
                  <h3 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-2">
                    <div className="w-2 h-2 bg-pink-500 rounded-full"></div>
                    Footer & Additional
                  </h3>
                  <div className="space-y-2 pl-4">
                    {[
                      { key: 'show_terms', label: 'Terms & Conditions' },
                      { key: 'show_notes', label: 'Notes' },
                      { key: 'show_signature', label: 'Signature' },
                      { key: 'show_authorized_signatory', label: 'Authorized Signatory' },
                      { key: 'show_qr_code', label: 'QR Code' },
                    ].map((field) => (
                      <label key={field.key} className="flex items-center gap-3 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={settings[field.key as keyof TemplateSettings] as boolean}
                          onChange={(e) => handleSettingChange(field.key as keyof TemplateSettings, e.target.checked)}
                          className="w-4 h-4 text-pink-600 rounded focus:ring-pink-500"
                        />
                        <span className="text-sm text-text-secondary group-hover:text-text-primary">{field.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'content' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-text-secondary mb-2">
                    Terms & Conditions
                  </label>
                  <textarea
                    value={settings.terms || ''}
                    onChange={(e) => handleSettingChange('terms', e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm resize-none bg-surface text-text-primary"
                    rows={3}
                    placeholder="Enter terms..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-text-secondary mb-2">
                    Notes
                  </label>
                  <textarea
                    value={settings.notes || ''}
                    onChange={(e) => handleSettingChange('notes', e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm resize-none bg-surface text-text-primary"
                    rows={3}
                    placeholder="Add notes..."
                  />
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Right: Live Preview */}
        <main className="flex-1 bg-gradient-to-br from-gray-100 to-gray-200 p-8 overflow-y-auto overflow-x-hidden min-h-0">
          <div className="mx-auto w-full max-w-[1920px] px-2">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <h2 className="text-sm font-semibold text-text-secondary">Live Preview</h2>
                <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={(e) => setAutoRefresh(e.target.checked)}
                    className="w-4 h-4 text-primary-600 rounded"
                  />
                  <span>Auto-refresh (800ms delay)</span>
                </label>
              </div>
              <div className="flex items-center gap-2">
                {!autoRefresh && (
                  <p className="text-xs text-amber-600 font-medium">
                    <Eye className="w-3 h-3 inline mr-1" />
                    Click "Refresh" to see changes
                  </p>
                )}
                <p className="text-xs text-text-muted">Preview may take a moment to load</p>
              </div>
            </div>
            
            <div className="bg-surface dark:bg-slate-900/70 shadow-2xl rounded-lg overflow-hidden">
              <iframe
                key={previewKey}
                src={getPreviewUrl()}
                className="w-full border-0"
                style={{ height: '1123px', aspectRatio: '794/1123' }}
                title="Live Preview"
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default function CustomizeTemplatePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-text-secondary">Loading...</p>
        </div>
      </div>
    }>
      <CustomizeTemplateContent />
    </Suspense>
  );
}

'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { 
  Loader2, Check, Palette, Layout, Save, ChevronLeft, ChevronRight, 
  Printer, Bluetooth, Search, ChevronDown, ChevronUp,
  Building2, FileText, User, Table, Receipt, FileCheck, Settings
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { TemplateSettings } from '@/types/template';
import { getDefaultTemplateSettings, mergeTemplateSettings } from '@/lib/template-defaults';
import { useApiErrorHandler } from '@/hooks/useApiErrorHandler';
import { useToastContext } from '@/contexts/ToastContext';

interface Template {
  id: string;
  name: string;
  defaults: any;
}

interface CollapsibleSection {
  id: string;
  title: string;
  icon: React.ReactNode;
  fields: Array<{ key: keyof TemplateSettings; label: string }>;
}

export const InvoiceDesignTab: React.FC = () => {
  const { business } = useAuth();
  const { handleApiCall } = useApiErrorHandler();
  const toast = useToastContext();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [settings, setSettings] = useState<TemplateSettings>(getDefaultTemplateSettings());
  const [previewHtml, setPreviewHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['header', 'invoice_meta', 'party_info', 'table_columns', 'summary', 'footer'])
  );

  // Define all collapsible sections with fields
  const sections: CollapsibleSection[] = [
    {
      id: 'header',
      title: 'Header & Business Info',
      icon: <Building2 className="w-4 h-4" />,
      fields: [
        { key: 'show_logo', label: 'Show Logo' },
        { key: 'show_business_name', label: 'Show Business Name' },
        { key: 'show_business_address', label: 'Show Business Address' },
        { key: 'show_business_phone', label: 'Show Business Phone' },
        { key: 'show_business_email', label: 'Show Business Email' },
        { key: 'show_business_website', label: 'Show Business Website' },
        { key: 'show_business_gstin', label: 'Show Business GSTIN' },
        { key: 'show_business_pan', label: 'Show Business PAN' },
        { key: 'show_business_cin', label: 'Show Business CIN' },
        { key: 'show_business_iec', label: 'Show IEC Code (Export)' },
        { key: 'show_business_swift', label: 'Show SWIFT Code (Export)' },
      ],
    },
    {
      id: 'invoice_meta',
      title: 'Invoice Details',
      icon: <FileText className="w-4 h-4" />,
      fields: [
        { key: 'show_invoice_number', label: 'Show Invoice Number' },
        { key: 'show_invoice_date', label: 'Show Invoice Date' },
        { key: 'show_invoice_type', label: 'Show Invoice Type' },
        { key: 'show_due_date', label: 'Show Due Date' },
        { key: 'show_po_number', label: 'Show PO Number' },
        { key: 'show_reference_number', label: 'Show Reference Number' },
        { key: 'show_place_of_supply', label: 'Show Place of Supply' },
        { key: 'show_reverse_charge', label: 'Show Reverse Charge' },
        { key: 'show_eway_bill_number', label: 'Show E-way Bill Number' },
      ],
    },
    {
      id: 'party_info',
      title: 'Customer Information',
      icon: <User className="w-4 h-4" />,
      fields: [
        { key: 'show_bill_to', label: 'Show "Bill To" Section' },
        { key: 'show_ship_to', label: 'Show "Ship To" Section' },
        { key: 'show_customer_name', label: 'Show Customer Name' },
        { key: 'show_customer_address', label: 'Show Customer Address' },
        { key: 'show_customer_phone', label: 'Show Customer Phone' },
        { key: 'show_customer_email', label: 'Show Customer Email' },
        { key: 'show_customer_gstin', label: 'Show Customer GSTIN' },
        { key: 'show_customer_state', label: 'Show Customer State' },
        { key: 'show_customer_state_code', label: 'Show Customer State Code' },
        { key: 'show_customer_pan', label: 'Show Customer PAN' },
        { key: 'show_contact_person', label: 'Show Contact Person' },
        { key: 'show_customer_country', label: 'Show Customer Country (Export)' },
        { key: 'show_buyer_tax_id', label: 'Show Buyer Tax/VAT ID (Export)' },
      ],
    },
    {
      id: 'table_columns',
      title: 'Items Table Columns',
      icon: <Table className="w-4 h-4" />,
      fields: [
        { key: 'show_serial_number', label: 'Serial Number (#)' },
        { key: 'show_item_name', label: 'Item Name/Description' },
        { key: 'show_hsn', label: 'HSN/SAC Code' },
        { key: 'show_unit', label: 'Unit' },
        { key: 'show_quantity', label: 'Quantity' },
        { key: 'show_rate', label: 'Rate' },
        { key: 'show_discount_percent', label: 'Discount %' },
        { key: 'show_discount_amount', label: 'Discount Amount' },
        { key: 'show_tax_rate', label: 'Tax Rate %' },
        { key: 'show_tax_amount', label: 'Tax Amount' },
        { key: 'show_line_total', label: 'Line Total' },
        { key: 'show_item_image', label: 'Item Image' },
        { key: 'show_batch_number', label: 'Batch Number' },
        { key: 'show_expiry_date', label: 'Expiry Date' },
      ],
    },
    {
      id: 'summary',
      title: 'Totals & Summary',
      icon: <Receipt className="w-4 h-4" />,
      fields: [
        { key: 'show_subtotal', label: 'Show Subtotal' },
        { key: 'show_discount_total', label: 'Show Discount Total' },
        { key: 'show_additional_charges', label: 'Show Additional Charges' },
        { key: 'show_cgst', label: 'Show CGST' },
        { key: 'show_sgst', label: 'Show SGST' },
        { key: 'show_igst', label: 'Show IGST' },
        { key: 'show_cess', label: 'Show CESS' },
        { key: 'show_tax_total', label: 'Show Tax Total' },
        { key: 'show_round_off', label: 'Show Round Off' },
        { key: 'show_grand_total', label: 'Show Grand Total' },
        { key: 'show_amount_in_words', label: 'Show Amount in Words' },
        { key: 'show_paid_amount', label: 'Show Paid Amount' },
        { key: 'show_balance_amount', label: 'Show Balance Amount' },
      ],
    },
    {
      id: 'footer',
      title: 'Footer & Additional Info',
      icon: <FileCheck className="w-4 h-4" />,
      fields: [
        { key: 'show_bank_details', label: 'Show Bank Details Section' },
        { key: 'show_bank_name', label: 'Show Bank Name' },
        { key: 'show_account_number', label: 'Show Account Number' },
        { key: 'show_ifsc_code', label: 'Show IFSC Code' },
        { key: 'show_branch_name', label: 'Show Branch Name' },
        { key: 'show_swift_code', label: 'Show SWIFT Code (Export)' },
        { key: 'show_payment_terms', label: 'Show Payment Terms' },
        { key: 'show_terms', label: 'Show Terms & Conditions' },
        { key: 'show_notes', label: 'Show Notes' },
        { key: 'show_signature', label: 'Show Signature Box' },
        { key: 'show_authorized_signatory', label: 'Show Authorized Signatory' },
        { key: 'show_qr_code', label: 'Show QR Code' },
      ],
    },
    {
      id: 'export_fields',
      title: 'Export-Specific Fields',
      icon: <FileText className="w-4 h-4" />,
      fields: [
        { key: 'show_invoice_currency', label: 'Show Invoice Currency' },
        { key: 'show_exchange_rate', label: 'Show Exchange Rate' },
        { key: 'show_country_of_origin', label: 'Show Country of Origin' },
        { key: 'show_port_of_loading', label: 'Show Port of Loading' },
        { key: 'show_port_of_discharge', label: 'Show Port of Discharge' },
        { key: 'show_place_of_delivery', label: 'Show Place of Delivery' },
        { key: 'show_incoterms', label: 'Show Incoterms' },
        { key: 'show_transport_mode', label: 'Show Transport Mode' },
        { key: 'show_awb_number', label: 'Show AWB Number (Air)' },
        { key: 'show_bl_number', label: 'Show BL Number (Sea)' },
        { key: 'show_export_declaration', label: 'Show Export Declaration' },
        { key: 'show_lut_declaration', label: 'Show LUT Declaration' },
      ],
    },
  ];

  // Fetch templates on load
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch templates (this doesn't require feature access)
        const templatesRes = await fetch('/api/invoice-templates');
        const templatesData = await templatesRes.json();
        setTemplates(templatesData.templates || []);

        // Fetch saved settings (this requires feature access)
        if (business) {
          const { success, data: savedSettings } = await handleApiCall(() =>
            fetch(`/api/invoice-template-settings?business_id=${business.id}`)
          );

          if (templatesData.templates && templatesData.templates.length > 0) {
            // If we have saved settings, find the template that matches
            if (success && savedSettings && (savedSettings as any).template_id) {
              const savedTemplate = templatesData.templates.find((t: Template) => t.id === (savedSettings as any).template_id);
              if (savedTemplate) {
                setSelectedTemplate(savedTemplate);
                // Merge defaults with saved settings
                const defaults = getDefaultTemplateSettings(savedTemplate.id);
                const merged = mergeTemplateSettings(savedSettings, defaults);
                setSettings(merged);
              } else {
                // Fallback if saved template ID no longer exists
                setSelectedTemplate(templatesData.templates[0]);
                const defaults = getDefaultTemplateSettings(templatesData.templates[0].id);
                setSettings(defaults);
              }
            } else {
              // No saved settings (either not found or feature not available), use defaults
              setSelectedTemplate(templatesData.templates[0]);
              const defaults = getDefaultTemplateSettings(templatesData.templates[0].id);
              setSettings(defaults);
            }
          }
        } else {
          // No business, just set first template with defaults
          if (templatesData.templates && templatesData.templates.length > 0) {
            setSelectedTemplate(templatesData.templates[0]);
            const defaults = getDefaultTemplateSettings(templatesData.templates[0].id);
            setSettings(defaults);
          }
        }
        setLoading(false);
      } catch (err) {
        console.error(err);
        setLoading(false);
      }
    };

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business]);

  // Fetch preview when settings change
  useEffect(() => {
    if (!selectedTemplate || !business) return;

    const fetchPreview = async () => {
      setRefreshing(true);
      try {
        // Merge current settings with defaults to ensure all fields are present
        const defaults = getDefaultTemplateSettings(selectedTemplate.id);
        const mergedSettings = mergeTemplateSettings(settings, defaults);
        
        // Mock data for preview
        const mockData: any = {
          invoice: {
            invoice_title: 'INVOICE',
            invoice_number: 'INV-001',
            invoice_date: '2024-03-20',
            invoice_type: 'Tax Invoice',
            due_date: '2024-03-27',
            po_number: 'PO-12345',
            reference_number: 'REF-67890',
            place_of_supply: 'Maharashtra (27)',
            is_reverse_charge: false,
            eway_bill_number: 'EWB-987654321',
            subtotal: 10000.00,
            tax_total: 1800.00,
            grand_total: 11800.00,
            amount_in_words: 'Eleven Thousand Eight Hundred Only',
            discount_total: 0.00,
            additional_charges: 500.00,
            round_off: 0.00,
            cgst_total: 900.00,
            sgst_total: 900.00,
            igst_total: 0.00,
            cess_total: 100.00,
            is_igst: false,
            is_export: false,
            // Export-specific fields for preview
            invoice_currency: 'USD',
            exchange_rate: 83.25,
            country_of_origin: 'India',
            port_of_loading: 'Mumbai',
            port_of_discharge: 'New York',
            place_of_delivery: 'Chicago',
            incoterms: 'DDP',
            transport_mode: 'Sea',
            awb_number: 'AWB123456789',
            bl_number: 'BL987654321',
            buyer_tax_id: 'US123456789',
            lut_declaration: false,
            export_type: 'wp',
            port_code: 'INNSA1',
            shipping_bill_number: 'SB123456',
            shipping_bill_date: '2024-03-15'
          },
          business: {
            ...business,
            name: business.name || 'Demo Business',
            address: business.address || business.address_line1 || '123 Business Park, Main Road',
            address_line1: business.address_line1 || business.address || '123 Business Park, Main Road',
            address_line2: business.address_line2 || '',
            city: business.city || 'Mumbai',
            state: business.state || 'Maharashtra',
            state_code: business.state_code || '27',
            pincode: business.pincode || '400001',
            phone: business.phone || '+91 9876543210',
            email: business.email || 'business@example.com',
            website: business.website || 'www.example.com',
            gstin: business.gstin || '27ABCDE1234F1Z5',
            pan: business.pan || 'ABCDE1234F',
            cin: business.cin || 'U12345MH2024PLC123456',
            iec_code: (business as any)?.iec_code || '1234567890',
            swift_code: (business as any)?.swift_code || 'ABCDINBB123',
            // Always provide logo_url for preview (use placeholder if setting enabled but no logo)
            logo_url: mergedSettings.show_logo 
              ? (business.logo_url || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iIzM5NDlBQiIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTQiIGZpbGw9IndoaXRlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+TG9nbzwvdGV4dD48L3N2Zz4=')
              : null,
            signature_url: mergedSettings.show_signature
              ? (business.signature_url || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjUwIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxwYXRoIGQ9Ik0xMCAyNUw0MCAxNUw3MCAyNUw5MCAxNSIgc3Ryb2tlPSIjMzMzIiBzdHJva2Utd2lkdGg9IjIiIGZpbGw9Im5vbmUiLz48L3N2Zz4=')
              : null,
            bank_name: business.bank_name || 'Sample Bank',
            account_number: business.account_number || '1234567890',
            ifsc_code: business.ifsc_code || 'SBIN0001234',
            branch_name: business.branch_name || 'Main Branch'
          },
          customer: {
            name: 'Demo Customer',
            address: '456 Market Street, Business District',
            shipping_address: '789 Delivery Lane, Warehouse Area',
            phone: '+91 9988776655',
            email: 'customer@example.com',
            gstin: '27XYZAB1234C1Z1',
            state: 'Maharashtra',
            state_code: '27',
            country: 'United States',
            buyer_tax_id: 'US123456789',
            pan: 'XYZAB1234C',
            contact_person: 'John Doe'
          },
          items: [
            { 
              index: 1, 
              item_name: 'Web Development Service', 
              description: 'Full-stack web application',
              quantity: 1, 
              unit: 'QTY', 
              unit_price: 5000.00, 
              hsn_sac: '998314',
              tax_rate: 18, 
              cgst_rate: 9,
              sgst_rate: 9,
              tax_amount: 900.00,
              cgst_amount: 450.00,
              sgst_amount: 450.00,
              discount_percent: 0,
              discount_amount: 0.00,
              image_url: null,
              batch_number: null,
              expiry_date: null,
              line_total: 5900.00 
            },
            { 
              index: 2, 
              item_name: 'Hosting Server (Annual)', 
              description: 'Cloud hosting for 12 months',
              quantity: 1, 
              unit: 'QTY', 
              unit_price: 5000.00, 
              hsn_sac: '998314',
              tax_rate: 18,
              cgst_rate: 9,
              sgst_rate: 9,
              tax_amount: 900.00,
              cgst_amount: 450.00,
              sgst_amount: 450.00,
              discount_percent: 0,
              discount_amount: 0.00,
              image_url: null,
              batch_number: null,
              expiry_date: null,
              line_total: 5900.00 
            }
          ],
          settings: {
            ...mergedSettings,
            payment_terms: mergedSettings.payment_terms || 'Payment due within 30 days'
          }
        };

        const res = await fetch('/api/invoices/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            templateId: selectedTemplate.id,
            data: mockData
          })
        });
        
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
          console.error('[Preview] API Error:', errorData);
          setPreviewHtml(`<html><body style="padding: 20px; color: red;"><h3>Preview Error</h3><p>${errorData.error || 'Failed to load preview'}</p></body></html>`);
          return;
        }
        
        const { html, error } = await res.json();
        if (error) {
          console.error('[Preview] Render Error:', error);
          setPreviewHtml(`<html><body style="padding: 20px; color: red;"><h3>Render Error</h3><p>${error}</p></body></html>`);
          return;
        }
        
        setPreviewHtml(html || '');
      } catch (error: any) {
        console.error('[Preview] Fetch Error:', error);
        setPreviewHtml(`<html><body style="padding: 20px; color: red;"><h3>Preview Error</h3><p>${error?.message || 'Failed to load preview'}</p></body></html>`);
      } finally {
        setRefreshing(false);
      }
    };

    // Debounce update
    const timer = setTimeout(fetchPreview, 500);
    return () => clearTimeout(timer);
  }, [selectedTemplate, settings, business]);

  const handleSettingChange = (key: keyof TemplateSettings, value: any) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sectionId)) {
        newSet.delete(sectionId);
      } else {
        newSet.add(sectionId);
      }
      return newSet;
    });
  };

  const scrollRef = React.useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = 200;
      scrollRef.current.scrollBy({ left: direction === 'left' ? -scrollAmount : scrollAmount, behavior: 'smooth' });
    }
  };

  // Helper to render skeleton
  const TemplateSkeleton = ({ id }: { id: string }) => {
    const isSelected = selectedTemplate?.id === id;
    
    return (
      <div className={`w-24 h-32 bg-white rounded border shadow-sm relative overflow-hidden transition-all ${isSelected ? 'ring-2 ring-primary-500 border-primary-500' : 'border-border group-hover:border-primary-300 dark:group-hover:border-primary-500'}`}>
        {/* Visual logic based on template ID */}
        {id === 'business_pro' && (
          <div className="flex h-full">
            <div className="w-1/3 bg-gray-100 h-full border-r border-gray-100"></div>
            <div className="w-2/3 p-1 space-y-1">
               <div className="h-1 w-12 bg-gray-200 rounded"></div>
               <div className="h-0.5 w-full bg-gray-100"></div>
               <div className="h-0.5 w-full bg-gray-100"></div>
            </div>
          </div>
        )}
        {id === 'modern' && (
          <div className="h-full flex flex-col">
            <div className="h-6 bg-slate-100 w-full mb-1"></div>
            <div className="p-1 space-y-1">
               <div className="flex justify-between"><div className="h-1 w-8 bg-gray-200"></div><div className="h-1 w-8 bg-gray-200"></div></div>
               <div className="h-1 w-full bg-gray-100 mt-2"></div>
            </div>
          </div>
        )}
        {id === 'gst_standard' && (
          <div className="p-1 h-full flex flex-col">
            <div className="h-2 w-full border-b border-gray-200 mb-1"></div>
            <div className="flex gap-1 mb-1">
               <div className="w-1/2 h-4 border border-gray-100"></div>
               <div className="w-1/2 h-4 border border-gray-100"></div>
            </div>
            <div className="flex-1 border border-gray-100">
              <div className="h-2 bg-gray-50 border-b border-gray-100"></div>
            </div>
          </div>
        )}
        {(id === 'classic' || id === 'minimal' || id === 'elegant') && (
           <div className="p-1 h-full flex flex-col items-center pt-2">
             <div className="h-1 w-10 bg-gray-200 mb-2"></div>
             {id === 'classic' && <div className="w-full h-full border border-gray-100 p-0.5"><div className="h-2 bg-gray-50 w-full"></div></div>}
             {id === 'minimal' && <div className="w-full h-full p-0.5 space-y-1"><div className="h-0.5 w-full bg-gray-100"></div><div className="h-0.5 w-full bg-gray-100"></div></div>}
             {id === 'elegant' && <div className="w-full h-px bg-gray-200 my-1"></div>}
           </div>
        )}
        {id === 'thermal_80mm' && (
          <div className="flex justify-center h-full bg-gray-50 py-2">
             <div className="w-12 h-full bg-white border border-gray-200 shadow-sm flex flex-col items-center p-1 gap-1">
               <div className="h-1 w-8 bg-gray-300"></div>
               <div className="h-0.5 w-full border-t border-dashed border-gray-300"></div>
               <div className="h-0.5 w-6 bg-gray-200"></div>
               <div className="h-0.5 w-6 bg-gray-200"></div>
             </div>
          </div>
        )}
        {id === 'thermal_58mm' && (
          <div className="flex justify-center h-full bg-gray-50 py-2">
             <div className="w-8 h-full bg-white border border-gray-200 shadow-sm flex flex-col items-center p-0.5 gap-1">
               <div className="h-1 w-5 bg-gray-300"></div>
               <div className="h-0.5 w-full border-t border-dashed border-gray-300"></div>
               <div className="h-0.5 w-4 bg-gray-200"></div>
               <div className="h-0.5 w-4 bg-gray-200"></div>
             </div>
          </div>
        )}
        {/* Default fallback */}
        {!['business_pro', 'modern', 'gst_standard', 'classic', 'minimal', 'elegant', 'thermal_80mm', 'thermal_58mm'].includes(id) && (
           <div className="flex items-center justify-center h-full text-xs text-gray-300">ABC</div>
        )}
      </div>
    );
  };

  const handleSave = async () => {
    if (!business || !selectedTemplate) return;
    setSaving(true);
    
    const payload = {
      business_id: business.id,
      settings: {
        ...settings,
        template_id: selectedTemplate.id
      },
      is_default: true
    };

    const { success, error, isPlanFeatureDenied } = await handleApiCall(() =>
      fetch('/api/invoice-template-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
    );

    if (success) {
      toast.success('Settings saved successfully!');
    } else if (error && !isPlanFeatureDenied) {
      toast.error(error || 'Failed to save settings');
    }
    
    setSaving(false);
  };

  const handleBluetoothScan = async () => {
    // Web Bluetooth is not typed in TS lib.dom for all targets
    const bluetooth = (navigator as any).bluetooth;
    if (!bluetooth) {
      toast.warning('Web Bluetooth is not supported in this browser. Try Chrome on Android or Desktop.');
      return;
    }
    try {
      const device = await bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb'] // Generic printer service
      });
      toast.success(`Paired with: ${device.name}. You can now print to this device.`);
    } catch (err) {
      console.error(err);
      toast.error('Bluetooth connection failed.');
    }
  };

  const renderCheckboxField = (key: keyof TemplateSettings, label: string) => {
    const value = settings[key] as boolean;
    return (
      <label className="flex items-center gap-3 cursor-pointer group">
        <div className="relative flex items-center">
          <input 
            type="checkbox" 
            checked={value || false}
            onChange={(e) => handleSettingChange(key, e.target.checked)}
            className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-border dark:border-slate-500 bg-surface checked:bg-primary-500 checked:border-primary-500 transition-all"
          />
          <Check className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 text-white opacity-0 peer-checked:opacity-100" />
        </div>
        <span className="text-sm text-text-primary group-hover:text-primary-600 transition-colors">{label}</span>
      </label>
    );
  };

  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="flex flex-col lg:flex-row gap-6 lg:h-[calc(100vh-200px)]">
      {/* Controls */}
      <div className="w-full lg:w-1/3 flex flex-col gap-4 lg:overflow-y-auto pr-2 order-2 lg:order-1">
        
        {/* Template Selector */}
        <Card padding="md">
          <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm uppercase tracking-wider text-text-secondary">
            <Layout className="w-4 h-4" /> Template Style
          </h3>
          
          <div className="relative group/carousel">
            {/* Left Button */}
            <button 
              onClick={() => scroll('left')}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-surface/90 dark:bg-slate-800/90 hover:bg-surface dark:hover:bg-slate-700 shadow-md rounded-full p-1 text-text-secondary border border-border opacity-0 group-hover/carousel:opacity-100 transition-opacity disabled:opacity-0"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {/* Scroll Area */}
            <div 
              ref={scrollRef}
              className="flex overflow-x-auto gap-4 py-2 px-1 scrollbar-hide scroll-smooth"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              {(templates || []).map(t => (
                <div 
                  key={t.id}
                  onClick={() => { 
                    setSelectedTemplate(t); 
                    const defaults = getDefaultTemplateSettings(t.id);
                    setSettings(defaults);
                  }}
                  className="flex flex-col items-center gap-2 cursor-pointer group min-w-[100px]"
                >
                  <TemplateSkeleton id={t.id} />
                  
                  <div className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${selectedTemplate?.id === t.id ? 'border-primary-600 bg-primary-600' : 'border-border dark:border-slate-500 bg-surface'}`}>
                      {selectedTemplate?.id === t.id && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    <span className={`text-xs font-medium ${selectedTemplate?.id === t.id ? 'text-primary-700' : 'text-text-secondary group-hover:text-text-primary'}`}>
                      {t.name}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Right Button */}
            <button 
              onClick={() => scroll('right')}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-surface/90 dark:bg-slate-800/90 hover:bg-surface dark:hover:bg-slate-700 shadow-md rounded-full p-1 text-text-secondary border border-border opacity-0 group-hover/carousel:opacity-100 transition-opacity"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </Card>

        {/* Collapsible Field Sections */}
        <div className="space-y-2">
          {sections.map(section => {
            const isExpanded = expandedSections.has(section.id);
            return (
              <Card key={section.id} padding="none" className="overflow-hidden">
                <button
                  onClick={() => toggleSection(section.id)}
                  className="w-full p-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-slate-800/80 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {section.icon}
                    <h3 className="font-semibold text-sm text-text-primary">{section.title}</h3>
                    <span className="text-xs text-text-muted">({section.fields.length})</span>
                  </div>
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                
                {isExpanded && (
                  <div className="px-3 pb-3 pt-2 space-y-2 border-t border-border">
                    {section.fields.map(field => renderCheckboxField(field.key, field.label))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        {/* Appearance */}
        <Card padding="md">
          <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm uppercase tracking-wider text-text-secondary">
            <Palette className="w-4 h-4" /> Appearance
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-text-secondary mb-1">Primary Color</label>
              <div className="flex gap-2">
                <input 
                  type="color" 
                  value={settings.primary_color || '#000000'}
                  onChange={(e) => handleSettingChange('primary_color', e.target.value)}
                  className="h-9 w-12 rounded cursor-pointer border border-border p-1"
                />
                <Input 
                  value={settings.primary_color || '#000000'} 
                  onChange={(e) => handleSettingChange('primary_color', e.target.value)}
                  className="uppercase"
                />
              </div>
            </div>
            
            <div>
              <label className="block text-xs text-text-secondary mb-1">Font Size ({settings.font_size || 12}px)</label>
              <input 
                type="range" min="10" max="16" step="1"
                value={settings.font_size || 12}
                onChange={(e) => handleSettingChange('font_size', Number(e.target.value))}
                className="w-full accent-primary-500"
              />
            </div>

            <div>
              <label className="block text-xs text-text-secondary mb-1">Font Family</label>
              <select 
                value={settings.font_family || 'Arial, sans-serif'}
                onChange={(e) => handleSettingChange('font_family', e.target.value)}
                className="w-full h-9 px-3 rounded border border-border bg-surface text-text-primary text-sm focus:ring-1 focus:ring-primary-500"
              >
                <option value="Arial, sans-serif">Arial</option>
                <option value="'Times New Roman', serif">Times New Roman</option>
                <option value="'Courier New', monospace">Courier New</option>
                <option value="'Helvetica Neue', sans-serif">Helvetica Neue</option>
                <option value="Georgia, serif">Georgia</option>
              </select>
            </div>
          </div>
        </Card>

        {/* Page & Print Settings */}
        <Card padding="md">
          <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm uppercase tracking-wider text-text-secondary">
            <Printer className="w-4 h-4" /> Page & Print
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-text-secondary mb-1">Paper Size</label>
              <select 
                value={settings.page_size || 'A4'}
                onChange={(e) => handleSettingChange('page_size', e.target.value)}
                className="w-full h-9 px-3 rounded border border-border bg-surface text-text-primary text-sm focus:ring-1 focus:ring-primary-500"
                disabled={selectedTemplate?.id === 'thermal_80mm' || selectedTemplate?.id === 'thermal_58mm'}
              >
                <option value="A4">A4 (Standard)</option>
                <option value="A5">A5 (Compact)</option>
                <option value="Letter">Letter (US)</option>
                <option value="Legal">Legal</option>
              </select>
              {selectedTemplate?.id === 'thermal_80mm' && <p className="text-[10px] text-orange-600 mt-1">Locked to 80mm for Thermal Template</p>}
              {selectedTemplate?.id === 'thermal_58mm' && <p className="text-[10px] text-orange-600 mt-1">Locked to 58mm for Thermal Template</p>}
            </div>

            <div>
              <label className="block text-xs text-text-secondary mb-1">Orientation</label>
              <select 
                value={settings.orientation || 'portrait'}
                onChange={(e) => handleSettingChange('orientation', e.target.value)}
                className="w-full h-9 px-3 rounded border border-border bg-surface text-text-primary text-sm focus:ring-1 focus:ring-primary-500"
              >
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-text-secondary mb-1">Margins (mm)</label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] text-text-muted uppercase">Top</span>
                  <Input 
                    type="number" 
                    value={settings.margin_top ?? 10} 
                    onChange={(e) => handleSettingChange('margin_top', Number(e.target.value))}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-text-muted uppercase">Bottom</span>
                  <Input 
                    type="number" 
                    value={settings.margin_bottom ?? 10} 
                    onChange={(e) => handleSettingChange('margin_bottom', Number(e.target.value))}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-text-muted uppercase">Left</span>
                  <Input 
                    type="number" 
                    value={settings.margin_left ?? 10} 
                    onChange={(e) => handleSettingChange('margin_left', Number(e.target.value))}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-text-muted uppercase">Right</span>
                  <Input 
                    type="number" 
                    value={settings.margin_right ?? 10} 
                    onChange={(e) => handleSettingChange('margin_right', Number(e.target.value))}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Terms & Notes */}
        <Card padding="md">
          <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm uppercase tracking-wider text-text-secondary">
            <Settings className="w-4 h-4" /> Terms & Notes
          </h3>
          <div className="space-y-4">
            {settings.show_terms && (
              <div>
                <label className="block text-xs text-text-secondary mb-1">Terms & Conditions</label>
                <textarea
                  value={settings.terms || ''}
                  onChange={(e) => handleSettingChange('terms', e.target.value)}
                  className="w-full px-3 py-2 rounded border border-border bg-surface text-text-primary text-sm focus:ring-1 focus:ring-primary-500 min-h-[80px]"
                  placeholder="Payment is due within 30 days..."
                />
              </div>
            )}
            {settings.show_notes && (
              <div>
                <label className="block text-xs text-text-secondary mb-1">Notes</label>
                <textarea
                  value={settings.notes || ''}
                  onChange={(e) => handleSettingChange('notes', e.target.value)}
                  className="w-full px-3 py-2 rounded border border-border bg-surface text-text-primary text-sm focus:ring-1 focus:ring-primary-500 min-h-[80px]"
                  placeholder="Additional notes..."
                />
              </div>
            )}
            {settings.footer_text !== undefined && (
              <div>
                <label className="block text-xs text-text-secondary mb-1">Footer Text</label>
                <Input
                  value={settings.footer_text || ''}
                  onChange={(e) => handleSettingChange('footer_text', e.target.value)}
                  placeholder="Custom footer text..."
                />
              </div>
            )}
          </div>
        </Card>

        {/* Printer Connection */}
        <Card padding="md">
          <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm uppercase tracking-wider text-text-secondary">
            <Bluetooth className="w-4 h-4" /> Printer Connection
          </h3>
          <div className="p-3 bg-gray-50 dark:bg-slate-800/50 rounded border border-border text-center">
            <p className="text-xs text-text-secondary mb-3">Connect a Bluetooth Thermal Printer for direct printing from mobile.</p>
            <Button variant="secondary" size="sm" onClick={handleBluetoothScan} className="w-full">
              <Search className="w-3 h-3 mr-2" /> Find Printer
            </Button>
          </div>
        </Card>
        
        <Button onClick={handleSave} isLoading={saving} className="w-full sticky bottom-0">
          <Save className="w-4 h-4 mr-2" /> Save Changes
        </Button>
      </div>

      {/* Preview */}
      <div className="w-full lg:flex-1 bg-gray-100 dark:bg-slate-900/50 rounded-xl border border-border overflow-hidden flex flex-col shadow-inner min-h-[500px] lg:min-h-0 order-1 lg:order-2">
        <div className="p-3 bg-surface border-b border-border flex justify-between items-center">
          <span className="text-xs font-bold text-text-secondary uppercase tracking-wider">Live Preview</span>
          {refreshing && <span className="text-xs text-primary-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Updating...</span>}
        </div>
        <div className="flex-1 overflow-auto p-4 xl:p-8 flex justify-center items-start bg-gray-50/50 dark:bg-slate-950/40">
          <iframe 
            className={`bg-white shadow-xl transition-all origin-top ${selectedTemplate?.id === 'thermal_80mm' ? 'w-[85mm] min-h-[400px]' : selectedTemplate?.id === 'thermal_58mm' ? 'w-[60mm] min-h-[400px]' : 'w-[210mm] min-h-[297mm]'}`}
            style={{ 
              transform: selectedTemplate?.id === 'thermal_80mm' || selectedTemplate?.id === 'thermal_58mm' 
                ? 'scale(1)' 
                : 'scale(0.75)', 
              transformOrigin: 'top center', 
              border: 'none',
              maxWidth: '100%',
              height: 'auto'
            }} 
            srcDoc={previewHtml}
            title="Invoice Preview"
          />
        </div>
      </div>

    </div>
  );
};

import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import { Invoice, Business, Customer } from '@/types/database';

// Define types for data injection
interface RenderData {
  invoice: any;
  business: any;
  customer: any;
  items: any[];
  settings: any;
}

// Module-level flag to ensure helpers are registered only once
let helpersRegistered = false;

export class InvoiceRenderer {
  private templateDir: string;

  constructor() {
    this.templateDir = path.join(process.cwd(), 'templates');
    this.registerHelpers();
  }

  private registerHelpers() {
    if (helpersRegistered) return;
    
    // Currency formatting
    Handlebars.registerHelper('formatCurrency', (value: any) => {
      if (value == null || value === '') return '0.00';
      const num = Number(value);
      if (isNaN(num)) return value;
      return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    });

    // Helper for conditional rendering based on setting
    Handlebars.registerHelper('ifSetting', function(this: any, settingKey: string, options: any) {
      // Safety check: ensure options.fn exists (block helper requirement)
      if (!options || typeof options.fn !== 'function') {
        console.error('[ifSetting] Error: options.fn is not a function. Setting:', settingKey, 'Options:', options);
        return '';
      }
      
      // Access settings from the root context
      // In Handlebars, when template(data) is called, data becomes options.data.root
      const root = options.data?.root || options.data || this;
      const settings = root?.settings || {};
      const value = settings[settingKey];
      
      // Debug logging for troubleshooting (only for first few calls to avoid spam)
      if (process.env.NODE_ENV === 'development' && ['show_logo', 'show_business_name', 'show_business_address'].includes(settingKey)) {
        console.log('[ifSetting]', settingKey, '=', value, '| Settings available:', Object.keys(settings).length > 0, '| Root has settings:', !!root?.settings);
      }
      
      // Explicit false means hide
      if (value === false) {
        return options.inverse && typeof options.inverse === 'function' ? options.inverse(this) : '';
      }
      
      // Explicit true means show
      if (value === true) {
        return options.fn(this);
      }
      
      // If undefined/null, try legacy mappings, then default to true (show)
      if (value === undefined || value === null) {
        // Legacy mappings for backward compatibility
        if (settingKey.startsWith('show_business_') && settingKey !== 'show_business_details' && settings.show_business_details !== undefined) {
          return settings.show_business_details !== false ? options.fn(this) : (options.inverse && typeof options.inverse === 'function' ? options.inverse(this) : '');
        }
        if (settingKey.includes('discount') && settings.show_discount !== undefined) {
          return settings.show_discount !== false ? options.fn(this) : (options.inverse && typeof options.inverse === 'function' ? options.inverse(this) : '');
        }
        if (settingKey.includes('tax') && settingKey !== 'show_tax_total' && settings.show_tax !== undefined) {
          return settings.show_tax !== false ? options.fn(this) : (options.inverse && typeof options.inverse === 'function' ? options.inverse(this) : '');
        }
        if (settingKey === 'show_customer_address' && settings.show_bill_to !== undefined) {
          return settings.show_bill_to !== false ? options.fn(this) : (options.inverse && typeof options.inverse === 'function' ? options.inverse(this) : '');
        }
        if (settingKey.includes('gstin') && settings.show_gstin !== undefined) {
          return settings.show_gstin !== false ? options.fn(this) : (options.inverse && typeof options.inverse === 'function' ? options.inverse(this) : '');
        }
        
        // Default: show if undefined (assumes default settings have been merged)
        return options.fn(this);
      }
      
      // Any other truthy value means show
      return options.fn(this);
    });

    // Helper to check if a setting is enabled
    Handlebars.registerHelper('hasSetting', (settingKey: string) => {
      // This is used in block helpers, so we need to access context differently
      // For now, return a function that can be used in templates
      return function(this: any, options: any) {
        const settings = (this.settings || options.data.root?.settings || {});
        return settings[settingKey] === true;
      };
    });

    // Helper to repeat a block N times
    Handlebars.registerHelper('times', function(this: any, n: number, block: any) {
      let accum = '';
      for (let i = 0; i < n; i++) {
        accum += block.fn(i);
      }
      return accum;
    });

    // Helper to sum a property from an array
    Handlebars.registerHelper('sum', function(this: any, items: any[], property: string, options: any) {
      if (!items || !Array.isArray(items)) return '0';
      const total = items.reduce((sum, item) => {
        const value = item[property] || 0;
        return sum + Number(value);
      }, 0);
      return total.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    });

    // Helper to add two numbers
    Handlebars.registerHelper('add', function(this: any, a: any, b: any) {
      return (Number(a || 0) + Number(b || 0)).toFixed(2);
    });

    // Helper to get absolute value
    Handlebars.registerHelper('abs', function(this: any, value: any) {
      return Math.abs(Number(value || 0)).toFixed(2);
    });

    // Helper to check if a > b
    Handlebars.registerHelper('gt', function(this: any, a: any, b: any) {
      return Number(a || 0) > Number(b || 0);
    });

    // Helper to split string by delimiter
    Handlebars.registerHelper('split', function(this: any, str: string, delimiter: string) {
      if (!str) return [];
      return str.split(delimiter);
    });

    // Helper for less than comparison
    Handlebars.registerHelper('lt', function(this: any, a: number, b: number) {
      return a < b;
    });

    // Helper for subtraction
    Handlebars.registerHelper('subtract', function(this: any, a: number, b: number) {
      return Math.max(0, a - b);
    });

    // Helper for logical OR
    Handlebars.registerHelper('or', function(this: any, ...args: any[]) {
      // Remove the last argument (options object)
      const values = args.slice(0, -1);
      return values.some(v => v);
    });

    // Helper for logical AND
    Handlebars.registerHelper('and', function(this: any, ...args: any[]) {
      // Remove the last argument (options object)
      const values = args.slice(0, -1);
      return values.every(v => v);
    });

    // Helper to calculate dynamic colspan for item table totals
    // Counts visible columns and returns (total - 1) to align with the last column
    Handlebars.registerHelper('itemTableColspan', function(this: any, ...args: any[]) {
      // Last argument is always the options object for Handlebars helpers
      const options = args[args.length - 1];
      
      // Access root context
      const root = options?.data?.root || options?.data || this;
      const settings = root?.settings || {};
      const invoice = root?.invoice || {};
      
      let count = 0;
      
      // Count visible columns (default to true if not explicitly false)
      // Each column is counted individually, regardless of tax type
      if (settings.show_serial_number !== false) count++;
      if (settings.show_item_name !== false) count++;
      if (settings.show_hsn !== false) count++;
      if (settings.show_quantity !== false) count++;
      if (settings.show_rate !== false) count++;
      if (settings.show_discount_percent !== false) count++;
      if (settings.show_discount_amount !== false) count++;
      
      // Tax columns: always count as 1 column each (Tax % and Tax are separate columns)
      // The template shows them as single columns, not split by CGST/SGST
      if (settings.show_tax_rate !== false) count++;
      if (settings.show_tax_amount !== false) count++;
      
      if (settings.show_line_total !== false) count++;
      
      // Return (total - 1) to span all columns except the last one (Total)
      return Math.max(1, count - 1);
    });

    helpersRegistered = true;
  }

  // Get list of available templates
  getTemplates() {
    const templates = [];
    if (fs.existsSync(this.templateDir)) {
      const dirs = fs.readdirSync(this.templateDir);
      for (const dir of dirs) {
        const configPath = path.join(this.templateDir, dir, 'config.json');
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          templates.push(config);
        }
      }
    }
    return templates;
  }

  private static TEMPLATE_PATH_MAP: Record<string, string> = {
    'gst_standard': 'gst_standard',
    'modern': 'modern',
    'classic': 'classic',
    'elegant': 'elegant',
    'minimal': 'minimal',
    'business_pro': 'business_pro',
    'tally_style': 'tally_style',
    'export_invoice': 'export_invoice',
    'gst_detailed': 'gst_detailed',
    'composition_standard': 'bill_of_supply/composition_standard',
    'composition_modern': 'bill_of_supply/composition_modern',
    'tax_exempt': 'bill_of_supply/tax_exempt',
    'credit_standard': 'credit_note/standard',
    'debit_standard': 'debit_note/standard',
    'challan_standard': 'delivery_challan/standard',
    'payment_receipt': 'payment_receipt',
    'thermal_58mm': 'thermal_58mm',
    'thermal_80mm': 'thermal_80mm',
    'tds_certificate': 'tds_certificate',
    'expense_voucher': 'expense_voucher',
    'account_statement': 'account_statement',
    'payslip_standard': 'payslips/standard',
    // Document-type defaults reference these IDs in template-registry; physical folders use shared GST layout until dedicated templates ship.
    'sales_order/professional': 'gst_standard',
    'purchase_order/professional': 'gst_standard',
    'work_order/job_card': 'gst_standard',
    // Financial report PDFs (see templates/reports/*)
    balance_sheet: 'reports/balance_sheet',
    trial_balance: 'reports/trial_balance',
    profit_loss: 'reports/profit_loss',
    cash_flow: 'reports/cash_flow',
  };

  // Render HTML for preview
  async renderHtml(templateId: string, data: RenderData): Promise<string> {
    this.registerHelpers();
    
    const folderName = InvoiceRenderer.TEMPLATE_PATH_MAP[templateId] || templateId;
    const templatePath = path.join(this.templateDir, folderName, 'template.html');
    
    console.log('[Renderer] Template ID:', templateId);
    console.log('[Renderer] Resolved folder:', folderName);
    console.log('[Renderer] Full Path:', templatePath);
    console.log('[Renderer] File Exists:', fs.existsSync(templatePath));
    
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template ${templateId} not found at ${templatePath}`);
    }

    const source = fs.readFileSync(templatePath, 'utf-8');
    const firstLine = source.substring(0, 100);
    console.log('[Renderer] First 100 chars of template:', firstLine);
    
    const template = Handlebars.compile(source);
    
    // Ensure settings object exists and has defaults
    if (!data.settings) {
      data.settings = {};
    }

    // Debug: Log settings to verify they're being passed
    console.log('[Renderer] Settings keys:', Object.keys(data.settings || {}).length);
    console.log('[Renderer] Sample settings:', {
      show_logo: data.settings?.show_logo,
      show_business_name: data.settings?.show_business_name,
      show_business_address: data.settings?.show_business_address,
      show_business_phone: data.settings?.show_business_phone,
      show_business_gstin: data.settings?.show_business_gstin
    });
    console.log('[Renderer] Business data:', {
      hasName: !!data.business?.name,
      hasAddress: !!data.business?.address,
      hasPhone: !!data.business?.phone,
      hasGstin: !!data.business?.gstin
    });

    // Ensure data structure is correct for Handlebars
    // Handlebars expects the root to be the data object itself
    try {
      const result = template(data);
      return result;
    } catch (renderError: any) {
      console.error('[Renderer] Template rendering error:', renderError);
      console.error('[Renderer] Error stack:', renderError.stack);
      console.error('[Renderer] Data keys:', Object.keys(data || {}));
      console.error('[Renderer] Settings keys:', Object.keys(data?.settings || {}));
      throw new Error(`Template rendering failed: ${renderError.message}`);
    }
  }
}


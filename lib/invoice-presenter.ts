import { getDocumentRule } from './invoice-config';
import {
  applyStatutorySettings,
  buildHsnTaxSummary,
  copyLabelFor,
  normalizePrintCopy,
} from './invoice-statutory';
import { attachItemTablePrintData } from './print/item-columns';
import * as db from './db';
import { enrichInvoiceRenderData } from './custom-fields-render';
import { parseCustomFieldValues } from './custom-fields';
import { getStateName } from './gst-utils';
import {
  amountInWords,
  documentLanguageDateLocale,
  translatePhrase,
  type DocumentLanguage,
} from './print-language';
import { resolveDocumentLanguage } from './print-language/storage';
import { translatePrintedItemName } from './print-language/item-name';

function placeOfSupplyName(code: unknown): string {
  const raw = String(code ?? '').trim();
  if (!raw) return '';
  const padded = raw.padStart(2, '0');
  if (padded === '96') return 'Other Country';
  if (padded === '97') return 'Other Territory';
  return getStateName(padded) || raw;
}

const WORK_ORDER_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** Job-card fields for the work order template, formatted for print. */
function workOrderFields(wo: any, formatDate: (d: any) => string, language: DocumentLanguage) {
  const money = (v: unknown) => Number(v || 0).toFixed(2);
  const hours = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(Number(v)));
  const priority = String(wo.priority || 'medium');
  return {
    description: wo.work_description || '',
    location: wo.work_location || '',
    assigned_to: wo.assigned_to || '',
    priority: translatePhrase(language, priority.charAt(0).toUpperCase() + priority.slice(1)),
    status: translatePhrase(language, WORK_ORDER_STATUS_LABELS[wo.status] || wo.status || ''),
    scheduled_start: formatDate(wo.scheduled_start_date),
    scheduled_end: formatDate(wo.scheduled_end_date),
    actual_start: formatDate(wo.actual_start_date),
    actual_end: formatDate(wo.actual_end_date),
    estimated_hours: hours(wo.estimated_hours),
    actual_hours: hours(wo.actual_hours),
    labor_cost: money(wo.labor_cost),
    material_cost: money(wo.material_cost),
    other_cost: money(wo.other_cost),
    total_cost: money(wo.total_cost),
    has_labor: Number(wo.labor_cost || 0) > 0,
    has_other: Number(wo.other_cost || 0) > 0,
  };
}

interface RenderData {
  invoice: any;
  business: any;
  customer: any;
  items: any[];
  settings: any;
}

/**
 * Fetches bank details from bank_accounts table for a business
 * Returns the first active bank account, or null if none found
 */
async function fetchBankDetails(businessId: string): Promise<{
  bank_name: string | null;
  account_number: string | null;
  ifsc_code: string | null;
  branch_name: string | null;
} | null> {
  try {
    const bankAccount = await db.queryOne(
      `SELECT bank_name, account_number, ifsc_code, branch_name
       FROM bank_accounts
       WHERE business_id = $1 AND is_active = true
       ORDER BY created_at ASC
       LIMIT 1`,
      [businessId]
    );
    
    if (bankAccount) {
      return {
        bank_name: bankAccount.bank_name || null,
        account_number: bankAccount.account_number || null,
        ifsc_code: bankAccount.ifsc_code || null,
        branch_name: bankAccount.branch_name || null
      };
    }
    return null;
  } catch (error) {
    console.error('[invoice-presenter] Error fetching bank details:', error);
    return null;
  }
}

/**
 * Transforms raw document data and settings into a standardized format for templates.
 * This is the SINGLE SOURCE OF TRUTH for how data is presented in Previews and PDFs.
 * Supports: Invoices, Sales Orders, Delivery Challans, Credit/Debit Notes, Purchase Orders, Work Orders.
 * 
 * NOTE: This function is now async because it fetches bank details from database.
 */
export async function prepareInvoiceForRendering(rawData: any, settings: any = {}): Promise<RenderData> {
  const { invoice: rawInvoice, business, customer, items } = rawData;
  const documentLanguage = await resolveDocumentLanguage(
    settings?.document_language,
    business?.business_id || business?.id,
  );
  
  // Fetch bank details from bank_accounts table if business_id is available
  let bankDetails = null;
  if (business?.id) {
    bankDetails = await fetchBankDetails(business.id);
    if (process.env.NODE_ENV === 'development') {
      console.log('[invoice-presenter] Bank details fetched:', bankDetails ? 'Found' : 'Not found', 'for business_id:', business.id);
    }
  } else {
    if (process.env.NODE_ENV === 'development') {
      console.log('[invoice-presenter] No business.id provided, cannot fetch bank details');
    }
  }

  // 1. Normalize Document Fields (Map order_number, challan_number, etc. to invoice_number)
  const invoice = {
    ...rawInvoice,
    invoice_number: rawInvoice.invoice_number || rawInvoice.order_number || rawInvoice.challan_number || rawInvoice.work_order_number || rawInvoice.credit_note_number || rawInvoice.debit_note_number || 'N/A',
    invoice_date: rawInvoice.invoice_date || rawInvoice.order_date || rawInvoice.challan_date || rawInvoice.work_order_date || rawInvoice.credit_note_date || rawInvoice.debit_note_date,
    grand_total: rawInvoice.grand_total || rawInvoice.total_cost || 0,
    // DB columns differ from the names templates read (place_of_supply_state_code,
    // purchase_order_number, e_way_bill_number on challans).
    place_of_supply: rawInvoice.place_of_supply || placeOfSupplyName(rawInvoice.place_of_supply_state_code),
    po_number: rawInvoice.po_number || rawInvoice.purchase_order_number || '',
    eway_bill_number: rawInvoice.eway_bill_number || rawInvoice.e_way_bill_number || '',
    e_way_bill_number: rawInvoice.e_way_bill_number || rawInvoice.eway_bill_number || '',
  };

  // 2. Determine Title and Rules
  const docType = rawInvoice.document_type || (
    rawInvoice.order_number ? 'sales_order' :
    rawInvoice.challan_number ? 'delivery_challan' :
    rawInvoice.work_order_number ? 'work_order' :
    rawInvoice.credit_note_number ? 'credit_note' :
    rawInvoice.debit_note_number ? 'debit_note' :
    'tax_invoice'
  );
  
  const rule = getDocumentRule(docType);
  
  // Apply document rules to settings
  const effectiveSettings = { ...settings, document_language: documentLanguage };
  // Notes/terms typed on the document win over the template's default text, and
  // always print: the template's show_notes/show_terms switch only governs its default text.
  if (typeof rawInvoice.notes === 'string' && rawInvoice.notes.trim()) {
    effectiveSettings.notes = rawInvoice.notes;
    effectiveSettings.show_notes = true;
  }
  if (typeof rawInvoice.terms === 'string' && rawInvoice.terms.trim()) {
    effectiveSettings.terms = rawInvoice.terms;
    effectiveSettings.show_terms = true;
  }
  // Bill of supply / challan carry no tax, but subtotal, discount and total are still real.
  if (!rule.isTaxable) {
    effectiveSettings.show_tax_rate = false;
    effectiveSettings.show_tax_amount = false;
    effectiveSettings.show_tax = false;
    effectiveSettings.show_tax_total = false;
    effectiveSettings.show_cgst = false;
    effectiveSettings.show_sgst = false;
    effectiveSettings.show_igst = false;
    effectiveSettings.show_cess = false;
  }
  // GST documents always print what Rules 46/49/53 require, whatever the template settings say.
  Object.assign(
    effectiveSettings,
    applyStatutorySettings(effectiveSettings, docType, rawData.template_id || settings?.template_id, {
      b2b: !!String(customer?.gstin || '').trim(),
    }),
  );

  // Proforma/Quotation title takes priority even if export is true
  let invoiceTitle = rule.title;
  if (
    invoice.is_export &&
    docType !== 'proforma_invoice' &&
    docType !== 'sales_order' &&
    docType !== 'purchase_order'
  ) {
    invoiceTitle = 'EXPORT INVOICE';
  }
  invoiceTitle = translatePhrase(documentLanguage, invoiceTitle);

  // 3. Formatting Helpers
  const formatCurrency = (val: any) => {
    const num = Number(val || 0);
    return num.toLocaleString('en-IN', { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 2 
    });
  };

  const formatDate = (dateStr: any) => {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      return date.toLocaleDateString(documentLanguageDateLocale(documentLanguage), { 
        day: 'numeric', 
        month: 'long', 
        year: 'numeric' 
      });
    } catch (e) {
      return dateStr;
    }
  };

  // 5. Process Items (Standardize Tax Splits)
  const isIGST = Number(invoice.igst_total || 0) > 0 || !!invoice.is_export;
  
  const processedItems = items.map((item: any, index: number) => {
    const qty = Number(item.quantity || item.qty || 0);
    const price = Number(item.unit_price || 0);
    const taxRate = Number(item.tax_rate || 0);
    const discountPercent = Number(item.discount_percent || 0);
    
    const subtotal = qty * price;
    const discountAmount = item.discount_amount || (subtotal * discountPercent) / 100;
    const taxableValue = item.taxable_value || (subtotal - discountAmount);
    const taxAmount = item.tax_amount || (taxableValue * taxRate) / 100;
    const lineTotal = item.line_total || item.total_cost || (taxableValue + taxAmount);

    let cgst = item.cgst_amount || 0, sgst = item.sgst_amount || 0, igst = item.igst_amount || 0;
    if (cgst === 0 && sgst === 0 && igst === 0) {
      if (isIGST) {
        igst = taxAmount;
      } else {
        cgst = taxAmount / 2;
        sgst = taxAmount / 2;
      }
    }

    // A line sold in boxes says how many pieces that is: "= 60 PCS" under the item.
    const unitFactor = Number(item.unit_factor) || 1;
    const baseUnit = item.item_base_unit || null;
    const baseQtyNote =
      unitFactor !== 1 && !item.charge_line
        ? `= ${Number((qty * unitFactor).toFixed(3)).toLocaleString('en-IN')} ${baseUnit || ''}`.trim()
        : '';
    const description = translatePrintedItemName(documentLanguage, item.description || '');

    return {
      index: index + 1,
      item_name: translatePrintedItemName(documentLanguage, item.item_name || ''),
      description: [description, baseQtyNote].filter(Boolean).join(' · '),
      unit_factor: unitFactor,
      base_qty_note: baseQtyNote,
      hsn_sac: item.hsn_sac || '',
      quantity: qty,
      charge_line: item.charge_line === true,
      unit: item.unit || 'PCS',
      unit_price: price.toFixed(2),
      discount_percent: discountPercent,
      discount_amount: Number(discountAmount).toFixed(2),
      tax_rate: taxRate.toFixed(2),
      taxable_value: Number(taxableValue).toFixed(2),
      cgst_rate: (taxRate / 2).toFixed(2).replace(/\.00$/, ''),
      sgst_rate: (taxRate / 2).toFixed(2).replace(/\.00$/, ''),
      igst_rate: taxRate.toFixed(2).replace(/\.00$/, ''),
      cgst_amount: Number(cgst).toFixed(2),
      sgst_amount: Number(sgst).toFixed(2),
      igst_amount: Number(igst).toFixed(2),
      tax_amount: Number(taxAmount).toFixed(2),
      line_total: Number(lineTotal).toFixed(2),
      image_url: item.image_url || null,
      batch_number: item.batch_number || null,
      expiry_date: item.expiry_date ? formatDate(item.expiry_date) : null,
      item_custom_fields: item.item_custom_fields ?? item.custom_fields,
      // Item master facts for distributor bills (MRP, product code, case size).
      mrp: item.mrp ?? item.item_mrp ?? null,
      item_code: item.item_code || '',
      case_unit: item.case_unit || null,
      case_factor: item.case_factor || null,
      cess_amount: Number(item.cess_amount || 0).toFixed(2),
    };
  });

  // 6. Calculate Opening Balance and Balance Due
  // Opening Balance = Customer's outstanding balance BEFORE this invoice
  // - If invoice is DRAFT: opening balance = customer.current_balance (this invoice not added yet)
  // - If invoice is FINAL: opening balance = customer.current_balance - invoice.balance_amount (this invoice already included)
  const invoiceStatus = rawInvoice.status || 'draft';
  const invoiceBalanceAmount = Number(rawInvoice.balance_amount !== undefined ? rawInvoice.balance_amount : (rawInvoice.grand_total - (rawInvoice.paid_amount || 0)));
  const invoiceGrandTotal = Number(invoice.grand_total || 0);
  const customerCurrentBalance = Number(customer.current_balance || 0);

  let openingBalance = 0;
  if (invoiceStatus === 'draft') {
    // Invoice is draft, so customer.current_balance doesn't include this invoice yet
    openingBalance = customerCurrentBalance;
  } else if (invoiceStatus === 'final') {
    // Invoice is final, so customer.current_balance already includes this invoice's balance
    // Subtract it to get the balance BEFORE this invoice
    openingBalance = customerCurrentBalance - invoiceBalanceAmount;
  } else {
    // For cancelled or other statuses, use current balance
    openingBalance = customerCurrentBalance;
  }

  // Balance Due = Opening Balance + Current Invoice Amount
  const balanceDue = openingBalance + invoiceGrandTotal;

  // Calculate total quantity and unit for display
  const totalQuantity = processedItems.reduce(
    (sum: number, item: any) => sum + (item.charge_line ? 0 : Number(item.quantity || 0)),
    0
  );
  const primaryUnit = processedItems.length > 0 ? processedItems[0].unit || 'Nos' : 'Nos';

  // HSN-wise tax summary, grouped by HSN and rate
  const taxSummary = buildHsnTaxSummary(processedItems);
  const copyLabel = copyLabelFor(docType, normalizePrintCopy(rawData.copy), processedItems);

  // 7. Final Data Assembly
  const assembled = {
    invoice: {
      ...invoice,
      custom_fields: parseCustomFieldValues(rawInvoice.custom_fields),
      invoice_title: invoiceTitle,
      invoice_date: formatDate(invoice.invoice_date),
      due_date: (invoice.due_date || invoice.expected_delivery_date) ? formatDate(invoice.due_date || invoice.expected_delivery_date) : '',
      amount_in_words: amountInWords(Number(invoice.grand_total), documentLanguage),
      tax_amount_in_words: amountInWords(Number(invoice.tax_total || 0), documentLanguage),
      is_igst: isIGST,
      subtotal: Number(invoice.subtotal || 0).toFixed(2),
      tax_total: Number(invoice.tax_total || 0).toFixed(2),
      discount_total: Number(invoice.discount_total || 0).toFixed(2),
      grand_total: Number(invoice.grand_total || 0).toFixed(2),
      paid_amount: Number(invoice.paid_amount || 0).toFixed(2),
      balance_amount: Number(invoice.balance_amount !== undefined ? invoice.balance_amount : (invoice.grand_total - (invoice.paid_amount || 0))).toFixed(2),
      cgst_total: Number(invoice.cgst_total || 0).toFixed(2),
      sgst_total: Number(invoice.sgst_total || 0).toFixed(2),
      igst_total: Number(invoice.igst_total || 0).toFixed(2),
      additional_charges: Number(invoice.additional_charges || 0).toFixed(2),
      charges_included: invoice.charges_included === true,
      round_off: Number(invoice.round_off || 0).toFixed(2),
      total_quantity: totalQuantity,
      items_have_prices: processedItems.some((i: any) => Number(i.unit_price) > 0),
      has_tax: Number(invoice.tax_total || 0) > 0,
      total_unit: primaryUnit,
      opening_balance: openingBalance.toFixed(2),
      balance_due: balanceDue.toFixed(2),
      // Export fields normalization
      invoice_currency: invoice.invoice_currency || 'INR',
      exchange_rate: invoice.exchange_rate || null,
      shipping_bill_date: invoice.shipping_bill_date ? formatDate(invoice.shipping_bill_date) : null,
      // Credit notes (migration 443): a post-sale discount covers a period instead of one invoice.
      is_post_sale_discount: invoice.note_type === 'post_sale_discount',
      supply_period_from: invoice.supply_period_from ? formatDate(invoice.supply_period_from) : null,
      supply_period_to: invoice.supply_period_to ? formatDate(invoice.supply_period_to) : null,
      // Additional metadata fields
      delivery_note: invoice.delivery_note || '',
      payment_terms: invoice.payment_terms || '',
      other_references: invoice.other_references || '',
      dispatched_through: invoice.dispatched_through || '',
      destination: invoice.destination || '',
      terms_of_delivery: invoice.terms_of_delivery || ''
      ,
      // Tax breakdown grouped by HSN/SAC (for templates like Tally Style)
      tax_breakdown: taxSummary.rows,
      tax_breakdown_totals: taxSummary.totals,
      copy_label: copyLabel ? translatePhrase(documentLanguage, copyLabel) : null,
      work_order: docType === 'work_order' ? workOrderFields(rawInvoice, formatDate, documentLanguage) : null
    },
    business: {
      ...business,
      address: business.address || business.address_line1 || '',
      city: business.city || '',
      state: business.state || '',
      pincode: business.pincode || '',
      gstin: business.gstin || '',
      logo_url: business.logo_url || null,
      signature_url: business.signature_url || null,
      // Add bank details from bank_accounts table
      bank_name: bankDetails?.bank_name || business.bank_name || null,
      account_number: bankDetails?.account_number || business.account_number || null,
      ifsc_code: bankDetails?.ifsc_code || business.ifsc_code || null,
      branch_name: bankDetails?.branch_name || business.branch_name || null
    },
    customer: {
      ...customer,
      name: customer.name || '',
      address: customer.billing_address || customer.address || '',
      shipping_address: customer.shipping_address || customer.address || '',
      gstin: customer.gstin || '',
      state: customer.state || '',
      state_code: customer.state_code || '',
      current_balance: customer.current_balance || 0,
      opening_balance: openingBalance.toFixed(2),
      balance_due: balanceDue.toFixed(2)
    },
    items: processedItems.map((item: Record<string, unknown>) => ({
      ...item,
      item_custom_fields: parseCustomFieldValues(
        item.item_custom_fields ?? item.custom_fields
      ),
    })),
    settings: effectiveSettings || {},
  };

  const enriched = await enrichInvoiceRenderData(assembled);
  return attachItemTablePrintData(enriched, {
    docType,
    translate: (label) => translatePhrase(documentLanguage, label),
  });
}

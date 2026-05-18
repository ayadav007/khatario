import { getDocumentRule } from './invoice-config';
import * as db from './db';

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
  const effectiveSettings = { ...settings };
  if (!rule.isTaxable) {
    effectiveSettings.show_rate = effectiveSettings.show_rate ?? false;
    effectiveSettings.show_tax_rate = false;
    effectiveSettings.show_tax_amount = false;
    effectiveSettings.show_line_total = effectiveSettings.show_line_total ?? false;
    effectiveSettings.show_discount = false;
    effectiveSettings.show_tax = false;
    effectiveSettings.show_subtotal = false;
    effectiveSettings.show_tax_total = false;
    effectiveSettings.show_grand_total = effectiveSettings.show_grand_total ?? false;
  }

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
      return date.toLocaleDateString('en-IN', { 
        day: 'numeric', 
        month: 'long', 
        year: 'numeric' 
      });
    } catch (e) {
      return dateStr;
    }
  };

  // 4. Number to Words (Internal Helper)
  const numberToWords = (num: number) => {
    if (isNaN(num) || num === 0) return 'Zero Rupees Only';
    const a = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
    const b = ['','', 'Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
    const toWords = (n: number): string => {
      if (n < 20) return a[n];
      if (n < 100) return b[Math.floor(n/10)] + (n%10 ? ' ' + a[n%10] : '');
      if (n < 1000) return a[Math.floor(n/100)] + ' Hundred' + (n%100 ? ' ' + toWords(n%100) : '');
      if (n < 100000) return toWords(Math.floor(n/1000)) + ' Thousand' + (n%1000 ? ' ' + toWords(n%1000) : '');
      if (n < 10000000) return toWords(Math.floor(n/100000)) + ' Lakh' + (n%100000 ? ' ' + toWords(n%100000) : '');
      return toWords(Math.floor(n/10000000)) + ' Crore' + (n%10000000 ? ' ' + toWords(n%10000000) : '');
    };
    const whole = Math.floor(Math.abs(num));
    const decimal = Math.round((Math.abs(num) - whole) * 100);
    const wholeWords = whole === 0 ? 'Zero' : toWords(whole);
    const decWords = decimal > 0 ? ` and ${toWords(decimal)} Paise` : '';
    return `${num < 0 ? 'Minus ' : ''}${wholeWords} Rupees${decWords} Only`;
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

    return {
      index: index + 1,
      item_name: item.item_name || '',
      description: item.description || '',
      hsn_sac: item.hsn_sac || '',
      quantity: qty,
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
      expiry_date: item.expiry_date ? formatDate(item.expiry_date) : null
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
  const totalQuantity = processedItems.reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0);
  const primaryUnit = processedItems.length > 0 ? processedItems[0].unit || 'Nos' : 'Nos';

  // Calculate tax breakdown grouped by HSN/SAC
  const taxBreakdownMap = new Map<string, {
    hsn_sac: string;
    taxable_value: number;
    cgst_rate: number;
    cgst_amount: number;
    sgst_rate: number;
    sgst_amount: number;
    total_tax: number;
  }>();

  processedItems.forEach((item: any) => {
    const hsn = item.hsn_sac || 'N/A';
    const existing = taxBreakdownMap.get(hsn) || {
      hsn_sac: hsn,
      taxable_value: 0,
      cgst_rate: Number(item.cgst_rate || 0),
      cgst_amount: 0,
      sgst_rate: Number(item.sgst_rate || 0),
      sgst_amount: 0,
      total_tax: 0
    };

    existing.taxable_value += Number(item.taxable_value || 0);
    existing.cgst_amount += Number(item.cgst_amount || 0);
    existing.sgst_amount += Number(item.sgst_amount || 0);
    existing.total_tax += Number(item.tax_amount || 0);

    taxBreakdownMap.set(hsn, existing);
  });

  const taxBreakdown = Array.from(taxBreakdownMap.values()).map(item => ({
    hsn_sac: item.hsn_sac,
    taxable_value: item.taxable_value.toFixed(2),
    cgst_rate: item.cgst_rate.toFixed(2).replace(/\.00$/, ''),
    cgst_amount: item.cgst_amount.toFixed(2),
    sgst_rate: item.sgst_rate.toFixed(2).replace(/\.00$/, ''),
    sgst_amount: item.sgst_amount.toFixed(2),
    total_tax: item.total_tax.toFixed(2)
  }));

  // 7. Final Data Assembly
  return {
    invoice: {
      ...invoice,
      invoice_title: invoiceTitle,
      invoice_date: formatDate(invoice.invoice_date),
      due_date: (invoice.due_date || invoice.expected_delivery_date) ? formatDate(invoice.due_date || invoice.expected_delivery_date) : '',
      amount_in_words: numberToWords(Number(invoice.grand_total)),
      tax_amount_in_words: numberToWords(Number(invoice.tax_total || 0)),
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
      round_off: Number(invoice.round_off || 0).toFixed(2),
      total_quantity: totalQuantity,
      total_unit: primaryUnit,
      opening_balance: openingBalance.toFixed(2),
      balance_due: balanceDue.toFixed(2),
      // Export fields normalization
      invoice_currency: invoice.invoice_currency || 'INR',
      exchange_rate: invoice.exchange_rate || null,
      shipping_bill_date: invoice.shipping_bill_date ? formatDate(invoice.shipping_bill_date) : null,
      // Additional metadata fields
      delivery_note: invoice.delivery_note || '',
      payment_terms: invoice.payment_terms || '',
      other_references: invoice.other_references || '',
      dispatched_through: invoice.dispatched_through || '',
      destination: invoice.destination || '',
      terms_of_delivery: invoice.terms_of_delivery || ''
      ,
      // Tax breakdown grouped by HSN/SAC (for templates like Tally Style)
      tax_breakdown: taxBreakdown
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
    items: processedItems,
    settings: effectiveSettings || {}
  };
}

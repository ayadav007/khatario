import type { SectionKey, SourceApp } from '@/lib/import/types';

type AppKey = Exclude<SourceApp, 'other'>;

const TALLY_PARTY = {
  name: ['Name', 'Ledger Name', 'Particulars'],
  gstin: ['GSTIN/UIN', 'GSTIN'],
  phone: ['Mobile', 'Mobile No.', 'Phone'],
  email: ['E-Mail', 'Email'],
  address: ['Address'],
  state: ['State', 'State Name'],
  pincode: ['Pincode', 'PIN Code'],
  pan: ['PAN/IT No.'],
};

const VYAPAR_PARTY = {
  name: ['Name', 'Party Name'],
  phone: ['Phone No.', 'Contact No.'],
  email: ['Email', 'Email ID'],
  address: ['Address', 'Billing Address'],
  gstin: ['GSTIN', 'GSTIN No.'],
  state: ['State'],
};

const ZOHO_PARTY = {
  name: ['Display Name', 'Contact Name'],
  company_name: ['Company Name'],
  gstin: ['GST Identification Number (GSTIN)'],
  phone: ['MobilePhone', 'Phone'],
  email: ['EmailID'],
  address: ['Billing Address'],
  city: ['Billing City'],
  state: ['Billing State', 'Place of Supply'],
  pincode: ['Billing Code'],
  pan: ['PAN Number'],
};

/** Field key to header names each app is believed to use. Starting data; verify against real exports before release. */
export const PRESET_ALIASES: Record<AppKey, Record<SectionKey, Record<string, string[]>>> = {
  tally: {
    customers: TALLY_PARTY,
    suppliers: TALLY_PARTY,
    items: {
      name: ['Name', 'Name of Item', 'Particulars'],
      unit: ['Units', 'UOM'],
      hsn_sac: ['HSN/SAC', 'HSN Code'],
      tax_rate: ['GST Rate', 'Rate of Tax', 'IGST Rate'],
      category_name: ['Under', 'Stock Group'],
      opening_stock: ['Opening Qty', 'Quantity'],
      purchase_price: ['Rate', 'Cost Price'],
      selling_price: ['Selling Price', 'Standard Price'],
      code: ['Alias', 'Part No.'],
    },
  },
  vyapar: {
    customers: VYAPAR_PARTY,
    suppliers: VYAPAR_PARTY,
    items: {
      name: ['Item name*', 'Item name'],
      code: ['Item code'],
      hsn_sac: ['HSN'],
      selling_price: ['Sale price'],
      purchase_price: ['Purchase price'],
      opening_stock: ['Opening stock quantity'],
      min_stock: ['Minimum stock quantity'],
      tax_rate: ['Tax Rate'],
      unit: ['Base Unit (x)', 'Base Unit'],
      category_name: ['Category'],
    },
  },
  zoho_books: {
    customers: ZOHO_PARTY,
    suppliers: ZOHO_PARTY,
    items: {
      name: ['Item Name'],
      code: ['SKU'],
      hsn_sac: ['HSN/SAC'],
      selling_price: ['Rate', 'Selling Price'],
      purchase_price: ['Purchase Rate', 'Purchase Price'],
      unit: ['Usage unit', 'Unit'],
      tax_rate: ['Intra State Tax Rate'],
      item_type: ['Product Type'],
      description: ['Description'],
    },
  },
};

const SAVE = 'Save as Excel or CSV, then upload the file here.';

/** Ordered steps shown on the Upload step. Kept generic: menu names are not confirmed. */
export const EXPORT_INSTRUCTIONS: Record<AppKey, Record<SectionKey, string[]>> = {
  tally: {
    customers: ['Open the customer (party / ledger) list in Tally.', SAVE],
    suppliers: ['Open the supplier (party / ledger) list in Tally.', SAVE],
    items: ['Open the stock items list in Tally.', SAVE],
  },
  vyapar: {
    customers: ['Open the customer (party) list in Vyapar.', SAVE],
    suppliers: ['Open the supplier (party) list in Vyapar.', SAVE],
    items: ['Open the items list in Vyapar.', SAVE],
  },
  zoho_books: {
    customers: ['Open the customers list in Zoho Books.', SAVE],
    suppliers: ['Open the vendors list in Zoho Books.', SAVE],
    items: ['Open the items list in Zoho Books.', SAVE],
  },
};

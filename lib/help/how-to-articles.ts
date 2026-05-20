/**
 * In-app "How to" articles for Settings → Help.
 * Screenshot: add public/help/how-to/{slug}.png when ready.
 * Full feature list: see lib/help/khatario-feature-inventory.txt
 */

export type HowToSection =
  | { type: 'h2'; text: string }
  | { type: 'p'; text: string }
  | { type: 'ol'; items: string[] }
  | { type: 'ul'; items: string[] }
  | { type: 'tip'; text: string }
  | { type: 'image'; src: string; alt: string; caption?: string };

export type HowToCategory =
  | 'Getting started'
  | 'Sales & customers'
  | 'Purchases, stock & items'
  | 'Money & books'
  | 'Reports & GST'
  | 'Team, settings & add-ons';

export type HowToArticle = {
  slug: string;
  title: string;
  description: string;
  category: HowToCategory;
  /** ISO date, for "Last updated" */
  updatedAt: string;
  sections: HowToSection[];
};

export const HOW_TO_CATEGORIES: HowToCategory[] = [
  'Getting started',
  'Sales & customers',
  'Purchases, stock & items',
  'Money & books',
  'Reports & GST',
  'Team, settings & add-ons',
];

const articles: HowToArticle[] = [
  // --- Getting started ---
  {
    slug: 'getting-started',
    title: 'First-time setup: profile, year, and users',
    description: 'Set up your organization, financial year, and who can use the app.',
    category: 'Getting started',
    updatedAt: '2026-04-24',
    sections: [
      {
        type: 'p',
        text: 'Complete these once (or when your business details change) so documents and reports use the right legal and tax data.',
      },
      { type: 'h2', text: '1. Business profile' },
      {
        type: 'p',
        text: 'Go to Settings → Organization. Add legal name, address, GSTIN (if applicable), logo, and contact details. Invoices and many reports pick these up automatically.',
      },
      { type: 'h2', text: '2. Financial year' },
      {
        type: 'p',
        text: 'Under Settings → Financial years, ensure the active year matches your books (April–March for most Indian companies). Some reports and closing stock use the selected year.',
      },
      { type: 'h2', text: '3. Branches (optional)' },
      {
        type: 'p',
        text: 'If you operate more than one location, add branches under Settings → Branches. You can then tag transactions and filter reports by branch.',
      },
      { type: 'h2', text: '4. Users and roles' },
      {
        type: 'p',
        text: 'Invite teammates under Settings → User management. Assign roles so only the right people can change tax settings, post journals, or see subscription billing.',
      },
      { type: 'tip', text: 'Use the product tour from Help & Support to learn the main menu and the organization screen.' },
      {
        type: 'image',
        src: '/help/how-to/getting-started.png',
        alt: 'Organization and financial year settings in Khatario',
        caption: 'Settings overview',
      },
    ],
  },
  {
    slug: 'key-settings-walkthrough',
    title: 'Key settings: tax, templates, numbers, and locks',
    description: 'Where to configure GST, documents, number series, and who can post in a period.',
    category: 'Getting started',
    updatedAt: '2026-04-24',
    sections: [
      {
        type: 'p',
        text: 'Beyond organization profile, these settings control how tax is calculated, how documents look, and how mistakes are prevented.',
      },
      { type: 'h2', text: 'Tax and GST' },
      {
        type: 'p',
        text: 'Open Settings → Tax & GST and Settings → GST configuration. Set place of business, default tax rates, HSN/SAC behaviour, and e-invoicing or filing preferences that match your process. Invoices, purchases, and GST reports all depend on this being right.',
      },
      { type: 'h2', text: 'Templates, invoice design, and printing' },
      {
        type: 'p',
        text: 'Under Settings → Templates & printing and Settings → Templates & printing, adjust columns, terms, and layout. If you use barcode labels, configure label templates and (where available) printer settings in the same area.',
      },
      { type: 'h2', text: 'Number series' },
      {
        type: 'p',
        text: 'Settings → Transaction number series sets prefixes and sequences for invoices, payments, and other documents so audit trails stay clear.',
      },
      { type: 'h2', text: 'Period locks' },
      {
        type: 'p',
        text: 'Settings → Period locks prevents changes before a date you choose. Use this after you close a month or before filing to avoid accidental edits.',
      },
      { type: 'h2', text: 'Users, roles, and data' },
      {
        type: 'p',
        text: 'From Settings, open User management, Manage users, and Manage roles to limit who can approve credit, run GST, or export data. Backup & restore and export (JSON/CSV) live under Settings when you need a copy of your data.',
      },
      {
        type: 'image',
        src: '/help/how-to/key-settings-walkthrough.png',
        alt: 'Tax, templates, and number series settings',
        caption: 'Core configuration screens',
      },
    ],
  },

  // --- Sales ---
  {
    slug: 'create-tax-invoice-step-by-step',
    title: 'Create a tax invoice (step by step)',
    description:
      'Full path on the new invoice screen: branch, number, customer, lines, options, and save—matches the actual Khatario flow.',
    category: 'Sales & customers',
    updatedAt: '2026-04-24',
    sections: [
      {
        type: 'p',
        text: 'This guide follows the new invoice page (Sales → All Invoices → new, or /invoices/new). Your menu labels may match “Generate”, “Save & Send”, or “Save as draft” depending on layout; the idea is the same.',
      },
      { type: 'h2', text: 'Before you start' },
      {
        type: 'ol',
        items: [
          'Open Sales → All Invoices and start a new invoice, or go directly to the new-invoice screen.',
          'If your business uses branches: select the correct branch first (usually from the app header or branch control). A branch is required for the app to assign the next document number. Non-admin users cannot save an invoice without a real branch (not “all branches”).',
          'Wait until the invoice number is ready. Save stays disabled until the number series has loaded (prefix and sequence from the server). If you see an error about the document number, confirm the branch and wait; do not save until the number is assigned.',
        ],
      },
      { type: 'h2', text: 'Document type' },
      {
        type: 'p',
        text: 'The screen can create a tax invoice, a proforma invoice (quotation / estimate style), or a bill of supply (e.g. composition or exempt supply). If you are on a regular GST setup, use the tax invoice for a normal outward taxable supply. You can open a proforma from the same new-invoice page when your app offers that document type. Composition businesses may default to a bill of supply—follow your accountant’s rule.',
      },
      { type: 'h2', text: 'Customer' },
      {
        type: 'p',
        text: 'In the customer field, search by name, company, or phone. Pick a row, or use add-new customer if the party is not in the list yet. Correct billing and shipping (and GSTIN for B2B) matter for the PDF and for tax. If the screen lets you edit address on the fly, do that before you finalize so place of supply and the printed address stay accurate.',
      },
      { type: 'h2', text: 'Invoice date and place of supply' },
      {
        type: 'p',
        text: 'Set the invoice date. Set the place of supply (state) so the app splits CGST/SGST vs IGST correctly. These fields drive tax lines on the invoice and in GST reports.',
      },
      { type: 'h2', text: 'Warehouse (when you use stock)' },
      {
        type: 'p',
        text: 'If stock and warehouses are enabled and your branch has warehouses, choose the warehouse that should ship or deduct stock. If no warehouse list appears, check that a specific branch is selected (warehouses are tied to a branch) and that warehouses exist for that branch.',
      },
      { type: 'h2', text: 'Line items' },
      {
        type: 'p',
        text: 'Add at least one line linked to a real item from your item master. For each line you need quantity, rate, and the right tax/HSN behaviour (the app may fill tax from the item and place of supply). You can add lines by searching the item list, and where POS or barcode is enabled, by scanning. If allowed, you can open “new item” from the flow to create a product on the spot.',
      },
      { type: 'h2', text: 'Optional details' },
      {
        type: 'p',
        text: 'When you need them, expand the extra sections: e-way and transport references, customer PO and internal references, terms, notes, attachments, additional charges, round-off, and payment rows if you are recording money received in the same step. None of that replaces a correct customer and at least one valid line.',
      },
      { type: 'h2', text: 'Save' },
      {
        type: 'ol',
        items: [
          'Optionally use Preview to check the document layout before you commit.',
          'Save as draft if you are still editing or need approval. Drafts do not have the same “final” meaning as a completed tax invoice.',
          'To issue the invoice for filing and for the customer, use the final action (e.g. Save & Send or Generate). The app warns that a final tax invoice affects GST. After save you can print, download PDF, or share where your account shows those buttons. On some devices, a finalized invoice opens the invoice view for confirmation.',
        ],
      },
      { type: 'h2', text: 'Keyboard shortcuts (desktop)' },
      {
        type: 'ul',
        items: [
          'Ctrl+S (Cmd+S on Mac): save as draft, when the field focus allows it.',
          'Ctrl+Enter (Cmd+Enter): finalize, when the field focus allows it.',
          'Ctrl+P: open the payment entry where the screen supports it (not for printing; use the Print button after save for PDF/print).',
        ],
      },
      { type: 'h2', text: 'If something blocks you' },
      {
        type: 'ul',
        items: [
          '“Add items” (or save does nothing for lines): you must have at least one line with a real item, not an empty row.',
          'Document number not ready: wait for the series request to finish; fix branch if the series failed.',
          'Branch required: pick one branch; non-admin users cannot post without a branch context.',
        ],
      },
      {
        type: 'tip',
        text: 'Proforma invoices use a different lifecycle (draft/sent/accepted/converted) than a final tax invoice. If you are unsure, use a draft or proforma first, then convert or copy into a final tax invoice per your process.',
      },
      {
        type: 'image',
        src: '/help/how-to/create-tax-invoice-step-by-step.png',
        alt: 'New tax invoice form with customer, lines, and save actions',
        caption: 'New invoice: customer, lines, and actions',
      },
    ],
  },
  {
    slug: 'sales-from-quote-to-invoice',
    title: 'Sales: customers, quotes, orders, and invoices',
    description: 'Typical path from a new customer to tax invoice and follow-up documents.',
    category: 'Sales & customers',
    updatedAt: '2026-04-24',
    sections: [
      {
        type: 'p',
        text: 'Khatario ties most sales to a customer master, then to a document type that matches your workflow (quotation, order, delivery, invoice, or note).',
      },
      { type: 'h2', text: '1. Customer master' },
      {
        type: 'ol',
        items: [
          'Go to Sales → Customers and add the party: name, billing/shipping, GSTIN if B2B, and payment/credit terms.',
          'For statements and aging, the customer must have transactions linked; keep addresses accurate for e-invoicing and delivery.',
        ],
      },
      { type: 'h2', text: '2. Quotation, sales order, delivery challan' },
      {
        type: 'p',
        text: 'Use Sales → Quotations for prices and validity; Sales → Sales orders when you accept an order; Sales → Delivery challans when stock leaves without a tax invoice (or as a pre-invoice document, depending on your process).',
      },
      { type: 'h2', text: '3. Tax invoice' },
      {
        type: 'p',
        text: 'Sales → All Invoices: create a new invoice, pick the customer, lines, tax, and payment. Saved invoices update stock (for inventory items) and post to the ledger for revenue and tax.',
      },
      {
        type: 'tip',
        text: 'For a full, screen-by-screen checklist (branch, number, document type, warehouse, options, save, and shortcuts), use the guide “Create a tax invoice (step by step)” in this same section.',
      },
      { type: 'h2', text: '4. Work orders' },
      {
        type: 'p',
        text: 'If you use Sales → Work orders, use them to track job-level work; billing may still be through invoice or a linked flow depending on your setup.',
      },
      { type: 'h2', text: '5. Credit and debit notes' },
      {
        type: 'p',
        text: 'Sales → Credit notes and Debit notes correct or adjust earlier invoices. They keep GST and stock aligned with the original supply.',
      },
      { type: 'tip', text: 'Customer outstanding and receipts appear in collection workflows and in Reports → Receivables aging once invoices are due.' },
      {
        type: 'image',
        src: '/help/how-to/sales-from-quote-to-invoice.png',
        alt: 'Customer list, invoice, and related sales screens',
        caption: 'Sales documents',
      },
    ],
  },

  // --- Purchases & inventory ---
  {
    slug: 'purchase-and-supplier-cycle',
    title: 'Purchases, suppliers, POs, and returns',
    description: 'Record suppliers, order goods, post bills, and handle returns.',
    category: 'Purchases, stock & items',
    updatedAt: '2026-04-24',
    sections: [
      { type: 'p', text: 'Purchasing flows start from a supplier record and can include requests, purchase orders, goods receipt, and the purchase bill itself.' },
      { type: 'h2', text: 'Suppliers' },
      {
        type: 'p',
        text: 'Go to Purchases → Suppliers. Enter legal name, GSTIN, and payment details. The Suppliers hub (if you use it) can group supplier tools and thresholds in one place.',
      },
      { type: 'h2', text: 'From request to purchase order' },
      {
        type: 'ol',
        items: [
          'Purchases → Requests: internal or formal requests to buy.',
          'Purchases → Purchase orders: issue a PO to the supplier with items, rates, and terms.',
        ],
      },
      { type: 'h2', text: 'Bill (purchase) and stock' },
      {
        type: 'p',
        text: 'Purchases → All Purchases: record the supplier bill. Inventory items update stock; tax lines feed GST and the ledger. Match the bill date to your accounting month.',
      },
      { type: 'h2', text: 'Returns' },
      {
        type: 'p',
        text: 'Purchases → Purchase returns issues a return note, reverses stock, and links to the right GST treatment for the original purchase.',
      },
      { type: 'h2', text: 'Expenses' },
      {
        type: 'p',
        text: 'Use Purchases → Expenses for services and costs that are not a stock purchase. See the separate guide on "on account" when the bill and payment differ.',
      },
      { type: 'tip', text: 'Payments to suppliers are often recorded from Accounting → Payments out, sometimes after a purchase is booked on account.' },
      {
        type: 'image',
        src: '/help/how-to/purchase-and-supplier-cycle.png',
        alt: 'Supplier, purchase, and purchase return screens',
        caption: 'Purchase workflow',
      },
    ],
  },
  {
    slug: 'create-purchase-step-by-step',
    title: 'Create a purchase bill (step by step)',
    description: 'Record a supplier bill, receive stock, and post payable or payment details.',
    category: 'Purchases, stock & items',
    updatedAt: '2026-05-10',
    sections: [
      {
        type: 'p',
        text: 'Use Purchases > All Purchases > New Purchase when you receive a supplier bill. The purchase creates the accounting entry, input tax record, and stock receipt for goods items.',
      },
      { type: 'h2', text: '1. Pick the supplier' },
      {
        type: 'ol',
        items: [
          'Open Purchases > All Purchases and click New Purchase.',
          'Search for the supplier and click the supplier row from the dropdown. Typing the name alone does not link the supplier record.',
          'If the supplier is new, use Add new supplier from the dropdown, save it, and continue with the purchase.',
        ],
      },
      { type: 'h2', text: '2. Enter bill details' },
      {
        type: 'p',
        text: 'Enter the supplier bill number and bill date. Choose the document type: Tax Invoice for regular taxable purchases, Bill of Supply where applicable, or Bill of Entry for imports. Confirm place of supply and reverse charge if it applies.',
      },
      { type: 'h2', text: '3. Select receiving warehouse' },
      {
        type: 'p',
        text: 'If warehouse stock is enabled and the bill has goods lines, select the receiving warehouse before finalizing. Khatario receives finalized stock into this location.',
      },
      { type: 'h2', text: '4. Add items and services' },
      {
        type: 'ol',
        items: [
          'Use Add Item for goods or Add Service for non-stock services.',
          'Search and select existing items where possible so stock and reports stay linked.',
          'Enter quantity, unit price, discount, HSN/SAC, and tax rate.',
          'For batch or serial tracked items, fill the batch, expiry, or serial details before finalizing.',
        ],
      },
      { type: 'h2', text: '5. Payment and save' },
      {
        type: 'p',
        text: 'Review the amount summary. Enter paid amount if you paid the supplier now, or leave it unpaid/on account to pay later from Payments Out. Use Save as Draft while checking details; use Save & Finalize or Finalize Purchase when the bill is ready to post.',
      },
      { type: 'h2', text: 'Upload bill extraction' },
      {
        type: 'p',
        text: 'If the bill upload/extraction panel is available, upload the supplier invoice, review extracted supplier, items, and amounts, correct any matches, then save. Always review extracted data before finalizing.',
      },
      {
        type: 'tip',
        text: 'Common blockers: choose the supplier from the dropdown row, add at least one line, select a receiving warehouse for goods when warehouses are enabled, and make sure you are online before finalizing.',
      },
    ],
  },
  {
    slug: 'items-warehouses-and-inventory',
    title: 'Items, stock movements, and warehouses',
    description: 'Masters, labels, multi-location stock, and adjustments.',
    category: 'Purchases, stock & items',
    updatedAt: '2026-04-24',
    sections: [
      { type: 'p', text: 'Inventory ties item masters to quantities in one or more locations and to purchase and sales documents.' },
      { type: 'h2', text: 'Item master' },
      {
        type: 'p',
        text: 'Inventory → Items: add products or services, units, HSN, tax, and (for stock items) how you value stock. Consistent item names make sales and stock reports reliable.',
      },
      { type: 'h2', text: 'Labels and barcodes' },
      {
        type: 'p',
        text: 'If your plan includes label printing, use Inventory → Print labels with the right label template from Settings. Activity may appear under Reports → Label printing activity when enabled.',
      },
      { type: 'h2', text: 'Warehouses and transfers' },
      {
        type: 'p',
        text: 'When warehouses are enabled in settings, open Settings → Warehouses to define sites, then use Inventory → Stock transfers to move stock. Multi-warehouse may require a plan upgrade in some cases.',
      },
      { type: 'h2', text: 'Adjustments and stock reports' },
      {
        type: 'p',
        text: 'Inventory → Adjustments handles shrinkage, recounts, and corrections. For valuation and quantity checks, use Reports → Stock summary and Reports → Closing stock with the right date and, if used, branch/warehouse filter.',
      },
      { type: 'tip', text: 'Lock inventory behaviour with period locks in Settings if you have already filed GST for a month.' },
      {
        type: 'image',
        src: '/help/how-to/items-warehouses-and-inventory.png',
        alt: 'Items list, warehouse, and stock transfer',
        caption: 'Inventory and locations',
      },
      {
        type: 'tip',
        text: 'To sell a kit as one line on invoices (for example Hair Oil + biscuits together), see the guide “Bundle (combo) items”.',
      },
    ],
  },
  {
    slug: 'bundle-combo-items',
    title: 'Bundle (combo) items',
    description:
      'Sell one SKU on invoices while stock is reduced from each component item (kit / combo products).',
    category: 'Purchases, stock & items',
    updatedAt: '2026-05-19',
    sections: [
      {
        type: 'p',
        text: 'A bundle (combo) is a single item you add on invoices, made up of other goods items. Customers see one line; your stock is updated on each component when the bundle is sold.',
      },
      { type: 'h2', text: 'When to use a bundle' },
      {
        type: 'ul',
        items: [
          'You sell a fixed kit (for example Hair Oil + Parle-G) at one price.',
          'You want one product name on the bill instead of listing every piece separately.',
          'You still need each component’s stock to go down correctly.',
        ],
      },
      { type: 'h2', text: 'How to set one up' },
      {
        type: 'ol',
        items: [
          'Go to Inventory → Items → Add item (or edit an existing goods item).',
          'Set Item type to Goods (bundles are not used for services).',
          'Open the section Bundle (combo) and check This item is a bundle.',
          'For each row, pick a component item and enter Qty — how many units of that item are used per 1 bundle sold.',
          'Use + Add component for more lines. Set the bundle selling price and save.',
        ],
      },
      { type: 'h2', text: 'What each field means' },
      {
        type: 'ul',
        items: [
          'Component item: a normal goods product (not another bundle, not a variant parent). The dropdown shows current stock for planning.',
          'Qty: units of that component consumed for every 1 bundle sold. Qty 2 on Hair Oil means selling 3 bundles deducts 6 Hair Oil.',
          'Estimated cost: sum of each component’s purchase price × qty. This is a hint only; you set the bundle selling price yourself.',
          'Margin vs selling price: compares estimated cost to your selling price. A negative % means the bundle price is below combined purchase cost on paper.',
          'You can create up to N bundles with current stock: for each component, floor(stock ÷ qty per bundle), then the smallest number wins. Example: stock 41 and 34.9 with qty 1 each → up to 34 bundles before Parle-G runs out.',
        ],
      },
      { type: 'h2', text: 'What happens when you sell' },
      {
        type: 'p',
        text: 'On a tax invoice you add the bundle SKU like any other goods line. When the invoice is saved or finalized, Khatario does not reduce stock on the bundle row itself (bundle opening stock stays 0). Instead it deducts invoice quantity × component qty from each linked item, using the same stock rules as a normal sale (branch/warehouse, batches, or serials if those apply to the component).',
      },
      { type: 'h2', text: 'Rules and limits' },
      {
        type: 'ul',
        items: [
          'Goods only — not for service items.',
          'A bundle cannot also use product variants; turn variants off to configure a bundle.',
          'Components cannot be bundles or variant-parent items. Nested bundles are blocked.',
          'You need at least one component with item and quantity greater than 0 before saving.',
          'Bundle lines on invoices cannot use a variant on the bundle SKU.',
        ],
      },
      {
        type: 'tip',
        text: 'Use estimated cost and margin hints when pricing so kits stay profitable. If “up to N bundles” is 0, restock the limiting component before selling the combo.',
      },
    ],
  },

  // --- Money & books ---
  {
    slug: 'chart-of-accounts-and-mappings',
    title: 'Chart of accounts, bank, and account mappings',
    description: 'Add ledgers for cash, bank, and loans, then map payment types to the right account.',
    category: 'Money & books',
    updatedAt: '2026-04-24',
    sections: [
      {
        type: 'p',
        text: 'The chart of accounts is your list of ledgers. Every payment and voucher posts to one of these accounts.',
      },
      { type: 'h2', text: 'Add or review accounts' },
      {
        type: 'p',
        text: 'Open Accounting → Chart of accounts. You will usually see default groups (Assets, Liabilities, Income, Expenses). Add lines such as a second bank, petty cash, or a loan (loans are typically liabilities, not the same as your bank balance).',
      },
      { type: 'h2', text: 'Map cash, UPI, and bank' },
      {
        type: 'p',
        text: 'Go to Settings → Account mappings. Point default Cash, default Bank, and each payment mode (UPI, bank transfer, card, etc.) to the correct ledger. That way invoices, expenses, and payments post to the right place without re-selecting the account every time.',
      },
      { type: 'h2', text: 'Balance sheet' },
      {
        type: 'p',
        text: 'Asset accounts in the right group (for example current assets for bank and cash) appear on the balance sheet when they have a balance. Liability accounts (such as term loans) appear under liabilities + equity, not with bank balances.',
      },
      {
        type: 'tip',
        text: 'IFSC and account number can be noted in the account description, or use any bank master feature your deployment supports, linked to the same ledger.',
      },
      {
        type: 'image',
        src: '/help/how-to/chart-of-accounts-and-mappings.png',
        alt: 'Chart of accounts and default account mappings',
        caption: 'Chart of accounts and payment mappings',
      },
    ],
  },
  {
    slug: 'expenses-on-account-and-payment',
    title: 'Record an expense (bill not paid) and pay the vendor later',
    description: 'Two steps: accrue the expense, then pay from Payments out.',
    category: 'Money & books',
    updatedAt: '2026-04-24',
    sections: [
      {
        type: 'p',
        text: 'When you receive a bill but pay later, the books should show the cost now and the amount you owe until you pay.',
      },
      { type: 'h2', text: 'Step 1: Bill received, not yet paid' },
      {
        type: 'ol',
        items: [
          'Create the vendor under Suppliers if needed.',
          'Go to Expenses → Add expense.',
          'Choose amount, date, category, and description.',
          'Under Payment, select "Bill received, not paid yet (on account)".',
          'Pick the same supplier you will pay later (recommended) so the vendor balance updates.',
          'Save. The app posts: debit expense, credit Accounts Payable (no cash leaves yet).',
        ],
      },
      { type: 'h2', text: 'Step 2: Pay the vendor' },
      {
        type: 'ol',
        items: [
          'When you pay, go to Accounting → Payments out (or Payments → Out).',
          'Select the same supplier, enter the amount and payment mode, and save.',
          'This posts: debit Accounts Payable, credit bank or cash. Cash moves only in this step.',
        ],
      },
      {
        type: 'tip',
        text: 'If you only record expenses as "paid" with cash or bank, the full amount is treated as cash out on that date. Use "on account" when the bill and payment dates differ.',
      },
      {
        type: 'image',
        src: '/help/how-to/expenses-on-account-and-payment.png',
        alt: 'Expense and supplier payment screens',
        caption: 'Recording an on-account bill and paying the supplier',
      },
    ],
  },
  {
    slug: 'payments-ledger-and-journals',
    title: 'Payments, ledger, journals, and opening balance',
    description: 'How money moves, how to read the ledger, and when to use journals.',
    category: 'Money & books',
    updatedAt: '2026-04-24',
    sections: [
      { type: 'p', text: 'Day-to-day cash and bank are usually updated by payments and sales/purchase documents; journals and opening data handle the rest.' },
      { type: 'h2', text: 'Payments in and out' },
      {
        type: 'ul',
        items: [
          'Accounting → Payments in: money from customers (against invoices or advances as your process allows).',
          'Accounting → Payments out: to suppliers, expenses already booked, and similar payables.',
        ],
      },
      { type: 'h2', text: 'General ledger' },
      {
        type: 'p',
        text: 'Accounting → Ledger: pick an account and date range. Use it to verify that invoices, payments, and journals all hit the right ledger, especially before year-end or audits.',
      },
      { type: 'h2', text: 'Journal entries' },
      {
        type: 'p',
        text: 'Accounting → Journal entries: for adjustments, accruals, reclassifications, and openings that do not go through a standard invoice or payment screen. Use templates when you repeat the same type of entry.',
      },
      { type: 'h2', text: 'Opening balances' },
      {
        type: 'p',
        text: 'If you start mid-year or migrate data, use the Opening balances setup (search for "Opening" in the app, or open the menu entry if your build shows it) so assets, liabilities, and equity match your closing from the previous system before you post new transactions.',
      },
      { type: 'h2', text: 'TDS, TCS, and provisions' },
      {
        type: 'p',
        text: 'Accounting → TDS/TCS: manage deductor settings, challans, and related registers as required. Provisions: use Accounting → Provisions for expenses or liabilities you need to accrue in the books by period.',
      },
      {
        type: 'image',
        src: '/help/how-to/payments-ledger-and-journals.png',
        alt: 'Payments, ledger, and journal entry screens',
        caption: 'Accounting entries',
      },
    ],
  },

  // --- Reports & GST ---
  {
    slug: 'balance-sheet-and-trial-balance',
    title: 'Balance sheet, trial balance, and when it "does not balance"',
    description: 'Read the two sides, check the trial balance first, and understand small paise differences.',
    category: 'Reports & GST',
    updatedAt: '2026-04-24',
    sections: [
      {
        type: 'p',
        text: 'The balance sheet shows what you have (assets) versus what you owe and what is yours (liabilities and equity) on a given date.',
      },
      { type: 'h2', text: 'Trial balance first' },
      {
        type: 'p',
        text: 'If something looks wrong, run Reports → Trial balance for the same date. Total debits should equal total credits. If the trial balance ties, the books are consistent; the balance sheet is built from the same data.',
      },
      { type: 'h2', text: 'Set financial year on the balance sheet' },
      {
        type: 'p',
        text: 'Where the report asks for financial year, enter it for closing stock, tax lines, and opening retained earnings to line up. Leaving it empty can change how some lines are loaded.',
      },
      { type: 'h2', text: 'Small difference (a few paise)' },
      {
        type: 'p',
        text: 'Rounding between asset totals, GST lines, and profit for the year can show a few paise gap. The app may treat that as "balanced" within a small tolerance. Larger gaps mean a misposting or missing link—review inventory, on-account items, and journal entries for that date.',
      },
      {
        type: 'tip',
        text: 'Current year profit on the balance sheet is built from income and expense in the books for the year to date, not from a single invoice total.',
      },
      {
        type: 'image',
        src: '/help/how-to/balance-sheet-and-trial-balance.png',
        alt: 'Balance sheet and trial balance reports',
        caption: 'Balance sheet and related checks',
      },
    ],
  },
  {
    slug: 'cash-flow-dashboard',
    title: 'Dashboard cash flow chart (what the line means)',
    description: 'Month-end cash, incoming vs outgoing, and why the line can look flat.',
    category: 'Reports & GST',
    updatedAt: '2026-04-24',
    sections: [
      {
        type: 'p',
        text: 'The dashboard cash flow card shows a line across months. Each point is the running cash position at the end of that month, not a single "activity bar" for that month only.',
      },
      { type: 'h2', text: 'What counts as in and out' },
      {
        type: 'ul',
        items: [
          'Incoming: customer payments (money in) recorded in the app for the year.',
          'Outgoing: purchase payments, other payments to suppliers, and paid expenses. Expenses marked "on account" (unpaid) are not cash out until you record a payment.',
        ],
      },
      { type: 'h2', text: 'Why the line can look flat' },
      {
        type: 'p',
        text: 'If most receipts and payments happen in one month, the running balance may stay the same for every other month, so the line is horizontal. That is expected for month-end balance when there is no activity in those months. Hover a point to see that month’s figure.',
      },
      { type: 'h2', text: 'Bottom summary' },
      {
        type: 'p',
        text: 'Opening + total incoming - total outgoing should match the end-of-year cash line shown. That matches a simple check of your numbers for the year.',
      },
      { type: 'tip', text: 'For full cash flow statement layout (operating, investing, financing), use Reports → Cash flow if you need a formal statement.' },
      {
        type: 'image',
        src: '/help/how-to/cash-flow-dashboard.png',
        alt: 'Cash flow line chart on the dashboard',
        caption: 'Dashboard cash flow and monthly points',
      },
    ],
  },
  {
    slug: 'profit-loss-aging-and-custom-reports',
    title: 'P&L, aging, and custom report builder',
    description: 'Period profit, who owes you, and building ad-hoc reports when your plan allows.',
    category: 'Reports & GST',
    updatedAt: '2026-04-24',
    sections: [
      { type: 'h2', text: 'Profit and loss' },
      {
        type: 'p',
        text: 'Reports → Profit & loss: choose the period. Income and expenses follow your chart of accounts. Compare with the dashboard and balance sheet: profit for the year ties to your books, not a single register.',
      },
      { type: 'h2', text: 'Receivables and payables aging' },
      {
        type: 'p',
        text: 'Reports → Receivables aging and Payables aging list outstanding invoices by age bucket. Use them for collections, credit control, and supplier planning. Unpaid "on account" expenses may also affect payables depending on your posting.',
      },
      { type: 'h2', text: 'Sales and purchase summaries' },
      {
        type: 'p',
        text: 'Under Reports, open Sales and Purchase submenus for party-wise, tax-wise, invoice-wise, and return-specific views. Pick the same date range and branch filters as in other reports for consistent numbers.',
      },
      { type: 'h2', text: 'Custom report builder' },
      {
        type: 'p',
        text: 'If your plan includes the custom report builder, use it to save layouts that you cannot get from a standard list screen. It does not replace statutory GST exports—use the GST reports for filing.',
      },
      { type: 'tip', text: 'Start from Reports → Overview to see everything available; exact names follow your version and entitlements.' },
      {
        type: 'image',
        src: '/help/how-to/profit-loss-aging-and-custom-reports.png',
        alt: 'P and L, aging, and report builder',
        caption: 'Financial and aging reports',
      },
    ],
  },
  {
    slug: 'gst-returns-essentials',
    title: 'GST returns: GSTR-1, 2B, 3B, and annual (GSTR-9)',
    description: 'What each return is for and how reconciliation fits in.',
    category: 'Reports & GST',
    updatedAt: '2026-04-24',
    sections: [
      { type: 'p', text: 'Khatario prepares views you can use alongside the government portal. Always validate totals before filing and use your registered credentials on the official site for submission.' },
      { type: 'h2', text: 'GSTR-1 (outward supplies)' },
      { type: 'p', text: 'Reports → GSTR-1: lists sales invoices and related outward documents for the return period. Match your book totals to this extract before upload.' },
      { type: 'h2', text: 'GSTR-2B (purchases as seen by the portal)' },
      { type: 'p', text: 'GSTR-2B is a read-only statement of your vendors’ reported supplies. Open Reports → GSTR-2B and, when needed, GSTR-2B reconciliation to match with your books and identify missing or mismatched entries.' },
      { type: 'h2', text: 'GSTR-3B (summary return)' },
      { type: 'p', text: 'Reports → GSTR-3B: summary of output tax, input tax credit, and net payment. It should align with GSTR-1 and your purchase/ITC data for the same period.' },
      { type: 'h2', text: 'GSTR-9 (annual return)' },
      { type: 'p', text: 'Use Reports → GSTR-9 for the annual view when applicable. It aggregates the year; lock prior periods in Settings to avoid last-minute changes after you sign off a quarter.' },
      { type: 'tip', text: 'Keep tax settings and invoice tax lines consistent all year so returns do not drift from the ledger.' },
      {
        type: 'image',
        src: '/help/how-to/gst-returns-essentials.png',
        alt: 'GST report list in Khatario',
        caption: 'GST report screens',
      },
    ],
  },

  // --- Team, settings, tools ---
  {
    slug: 'hr-and-payroll-overview',
    title: 'HR: employees, attendance, leave, and salary',
    description: 'What each HR area does if enabled for your business.',
    category: 'Team, settings & add-ons',
    updatedAt: '2026-04-24',
    sections: [
      {
        type: 'p',
        text: 'HR features may require the right plan and permissions. If a menu is hidden or marked Upgrade, contact your admin or subscription page.',
      },
      { type: 'h2', text: 'Employees' },
      { type: 'p', text: 'HR & Employees → All employees: maintain profiles, designations, and links to salary and attendance. Add employees from the add flow with documents as your policy needs.' },
      { type: 'h2', text: 'Attendance and leave' },
      {
        type: 'p',
        text: 'Attendance: record daily or periodic attendance. Leaves: use leave types and holidays from Settings (holidays, leave types) together with the leaves screen for requests and balances.',
      },
      { type: 'h2', text: 'Salary and commission' },
      {
        type: 'p',
        text: 'Salary payments and advances: run payroll from the menu after pay periods are set. Commissions: tie sales results to pay using commission rules in Settings and the commissions list.',
      },
      { type: 'h2', text: 'Other' },
      { type: 'p', text: 'Performance, tasks, and activity logs (where enabled) help track work. Activity logs are also under Settings in some builds—use the path your app shows for audit of user actions.' },
      {
        type: 'image',
        src: '/help/how-to/hr-and-payroll-overview.png',
        alt: 'Employee and attendance list',
        caption: 'HR area',
      },
    ],
  },
  {
    slug: 'tools-whatsapp-and-search',
    title: 'Tools, WhatsApp, search, and documentation',
    description: 'Calculators, optional WhatsApp, and how to get more help.',
    category: 'Team, settings & add-ons',
    updatedAt: '2026-04-24',
    sections: [
      { type: 'h2', text: 'Search' },
      { type: 'p', text: 'Use the global search from More → Search (or the search entry in your app) to jump to customers, documents, and items by number or name.' },
      { type: 'h2', text: 'Tools' },
      {
        type: 'p',
        text: 'More → Tools (or the tools submenu) includes GST/TDS/EMI calculators, validators, lead extractors, and utilities. The To do list and some tools are gated by plan—upgrade if you need them long term.',
      },
      { type: 'h2', text: 'WhatsApp Business' },
      {
        type: 'p',
        text: 'The WhatsApp add-on shows dashboard, conversations, order verification, campaigns, contacts, and more. Enable and configure it from Settings → Integrations and your subscription. Without the add-on, those links may show an upgrade or lock state.',
      },
      { type: 'h2', text: 'Help and support' },
      {
        type: 'p',
        text: 'Settings → Help & support links product tour, this how-to library, and external documentation. Use Contact support (from the More or support menu) for account-specific issues.',
      },
      {
        type: 'image',
        src: '/help/how-to/tools-whatsapp-and-search.png',
        alt: 'Tools and help links',
        caption: 'Tools and add-ons',
      },
    ],
  },
  {
    slug: 'send-whatsapp-message',
    title: 'Send a WhatsApp message',
    description: 'Connect WhatsApp, send text, image, button, invoice, reminder, and campaign messages.',
    category: 'Team, settings & add-ons',
    updatedAt: '2026-05-10',
    sections: [
      {
        type: 'p',
        text: 'WhatsApp features can be add-on gated. Invoice sharing may still be available from an invoice, while the full WhatsApp area unlocks conversations, bot rules, campaigns, contacts, and manual messages.',
      },
      { type: 'h2', text: '1. Connect WhatsApp' },
      {
        type: 'ol',
        items: [
          'Open WhatsApp or Settings > Integrations > WhatsApp.',
          'Go to the Connection tab.',
          'Scan the QR code with the WhatsApp phone.',
          'Wait for the status to show connected. If it disconnects later, reconnect from the same screen.',
        ],
      },
      { type: 'h2', text: '2. Send a text message' },
      {
        type: 'ol',
        items: [
          'Open WhatsApp > Send Message.',
          'Choose Text.',
          'Enter the phone number with country code, for example 919876543210.',
          'Type the message and click Send Message.',
        ],
      },
      { type: 'h2', text: '3. Send an image' },
      {
        type: 'ol',
        items: [
          'Choose Image in Send Message.',
          'Enter the phone number with country code.',
          'Upload a PNG, JPG, or GIF image up to 5 MB.',
          'Enter a caption and send.',
        ],
      },
      { type: 'h2', text: '4. Send buttons' },
      {
        type: 'p',
        text: 'Choose Buttons to add quick replies and call-to-action buttons. You can add up to 3 quick replies, plus one phone button and one URL button. Button titles should be short, up to 20 characters.',
      },
      { type: 'h2', text: '5. Send an invoice' },
      {
        type: 'p',
        text: 'Open the invoice, use the WhatsApp/share action, confirm the customer phone number, and send. Khatario can generate or attach the invoice PDF from the invoice share flow.',
      },
      { type: 'h2', text: '6. Reminders, conversations, and campaigns' },
      {
        type: 'ul',
        items: [
          'Use Send Reminders or Auto Reminders for due invoices and follow-ups.',
          'Use Logs to review send status and errors.',
          'Use Conversations for live chats, notes, labels, linked orders, and timelines where enabled.',
          'Use Contacts, Groups, and Campaigns for bulk communication. Message only customers who have consented.',
          'Use Bot Rules for automated replies and order handling; test rules with a small audience before relying on them.',
        ],
      },
      {
        type: 'tip',
        text: 'If a WhatsApp send fails, check connection status, country-code phone format, add-on access, media size, and whether the customer has opted out.',
      },
    ],
  },
];

export function getAllHowToArticles(): HowToArticle[] {
  return articles;
}

/** One guide per category (first in list order) — for the "Start here" tiles. */
export function getFeaturedHowToArticles(): HowToArticle[] {
  const firstByCategory = new Map<string, HowToArticle>();
  for (const a of articles) {
    if (!firstByCategory.has(a.category)) {
      firstByCategory.set(a.category, a);
    }
  }
  return HOW_TO_CATEGORIES.map((c) => firstByCategory.get(c)).filter((a): a is HowToArticle => a != null);
}

export function getHowToSlugs(): string[] {
  return articles.map((a) => a.slug);
}

export function getHowToArticleBySlug(slug: string): HowToArticle | undefined {
  return articles.find((a) => a.slug === slug);
}

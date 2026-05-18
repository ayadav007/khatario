import type { DriveStep } from 'driver.js';

/**
 * Guided tour for Settings → Business Profile.
 * Each step explains what the section controls and the impact of leaving it empty or off.
 */
export const BUSINESS_PROFILE_TOUR_STEPS: DriveStep[] = [
  {
    element: '[data-tour="bp-intro"]',
    popover: {
      title: 'Why this page matters',
      description:
        'This is the second part of the guided tour — your business profile. It is the master identity Khatario uses on invoices, PDFs, GST-related flows, and many customer-facing screens. If you skip fields, documents can show blanks, wrong addresses, or missing tax IDs — which hurts trust and compliance.',
      side: 'bottom',
      align: 'start',
    },
  },
  {
    element: '[data-tour="bp-branch-notice"]',
    popover: {
      title: 'Multiple branches',
      description:
        'If you see this banner, you are editing the active outlet’s name, contact, and address. PAN, logo, and signature usually stay at company level — so changes here may not mirror every branch. Single-outlet businesses edit everything in one place.',
      side: 'bottom',
      align: 'start',
    },
  },
  {
    element: '[data-tour="bp-basic"]',
    popover: {
      title: 'Business name, email, and phone',
      description:
        'Business or branch name prints on invoices and reports; leaving it wrong confuses buyers. Email is ideal for quotes and from-address context; without it, some communications fall back to your login. Phone appears on documents; if empty, customers may not reach you from the PDF alone.',
      side: 'bottom',
      align: 'start',
    },
  },
  {
    element: '[data-tour="bp-type"]',
    popover: {
      title: 'Type, industry, model, and “About us”',
      description:
        'Type, industry, and model tune defaults and reporting context; they are optional but help analytics. The company introduction feeds the AI/WhatsApp assistant — if you leave it blank, automated replies have less context about what you sell and how you operate.',
      side: 'bottom',
      align: 'start',
    },
  },
  {
    element: '[data-tour="bp-features"]',
    popover: {
      title: 'Catalog and inventory behaviour',
      description:
        'Product variants: off keeps items simple; on enables size/color SKUs (common for apparel). Default “sell when out of stock” only sets the starting rule for new items — you can override each item. Warehouses: off keeps one stock bucket; on enables locations and transfers (may require your plan). Auto-assign branch warehouses (when warehouses are on) controls whether staff linked to a branch automatically get its warehouses, or you assign access manually.',
      side: 'bottom',
      align: 'start',
    },
  },
  {
    element: '[data-tour="bp-pos"]',
    popover: {
      title: 'POS mode',
      description:
        'This only changes how the new invoice screen is laid out for fast checkout (e.g. retail). It does not change tax, stock, or customer rules — you can turn it off anytime.',
      side: 'bottom',
      align: 'start',
    },
  },
  {
    element: '[data-tour="bp-address"]',
    popover: {
      title: 'Business address',
      description:
        'Shown on invoices and used wherever a registered address is required. An incomplete address can hurt e-invoice clarity and may not match GST records — fill at least line 1, city, state, and pincode for Indian businesses.',
      side: 'bottom',
      align: 'start',
    },
  },
  {
    element: '[data-tour="bp-gst"]',
    popover: {
      title: 'GST registration, GSTIN, and PAN',
      description:
        'Registration type decides whether you issue tax invoices, bills of supply (composition), or stay unregistered (no GST charging). GSTIN is required for regular or composition in typical cases; wrong or missing GSTIN can invalidate GST invoices. PAN links income-tax data; without it, some statutory summaries stay incomplete.',
      side: 'bottom',
      align: 'start',
    },
  },
  {
    element: '[data-tour="bp-export"]',
    popover: {
      title: 'Export (IEC) and SWIFT',
      description:
        'IEC is for import/export paperwork — only needed if you ship across borders. SWIFT/BIC helps international bank transfers; domestic-only businesses can leave these empty with no downside.',
      side: 'bottom',
      align: 'start',
    },
  },
  {
    element: '[data-tour="bp-logo"]',
    popover: {
      title: 'Business logo',
      description:
        'Appears on printed and PDF invoices and other branded outputs. If unset, invoices still work but look generic — add a logo for professional PDFs.',
      side: 'bottom',
      align: 'start',
    },
  },
  {
    element: '[data-tour="bp-signature"]',
    popover: {
      title: 'Authorized signature',
      description:
        'Shows as signatory on invoices. If missing, the PDF may look unsigned — fine for drafts, less ideal for formal documents.',
      side: 'bottom',
      align: 'start',
    },
  },
  {
    element: '[data-tour="bp-save"]',
    popover: {
      title: 'Save changes',
      description:
        'Nothing here applies until you save. After major updates, reload or reopen a screen if values look stale.',
      side: 'top',
      align: 'end',
    },
  },
  {
    element: '[data-tour="bp-banks"]',
    popover: {
      title: 'Bank accounts on documents',
      description:
        'Active accounts can print on invoices so customers know where to pay. The first active account is typically used for display. If you add none, payment instructions may rely on manual text elsewhere.',
      side: 'bottom',
      align: 'start',
    },
  },
  {
    element: '[data-tour="bp-payments"]',
    popover: {
      title: 'UPI and other payment methods',
      description:
        'Used for WhatsApp payment links and similar flows. Mark one as default so automation knows which QR or UPI to prefer. If empty, you can still collect payment outside the app but will not get prefilled payment links.',
      side: 'bottom',
      align: 'start',
    },
  },
];

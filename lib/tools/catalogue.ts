import { TDS_PUBLIC } from '@/lib/tools/tds-rates';
import { CURRENCY_RATES_AS_OF, CURRENCY_RATES_SOURCE, formatRatesDate } from '@/lib/tools/currency-converter';

const CURRENCY_RATES_DATE_TEXT = formatRatesDate(CURRENCY_RATES_AS_OF);

export type ToolCategory = 'GST and tax' | 'Money' | 'Business' | 'Images';
export type ToolFaq = { question: string; answer: string };
export type FreeTool = {
  slug: string;
  title: string;
  shortDescription: string;
  /** lucide-react icon name */
  icon: string;
  category: ToolCategory;
  metaTitle: string;
  metaDescription: string;
  /** 2 to 4 sentences */
  howItWorks: string[];
  /** 2 or 3 */
  faqs: ToolFaq[];
  /** 2 or 3 slugs of other tools */
  related: string[];
  showsStatutoryRates: boolean;
  /** Plain-words caveat shown on the page, for example the outside model or approximate rates */
  notes?: string;
};

const ALL_TOOLS: FreeTool[] = [
  {
    slug: 'invoice-maker',
    title: 'GST invoice maker',
    shortDescription: 'Make a GST invoice in your browser and save it as a PDF.',
    icon: 'FileText',
    category: 'GST and tax',
    metaTitle: 'Free GST Invoice Maker | Khatario',
    metaDescription: 'Make a GST invoice in your browser and save it as a PDF. Nothing is saved to Khatario, and no sign-up is needed.',
    howItWorks: [
      'Fill in your business details, the customer details and the items you sold.',
      'The invoice updates as you type, with the tax worked out for each line.',
      'Your draft stays in this browser so you can come back to it later. Nothing is saved to Khatario.',
      'To keep a copy, use Download PDF, then choose Save as PDF in the print window.',
    ],
    faqs: [
      {
        question: 'Does Khatario save my invoice?',
        answer: 'No. The invoice maker works in your browser and saves nothing to Khatario. Your draft is kept in this browser only, so clearing site data removes it.',
      },
      {
        question: 'How do I get a PDF?',
        answer: 'Use Download PDF, then choose Save as PDF in the print window.',
      },
      {
        question: 'Do I need an account?',
        answer: 'No. You can make an invoice without signing up.',
      },
    ],
    related: ['gst-calculator', 'invoice-number-generator', 'gstin-validator'],
    showsStatutoryRates: false,
  },
  {
    slug: 'gst-calculator',
    title: 'GST calculator',
    shortDescription: 'Add GST to an amount or take it out of a total, with the CGST, SGST and IGST split.',
    icon: 'Calculator',
    category: 'GST and tax',
    metaTitle: 'Free GST Calculator | Khatario',
    metaDescription: 'Add GST to an amount or remove it from a total. See the CGST, SGST and IGST split. Free, with no sign-up.',
    howItWorks: [
      'Choose whether your amount is without GST or with GST included.',
      'Enter the amount and pick a rate, or type your own rate.',
      'You see the base amount, the GST and the total, with the tax split into CGST plus SGST and into IGST.',
    ],
    faqs: [
      {
        question: 'When do I use CGST and SGST, and when IGST?',
        answer: 'Use CGST plus SGST when the sale is within one state. Use IGST when the sale is between two states.',
      },
      {
        question: 'Which GST rates can I pick?',
        answer: 'The quick buttons show 0%, 5%, 18% and 40%. For special rates, such as 0.1%, 0.25%, 1.5% or 3%, type the rate in the custom box. Check the rate for your item before you bill.',
      },
      {
        question: 'Is anything saved?',
        answer: 'No. The sums happen in your browser and nothing is sent or stored.',
      },
    ],
    related: ['hsn-finder', 'invoice-maker', 'discount-calculator'],
    showsStatutoryRates: true,
  },
  {
    slug: 'gstin-validator',
    title: 'GSTIN validator',
    shortDescription: 'Check that a GSTIN is written correctly and see its state code and PAN.',
    icon: 'UserCheck',
    category: 'GST and tax',
    metaTitle: 'Free GSTIN Format Checker | Khatario',
    metaDescription: 'Check that a GSTIN is in the right format and read the state and PAN inside it. Free, with no sign-up.',
    howItWorks: [
      'Type or paste a 15 character GSTIN.',
      'The tool checks the length and the pattern of letters and numbers.',
      'If the format is right, it shows the state from the first two digits and the PAN inside the GSTIN.',
    ],
    faqs: [
      {
        question: 'Does this check the GST portal?',
        answer: 'No. It checks the format only and does not contact the GST portal. A GSTIN can look correct here and still be cancelled or not exist. To confirm a supplier, search the number on the GST portal.',
      },
      {
        question: 'What is inside a GSTIN?',
        answer: 'The first two digits are the state code, the next ten are the PAN of the business, and the last characters mark the registration and a final check character.',
      },
    ],
    related: ['pan-validator', 'invoice-maker', 'gst-calculator'],
    showsStatutoryRates: false,
    notes: 'This tool checks the format only. It does not contact the GST portal, so it cannot tell you if a GSTIN is active.',
  },
  {
    slug: 'pan-validator',
    title: 'PAN validator',
    shortDescription: 'Check that a PAN is written correctly and see the holder type.',
    icon: 'CreditCard',
    category: 'GST and tax',
    metaTitle: 'Free PAN Format Checker | Khatario',
    metaDescription: 'Check that a PAN is in the right format and see the holder type from its fourth character. Free, no sign-up.',
    howItWorks: [
      'Type or paste a 10 character PAN.',
      'The tool checks that it is five letters, four numbers and one letter.',
      'If the format is right, it reads the holder type, such as individual or company, from the fourth character.',
    ],
    faqs: [
      {
        question: 'Does this confirm the PAN belongs to a real person?',
        answer: 'No. It checks the format only. It does not look the PAN up with the Income Tax Department.',
      },
      {
        question: 'What does the fourth character mean?',
        answer: 'It shows the type of holder. P is an individual, C a company, H a Hindu Undivided Family, F a firm, and so on.',
      },
    ],
    related: ['gstin-validator', 'tds-calculator', 'invoice-maker'],
    showsStatutoryRates: false,
    notes: 'This tool checks the format only. It does not look the PAN up anywhere.',
  },
  {
    slug: 'hsn-finder',
    title: 'HSN and SAC finder',
    shortDescription: 'Look up common HSN and SAC codes by code or by item name.',
    icon: 'Search',
    category: 'GST and tax',
    metaTitle: 'Free HSN and SAC Code Finder | Khatario',
    metaDescription: 'Search common HSN and SAC codes by code or item name, with the GST rate where one rate applies. Free, no sign-up.',
    howItWorks: [
      'Type a code, such as 6109, or an item name, such as T-shirt.',
      'The list narrows to matching codes with a short description and a category.',
      'Where one GST rate applies, it is shown. Where the rate depends on the item, the tool says so and asks you to check the current rate.',
    ],
    faqs: [
      {
        question: 'Does it list every HSN code?',
        answer: 'No. It covers a short list of common codes used by small businesses. If your item is not listed, find the code on the GST portal or ask your accountant.',
      },
      {
        question: 'Why do some codes show no rate?',
        answer: 'For some goods the GST rate depends on the price or the type of item, so one number would mislead you. Check the current rate before you bill.',
      },
    ],
    related: ['gst-calculator', 'invoice-maker', 'gstin-validator'],
    showsStatutoryRates: true,
    notes: 'Rates shown are a guide. Check the current notification before you bill.',
  },
  {
    slug: 'tds-calculator',
    title: 'TDS calculator',
    shortDescription: 'Work out the TDS to cut on a payment, by section.',
    icon: 'Banknote',
    category: 'GST and tax',
    metaTitle: 'Free TDS Calculator | Khatario',
    metaDescription: 'Work out TDS on a payment by section and see the amount you pay out. Rates for tax year 2026-27. Free, no sign-up.',
    howItWorks: [
      'Enter the payment amount and pick the kind of payment from the list.',
      'The list shows the section of the Income-tax Act, 2025 and the older section number in brackets.',
      'You see the TDS to cut and the amount left to pay. You can also type your own rate.',
    ],
    faqs: [
      {
        question: 'Which year are the rates for?',
        answer: 'The listed rates are for tax year 2026-27 and are based on the Income Tax Department rate chart and the Finance Act, 2026. Rates can change, so check the chart before you file.',
      },
      {
        question: 'Does it handle a lower deduction or a missing PAN?',
        answer: 'No. It multiplies the amount by the rate you choose. For a case such as a higher rate for a missing PAN, type that rate in the custom box.',
      },
      {
        question: 'Why is insurance commission 2% when some charts show 5%?',
        answer: 'The Finance Act, 2026 sets 2% for a payee who is not a company. Some published charts still show the older 5%.',
      },
    ],
    related: ['pan-validator', 'gst-calculator', 'interest-calculator'],
    showsStatutoryRates: true,
    notes: 'Rates are for tax year 2026-27 and are based on the Income Tax Department rate chart and the Finance Act, 2026. Confirm with your accountant before you file.',
  },
  {
    slug: 'discount-calculator',
    title: 'Discount calculator',
    shortDescription: 'Find the final price and the amount saved after a discount.',
    icon: 'Tag',
    category: 'Money',
    metaTitle: 'Free Discount Calculator | Khatario',
    metaDescription: 'Work out the final price and the saving after a percentage or flat discount. Free, with no sign-up.',
    howItWorks: [
      'Enter the original price.',
      'Choose a percentage discount or a flat rupee discount, and enter it.',
      'You see the amount saved and the final price.',
    ],
    faqs: [
      {
        question: 'Can I use a flat rupee discount?',
        answer: 'Yes. Switch from percentage to amount and enter the rupees off.',
      },
      {
        question: 'Does it add GST?',
        answer: 'No. It works on the price you enter. Use the GST calculator for tax.',
      },
    ],
    related: ['price-margin-calculator', 'gst-calculator', 'invoice-maker'],
    showsStatutoryRates: false,
  },
  {
    slug: 'price-margin-calculator',
    title: 'Price and margin calculator',
    shortDescription: 'Work out selling price, markup and profit margin from your cost.',
    icon: 'TrendingUp',
    category: 'Money',
    metaTitle: 'Free Price and Margin Calculator | Khatario',
    metaDescription: 'Work out selling price, markup and profit margin from your cost or selling price. Free, with no sign-up.',
    howItWorks: [
      'Enter your cost price or your selling price.',
      'Enter the margin or the markup you want.',
      'You see the other price, the profit, and both the margin and the markup.',
    ],
    faqs: [
      {
        question: 'What is the difference between margin and markup?',
        answer: 'Margin is profit as a share of the selling price. Markup is profit as a share of the cost. The same sale has a higher markup than margin.',
      },
      {
        question: 'Does it include GST?',
        answer: 'No. Prices are taken as entered. Work out GST separately with the GST calculator.',
      },
    ],
    related: ['discount-calculator', 'gst-calculator', 'emi-calculator'],
    showsStatutoryRates: false,
  },
  {
    slug: 'interest-calculator',
    title: 'Interest calculator',
    shortDescription: 'Work out simple or compound interest on an amount over a number of years.',
    icon: 'Percent',
    category: 'Money',
    metaTitle: 'Free Interest Calculator | Khatario',
    metaDescription: 'Work out simple or compound interest for a rate and number of years. Free, with no sign-up.',
    howItWorks: [
      'Enter the amount, the yearly interest rate and the number of years.',
      'Pick simple or compound interest.',
      'You see the interest earned and the total amount at the end.',
    ],
    faqs: [
      {
        question: 'What is the difference between simple and compound interest?',
        answer: 'Simple interest is worked out on the original amount only. Compound interest is worked out on the amount plus the interest already added, once a year.',
      },
      {
        question: 'Can I use part of a year?',
        answer: 'Yes. The number of years can be a decimal, for example 0.5 for six months. For a monthly loan repayment, use the EMI calculator.',
      },
    ],
    related: ['emi-calculator', 'tds-calculator', 'discount-calculator'],
    showsStatutoryRates: false,
  },
  {
    slug: 'emi-calculator',
    title: 'EMI calculator',
    shortDescription: 'Work out the monthly instalment on a loan, with the interest and a repayment schedule.',
    icon: 'BarChart',
    category: 'Money',
    metaTitle: 'Free EMI Calculator | Khatario',
    metaDescription: 'Work out the monthly EMI on a loan, the total interest and the first year of repayments. Free, no sign-up.',
    howItWorks: [
      'Enter the loan amount, the yearly interest rate and the length of the loan in months or years.',
      'The tool works out the monthly instalment.',
      'You also see the total interest and the first twelve months of repayments, with the balance left each month.',
    ],
    faqs: [
      {
        question: 'Does the EMI include fees?',
        answer: 'No. It covers the loan amount and interest only. Processing fees and insurance are not included.',
      },
      {
        question: 'Will my lender show the same number?',
        answer: 'It should be close for a standard reducing-balance loan. Lenders can round differently or use a different start date, so check with your lender.',
      },
    ],
    related: ['interest-calculator', 'price-margin-calculator', 'discount-calculator'],
    showsStatutoryRates: false,
  },
  {
    slug: 'currency-converter',
    title: 'Currency converter',
    shortDescription: 'Convert between rupees and the dollar, euro, pound, yen and dirham at RBI reference rates.',
    icon: 'RefreshCw',
    category: 'Money',
    metaTitle: 'Free Currency Converter | Khatario',
    metaDescription: 'Convert between rupees and the dollar, euro, pound, yen and dirham at Reserve Bank of India reference rates. A quick estimate, not a live rate. Free.',
    howItWorks: [
      'Enter an amount and choose the currency you have and the one you want.',
      'The tool converts it using a fixed table of Reserve Bank of India reference rates from one date.',
      'Use the result as a quick estimate, not as a quote.',
    ],
    faqs: [
      {
        question: 'Are these live rates?',
        answer: `No. Reference rates as of ${CURRENCY_RATES_DATE_TEXT}. Banks and money changers charge a different rate. The rates come from the Reserve Bank of India website (${CURRENCY_RATES_SOURCE}), which publishes the reference rates set by Financial Benchmarks India (FBIL). They do not update by themselves, so check your bank before you quote a price or send money.`,
      },
      {
        question: 'Which currencies are covered?',
        answer: 'Indian rupee, US dollar, euro, pound, Japanese yen and UAE dirham. These are the currencies the Reserve Bank of India shows reference rates for.',
      },
    ],
    related: ['gst-calculator', 'discount-calculator', 'invoice-maker'],
    showsStatutoryRates: false,
    notes: `Reference rates as of ${CURRENCY_RATES_DATE_TEXT}. Banks and money changers charge a different rate. Source: Reserve Bank of India reference rates (FBIL), ${CURRENCY_RATES_SOURCE}.`,
  },
  {
    slug: 'invoice-number-generator',
    title: 'Invoice number generator',
    shortDescription: 'Make a run of invoice numbers with your own prefix, year and counter.',
    icon: 'Hash',
    category: 'Business',
    metaTitle: 'Free Invoice Number Generator | Khatario',
    metaDescription: 'Make a list of invoice numbers with your own prefix, year, month and counter, and copy them. Free, no sign-up.',
    howItWorks: [
      'Set a prefix, a starting number and how many digits the counter should have.',
      'Choose whether to include the year and the month, and add a suffix if you want one.',
      'Make up to 100 numbers at a time and copy the ones you need.',
    ],
    faqs: [
      {
        question: 'Does it remember the last number I used?',
        answer: 'No. It does not save anything. Note down your last number and enter the next one as the starting number.',
      },
      {
        question: 'Does it check my numbers against GST rules?',
        answer: 'No. It only joins the parts you choose. Keep each invoice number unique, and check the format your accountant expects.',
      },
    ],
    related: ['invoice-maker', 'gst-calculator', 'gstin-validator'],
    showsStatutoryRates: false,
  },
  {
    slug: 'image-size-reducer',
    title: 'Image size reducer',
    shortDescription: 'Resize and recompress photos on your own device, one or many at a time.',
    icon: 'FileImage',
    category: 'Images',
    metaTitle: 'Free Image Size Reducer | Khatario',
    metaDescription: 'Resize and recompress photos in your browser. Pick the size, format and quality, then download. Free, no sign-up.',
    howItWorks: [
      'Add one or more photos. Most photo formats work.',
      'Pick an output format (JPG, WebP or PNG), a largest width and a largest height. Quality applies to JPG and WebP only.',
      'The photos are resized in your browser. Download each one, or use Download all, which saves each file separately.',
    ],
    faqs: [
      {
        question: 'Do my photos get uploaded?',
        answer: 'No. The photos are changed in your browser and are not sent to Khatario.',
      },
      {
        question: 'Will the photo look the same?',
        answer: 'Not exactly. For JPG and WebP, lower quality usually gives a smaller file but the photo can look softer. Resizing to a smaller width and height also saves space. The new file can sometimes be larger than the original, especially as PNG, so compare the sizes shown before you download.',
      },
    ],
    related: ['image-background-remover', 'invoice-maker', 'discount-calculator'],
    showsStatutoryRates: false,
  },
  {
    slug: 'image-background-remover',
    title: 'Image background remover',
    shortDescription: 'Click the product or person you want to keep and remove the rest of the background.',
    icon: 'Wand2',
    category: 'Images',
    metaTitle: 'Free Image Background Remover | Khatario',
    metaDescription: 'Click your product or person and cut out the background in your browser. Download a PNG. Free, no sign-up.',
    howItWorks: [
      'Add a JPG, PNG or WebP photo under 20 MB.',
      'Click the product, person or logo you want to keep.',
      'Use Erase to clear leftover background and Restore to bring back parts you lost, then download the PNG.',
    ],
    faqs: [
      {
        question: 'Is my photo uploaded?',
        answer: 'The photo stays in this browser. The tool does download its model and some engine files from outside sites, as the note on this page explains.',
      },
      {
        question: 'Why is the first cutout slow?',
        answer: 'The first time, your browser downloads the selection model and the tool files. Later photos reuse them.',
      },
    ],
    related: ['image-size-reducer', 'invoice-maker', 'discount-calculator'],
    showsStatutoryRates: false,
    notes:
      'The photo stays in this browser. The first cutout downloads the tool files: the MediaPipe library and its WebAssembly files come from cdn.jsdelivr.net, and the model from Google (storage.googleapis.com). Those downloads are for the tool files, not your photo.',
  },
];

const LISTED = ALL_TOOLS.filter((t) => t.slug !== 'tds-calculator' || TDS_PUBLIC);
const LISTED_SLUGS = new Set(LISTED.map((t) => t.slug));

/** Related links only point at tools that are listed (a withdrawn tool leaves no dead link). */
export const FREE_TOOLS: FreeTool[] = LISTED.map((t) => ({ ...t, related: t.related.filter((r) => LISTED_SLUGS.has(r)) }));

export function getFreeTool(slug: string): FreeTool | undefined {
  return FREE_TOOLS.find((t) => t.slug === slug);
}

export const FREE_TOOL_PATHS: string[] = ['/free-tools', ...FREE_TOOLS.map((t) => `/free-tools/${t.slug}`)];

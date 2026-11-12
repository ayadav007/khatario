/**
 * TDS rates for payments to residents, tax year 2026-27 (Income-tax Act, 2025, in force from 1 April 2026).
 *
 * Sources, read on 2026-11-12:
 * - Income Tax Department TDS rate chart "For tax year 2026-27" (Income-tax Act, 2025 as amended by
 *   Finance Act, 2026): https://wm.incometaxindia.gov.in/web/guest/w/tds-rates
 * - Section 393 of the Income-tax Act, 2025 (rates in column D of the Table for payments to residents):
 *   https://wm.incometaxindia.gov.in/web/guest/w/section-393-6
 * - First Schedule, Part II, Finance Act, 2026 ("rates in force" for insurance commission and interest):
 *   https://wm.incometaxindia.gov.in/web/guest/w/first-schedule-104
 *
 * Insurance commission: the rate chart shows 5% for a payee other than a company, but section 393(1)
 * [Table S. No. 1(i)] says "rates in force", and Part II of the First Schedule to the Finance Act, 2026
 * sets 2% for a resident person other than a company. The Act is used here.
 *
 * `oldSection` is the matching Income-tax Act, 1961 section from the department's 1961 chart
 * (https://wm.incometaxindia.gov.in/web/guest/w/tds-rates-1), for payments up to 31 March 2026.
 */
export type TdsRate = { section: string; oldSection?: string; label: string; rate: number; category: string };

export const TDS_RATES: TdsRate[] = [
  { section: '393(1) Table S. No. 5(ii)', oldSection: '194A', label: 'Interest other than on securities (bank FD)', rate: 10, category: 'Interest' },
  { section: '393(1) Table S. No. 6(i)', oldSection: '194C', label: 'Contractor: individual or HUF', rate: 1, category: 'Contract' },
  { section: '393(1) Table S. No. 6(i)', oldSection: '194C', label: 'Contractor: others', rate: 2, category: 'Contract' },
  { section: '393(1) Table S. No. 1(i)', oldSection: '194D', label: 'Insurance commission (payee not a company)', rate: 2, category: 'Commission' },
  { section: '393(1) Table S. No. 1(ii)', oldSection: '194H', label: 'Commission or brokerage', rate: 2, category: 'Commission' },
  { section: '393(1) Table S. No. 2(ii)', oldSection: '194-I', label: 'Rent: plant, machinery or equipment', rate: 2, category: 'Rent' },
  { section: '393(1) Table S. No. 2(ii)', oldSection: '194-I', label: 'Rent: land, building, furniture or fittings', rate: 10, category: 'Rent' },
  { section: '393(1) Table S. No. 2(i)', oldSection: '194-IB', label: 'Rent paid by an individual or HUF not under tax audit', rate: 2, category: 'Rent' },
  { section: '393(1) Table S. No. 6(iii)', oldSection: '194J', label: 'Fees for technical services', rate: 2, category: 'Professional' },
  { section: '393(1) Table S. No. 6(iii)', oldSection: '194J', label: 'Fees for professional services', rate: 10, category: 'Professional' },
  { section: '393(1) Table S. No. 8(ii)', oldSection: '194Q', label: 'Purchase of goods (on the amount above Rs 50 lakh)', rate: 0.1, category: 'Purchase' },
  { section: '393(1) Table S. No. 8(v)', oldSection: '194-O', label: 'E-commerce operator paying a seller', rate: 0.1, category: 'E-commerce' },
  { section: '393(1) Table S. No. 8(vi)', oldSection: '194S', label: 'Transfer of a virtual digital asset (crypto)', rate: 1, category: 'Other' },
];

export const TDS_RATES_SOURCE: { url: string; checkedOn: string } = {
  url: 'https://wm.incometaxindia.gov.in/web/guest/w/tds-rates',
  checkedOn: '2026-11-12',
};

/** Every row above is confirmed against section 393 of the Income-tax Act, 2025 and the Finance Act, 2026. */
export const TDS_PUBLIC = true;

/** Month the GST and TDS rates in the tools were last checked, for the "Rates as of" line. */
export const RATES_CHECKED_ON = '2026-11';

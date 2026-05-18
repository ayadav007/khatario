import { calculateRow, type InvoiceItemRow, type CalculateRowContext } from './calculateRow';
import { determineTaxType, type TaxTypeContext } from './determineTaxType';

export interface ExtraCharge {
  id: string;
  purpose: string;
  amount: number;
}

export interface CalculateTotalsInput {
  rows: InvoiceItemRow[];
  extraCharges: ExtraCharge[];
  context: CalculateRowContext;
}

export interface CalculateTotalsResult {
  itemSubtotal: number;
  totalDiscount: number;
  subtotal: number;
  itemTax: number;
  itemCGST: number;
  itemSGST: number;
  itemIGST: number;
  effectiveTaxRate: number;
  totalExtraCharges: number;
  extraChargesCGST: number;
  extraChargesSGST: number;
  extraChargesIGST: number;
  extraChargesTax: number;
  totalTax: number;
  totalCGST: number;
  totalSGST: number;
  totalIGST: number;
  taxableAmount: number;
  grandTotal: number;
}

/**
 * Calculates all totals for an invoice
 * Pure function - no side effects
 * 
 * This function recalculates all rows first to ensure they're up-to-date,
 * then calculates totals from the recalculated rows.
 */
export function calculateTotals(input: CalculateTotalsInput): CalculateTotalsResult {
  // First, ensure all rows are calculated with current context
  const calculatedRows = input.rows.map(row => calculateRow(row, input.context, true));
  
  // Calculate item-level totals
  const itemSubtotal = calculatedRows.reduce((acc, row) => acc + (row.quantity * row.price), 0);
  const totalDiscount = calculatedRows.reduce((acc, row) => acc + row.discountAmount, 0);
  const subtotal = calculatedRows.reduce((acc, row) => acc + row.taxableValue, 0);
  
  // Calculate tax on items
  const itemTax = calculatedRows.reduce((acc, row) => acc + row.taxAmount, 0);
  const itemCGST = calculatedRows.reduce((acc, row) => acc + row.cgstAmount, 0);
  const itemSGST = calculatedRows.reduce((acc, row) => acc + row.sgstAmount, 0);
  const itemIGST = calculatedRows.reduce((acc, row) => acc + row.igstAmount, 0);
  
  // Calculate effective tax rate from items (weighted average)
  const taxableAmountForRate = subtotal > 0 ? subtotal : 1; // Avoid division by zero
  const effectiveTaxRate = itemTax / taxableAmountForRate * 100;
  
  // Calculate total extra charges
  const totalExtraCharges = input.extraCharges.reduce((acc, charge) => acc + (charge.amount || 0), 0);
  
  // Calculate tax on extra charges using effective rate
  const taxType = determineTaxType({
    businessStateCode: input.context.businessStateCode,
    businessState: input.context.businessState,
    placeOfSupply: input.context.placeOfSupply,
    isExport: input.context.isExport,
    exportType: input.context.exportType,
    documentType: input.context.documentType
  });
  
  let extraChargesCGST = 0;
  let extraChargesSGST = 0;
  let extraChargesIGST = 0;
  let extraChargesTax = 0;
  
  if (totalExtraCharges > 0 && effectiveTaxRate > 0) {
    if (input.context.isExport) {
      // For export invoices, always use IGST
      extraChargesIGST = totalExtraCharges * effectiveTaxRate / 100;
      extraChargesTax = extraChargesIGST;
    } else if (taxType.useCGSTSGST) {
      // Intra-state: CGST + SGST
      extraChargesCGST = totalExtraCharges * (effectiveTaxRate / 2) / 100;
      extraChargesSGST = totalExtraCharges * (effectiveTaxRate / 2) / 100;
      extraChargesTax = extraChargesCGST + extraChargesSGST;
    } else {
      // Inter-state: IGST
      extraChargesIGST = totalExtraCharges * effectiveTaxRate / 100;
      extraChargesTax = extraChargesIGST;
    }
  }
  
  // Total tax (items + extra charges)
  const totalTax = itemTax + extraChargesTax;
  const totalCGST = itemCGST + extraChargesCGST;
  const totalSGST = itemSGST + extraChargesSGST;
  const totalIGST = itemIGST + extraChargesIGST;
  
  // Taxable amount including extra charges
  const taxableAmount = subtotal + totalExtraCharges;
  
  // Grand total
  const grandTotal = taxableAmount + totalTax;
  
  return {
    itemSubtotal,
    totalDiscount,
    subtotal,
    itemTax,
    itemCGST,
    itemSGST,
    itemIGST,
    effectiveTaxRate,
    totalExtraCharges,
    extraChargesCGST,
    extraChargesSGST,
    extraChargesIGST,
    extraChargesTax,
    totalTax,
    totalCGST,
    totalSGST,
    totalIGST,
    taxableAmount,
    grandTotal
  };
}


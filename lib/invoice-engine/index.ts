/**
 * Invoice Engine - Pure calculation functions
 * 
 * This module contains all business logic for invoice calculations.
 * All functions are pure (no side effects, same inputs = same outputs).
 * No React dependencies - can be used anywhere.
 */

export { getStateCode } from './getStateCode';
export { determineTaxType, type TaxTypeContext, type TaxTypeResult } from './determineTaxType';
export { numberToWords } from './numberToWords';
export { calculateRow, type InvoiceItemRow, type CalculateRowContext } from './calculateRow';
export { calculateTotals, type CalculateTotalsInput, type CalculateTotalsResult, type ExtraCharge } from './calculateTotals';


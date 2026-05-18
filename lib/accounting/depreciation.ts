/**
 * Depreciation Calculation Utilities
 */

export interface DepreciationCalculation {
  period_start: Date;
  period_end: Date;
  opening_book_value: number;
  depreciation_amount: number;
  closing_book_value: number;
}

/**
 * Calculate depreciation using Straight Line Method (SLM)
 */
export function calculateSLMDepreciation(
  purchaseCost: number,
  residualValue: number,
  usefulLifeYears: number,
  periodMonths: number = 12
): number {
  const annualDepreciation = (purchaseCost - residualValue) / usefulLifeYears;
  return (annualDepreciation * periodMonths) / 12;
}

/**
 * Calculate depreciation using Written Down Value (WDV) method
 */
export function calculateWDVDepreciation(
  openingBookValue: number,
  depreciationRate: number,
  periodMonths: number = 12
): number {
  const annualDepreciation = (openingBookValue * depreciationRate) / 100;
  return (annualDepreciation * periodMonths) / 12;
}

/**
 * Generate depreciation schedule for an asset
 */
export function generateDepreciationSchedule(
  purchaseDate: Date,
  purchaseCost: number,
  residualValue: number,
  usefulLifeYears: number,
  depreciationMethod: 'SLM' | 'WDV',
  depreciationRate?: number
): DepreciationCalculation[] {
  const schedule: DepreciationCalculation[] = [];
  let currentBookValue = purchaseCost;
  const endDate = new Date(purchaseDate);
  endDate.setFullYear(endDate.getFullYear() + usefulLifeYears);

  let currentDate = new Date(purchaseDate);
  let periodNumber = 1;

  while (currentDate < endDate && currentBookValue > residualValue) {
    const periodStart = new Date(currentDate);
    const periodEnd = new Date(currentDate);
    periodEnd.setMonth(periodEnd.getMonth() + 12);

    let depreciationAmount: number;

    if (depreciationMethod === 'SLM') {
      depreciationAmount = calculateSLMDepreciation(
        purchaseCost,
        residualValue,
        usefulLifeYears,
        12
      );
    } else {
      if (!depreciationRate) {
        throw new Error('Depreciation rate is required for WDV method');
      }
      depreciationAmount = calculateWDVDepreciation(
        currentBookValue,
        depreciationRate,
        12
      );
    }

    // Ensure book value doesn't go below residual value
    if (currentBookValue - depreciationAmount < residualValue) {
      depreciationAmount = currentBookValue - residualValue;
    }

    const closingBookValue = currentBookValue - depreciationAmount;

    schedule.push({
      period_start: periodStart,
      period_end: periodEnd,
      opening_book_value: currentBookValue,
      depreciation_amount: depreciationAmount,
      closing_book_value: closingBookValue,
    });

    currentBookValue = closingBookValue;
    currentDate = periodEnd;
    periodNumber++;

    // Safety check to prevent infinite loop
    if (periodNumber > usefulLifeYears + 5) {
      break;
    }
  }

  return schedule;
}


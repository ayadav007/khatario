/** Reasons a manual adjustment can post. Repack (REPACK_OUT/REPACK_IN) has its own flow. */
export const REASON_CODES = [
  'STOCK_TAKE',
  'DAMAGE',
  'THEFT',
  'EXPIRED',
  'FREE_SAMPLE',
  'COST_CORRECTION',
  'LANDED_COST',
  'REVALUATION',
  'WRITE_DOWN',
  'PROCESS_LOSS',
  'TRANSIT_LOSS',
  'OWN_CONSUMPTION',
  'CUSTODY_LOSS',
  'PRODUCTION_ISSUE',
  'PRODUCTION_RECEIPT',
  'BY_PRODUCT',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

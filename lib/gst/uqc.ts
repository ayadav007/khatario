/** GSTN Unit Quantity Codes accepted in the GSTR-1 HSN summary. */
const GST_UQC = new Set([
  'BAG', 'BAL', 'BDL', 'BKL', 'BOU', 'BOX', 'BTL', 'BUN', 'CAN', 'CBM', 'CCM', 'CMS', 'CTN',
  'DOZ', 'DRM', 'GGK', 'GMS', 'GRS', 'GYD', 'KGS', 'KLR', 'KME', 'LTR', 'MLT', 'MTR', 'MTS',
  'NOS', 'OTH', 'PAC', 'PCS', 'PRS', 'QTL', 'ROL', 'SET', 'SQF', 'SQM', 'SQY', 'TBS', 'TGM',
  'THD', 'TON', 'TUB', 'UGS', 'UNT', 'YDS', 'NA',
]);

const UQC_ALIASES: Record<string, string> = {
  KG: 'KGS', KGS: 'KGS', KILO: 'KGS', KILOGRAM: 'KGS', KILOGRAMS: 'KGS',
  G: 'GMS', GM: 'GMS', GMS: 'GMS', GRAM: 'GMS', GRAMS: 'GMS',
  L: 'LTR', LT: 'LTR', LTR: 'LTR', LITRE: 'LTR', LITER: 'LTR', LITRES: 'LTR', LITERS: 'LTR',
  ML: 'MLT', MILLILITRE: 'MLT', MILLILITER: 'MLT',
  M: 'MTR', MT: 'MTR', METER: 'MTR', METRE: 'MTR', METERS: 'MTR', METRES: 'MTR',
  CM: 'CMS', KM: 'KME',
  PC: 'PCS', PCS: 'PCS', PIECE: 'PCS', PIECES: 'PCS',
  NO: 'NOS', NOS: 'NOS', NUMBER: 'NOS', NUMBERS: 'NOS', EA: 'NOS', EACH: 'NOS',
  UNIT: 'UNT', UNITS: 'UNT',
  DOZEN: 'DOZ', PAIR: 'PRS', PAIRS: 'PRS', PKT: 'PAC', PACK: 'PAC', PACKET: 'PAC',
  BOTTLE: 'BTL', BOTTLES: 'BTL', ROLL: 'ROL', ROLLS: 'ROL', TONNE: 'TON', TONNES: 'TON',
  QUINTAL: 'QTL', SQFT: 'SQF', SQMT: 'SQM', SQM: 'SQM', CARTON: 'CTN', CARTONS: 'CTN',
  HOUR: 'NA', HOURS: 'NA', HRS: 'NA', SERVICE: 'NA',
};

/** Maps a free-text unit to a GSTN UQC; services (SAC 99xxxx) report 'NA'. */
export function toGstUqc(unit: string | null | undefined, hsnSac?: string | null): string {
  if (hsnSac && String(hsnSac).startsWith('99')) return 'NA';
  const key = String(unit || '').trim().toUpperCase().replace(/[.\s]/g, '');
  if (!key) return 'OTH';
  if (UQC_ALIASES[key]) return UQC_ALIASES[key];
  if (GST_UQC.has(key)) return key;
  return 'OTH';
}

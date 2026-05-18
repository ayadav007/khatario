import { matchSupplier } from '@/lib/matching/supplier-matcher';
import { matchItem, type ItemMatchResult } from '@/lib/matching/item-matcher';

/**
 * Mirrors ExtractionReviewModal matching: GSTIN/name exact picks supplier; parallel item fuzzy/HSN.
 */
export async function matchExtractionForPurchase(businessId: string, envelope: any): Promise<{
  selectedSupplier: string | null;
  itemMatches: Record<number, ItemMatchResult[]>;
}> {
  const itemMatches: Record<number, ItemMatchResult[]> = {};
  let selectedSupplier: string | null = null;

  const supplier = envelope?.data?.supplier;
  if (supplier && (supplier.name || supplier.gstin)) {
    try {
      const matches = await matchSupplier(businessId, {
        name: supplier.name,
        gstin: supplier.gstin,
      });
      const bestMatch = matches[0];
      if (bestMatch && (bestMatch.matchType === 'exact_gstin' || bestMatch.matchType === 'exact_name')) {
        selectedSupplier = bestMatch.supplierId;
      }
    } catch {
      /* non-fatal */
    }
  }

  const items = Array.isArray(envelope?.data?.items) ? envelope.data.items : [];
    await Promise.all(
    items.map(async (_row: unknown, idx: number) => {
      const row = envelope.data.items[idx] as Record<string, unknown>;
      const name = String(row?.item_name ?? '').trim();
      const hsn = row?.hsn_sac != null ? String(row.hsn_sac) : '';
      if (!name && !hsn) return;
      try {
        const matches = await matchItem(businessId, {
          name: name || hsn || ' ',
          hsnSac: hsn || undefined,
        });
        itemMatches[idx] = matches;
      } catch {
        itemMatches[idx] = [];
      }
    })
  );

  return { selectedSupplier, itemMatches };
}

/**
 * Extract reference tokens from bank narrative (UTR-like, cheque, long numeric IDs).
 */

export type ExtractedReferences = {
  /** 6+ digit runs (UTR / ref candidates) */
  long_numeric_refs: string[];
  /** Cheque / CHQ patterns */
  cheque_refs: string[];
};

const LONG_NUM = /\b\d{6,}\b/g;
const CHQ = /\b(?:chq|cheque|chk|ch)\s*[#:]?\s*([A-Za-z0-9/-]+)/gi;

export function extractReferencesFromDescription(description: string): ExtractedReferences {
  const long_numeric_refs = [...new Set((description.match(LONG_NUM) || []).map((s) => s.trim()))];
  const cheque_refs: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(CHQ);
  while ((m = re.exec(description)) !== null) {
    if (m[1]) cheque_refs.push(m[1].trim());
  }
  return { long_numeric_refs, cheque_refs: [...new Set(cheque_refs)] };
}

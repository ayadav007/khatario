/**
 * Load promoted adaptive_config_releases and merge deterministically (older → newer overlays).
 * Only patches matching supplier/layout allowlists contribute to the merged runtime fragment.
 */

import { queryRows } from '@/lib/db';
import type { AdaptiveConfigPatch } from './adaptiveConfigEngine';

export interface IgnoredAdaptiveRelease {
  release_version: string;
  reason: string;
}

function extractPatch(snapshot: unknown): AdaptiveConfigPatch | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const p = (snapshot as Record<string, unknown>).patch;
  return p && typeof p === 'object' ? (p as AdaptiveConfigPatch) : null;
}

function stripTargeting(patch: AdaptiveConfigPatch): AdaptiveConfigPatch {
  const {
    supplier_hash_allowlist: _s,
    layout_fingerprint_allowlist: _l,
    ...rest
  } = patch;
  return rest;
}

export function patchMatchesSupplierLayout(
  patch: AdaptiveConfigPatch,
  supplierHash: string | null,
  layoutFingerprint: string | null,
): { ok: boolean; reason?: string } {
  const sh = patch.supplier_hash_allowlist;
  if (Array.isArray(sh) && sh.length > 0) {
    if (!supplierHash || !sh.includes(supplierHash)) {
      return { ok: false, reason: 'supplier_hash_allowlist_mismatch' };
    }
  }
  const lf = patch.layout_fingerprint_allowlist;
  if (Array.isArray(lf) && lf.length > 0) {
    if (!layoutFingerprint || !lf.includes(layoutFingerprint)) {
      return { ok: false, reason: 'layout_fingerprint_allowlist_mismatch' };
    }
  }
  return { ok: true };
}

function mergeHeaderSynonyms(
  a: Record<string, string[]> | undefined,
  b: Record<string, string[]> | undefined,
): Record<string, string[]> | undefined {
  if (!a && !b) return undefined;
  const out: Record<string, string[]> = {};
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const k of [...keys].sort()) {
    const av = a?.[k] ?? [];
    const bv = b?.[k] ?? [];
    const set = new Set<string>();
    for (const x of [...av, ...bv]) {
      const t = String(x).trim();
      if (t) set.add(t);
    }
    out[k] = [...set].sort((x, y) => x.localeCompare(y));
  }
  return Object.keys(out).length ? out : undefined;
}

export function mergeAdaptiveConfigPatches(base: AdaptiveConfigPatch, next: AdaptiveConfigPatch): AdaptiveConfigPatch {
  const {
    header_synonyms: hn,
    supplier_aliases: na,
    thresholds: nt,
    gst_heuristics: ng,
    layout_preferences: nl,
    optimization_weights: ow,
    semantic_validation: sv,
    numeric_repair_search: nrs,
    preferred_price_mode: npm,
    supplier_hash_allowlist: sh,
    layout_fingerprint_allowlist: lf,
    ...restNext
  } = next;

  return {
    ...base,
    ...restNext,
    header_synonyms: mergeHeaderSynonyms(base.header_synonyms, hn),
    supplier_aliases: { ...base.supplier_aliases, ...na },
    thresholds: { ...base.thresholds, ...nt },
    gst_heuristics: { ...base.gst_heuristics, ...ng },
    layout_preferences: { ...base.layout_preferences, ...nl },
    optimization_weights: { ...base.optimization_weights, ...ow },
    semantic_validation: { ...base.semantic_validation, ...sv },
    numeric_repair_search: { ...base.numeric_repair_search, ...nrs },
    preferred_price_mode: npm ?? base.preferred_price_mode,
    supplier_hash_allowlist: sh ?? base.supplier_hash_allowlist,
    layout_fingerprint_allowlist: lf ?? base.layout_fingerprint_allowlist,
  };
}

export async function loadMergedApprovedAdaptivePatch(params: {
  businessId: string | null | undefined;
  supplierHash: string | null;
  layoutFingerprint: string | null;
}): Promise<{
  mergedPatch: AdaptiveConfigPatch;
  appliedReleaseVersions: string[];
  ignored: IgnoredAdaptiveRelease[];
}> {
  const ignored: IgnoredAdaptiveRelease[] = [];
  const appliedReleaseVersions: string[] = [];
  let merged: AdaptiveConfigPatch = {};

  if (!params.businessId?.trim()) {
    return { mergedPatch: {}, appliedReleaseVersions: [], ignored: [] };
  }

  try {
    const rows = await queryRows<{
      release_version: string;
      promoted_at: string;
      config_snapshot: unknown;
    }>(
      `SELECT release_version, promoted_at, config_snapshot
       FROM adaptive_config_releases
       WHERE business_id IS NOT DISTINCT FROM $1::uuid
          OR business_id IS NULL
       ORDER BY promoted_at ASC`,
      [params.businessId],
    );

    for (const row of rows) {
      const rawPatch = extractPatch(row.config_snapshot);
      if (!rawPatch || Object.keys(rawPatch).length === 0) {
        ignored.push({ release_version: row.release_version, reason: 'empty_patch' });
        continue;
      }
      const match = patchMatchesSupplierLayout(rawPatch, params.supplierHash, params.layoutFingerprint);
      if (!match.ok) {
        ignored.push({
          release_version: row.release_version,
          reason: match.reason ?? 'filtered',
        });
        continue;
      }
      merged = mergeAdaptiveConfigPatches(merged, stripTargeting(rawPatch));
      appliedReleaseVersions.push(row.release_version);
    }
  } catch (e) {
    console.warn('[supplier-adaptive-config] load releases failed:', e);
  }

  return { mergedPatch: merged, appliedReleaseVersions, ignored };
}

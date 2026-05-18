/**
 * Deterministic benchmark runner: canonical JSON input → normalized extract vs ground-truth.
 * Supports thermal / GST / ecommerce / wholesale folders via scenario `category`.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  coerceRawInvoiceJson,
  normalizeIndianGstInvoiceExtract,
} from '@/lib/indian-gst-invoice-extract';

export type GoldenInvoiceCategory = 'thermal' | 'gst' | 'ecommerce' | 'wholesale';

export interface InvoiceGoldenScenarioFile {
  id: string;
  category: GoldenInvoiceCategory;
  /** Shape similar to LLM output — fed through coerce + normalize */
  canonical_input: unknown;
  ground_truth: {
    grand_total?: number;
    subtotal?: number;
    supplier_gstin?: string | null;
    tax_type?: string | null;
    items?: Array<
      Partial<{ qty: number; rate: number; line_total: number; gst_rate: number; description: string }>
    >;
    gst_summary_row_count?: number;
  };
}

export interface InvoiceBenchmarkMetrics {
  scenario_id: string;
  category: GoldenInvoiceCategory;
  line_accuracy: number;
  quantity_accuracy: number;
  amount_accuracy: number;
  gst_accuracy: number;
  subtotal_accuracy: number;
  grand_total_accuracy: number;
  /** Null when semantic optimization deltas are not present in benchmark fixtures */
  optimization_improvement: number | null;
  /** Null when repair outcomes are not modeled in fixtures */
  repair_success_rate: number | null;
}

function approxEq(a: number | undefined | null, b: number | undefined | null, tol: number): boolean {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= tol;
}

function evalScenario(scenario: InvoiceGoldenScenarioFile): InvoiceBenchmarkMetrics {
  const normalized = normalizeIndianGstInvoiceExtract(coerceRawInvoiceJson(scenario.canonical_input));
  const gt = scenario.ground_truth;

  let qtyHits = 0;
  let qtyTotal = 0;
  let amtHits = 0;
  let amtTotal = 0;
  let gstLineHits = 0;
  let gstLineTotal = 0;

  const gtItems = gt.items ?? [];
  const lines = normalized.items ?? [];
  const pairCount = Math.max(gtItems.length, lines.length);

  for (let i = 0; i < pairCount; i++) {
    qtyTotal++;
    amtTotal++;
    gstLineTotal++;
    const ex = lines[i];
    const exp = gtItems[i];
    if (!exp || !ex) continue;

    const eqQty =
      exp.qty == null || ex.qty == null ? exp.qty == null && ex.qty == null : approxEq(exp.qty, ex.qty, 0.001);
    if (eqQty) qtyHits++;

    const eqAmt =
      exp.line_total == null || ex.line_total == null
        ? exp.line_total == null && ex.line_total == null
        : approxEq(exp.line_total, ex.line_total, Math.max(0.05, Math.abs(exp.line_total) * 0.02));
    if (eqAmt) amtHits++;

    const eqGst =
      exp.gst_rate == null || ex.gst_rate == null
        ? exp.gst_rate == null && ex.gst_rate == null
        : approxEq(exp.gst_rate, ex.gst_rate ?? 0, 0.25);
    if (eqGst) gstLineHits++;
  }

  if (qtyTotal === 0) qtyTotal = 1;
  if (amtTotal === 0) amtTotal = 1;
  if (gstLineTotal === 0) gstLineTotal = 1;

  let gstAggHits = 0;
  let gstAggTotal = 0;
  if (gt.supplier_gstin !== undefined) {
    gstAggTotal++;
    if ((normalized.supplier_gstin ?? null) === (gt.supplier_gstin ?? null)) gstAggHits++;
  }
  if (gt.tax_type !== undefined) {
    gstAggTotal++;
    if ((normalized.tax_type ?? null) === (gt.tax_type ?? null)) gstAggHits++;
  }
  if (gt.gst_summary_row_count != null) {
    gstAggTotal++;
    if ((normalized.gst_summary?.length ?? 0) === gt.gst_summary_row_count) gstAggHits++;
  }

  let subHits = 0;
  let subTotal = 0;
  if (gt.subtotal != null) {
    subTotal++;
    if (approxEq(normalized.subtotal, gt.subtotal, Math.max(0.05, gt.subtotal * 0.02))) subHits++;
  }

  let grandHits = 0;
  let grandTotalCount = 0;
  if (gt.grand_total != null) {
    grandTotalCount++;
    if (approxEq(normalized.grand_total, gt.grand_total, Math.max(0.05, gt.grand_total * 0.02))) grandHits++;
  }

  const gst_accuracy =
    gstAggTotal > 0 ? gstAggHits / gstAggTotal : gstLineHits / Math.max(1, gstLineTotal);

  const line_accuracy =
    pairCount > 0 ? (qtyHits / qtyTotal + amtHits / amtTotal + gstLineHits / gstLineTotal) / 3 : 1;

  const subtotal_accuracy = subTotal ? subHits / subTotal : 1;
  const grand_total_accuracy = grandTotalCount ? grandHits / grandTotalCount : 1;

  return {
    scenario_id: scenario.id,
    category: scenario.category,
    line_accuracy,
    quantity_accuracy: qtyHits / qtyTotal,
    amount_accuracy: amtHits / amtTotal,
    gst_accuracy,
    subtotal_accuracy,
    grand_total_accuracy,
    optimization_improvement: null,
    repair_success_rate: null,
  };
}

/** Aggregate scalar score [0,1] across scenarios */
export type InvoiceBenchmarkAggregate = {
  scenarios: InvoiceBenchmarkMetrics[];
  mean_score: number;
  failed_scenarios: string[];
};

export function summarizeBenchmark(metrics: InvoiceBenchmarkMetrics[]): InvoiceBenchmarkAggregate {
  const weights = metrics.map((m) => {
    const parts = [
      m.line_accuracy,
      m.quantity_accuracy,
      m.amount_accuracy,
      m.gst_accuracy,
      m.subtotal_accuracy,
      m.grand_total_accuracy,
    ];
    return parts.reduce((a, b) => a + b, 0) / parts.length;
  });
  const mean_score = weights.length ? weights.reduce((a, b) => a + b, 0) / weights.length : 0;
  const failed_scenarios = metrics
    .filter((_, i) => weights[i]! < 1 - 1e-6)
    .map((m) => m.scenario_id);
  return { scenarios: metrics, mean_score, failed_scenarios };
}

export function loadGoldenScenariosUnder(rootDir: string): InvoiceGoldenScenarioFile[] {
  if (!fs.existsSync(rootDir)) return [];
  const out: InvoiceGoldenScenarioFile[] = [];

  function walk(dir: string) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile() && ent.name.endsWith('.json')) {
        try {
          const raw = fs.readFileSync(p, 'utf8');
          const j = JSON.parse(raw) as InvoiceGoldenScenarioFile;
          if (j && typeof j.id === 'string' && j.canonical_input != null && j.ground_truth != null) {
            out.push(j);
          }
        } catch {
          /* skip malformed */
        }
      }
    }
  }

  walk(rootDir);
  return out;
}

export function runGoldenBenchmarkSuite(scenarios: InvoiceGoldenScenarioFile[]): InvoiceBenchmarkAggregate {
  const scenariosMetrics = scenarios.map(evalScenario);
  return summarizeBenchmark(scenariosMetrics);
}

export function runGoldenBenchmarkSuiteFromDisk(rootDir: string): InvoiceBenchmarkAggregate {
  return runGoldenBenchmarkSuite(loadGoldenScenariosUnder(rootDir));
}

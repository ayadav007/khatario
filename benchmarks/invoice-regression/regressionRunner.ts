import * as fs from 'fs';
import * as path from 'path';
import {
  coerceRawInvoiceJson,
  normalizeIndianGstInvoiceExtract,
  type IndianGstInvoiceExtract,
} from '@/lib/indian-gst-invoice-extract';

export interface InvoiceRegressionScenario {
  id: string;
  input: unknown;
  /** Field-level expectations after normalize (subset of keys). */
  expected: Record<string, unknown>;
}

export interface ScenarioScore {
  id: string;
  precision: number;
  ok: number;
  total: number;
  issues: string[];
}

function approximatelyEqual(a: number, b: number, tol = 0.05): boolean {
  return Math.abs(a - b) <= tol;
}

function scoreScenario(
  scenario: InvoiceRegressionScenario,
  normalized: IndianGstInvoiceExtract,
): ScenarioScore {
  const exp = scenario.expected;
  const issues: string[] = [];
  let ok = 0;
  let total = 0;

  for (const key of Object.keys(exp)) {
    total++;
    const ev = exp[key];

    if (key === 'item_count') {
      const n = (normalized.items ?? []).length;
      if (n === ev) ok++;
      else issues.push(`item_count: got ${n}, expected ${ev}`);
      continue;
    }

    const gv = (normalized as unknown as Record<string, unknown>)[key];

    if (key === 'grand_total' || key === 'subtotal') {
      if (typeof ev === 'number' && typeof gv === 'number' && approximatelyEqual(gv, ev)) ok++;
      else issues.push(`${key}: got ${String(gv)}, expected ${String(ev)}`);
      continue;
    }

    if (gv === ev) ok++;
    else issues.push(`${key}: got ${String(gv)}, expected ${String(ev)}`);
  }

  return {
    id: scenario.id,
    precision: total ? ok / total : 1,
    ok,
    total,
    issues,
  };
}

export function loadScenariosFromDir(dir: string): InvoiceRegressionScenario[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      return JSON.parse(raw) as InvoiceRegressionScenario;
    });
}

export function runRegressionOnScenario(s: InvoiceRegressionScenario): ScenarioScore {
  const normalized = normalizeIndianGstInvoiceExtract(coerceRawInvoiceJson(s.input));
  return scoreScenario(s, normalized);
}

export function runRegressionSuite(scenarios: InvoiceRegressionScenario[]): {
  scenarios: ScenarioScore[];
  meanFieldPrecision: number;
} {
  const scenariosOut = scenarios.map(runRegressionOnScenario);
  const meanFieldPrecision = scenariosOut.length
    ? scenariosOut.reduce((a, x) => a + x.precision, 0) / scenariosOut.length
    : 0;
  return { scenarios: scenariosOut, meanFieldPrecision };
}

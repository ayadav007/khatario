/**
 * Loads JSON scenarios from benchmarks/invoice-regression/scenarios and checks
 * normalized extract field accuracy (deterministic, no LLM).
 */
import * as path from 'path';
import {
  loadScenariosFromDir,
  runRegressionSuite,
  type ScenarioScore,
} from '../benchmarks/invoice-regression/regressionRunner';

const scenariosDir = path.join(__dirname, '../benchmarks/invoice-regression/scenarios');

describe('invoice extract regression (golden JSON)', () => {
  const scenarios = loadScenariosFromDir(scenariosDir);
  expect(scenarios.length).toBeGreaterThan(0);

  it('meets aggregate field precision', () => {
    const { scenarios: scores, meanFieldPrecision } = runRegressionSuite(scenarios);
    const failed = scores.filter((s) => s.issues.length);
    expect({
      meanFieldPrecision,
      failures: failed.map((s) => ({ id: s.id, issues: s.issues })),
    }).toEqual({ meanFieldPrecision: 1, failures: [] });
  });

  it.each(scenarios.map((s) => [s.id, s] as const))('%s snapshot', (_id, scenario) => {
    const { scenarios: out } = runRegressionSuite([scenario]);
    const row = out[0] as ScenarioScore;
    expect(row.precision).toBe(1);
  });
});

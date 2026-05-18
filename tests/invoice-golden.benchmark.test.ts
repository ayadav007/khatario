/**
 * Golden benchmarks under benchmarks/invoices-golden/{thermal,gst,ecommerce,wholesale}
 */
import * as path from 'path';
import { runGoldenBenchmarkSuiteFromDisk } from '@/lib/services/invoice-extract/invoiceBenchmarkRunner';

const goldenRoot = path.join(__dirname, '../benchmarks/invoices-golden');

describe('invoice golden benchmarks', () => {
  it('passes deterministic suite at threshold', () => {
    const agg = runGoldenBenchmarkSuiteFromDisk(goldenRoot);
    expect(agg.scenarios.length).toBeGreaterThan(0);
    expect(agg.failed_scenarios).toEqual([]);
    expect(agg.mean_score).toBeGreaterThanOrEqual(0.99);
  });
});

import fs from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';

export type ScenarioResult = {
  id: string;
  title: string;
  persona: string;
  passed: boolean;
  urlVisited: string;
  finalUrl: string;
  modalOrBannerText: string;
  userAction: string;
  result: string;
  pricingVisible: boolean;
  ctaText: string;
  checkoutReached: boolean;
  screenshots: string[];
  apiFindings: Array<{ label: string; status: number; bodySnippet: string }>;
  notes: string[];
};

const EVIDENCE_DIR = path.join(process.cwd(), 'e2e', 'evidence');

export function ensureEvidenceDir(): string {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  return EVIDENCE_DIR;
}

export function createEvidenceCollector() {
  const results: ScenarioResult[] = [];

  return {
    results,
    async capture(
      page: Page,
      partial: Omit<
        ScenarioResult,
        'screenshots' | 'passed' | 'urlVisited' | 'finalUrl' | 'modalOrBannerText'
      > & {
        screenshotLabel: string;
        passed?: boolean;
        urlVisited?: string;
        finalUrl?: string;
        modalOrBannerText?: string;
      },
    ) {
      ensureEvidenceDir();
      const safeName = partial.screenshotLabel.replace(/[^a-z0-9_-]+/gi, '-');
      const file = path.join(EVIDENCE_DIR, `${partial.id}-${safeName}.png`);
      await page.screenshot({ path: file, fullPage: true });

      results.push({
        ...partial,
        passed: partial.passed ?? true,
        urlVisited: partial.urlVisited ?? page.url(),
        finalUrl: partial.finalUrl ?? page.url(),
        modalOrBannerText: partial.modalOrBannerText ?? '',
        screenshots: [path.relative(process.cwd(), file)],
      });
    },
    writeReports(baseUrl: string) {
      ensureEvidenceDir();
      const jsonPath = path.join(EVIDENCE_DIR, 'subscription-audit-report.json');
      const mdPath = path.join(EVIDENCE_DIR, 'subscription-audit-report.md');

      const payload = {
        generatedAt: new Date().toISOString(),
        baseUrl,
        scenarios: results,
        summary: {
          total: results.length,
          passed: results.filter((r) => r.passed).length,
          failed: results.filter((r) => !r.passed).length,
        },
      };

      fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));

      const lines = [
        '# Subscription Browser Audit Evidence',
        '',
        `**Generated:** ${payload.generatedAt}`,
        `**Base URL:** ${baseUrl}`,
        `**Scenarios:** ${payload.summary.passed}/${payload.summary.total} passed`,
        '',
      ];

      for (const r of results) {
        lines.push(`## ${r.id}: ${r.title}`);
        lines.push('');
        lines.push(`- **Persona:** ${r.persona}`);
        lines.push(`- **Passed:** ${r.passed ? 'YES' : 'NO'}`);
        lines.push(`- **URL visited:** ${r.urlVisited}`);
        lines.push(`- **Final URL:** ${r.finalUrl}`);
        lines.push(`- **User action:** ${r.userAction}`);
        lines.push(`- **Result:** ${r.result}`);
        lines.push(`- **Pricing visible:** ${r.pricingVisible}`);
        lines.push(`- **CTA:** ${r.ctaText || '—'}`);
        lines.push(`- **Checkout reached:** ${r.checkoutReached}`);
        if (r.modalOrBannerText) {
          lines.push('');
          lines.push('**Visible copy:**');
          lines.push('```');
          lines.push(r.modalOrBannerText.slice(0, 2000));
          lines.push('```');
        }
        if (r.screenshots.length) {
          lines.push('');
          lines.push('**Screenshots:**');
          for (const s of r.screenshots) {
            lines.push(`- \`${s}\``);
          }
        }
        if (r.apiFindings.length) {
          lines.push('');
          lines.push('**API checks:**');
          for (const a of r.apiFindings) {
            lines.push(`- ${a.label}: HTTP ${a.status} — ${a.bodySnippet.slice(0, 200)}`);
          }
        }
        if (r.notes.length) {
          lines.push('');
          lines.push('**Notes:**');
          for (const n of r.notes) {
            lines.push(`- ${n}`);
          }
        }
        lines.push('');
      }

      fs.writeFileSync(mdPath, lines.join('\n'));
      return { jsonPath, mdPath };
    },
  };
}

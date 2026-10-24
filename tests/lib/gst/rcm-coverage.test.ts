import fs from 'fs';
import path from 'path';
import { countApprovedRcmRules } from '@/lib/gst/rcm-catalogue';
import {
  classifyRcmApplicability,
  formRcmNotice,
  matchRcmRules,
  rcmCatalogueIsComplete,
  rcmDashboardStatus,
  RCM_EXPENSE_INACTIVE_NOTICE,
  RCM_PURCHASE_INACTIVE_NOTICE,
  RCM_PURCHASE_PARTIAL_NOTICE,
  type RcmRule,
} from '@/lib/gst/rcm-rules';
import { gstr1BlockingIssues } from '@/lib/gst/return-readiness';

const root = path.join(__dirname, '../../..');

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const rule: RcmRule = {
  id: 'r',
  catalogueVersion: 1,
  effectiveFrom: '2024-11-01',
  effectiveTo: null,
  supplierType: 'registered',
  sacPrefix: '9965',
  hsnPrefix: null,
  expenseCategory: null,
  sourceCitation: 'Notification example',
  reviewOnly: true,
  status: 'approved',
  exclusions: [],
};

describe('RCM coverage visibility', () => {
  it('uses the inactive notice when the approved count is zero', () => {
    expect(formRcmNotice('purchase', 0)).toBe(RCM_PURCHASE_INACTIVE_NOTICE);
    expect(formRcmNotice('expense', 0)).toBe(RCM_EXPENSE_INACTIVE_NOTICE);
    const dash = rcmDashboardStatus(0);
    expect(dash.status).toBe('Automatic RCM detection is not active.');
    expect(dash.approvedRules).toBe(0);
    expect(dash.action).toBe('Verify RCM applicability manually when recording relevant purchases and expenses.');
    expect(dash.explanation).toMatch(/cannot currently detect all notified RCM/);
    expect(dash.customerViolation).toBe(false);
    expect(dash.blocksExport).toBe(false);
  });

  it('reads the approved count from the rule query instead of a fixed zero', async () => {
    const seen: string[] = [];
    const db = {
      query: async (sql: string) => {
        seen.push(sql);
        return {
          rows: [
            {
              id: 'ok',
              catalogue_version: 1,
              effective_from: '2024-11-01',
              effective_to: null,
              supplier_type: 'registered',
              sac_prefix: '9965',
              hsn_prefix: null,
              expense_category: null,
              source_citation: 'Notification example',
              review_only: true,
              status: 'approved',
              recipient_class: null,
              turnover_min: null,
              turnover_max: null,
              exclusions: [],
            },
            {
              id: 'candidate',
              catalogue_version: 1,
              effective_from: '2024-11-01',
              effective_to: null,
              supplier_type: 'registered',
              sac_prefix: '99',
              hsn_prefix: null,
              expense_category: null,
              source_citation: 'draft',
              review_only: true,
              status: 'candidate',
              recipient_class: null,
              turnover_min: null,
              turnover_max: null,
              exclusions: [],
            },
          ],
        };
      },
    };
    await expect(countApprovedRcmRules(db as never)).resolves.toBe(1);
    expect(seen[0]).toMatch(/status = 'approved'/);
    expect(rcmDashboardStatus(1).approvedRules).toBe(1);
    expect(rcmDashboardStatus(1).approvedRules).not.toBe(0);
  });

  it('does not treat a positive approved count as full coverage', () => {
    expect(rcmCatalogueIsComplete(4)).toBe(false);
    expect(formRcmNotice('purchase', 4)).toBe(RCM_PURCHASE_PARTIAL_NOTICE);
    expect(formRcmNotice('expense', 4)).toMatch(/not complete/);
    expect(rcmDashboardStatus(4).explanation).toMatch(/does not mean every notified RCM category/);
    expect(rcmDashboardStatus(4).blocksExport).toBe(false);
    expect(rcmDashboardStatus(4).customerViolation).toBe(false);
  });

  it('keeps a non-match and missing facts unverified', () => {
    const facts = {
      billDate: '2026-04-01',
      registrationStatus: 'registered' as const,
      reverseCharge: false,
      sac: '1111',
      hsn: null,
      expenseCategory: null,
    };
    const noRules = classifyRcmApplicability(0, matchRcmRules(facts, []));
    expect(noRules.outcome).toBe('inactive');

    const noMatch = classifyRcmApplicability(2, matchRcmRules(facts, [rule]));
    expect(noMatch.outcome).toBe('unverified');
    if (noMatch.outcome === 'unverified') expect(noMatch.reason).toBe('no_match');

    const missing = classifyRcmApplicability(2, matchRcmRules({ ...facts, sac: null }, [rule]));
    expect(missing.outcome).toBe('unverified');
    if (missing.outcome === 'unverified') expect(missing.reason).toBe('missing_facts');

    const matched = classifyRcmApplicability(2, matchRcmRules({ ...facts, sac: '996511' }, [rule]));
    expect(matched.outcome).toBe('matched');
    expect(formRcmNotice('purchase', 2)).not.toBeNull();
  });

  it('does not add RCM coverage to GSTR-1 export blocks', () => {
    const issues = gstr1BlockingIssues([
      {
        id: '1',
        invoiceNumber: 'INV-1',
        invoiceDate: '2026-04-01',
        placeOfSupply: '29',
        gstin: null,
        included: true,
      },
    ]);
    expect(issues.some((issue) => /rcm/i.test(issue.key))).toBe(false);
  });

  it('places one purchase notice beside reverse charge on desktop and mobile, including edit', () => {
    const desktop = read('app/(app)/purchases/new/page.tsx');
    const mobile = read('components/purchases/MobileNewPurchaseScrollForm.tsx');
    const expense = read('app/(app)/expenses/new/page.tsx');

    expect(desktop).toMatch(/is_reverse_charge: false/);
    expect(desktop.indexOf('<RcmCoverageNotice kind="purchase" />')).toBeGreaterThan(
      desktop.indexOf('Reverse charge')
    );
    expect(desktop.indexOf('<RcmCoverageNotice kind="purchase" />')).toBeLessThan(
      desktop.indexOf('More details — registration')
    );
    expect(desktop).not.toMatch(/editingPurchaseId[\s\S]{0,40}\? null : <RcmCoverageNotice/);
    expect(desktop).not.toMatch(/checks\.push\(\{[^}]*rcm/i);

    expect(mobile.match(/<RcmCoverageNotice kind="purchase" \/>/g)).toHaveLength(1);
    expect(mobile.indexOf('<RcmCoverageNotice kind="purchase" />')).toBeLessThan(mobile.indexOf('billEditOpen &&'));

    expect(expense.match(/<RcmCoverageNotice kind="expense" \/>/g)).toHaveLength(1);
    expect(expense).not.toMatch(/notified-supply rules are loaded/);
    expect(expense).toMatch(/!!expense\.is_reverse_charge/);
    expect(expense).toMatch(/blocked credit u\/s 17\(5\)/);
  });
});

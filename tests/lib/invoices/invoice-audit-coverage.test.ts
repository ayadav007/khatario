/**
 * Every code path that writes an invoice, its lines or its charges must tell the edit log who did
 * it and why (setInvoiceAuditContext / runWithInvoiceAudit), or be listed here with the reason it
 * does not need to. The database records the change either way (migration 469); this keeps
 * "System" entries rare.
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const WRITER_RE =
  /UPDATE\s+invoices\s|INSERT\s+INTO\s+invoices\s*[(]|INSERT\s+INTO\s+invoice_items|DELETE\s+FROM\s+invoice_items|UPDATE\s+invoice_items\s|INSERT\s+INTO\s+invoice_charges|DELETE\s+FROM\s+invoice_charges/;

const SETS_CONTEXT_RE = /setInvoiceAuditContext[(]|runWithInvoiceAudit[(]/;

/** path (forward slashes, from repo root) → why it does not set context itself */
const ALLOWLIST: Record<string, string> = {
  'lib/customer-surface/record-view.ts': 'only view counters, which snapshots leave out',
  'lib/customer-surface/public-token.ts': 'only the link token, which snapshots leave out',
  'lib/invoices/invoice-balance.ts': 'helper; always runs inside a caller that sets context',
  'lib/invoices/invoice-charges.ts': 'helper; always runs inside a caller that sets context',
  'lib/invoices/invoice-create-service.ts': 'helper; its callers set context',
  'lib/invoices/cancel-final-invoice.ts': 'helper; its callers set context',
  'lib/custom-fields-persist.ts': 'helper; always runs inside the invoice save that sets context',
  'lib/accounting/payment-reversal.ts': 'helper taking a client; app/api/payments/[id]/reverse sets context',
  'lib/accounting/advance-service.ts': 'helper taking a client; the advances routes set context',
  'lib/inter-branch-utils.ts': 'helper taking a client; the stock-transfer routes set context',
};

/** Helpers that write invoices on a client they are given. A file that opens a transaction and
 * calls one of them must set context (or be allowlisted). */
const HELPERS = [
  'recomputeInvoiceBalance',
  'persistInvoiceCharges',
  'createInvoiceInTransaction',
  'cancelPostedInvoiceInTransaction',
  'saveInvoiceCustomFields',
  'createCreditNoteInTransaction',
  'executePaymentReversal',
  'adjustAdvance',
  'releaseDocumentAdvances',
  'convertLinesToInvoice',
  'executeSalesFinalizeReplay',
  'createReturn',
  'receiveReturn',
  'settleReturn',
  'settleKhataPayment',
  'ensureInterBranchInvoiceForTransfer',
  // Write invoices through a dynamic table name the writer pattern cannot see.
  'createEwayBill',
  'mergeItems',
];
const HELPER_CALL_RE = new RegExp(`(^|[^A-Za-z0-9_])(${HELPERS.join('|')})[(]`);
const OPENS_TX_RE = /query[(]\s*['"]BEGIN['"]\s*[)]/;

/** Transaction owners that call a helper but never touch an invoice through it. */
const HELPER_CALLER_ALLOWLIST: Record<string, string> = {};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(full, out);
    } else if (/[.](ts|tsx)$/.test(entry.name) && !/[.]test[.]tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function rel(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

describe('invoice audit coverage', () => {
  const files = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'lib'))];
  const text = new Map(files.map((f) => [rel(f), fs.readFileSync(f, 'utf8')]));

  it('every invoice writer sets audit context or is allowlisted with a reason', () => {
    const missing = [...text.entries()]
      .filter(([p, t]) => WRITER_RE.test(t) && !ALLOWLIST[p] && !SETS_CONTEXT_RE.test(t))
      .map(([p]) => p);
    expect(missing).toEqual([]);
  });

  it('every transaction that calls an invoice-writing helper sets audit context', () => {
    const missing = [...text.entries()]
      .filter(([p, t]) => OPENS_TX_RE.test(t) && HELPER_CALL_RE.test(t) && !SETS_CONTEXT_RE.test(t))
      .filter(([p]) => !ALLOWLIST[p] && !HELPER_CALLER_ALLOWLIST[p])
      .map(([p]) => p);
    expect(missing).toEqual([]);
  });

  it('store paths that know the staff user record them instead of System', () => {
    const body = (file: string, fn: string) => {
      const t = text.get(file)!;
      const start = t.indexOf(`export async function ${fn}(`);
      const end = t.indexOf(String.fromCharCode(10) + 'export ', start + 1);
      return t.slice(start, end < 0 ? undefined : end);
    };
    expect(body('lib/store/fulfill-paid-order.ts', 'createInvoiceForStoreOrder')).toContain(
      "setInvoiceAuditContext(client, { actorUserId: actorUserId ?? null, action: 'store_order' })",
    );
    expect(body('lib/store/store-refund.ts', 'prepareStoreRefund')).toContain(
      "setInvoiceAuditContext(client, { actorUserId: input.actorUserId, action: 'payment_reversed' })",
    );
    expect(body('lib/store/order-lifecycle.ts', 'syncStoreFulfilment')).toContain(
      "setInvoiceAuditContext(client, { actorUserId: actorUserId ?? null, action: 'store_order' })",
    );
    expect(body('lib/store/order-lifecycle.ts', 'transitionStoreOrder')).toContain(
      "actorUserId: input.systemActor ? null : input.actorUserId ?? null",
    );
  });

  it('has no stale allowlist entries', () => {
    const stale = Object.keys(ALLOWLIST).filter((p) => !text.has(p) || !WRITER_RE.test(text.get(p)!));
    const staleCallers = Object.keys(HELPER_CALLER_ALLOWLIST).filter(
      (p) => !text.has(p) || !HELPER_CALL_RE.test(text.get(p)!),
    );
    expect([...stale, ...staleCallers]).toEqual([]);
  });
});

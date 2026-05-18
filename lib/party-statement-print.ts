/**
 * Print-friendly HTML for customer party statement (aligned with common "Party ledger" layouts).
 */

export function formatStatementDateInput(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return String(isoOrDate);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export function customerVoucherLabel(transactionType: string): string {
  switch (transactionType) {
    case 'opening_balance':
      return 'Opening balance';
    case 'invoice':
      return 'Sales invoice';
    case 'payment':
      return 'Payment-in';
    case 'advance':
      return 'Advance received';
    default:
      return transactionType;
  }
}

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtInr(n: number): string {
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** India FY: April 1 – March 31 (local calendar date). */
export function indianFinancialYearStartIndia(today: Date): Date {
  const y = today.getFullYear();
  const m = today.getMonth();
  if (m >= 3) return new Date(y, 3, 1);
  return new Date(y - 1, 3, 1);
}

export function formatLocalYmdIndia(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

export function getDefaultCustomerStatementPeriod(): { from_date: string; to_date: string } {
  const toD = new Date();
  const fromD = indianFinancialYearStartIndia(toD);
  return { from_date: formatLocalYmdIndia(fromD), to_date: formatLocalYmdIndia(toD) };
}

export function formatInrStatement(n: number): string {
  return fmtInr(n);
}

export function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Opens print dialog with HTML without leaving the app (clean layout vs printing whole chrome). */
export function printHtmlInIframe(html: string): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  Object.assign(iframe.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
    opacity: '0',
    pointerEvents: 'none',
  });
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();

  const cleanup = () => {
    iframe.remove();
  };

  const run = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      setTimeout(cleanup, 800);
    }
  };

  setTimeout(run, 150);
}

export interface PartyStatementPrintPayload {
  businessName: string;
  businessPhone?: string | null;
  partyName: string;
  partyPhone?: string | null;
  fromDate: string;
  toDate: string;
  openingBalance: number;
  closingBalance: number;
  transactions: Array<{
    transaction_date: string;
    transaction_type: string;
    reference_number: string;
    description: string;
    debit: number | string;
    credit: number | string;
    running_balance: number;
  }>;
}

function netSummaryCustomer(closing: number): { title: string; amount: number; subtitle: string } {
  if (closing > 0.005) {
    return { title: 'Amount due (net)', amount: closing, subtitle: 'Customer owes this amount' };
  }
  if (closing < -0.005) {
    return {
      title: 'Net credit balance',
      amount: Math.abs(closing),
      subtitle: 'Advance / overpayment with customer',
    };
  }
  return { title: 'Account balance', amount: 0, subtitle: 'No net amount due' };
}

/** For UI cards (Ledger tab) — same labels as print summary. */
export function customerStatementSummary(closing: number) {
  const r = netSummaryCustomer(closing);
  return { ...r, signedClosing: closing };
}

export function buildCustomerStatementHtml(payload: PartyStatementPrintPayload): string {
  const { title, amount: summaryAmount, subtitle } = netSummaryCustomer(payload.closingBalance);
  const period = `${formatStatementDateInput(payload.fromDate)} – ${formatStatementDateInput(payload.toDate)}`;

  const rowsHtml = payload.transactions
    .map((t) => {
      const dr = Number(t.debit || 0);
      const cr = Number(t.credit || 0);
      const voucher = customerVoucherLabel(t.transaction_type);
      return `<tr>
        <td>${escapeHtml(formatStatementDateInput(t.transaction_date))}</td>
        <td>${escapeHtml(voucher)}</td>
        <td class="mono">${escapeHtml(t.reference_number)}</td>
        <td>${escapeHtml(t.description)}</td>
        <td class="num">${dr > 0 ? fmtInr(dr) : '—'}</td>
        <td class="num cr">${cr > 0 ? fmtInr(cr) : '—'}</td>
        <td class="num bal">${fmtInr(t.running_balance)}</td>
      </tr>`;
    })
    .join('');

  const footerLabel =
    payload.closingBalance >= 0 ? 'Closing balance (amount due)' : 'Closing balance (net credit)';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(payload.partyName)} — Party ledger</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #111; margin: 0; padding: 24px; background: #f8fafc; }
    .sheet { max-width: 900px; margin: 0 auto; background: #fff; padding: 28px 32px 36px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; border-bottom: 1px solid #e5e7eb; padding-bottom: 20px; margin-bottom: 20px; }
    .top h1 { margin: 0 0 6px; font-size: 1.35rem; font-weight: 700; color: #0f172a; }
    .biz { margin: 0; font-size: 0.9rem; color: #64748b; }
    .period { font-size: 0.85rem; color: #475569; text-align: right; }
    .period strong { display: block; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: #94a3b8; margin-bottom: 4px; }
    .party-row { display: flex; justify-content: space-between; gap: 20px; flex-wrap: wrap; margin-bottom: 22px; }
    .to { font-size: 0.95rem; color: #334155; line-height: 1.5; }
    .to strong { font-size: 1.05rem; color: #0f172a; }
    .summary { border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 18px; min-width: 220px; background: #f8fafc; }
    .summary .t { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 4px; }
    .summary .a { font-size: 1.35rem; font-weight: 700; color: #0f172a; }
    .summary .s { font-size: 0.75rem; color: #94a3b8; margin-top: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
    thead th { text-align: left; background: #f1f5f9; color: #475569; font-weight: 600; padding: 10px 8px; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
    thead th.num { text-align: right; }
    tbody td { padding: 10px 8px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    tbody td.num { text-align: right; font-variant-numeric: tabular-nums; }
    tbody td.cr { color: #047857; }
    tbody td.bal { font-weight: 600; color: #0f172a; }
    .mono { font-family: ui-monospace, monospace; font-size: 0.78rem; color: #64748b; }
    .footer { margin-top: 20px; padding: 14px 16px; background: #f1f5f9; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
    .footer .big { font-size: 1.15rem; font-weight: 700; color: #0f172a; }
    .footer .lbl { font-size: 0.8rem; color: #64748b; }
    .actions { margin-top: 20px; display: flex; gap: 12px; flex-wrap: wrap; }
    .btn { appearance: none; border: none; background: #2563eb; color: #fff; padding: 10px 18px; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.9rem; }
    .btn:hover { background: #1d4ed8; }
    .btn-sec { background: #fff; color: #334155; border: 1px solid #e2e8f0; }
    .btn-sec:hover { background: #f8fafc; }
    @media print {
      body { background: #fff; padding: 0; }
      .sheet { box-shadow: none; border-radius: 0; padding: 0; }
      .actions { display: none; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="top">
      <div>
        <h1>Party ledger</h1>
        <p class="biz">${escapeHtml(payload.businessName)}${payload.businessPhone ? ` · Phone: ${escapeHtml(payload.businessPhone)}` : ''}</p>
      </div>
      <div class="period">
        <strong>Statement period</strong>
        ${escapeHtml(period)}
      </div>
    </div>
    <div class="party-row">
      <div class="to">
        To,<br />
        <strong>${escapeHtml(payload.partyName)}</strong><br />
        ${payload.partyPhone ? `Phone: ${escapeHtml(payload.partyPhone)}` : ''}
      </div>
      <div class="summary">
        <div class="t">${escapeHtml(title)}</div>
        <div class="a">₹ ${fmtInr(summaryAmount)}</div>
        <div class="s">${escapeHtml(subtitle)}</div>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Voucher</th>
          <th>Reference</th>
          <th>Particulars</th>
          <th class="num">Debit</th>
          <th class="num">Credit</th>
          <th class="num">Balance</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div class="footer">
      <div>
        <div class="lbl">${escapeHtml(footerLabel)}</div>
        <div class="big">₹ ${fmtInr(payload.closingBalance)}</div>
      </div>
    </div>
    <div class="actions no-print">
      <button class="btn" type="button" onclick="window.print()">Print / Save as PDF</button>
    </div>
  </div>
</body>
</html>`;
}

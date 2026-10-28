/**
 * Which ledger a receipt or payment may hit.
 *
 * Cash, bank and clearing accounts only. A payment never posts to an arbitrary
 * chart account. When more than one bank could apply and the caller did not
 * choose one, posting stops instead of using 1102.
 */

export class SettlementAccountError extends Error {
  constructor(
    message: string,
    public code: string,
    public status = 400,
  ) {
    super(message);
    this.name = 'SettlementAccountError';
  }
}

export type SettlementKind = 'cash' | 'bank' | 'clearing';

export type SettlementAccount = {
  id: string;
  code: string;
  name: string;
  accountType: string;
  kind: SettlementKind;
};

export type PaymentModeClass = 'cash' | 'bank' | 'clearing' | 'on_account' | 'transfer' | 'other';

export type SettlementResolution =
  | { ok: true; accountId: string | null; modeClass: PaymentModeClass }
  | { ok: false; code: string; error: string; modeClass: PaymentModeClass };

const ON_ACCOUNT = new Set(['on_account', 'pay_later', 'unpaid', 'credit']);
const CASH = new Set(['cash', 'cash_in_hand']);
const BANK = new Set([
  'bank',
  'bank_transfer',
  'upi',
  'neft',
  'rtgs',
  'imps',
  'cheque',
  'check',
  'debit_card',
  'debit',
  'card',
  'pos',
]);
const CLEARING = new Set(['credit_card', 'payment_gateway', 'gateway', 'card_clearing']);
const TRANSFER = new Set(['transfer', 'contra', 'own_transfer']);

export function normalizePaymentMode(mode: string | null | undefined): string {
  return String(mode || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function classifyPaymentMode(mode: string | null | undefined): PaymentModeClass {
  const m = normalizePaymentMode(mode) || 'cash';
  if (ON_ACCOUNT.has(m)) return 'on_account';
  if (CASH.has(m)) return 'cash';
  if (BANK.has(m)) return 'bank';
  if (CLEARING.has(m)) return 'clearing';
  if (TRANSFER.has(m)) return 'transfer';
  return 'other';
}

export function settlementKind(row: {
  account_code: string;
  account_name: string;
  account_type: string;
  group_name?: string | null;
  linked_bank?: boolean;
}): SettlementKind | null {
  const code = String(row.account_code || '').trim();
  const name = String(row.account_name || '');
  const group = String(row.group_name || '');
  const type = String(row.account_type || '');
  if (isClearingName(name)) return 'clearing';
  // GST electronic cash/credit ledgers (1130–1133) hold tax paid on the portal, not money a receipt
  // or payment can land in.
  if (/electronic\s+(cash|credit)\s+ledger/i.test(name)) return null;
  if (code === '1101' || (type === 'asset' && /\bcash\b/i.test(name) && code !== '1102' && !row.linked_bank)) {
    return 'cash';
  }
  if (row.linked_bank || code === '1102' || code === '2112') return 'bank';
  if (
    type === 'asset' &&
    code.startsWith('11') &&
    code !== '1101' &&
    (/bank/i.test(group) || /bank/i.test(name)) &&
    !/\bcash\b/i.test(name)
  ) {
    return 'bank';
  }
  return null;
}

function isClearingName(name: string): boolean {
  return /credit\s*card|payment\s*gateway|gateway\s*clearing|card\s*clearing|card\s*receivable|unsettled\s*card/i.test(
    name,
  );
}

export function accountsForMode(accounts: SettlementAccount[], modeClass: PaymentModeClass): SettlementAccount[] {
  if (modeClass === 'cash') return accounts.filter((a) => a.kind === 'cash');
  if (modeClass === 'bank') return accounts.filter((a) => a.kind === 'bank');
  if (modeClass === 'clearing') return accounts.filter((a) => a.kind === 'clearing');
  if (modeClass === 'other') return accounts.filter((a) => a.kind === 'cash' || a.kind === 'bank' || a.kind === 'clearing');
  return [];
}

/**
 * `selectedId` is the account the user chose. It is required when more than one
 * eligible account exists. On-account modes settle the party ledger and return
 * no settlement account.
 */
export function resolveSettlementAccount(input: {
  accounts: SettlementAccount[];
  mode: string | null | undefined;
  selectedId?: string | null;
}): SettlementResolution {
  const modeClass = classifyPaymentMode(input.mode);
  if (modeClass === 'on_account') {
    if (input.selectedId) {
      return {
        ok: false,
        modeClass,
        code: 'SETTLEMENT_NOT_ALLOWED',
        error: 'An on-account payment is not posted to cash or bank.',
      };
    }
    return { ok: true, accountId: null, modeClass };
  }
  if (modeClass === 'transfer') {
    return {
      ok: false,
      modeClass,
      code: 'USE_CONTRA',
      error: 'A transfer between your own cash and bank accounts is a contra voucher, not a payment.',
    };
  }

  const eligible = accountsForMode(input.accounts, modeClass);
  const selected = input.selectedId ? eligible.find((a) => a.id === input.selectedId) : undefined;
  if (input.selectedId && !selected) {
    return {
      ok: false,
      modeClass,
      code: 'SETTLEMENT_ACCOUNT_INVALID',
      error: settlementInvalidMessage(modeClass),
    };
  }
  if (selected) return { ok: true, accountId: selected.id, modeClass };

  if (modeClass === 'clearing' && eligible.length === 0) {
    return {
      ok: false,
      modeClass,
      code: 'CLEARING_ACCOUNT_REQUIRED',
      error:
        'Add a credit-card or payment-gateway clearing account in the chart before recording this payment. It is not posted to cash or bank.',
    };
  }
  if (eligible.length === 1) return { ok: true, accountId: eligible[0].id, modeClass };
  if (modeClass === 'cash') {
    const cashInHand = eligible.find((a) => a.code === '1101');
    if (cashInHand) return { ok: true, accountId: cashInHand.id, modeClass };
  }
  if (modeClass === 'bank') {
    // The seeded Bank OD / Cash Credit ledger (2112) is a loan account, not a second bank to pick
    // between: with one real bank beside it, money goes to that bank unless the user chose 2112.
    const banks = eligible.filter((a) => a.code !== '2112');
    if (banks.length === 1) return { ok: true, accountId: banks[0].id, modeClass };
  }
  if (modeClass === 'cash' && eligible.length === 0) {
    return {
      ok: false,
      modeClass,
      code: 'CASH_ACCOUNT_REQUIRED',
      error: 'Cash in hand (1101) is not set up for this business.',
    };
  }
  if (eligible.length === 0) {
    return {
      ok: false,
      modeClass,
      code: 'SETTLEMENT_ACCOUNT_REQUIRED',
      error:
        modeClass === 'bank'
          ? 'Add a bank account and link it to a bank ledger before recording this payment.'
          : 'No cash or bank ledger is available for this payment.',
    };
  }
  return {
    ok: false,
    modeClass,
    code: 'SETTLEMENT_ACCOUNT_REQUIRED',
    error: 'Choose the cash or bank account. More than one account can take this payment.',
  };
}

function settlementInvalidMessage(modeClass: PaymentModeClass): string {
  if (modeClass === 'cash') return 'Cash payments can only be posted to a cash account.';
  if (modeClass === 'bank') return 'This payment mode can only be posted to a bank account.';
  if (modeClass === 'clearing') return 'This payment mode can only be posted to a clearing account.';
  return 'Choose a cash, bank or clearing account.';
}

/** One unlinked bank register row and one unlinked bank ledger can be joined. Anything else stays for the user. */
export function shouldBackfillBankLedgerLink(unlinkedBankRows: number, unlinkedBankLedgers: number): boolean {
  return unlinkedBankRows === 1 && unlinkedBankLedgers === 1;
}

/**
 * A non-zero opening entered while linking a ledger that already has one would
 * replace or double it. Skip when the amount is zero. Reject when one exists.
 */
export function openingBalanceDecision(
  ledgerAlreadyHasOpening: boolean,
  amount: number,
): 'skip' | 'post' | 'reject' {
  if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) return 'skip';
  if (ledgerAlreadyHasOpening) return 'reject';
  return 'post';
}

export type AccountGroupPick = {
  id: string;
  group_code: string;
  group_name: string;
  group_type: string;
};

/** Bank ledgers sit in the Bank asset group, then Current Assets (1100), then Assets (1000). */
export function pickBankAssetGroup(groups: AccountGroupPick[]): string | null {
  const asset = groups.filter((g) => g.group_type === 'asset');
  const named = asset.find((g) => /bank/i.test(g.group_name));
  if (named) return named.id;
  const current = asset.find((g) => g.group_code === '1100');
  if (current) return current.id;
  const root = asset.find((g) => g.group_code === '1000');
  return root?.id ?? asset[0]?.id ?? null;
}

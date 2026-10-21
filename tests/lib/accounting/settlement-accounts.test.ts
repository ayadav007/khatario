import {
  classifyPaymentMode,
  openingBalanceDecision,
  pickBankAssetGroup,
  resolveSettlementAccount,
  settlementKind,
  shouldBackfillBankLedgerLink,
  type SettlementAccount,
} from '@/lib/accounting/settlement-accounts';

const cash: SettlementAccount = {
  id: 'cash',
  code: '1101',
  name: 'Cash',
  accountType: 'asset',
  kind: 'cash',
};
const bank: SettlementAccount = {
  id: 'bank',
  code: '1102',
  name: 'Bank Account',
  accountType: 'asset',
  kind: 'bank',
};
const hdfc: SettlementAccount = {
  id: 'hdfc',
  code: '1119',
  name: 'HDFC',
  accountType: 'asset',
  kind: 'bank',
};
const cardClearing: SettlementAccount = {
  id: 'cards',
  code: '1120',
  name: 'Credit Card Clearing',
  accountType: 'asset',
  kind: 'clearing',
};

describe('settlement kind', () => {
  it('treats HDFC under a Bank group as a bank ledger and cash as cash', () => {
    expect(
      settlementKind({
        account_code: '1119',
        account_name: 'HDFC',
        account_type: 'asset',
        group_name: 'Bank',
      }),
    ).toBe('bank');
    expect(
      settlementKind({
        account_code: '1101',
        account_name: 'Cash',
        account_type: 'asset',
        group_name: 'Current Assets',
      }),
    ).toBe('cash');
    expect(
      settlementKind({
        account_code: '1103',
        account_name: 'Accounts Receivable',
        account_type: 'asset',
        group_name: 'Current Assets',
      }),
    ).toBeNull();
  });

  it('keeps credit-card and gateway accounts out of cash and bank', () => {
    expect(
      settlementKind({
        account_code: '1120',
        account_name: 'Payment Gateway Clearing',
        account_type: 'asset',
        group_name: 'Current Assets',
      }),
    ).toBe('clearing');
  });
});

describe('resolveSettlementAccount', () => {
  const books = [cash, bank];

  it('defaults cash to cash in hand, including when another cash book exists', () => {
    const petty: SettlementAccount = {
      id: 'petty',
      code: '1108',
      name: 'Petty Cash',
      accountType: 'asset',
      kind: 'cash',
    };
    expect(resolveSettlementAccount({ accounts: [petty, cash, bank], mode: 'cash' })).toMatchObject({
      ok: true,
      accountId: 'cash',
    });
  });

  it('posts UPI, NEFT, RTGS, cheque and debit card to the only bank', () => {
    for (const mode of ['upi', 'neft', 'rtgs', 'cheque', 'debit_card', 'card', 'bank_transfer']) {
      expect(resolveSettlementAccount({ accounts: books, mode }).accountId).toBe('bank');
    }
  });

  it('requires a choice when two banks exist and does not fall back to 1102', () => {
    const resolved = resolveSettlementAccount({ accounts: [cash, bank, hdfc], mode: 'upi' });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.code).toBe('SETTLEMENT_ACCOUNT_REQUIRED');
  });

  it('posts the selected HDFC ledger for a bank movement', () => {
    expect(
      resolveSettlementAccount({ accounts: [cash, bank, hdfc], mode: 'neft', selectedId: 'hdfc' }),
    ).toMatchObject({ ok: true, accountId: 'hdfc' });
  });

  it('rejects a cash payment posted to HDFC', () => {
    const resolved = resolveSettlementAccount({ accounts: [cash, hdfc], mode: 'cash', selectedId: 'hdfc' });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.code).toBe('SETTLEMENT_ACCOUNT_INVALID');
  });

  it('posts a credit card to the clearing account, not the bank', () => {
    expect(
      resolveSettlementAccount({ accounts: [cash, bank, cardClearing], mode: 'credit_card' }),
    ).toMatchObject({ ok: true, accountId: 'cards', modeClass: 'clearing' });
  });

  it('does not invent a clearing account', () => {
    const resolved = resolveSettlementAccount({ accounts: books, mode: 'credit_card' });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.code).toBe('CLEARING_ACCOUNT_REQUIRED');
  });

  it('leaves on-account payments off the cash and bank ledgers', () => {
    expect(resolveSettlementAccount({ accounts: books, mode: 'on_account' })).toEqual({
      ok: true,
      accountId: null,
      modeClass: 'on_account',
    });
    expect(classifyPaymentMode('credit')).toBe('on_account');
  });

  it('sends own-account transfers to contra', () => {
    const resolved = resolveSettlementAccount({ accounts: books, mode: 'transfer' });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.code).toBe('USE_CONTRA');
  });
});

describe('bank ledger link and opening balance', () => {
  it('backfills only when both sides are a single unlinked row', () => {
    expect(shouldBackfillBankLedgerLink(1, 1)).toBe(true);
    expect(shouldBackfillBankLedgerLink(1, 2)).toBe(false);
    expect(shouldBackfillBankLedgerLink(2, 1)).toBe(false);
    expect(shouldBackfillBankLedgerLink(0, 1)).toBe(false);
  });

  it('does not post a second opening onto a ledger that already has one', () => {
    expect(openingBalanceDecision(true, 5000)).toBe('reject');
    expect(openingBalanceDecision(true, 0)).toBe('skip');
    expect(openingBalanceDecision(false, 5000)).toBe('post');
    expect(openingBalanceDecision(false, 0)).toBe('skip');
  });

  it('places a new bank ledger in the Bank asset group', () => {
    const id = pickBankAssetGroup([
      { id: 'assets', group_code: '1000', group_name: 'Assets', group_type: 'asset' },
      { id: 'current', group_code: '1100', group_name: 'Current Assets', group_type: 'asset' },
      { id: 'bank-group', group_code: '1110', group_name: 'Bank', group_type: 'asset' },
    ]);
    expect(id).toBe('bank-group');
  });
});

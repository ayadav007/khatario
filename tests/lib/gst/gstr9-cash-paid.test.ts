import { allocateGstCashPaidByHead, type GstCashPaidLine } from '@/lib/gst/gst-settlement';

const line = (partial: GstCashPaidLine): GstCashPaidLine => partial;

describe('GSTR-9 Table 9 cash paid', () => {
  it('ignores a cash deposit and an ITC set-off', () => {
    const paid = allocateGstCashPaidByHead([
      line({ voucher_type: 'gst_cash_deposit', liability_account_code: '1130', debit: 500 }),
      line({ voucher_type: 'gst_setoff', liability_account_code: '2152', debit: 300 }),
    ]);
    expect(paid).toEqual({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
  });

  it('counts cash utilisation and historical gst_payment on the liability head', () => {
    const paid = allocateGstCashPaidByHead([
      line({ voucher_type: 'gst_cash_utilization', liability_account_code: '2150', debit: 40 }),
      line({ voucher_type: 'gst_payment', liability_account_code: '2152', debit: 25 }),
      line({ voucher_type: 'gst_payment', liability_account_code: '2153', debit: 5 }),
      line({ voucher_type: 'gst_cash_utilization', liability_account_code: '2156', debit: 7 }),
    ]);
    expect(paid).toEqual({ igst: 25, cgst: 47, sgst: 0, cess: 5 });
  });

  it('counts a one-shot payment only on the utilisation, split by the cash head for pooled RCM', () => {
    const paid = allocateGstCashPaidByHead([
      line({ voucher_type: 'gst_cash_deposit', liability_account_code: '1130', debit: 100 }),
      line({
        voucher_type: 'gst_cash_utilization',
        liability_account_code: '2155',
        debit: 100,
        cash_account_code: '1130',
      }),
      line({
        voucher_type: 'gst_cash_utilization',
        liability_account_code: '2155',
        debit: 15,
        cash_account_code: '1132',
      }),
      line({ voucher_type: 'gst_payment', liability_account_code: '2151', debit: 8 }),
    ]);
    expect(paid).toEqual({ igst: 100, cgst: 0, sgst: 23, cess: 0 });
  });

  it('places a historical pooled RCM gst_payment on IGST cash, the same default as an unnamed one-shot payment', () => {
    const paid = allocateGstCashPaidByHead([
      line({ voucher_type: 'gst_payment', liability_account_code: '2155', debit: 12 }),
    ]);
    expect(paid.igst).toBe(12);
    expect(paid.cgst).toBe(0);
  });
});

/**
 * POS cash tendered vs amount applied to the invoice.
 * Extra cash is change, not a negative balance / overpayment on the bill.
 */

export type PosTenderPayment = {
  mode: string;
  amount: number;
  date?: string;
  reference?: string;
  id?: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function applyPosTenders(
  grandTotal: number,
  payments: PosTenderPayment[]
): {
  payments: PosTenderPayment[];
  paidAmount: number;
  balanceAmount: number;
  cashTendered: number;
  changeGiven: number;
} {
  const others = payments.filter((p) => p.mode !== 'cash' && Number(p.amount) > 0);
  const cashRow = payments.find((p) => p.mode === 'cash');
  const otherSum = round2(others.reduce((s, p) => s + (Number(p.amount) || 0), 0));
  const cashTendered = round2(Number(cashRow?.amount) || 0);
  const remainingAfterOthers = Math.max(0, round2(grandTotal - otherSum));
  const cashApplied = Math.min(cashTendered, remainingAfterOthers);
  const changeGiven = Math.max(0, round2(cashTendered - cashApplied));

  const applied: PosTenderPayment[] = others.map((p) => ({
    ...p,
    amount: Number(p.amount) || 0,
  }));
  if (cashApplied > 0.0001 && cashRow) {
    applied.push({
      ...cashRow,
      amount: cashApplied,
      reference:
        changeGiven > 0.0001
          ? `Tendered ₹${cashTendered.toFixed(2)}; change ₹${changeGiven.toFixed(2)}`
          : cashRow.reference,
    });
  }

  const paidAmount = round2(applied.reduce((s, p) => s + (Number(p.amount) || 0), 0));
  const balanceAmount = round2(Math.max(0, grandTotal - paidAmount));

  return {
    payments: applied,
    paidAmount,
    balanceAmount,
    cashTendered,
    changeGiven,
  };
}

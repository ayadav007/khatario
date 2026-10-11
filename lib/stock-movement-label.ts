export type StockMovementPresentation = {
  label: string;
  documentNumber: string | null;
  href: string | null;
};

const ADJUSTMENT_LABELS: Record<string, string> = {
  DAMAGE: 'Damage',
  THEFT: 'Missing',
  EXPIRED: 'Expired',
  STOCK_TAKE: 'Stock take',
  FREE_SAMPLE: 'Free sample',
  COST_CORRECTION: 'Cost correction',
  LANDED_COST: 'Landed cost',
  REVALUATION: 'Revaluation',
  WRITE_DOWN: 'Write down',
};

export function stockMovementPresentation(input: {
  referenceType?: string | null;
  reasonCode?: string | null;
  documentNumber?: string | null;
  referenceId?: string | null;
}): StockMovementPresentation {
  const type = String(input.referenceType || '').toLowerCase();
  const documentNumber = input.documentNumber?.trim() || null;
  const id = input.referenceId || null;

  if (type === 'adjustment') {
    const reason = String(input.reasonCode || '').toUpperCase();
    return {
      label: ADJUSTMENT_LABELS[reason] || 'Adjustment',
      documentNumber,
      href: id ? `/inventory-adjustments/${id}` : null,
    };
  }

  const known: Record<string, { label: string; href: (id: string) => string }> = {
    invoice: { label: 'Sale', href: (docId) => `/invoices/${docId}` },
    sale: { label: 'Sale', href: (docId) => `/invoices/${docId}` },
    invoice_cancel: { label: 'Sale cancelled', href: (docId) => `/invoices/${docId}` },
    purchase: { label: 'Purchase', href: (docId) => `/purchases/${docId}` },
    purchase_cancel: { label: 'Purchase cancelled', href: (docId) => `/purchases/${docId}` },
    credit_note: { label: 'Sales return', href: (docId) => `/credit-notes/${docId}` },
    credit_note_cancel: { label: 'Sales return cancelled', href: (docId) => `/credit-notes/${docId}` },
    debit_note: { label: 'Debit note', href: (docId) => `/debit-notes/${docId}` },
    purchase_return: { label: 'Purchase return', href: (docId) => `/purchase-returns/${docId}` },
    stock_transfer: { label: 'Transfer', href: (docId) => `/stock-transfers/${docId}` },
  };

  const match = known[type];
  if (!match) {
    return { label: 'Stock change', documentNumber, href: null };
  }
  return {
    label: match.label,
    documentNumber,
    href: id ? match.href(id) : null,
  };
}

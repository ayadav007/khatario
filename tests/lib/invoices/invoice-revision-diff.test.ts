import {
  describeRevision,
  diffInvoiceSnapshots,
  fieldLabel,
  INVOICE_ACTION_LABELS,
  type InvoiceDiff,
  type InvoiceSnapshot,
} from '@/lib/invoices/invoice-revision-diff';

function snap(parts: Partial<InvoiceSnapshot> = {}): InvoiceSnapshot {
  return { header: { id: 'inv-1', invoice_number: 'INV-7' }, lines: [], charges: [], ...parts };
}

function line(sort: number, name: string, quantity: number, extra: Record<string, unknown> = {}) {
  return { id: `row-${Math.random()}`, invoice_id: 'inv-1', sort_order: sort, item_name: name, quantity, unit_price: 100, ...extra };
}

describe('diffInvoiceSnapshots', () => {
  it('returns an empty diff when there is no earlier version', () => {
    expect(diffInvoiceSnapshots(null, snap({ header: { notes: 'x' } }))).toEqual({ header: [], lines: [], charges: [] });
  });

  it('lists changed header fields with labels', () => {
    const diff = diffInvoiceSnapshots(
      snap({ header: { notes: 'Old', invoice_date: '2026-10-01', grand_total: 100 } }),
      snap({ header: { notes: 'New', invoice_date: '2026-10-03', grand_total: 100 } }),
    );
    expect(diff.header).toEqual([
      { field: 'invoice_date', label: 'Invoice date', before: '2026-10-01', after: '2026-10-03' },
      { field: 'notes', label: 'Notes', before: 'Old', after: 'New' },
    ]);
  });

  it('treats a numeric string and the same number as equal', () => {
    const diff = diffInvoiceSnapshots(snap({ header: { grand_total: '100.00' } }), snap({ header: { grand_total: 100 } }));
    expect(diff.header).toEqual([]);
  });

  it('treats null, empty text and a missing field as equal', () => {
    const diff = diffInvoiceSnapshots(snap({ header: { notes: null, terms: '' } }), snap({ header: { notes: '' } }));
    expect(diff.header).toEqual([]);
  });

  it('compares date-shaped text exactly', () => {
    const diff = diffInvoiceSnapshots(
      snap({ header: { purchase_order_number: '2026-11-001' } }),
      snap({ header: { purchase_order_number: '2026-11-002' } }),
    );
    expect(diff.header).toEqual([
      { field: 'purchase_order_number', label: 'PO number', before: '2026-11-001', after: '2026-11-002' },
    ]);
  });

  it('never shows system bookkeeping fields', () => {
    const diff = diffInvoiceSnapshots(
      snap({ header: { id: 'a', business_id: 'b', created_at: '1', created_by: 'u1', search_vector: 'x' } }),
      snap({ header: { id: 'c', business_id: 'd', created_at: '2', created_by: 'u2', search_vector: 'y' } }),
    );
    expect(diff.header).toEqual([]);
  });

  it('shows the edit lock under its own label', () => {
    const diff = diffInvoiceSnapshots(snap({ header: { is_editable: true } }), snap({ header: { is_editable: false } }));
    expect(diff.header).toEqual([{ field: 'is_editable', label: 'Locked for editing', before: true, after: false }]);
  });

  it('pairs re-inserted lines by item, not row id', () => {
    const prev = snap({ lines: [line(0, 'Rice', 2), line(1, 'Dal', 1)] });
    const next = snap({ lines: [line(0, 'Rice', 3), line(1, 'Dal', 1)] });
    expect(diffInvoiceSnapshots(prev, next).lines).toEqual([
      { kind: 'changed', position: 0, name: 'Rice', fields: [{ field: 'quantity', label: 'Qty', before: 2, after: 3 }] },
    ]);
  });

  it('reports added and removed lines', () => {
    const prev = snap({ lines: [line(0, 'Rice', 2), line(1, 'Dal', 1)] });
    const next = snap({ lines: [line(0, 'Rice', 2), line(2, 'Salt', 4)] });
    const lines = diffInvoiceSnapshots(prev, next).lines;
    expect(lines).toEqual([
      { kind: 'removed', position: 1, name: 'Dal', fields: [] },
      { kind: 'added', position: 1, name: 'Salt', fields: [] },
    ]);
  });

  it('reports only the removed line when an earlier line is deleted and the rest renumber', () => {
    const prev = snap({ lines: [line(0, 'Rice', 2), line(1, 'Dal', 1), line(2, 'Salt', 4)] });
    const next = snap({ lines: [line(0, 'Dal', 1), line(1, 'Salt', 4)] });
    expect(diffInvoiceSnapshots(prev, next).lines).toEqual([{ kind: 'removed', position: 0, name: 'Rice', fields: [] }]);
  });

  it('pairs a renamed line with the same item as a change', () => {
    const prev = snap({ lines: [line(0, 'Rice 1kg', 2, { item_id: 'i-1' })] });
    const next = snap({ lines: [line(0, 'Rice 1 kg bag', 2, { item_id: 'i-1' })] });
    expect(diffInvoiceSnapshots(prev, next).lines).toEqual([
      {
        kind: 'changed',
        position: 0,
        name: 'Rice 1 kg bag',
        fields: [{ field: 'item_name', label: 'Item', before: 'Rice 1kg', after: 'Rice 1 kg bag' }],
      },
    ]);
  });

  it('pairs lines of the same item when sort_order repeats', () => {
    const prev = snap({ lines: [line(0, 'Rice', 2), line(0, 'Dal', 1)] });
    const next = snap({ lines: [line(0, 'Rice', 2), line(0, 'Dal', 5)] });
    expect(diffInvoiceSnapshots(prev, next).lines).toEqual([
      { kind: 'changed', position: 1, name: 'Dal', fields: [{ field: 'quantity', label: 'Qty', before: 1, after: 5 }] },
    ]);
  });

  it('names charges by purpose', () => {
    const prev = snap({ charges: [{ sort_order: 0, purpose: 'Freight', amount: 50 }] });
    const next = snap({ charges: [{ sort_order: 0, purpose: 'Freight', amount: 80 }] });
    expect(diffInvoiceSnapshots(prev, next).charges).toEqual([
      { kind: 'changed', position: 0, name: 'Freight', fields: [{ field: 'amount', label: 'Amount', before: 50, after: 80 }] },
    ]);
  });
});

describe('fieldLabel', () => {
  it('uses the same labels as the amend form', () => {
    expect(fieldLabel('shipping_address')).toBe('Ship-to address');
    expect(fieldLabel('payment_terms')).toBe('Terms of payment');
    expect(fieldLabel('purchase_order_date')).toBe('PO date');
    expect(fieldLabel('eway_bill_date')).toBe('E-way bill date');
  });

  it('turns an unknown field into a sentence', () => {
    expect(fieldLabel('tcs_section_code')).toBe('Tcs section code');
  });
});

describe('describeRevision', () => {
  const change = (field: string) => ({ field, label: fieldLabel(field), before: 1, after: 2 });
  const empty: InvoiceDiff = { header: [], lines: [], charges: [] };

  it('names the changed fields', () => {
    const diff = { ...empty, header: [change('invoice_date'), change('notes')] };
    expect(describeRevision('amended', diff, 'INV-7')).toBe('Amended INV-7: Invoice date, Notes');
  });

  it('names only the action when nothing is listed', () => {
    expect(describeRevision('amended', empty, 'INV-7')).toBe('Amended INV-7');
  });

  it('shortens more than three changes', () => {
    const diff = {
      header: [change('invoice_date'), change('notes'), change('due_date'), change('payment_terms')],
      lines: [{ kind: 'added' as const, position: 0, name: 'Rice', fields: [] }],
      charges: [],
    };
    expect(describeRevision('draft_edited', diff, 'INV-7')).toBe('Draft edited INV-7: Invoice date, Notes, Due date and 2 more');
  });

  it('counts line changes once as Items', () => {
    const diff = {
      ...empty,
      lines: [
        { kind: 'added' as const, position: 0, name: 'Rice', fields: [] },
        { kind: 'removed' as const, position: 1, name: 'Dal', fields: [] },
      ],
    };
    expect(describeRevision('draft_edited', diff, 'INV-7')).toBe('Draft edited INV-7: Items');
  });

  it('has a label for every action', () => {
    expect(INVOICE_ACTION_LABELS.baseline).toBe('Recorded when history started');
    expect(INVOICE_ACTION_LABELS.gstr1_locked).toBe('Locked by GSTR-1 filing');
  });
});

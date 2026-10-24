import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/invoices/invoice_form_logic.dart';
import 'package:khatario_phone/screens/invoices/invoice_scan.dart';

void main() {
  test('an intra-state line splits GST the way the server does', () {
    final line = computeLineGst(quantity: 2, unitPrice: 100, taxRate: 18, intraState: true);
    expect(line.taxable, 200);
    expect(line.cgst, 18);
    expect(line.sgst, 18);
    expect(line.igst, 0);
    expect(line.total, 236);
  });

  test('a registered customer supplies from the GSTIN state', () {
    const gstin = '27AAPFU0939F1ZV';
    expect(invoicePlaceOfSupply(gstin: gstin, customerState: 'Karnataka', supplierStateCode: '29'), '27');
    expect(invoiceIntraState('27', '29'), isFalse);
    expect(invoiceIntraState('29', '29'), isTrue);
    expect(invoiceIntraState(null, '29'), isFalse);
  });

  test('the save body leaves identity to the session and keeps payment off drafts', () {
    final body = invoiceCreateBody(const InvoiceDraft(
      customerId: 'c1',
      invoiceDate: '2026-10-13',
      status: 'draft',
      paymentAmount: 50,
      lines: [InvoiceLineDraft(name: 'Rice', quantity: 1, unitPrice: 100, taxRate: 5)],
    ));
    expect(body.containsKey('created_by'), isFalse);
    expect(body.containsKey('business_id'), isFalse);
    expect(body.containsKey('payments'), isFalse);
    expect(body['document_type'], 'tax_invoice');
    expect(validateInvoiceDraft(const InvoiceDraft(
      invoiceDate: '2026-10-13',
      status: 'draft',
      paymentAmount: 50,
      lines: [InvoiceLineDraft(name: 'Rice', quantity: 1, unitPrice: 100)],
    )), 'A payment can only be recorded on a final invoice');
  });

  test('finalizing an existing draft sends the payment with the bill', () {
    final body = invoiceCreateBody(const InvoiceDraft(
      invoiceId: 'inv-1',
      invoiceDate: '2026-10-14',
      status: 'final',
      payments: [RecordedPayment(amount: 190, mode: 'cash', date: '2026-10-14')],
      lines: [InvoiceLineDraft(itemId: 'i1', name: 'Rice', quantity: 2, unitPrice: 95)],
    ));
    expect(body['id'], 'inv-1');
    expect(body['status'], 'final');
    expect(body['payments'], [
      {'amount': 190, 'mode': 'cash', 'date': '2026-10-14'},
    ]);
  });

  test('a final cash receipt includes one payment and no identity', () {
    final body = invoiceCreateBody(const InvoiceDraft(
      invoiceDate: '2026-10-13',
      status: 'final',
      paymentAmount: 118,
      paymentMode: 'upi',
      lines: [InvoiceLineDraft(itemId: 'i1', name: 'Rice', quantity: 1, unitPrice: 100, taxRate: 18)],
    ));
    expect(body['customer_id'], isNull);
    expect(body['payments'], [
      {'amount': 118, 'mode': 'upi', 'date': '2026-10-13'},
    ]);
  });
  test('due date, round-off and references go in the body; blanks become null', () {
    const draft = InvoiceDraft(
      invoiceDate: '2026-10-13',
      dueDate: '2026-10-28',
      status: 'draft',
      enableRoundOff: true,
      purchaseOrderNumber: ' PO-9 ',
      referenceNumber: '',
      lines: [InvoiceLineDraft(name: 'Rice', quantity: 1, unitPrice: 100.4, taxRate: 0)],
    );
    final body = invoiceCreateBody(draft);
    expect(body['due_date'], '2026-10-28');
    expect(body['enable_round_off'], isTrue);
    expect(body['purchase_order_number'], 'PO-9');
    expect(body['reference_number'], isNull);
    final preview = previewInvoice(draft);
    expect(preview.grand, 100);
    expect(preview.roundOff, -0.4);
    expect(
      validateInvoiceDraft(const InvoiceDraft(
        invoiceDate: '2026-10-13',
        dueDate: '2026-10-01',
        status: 'draft',
        lines: [InvoiceLineDraft(name: 'Rice', quantity: 1, unitPrice: 1)],
      )),
      'Due date cannot be before the invoice date',
    );
  });

  test('additional charges are added after tax and sent as one amount; a variant line keeps its variant', () {
    const draft = InvoiceDraft(
      invoiceDate: '2026-10-14',
      status: 'final',
      additionalCharges: 50,
      lines: [InvoiceLineDraft(itemId: 'i1', variantId: 'v1', name: 'Shirt (M)', quantity: 2, unitPrice: 100, taxRate: 5)],
    );
    final p = previewInvoice(draft);
    expect(p.taxable, 200);
    expect(p.tax, 10);
    expect(p.grand, 260);
    final body = invoiceCreateBody(draft);
    expect(body['additional_charges'], 50);
    expect((body['items'] as List).single, containsPair('variant_id', 'v1'));
  });

  test('a scanned code matches an exact barcode, then a code, then a variant barcode', () {
    final items = [
      {'id': 'a', 'name': 'Shirt', 'barcode': '8901234567890', 'code': 'SH-1', 'selling_price': 499},
      {'id': 'b', 'name': 'Cap', 'barcode': null, 'code': 'CAP-9', 'selling_price': 199},
      {
        'id': 'c',
        'name': 'Kurta',
        'barcode': null,
        'code': 'KU',
        'selling_price': 899,
        'variants': [
          {'id': 'v1', 'variant_name': 'L', 'barcode': '111222', 'selling_price': 949},
        ],
      },
    ];
    expect(matchScannedItem(items, ' 8901234567890 ')!.item['id'], 'a');
    expect(matchScannedItem(items, 'cap-9')!.item['id'], 'b');
    final v = matchScannedItem(items, '111222')!;
    expect(v.variant!['id'], 'v1');
    expect(v.name, 'Kurta (L)');
    expect(v.price, 949);
    expect(matchScannedItem(items, '999'), isNull);
  });
}

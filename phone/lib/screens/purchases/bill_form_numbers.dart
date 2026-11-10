import '../../api.dart';
import '../docs/doc_logic.dart';
import 'bill_form_screen.dart' show BillKind;

/// The first `PREFIX-001`, `PREFIX-002`, ... not in [taken], as the website's sales and purchase order forms pick it.
String firstFreeNumber(String prefix, Iterable<String> taken) {
  final used = taken.toSet();
  var n = 1;
  String at(int i) => '$prefix-${i.toString().padLeft(3, '0')}';
  while (used.contains(at(n))) {
    n++;
  }
  return at(n);
}

/// The number a new document form starts with, or null when the kind has none or the request fails
/// (the field then stays empty and the user types one; nothing is shown). Never called when editing.
/// Credit note: `GET /api/credit-notes?next_number=1` -> `next_credit_note_number`.
/// Debit note: `GET /api/debit-notes?next_number=1` -> `next_debit_note_number`.
/// Sales order: `GET /api/sales-orders` -> `salesOrders[].order_number`, first free `SO-###`.
/// Purchase order: `GET /api/purchase-orders` -> `purchaseOrders[].order_number`, first free `PO-###`.
Future<String?> suggestedDocumentNumber(KhatarioApi api, BillKind kind) async {
  try {
    switch (kind) {
      case BillKind.creditNote:
        final text = docText((await api.getJson('/api/credit-notes?next_number=1'))['next_credit_note_number']);
        return text.isEmpty ? null : text;
      case BillKind.debitNote:
        final text = docText((await api.getJson('/api/debit-notes?next_number=1'))['next_debit_note_number']);
        return text.isEmpty ? null : text;
      case BillKind.salesOrder:
        final rows = docRows(await api.getData('/api/sales-orders'), 'salesOrders');
        return firstFreeNumber('SO', [for (final r in rows) docText(r['order_number'])]);
      case BillKind.purchaseOrder:
        final rows = docRows(await api.getData('/api/purchase-orders'), 'purchaseOrders');
        return firstFreeNumber('PO', [for (final r in rows) docText(r['order_number'])]);
      default:
        return null;
    }
  } catch (_) {
    return null;
  }
}

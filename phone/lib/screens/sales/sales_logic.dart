import '../../format.dart';
import '../../ui/kit.dart';
import '../docs/doc_logic.dart';

/// Quotations (`app/(app)/estimates/page.tsx`). A quotation is an invoice row whose
/// `document_type` is `proforma_invoice`; `GET /api/estimates` maps it to `estimate_number`,
/// `estimate_date`, `status` (the estimate status), `grand_total` and `converted_invoice_id`.

/// The website's status chips (the route filters on the estimate status; there is no "open").
const kQuotationFilters = <(String, String)>[
  ('', 'All'),
  ('draft', 'Draft'),
  ('sent', 'Sent'),
  ('accepted', 'Accepted'),
  ('rejected', 'Rejected'),
  ('expired', 'Expired'),
  ('converted', 'Converted'),
];

enum QuotationAction { convert, openInvoice, share }

/// A row from the list (`status`) or a full invoice (`estimate_status`). Having an invoice means converted.
String quotationStatus(Map<String, dynamic> row) {
  if (docText(row['converted_invoice_id']).isNotEmpty) return 'converted';
  const known = {'draft', 'sent', 'accepted', 'rejected', 'expired', 'converted'};
  // The estimate status first. A full invoice's `status` is the invoice's own (final, draft...), and a
  // list row's `status` already is the estimate status, so it counts only when it is one.
  final est = docText(row['estimate_status']).trim().toLowerCase();
  if (known.contains(est)) return est;
  final s = docText(row['status']).trim().toLowerCase();
  return known.contains(s) ? s : 'draft';
}

/// `getStatusBadge` on the website page.
(KTone, String) quotationStatusStyle(String status) => switch (status) {
      'draft' => (KTone.neutral, 'Draft'),
      'sent' => (KTone.brand, 'Sent'),
      'accepted' => (KTone.positive, 'Accepted'),
      'rejected' => (KTone.negative, 'Rejected'),
      'expired' => (KTone.due, 'Expired'),
      'converted' => (KTone.positive, 'Converted'),
      _ => (KTone.neutral, 'Draft'),
    };

String? convertedInvoiceIdOf(Map<String, dynamic> row) {
  final id = docText(row['converted_invoice_id'] ?? row['invoice_id']);
  return id.isEmpty ? null : id;
}

/// The website offers Convert for draft, sent and accepted only.
bool canConvertQuotation(Map<String, dynamic> row) => const {'draft', 'sent', 'accepted'}.contains(quotationStatus(row));

List<QuotationAction> quotationActions(Map<String, dynamic> row) => [
      if (canConvertQuotation(row)) QuotationAction.convert,
      if (quotationStatus(row) == 'converted' && convertedInvoiceIdOf(row) != null) QuotationAction.openInvoice,
      QuotationAction.share,
    ];

/// `POST /api/invoices/[id]/convert-to-tax-invoice` takes an optional `invoice_date`; the website sends `{}`.
Map<String, dynamic> quotationConvertBody() => const {};

String quotationTitle(Map<String, dynamic> row) {
  final n = docText(row['estimate_number'] ?? row['invoice_number']);
  return n.isEmpty ? 'Quotation' : n;
}

String quotationSubtitle(Map<String, dynamic> row) {
  final name = docText(row['customer_name']);
  final date = docDate(row['estimate_date'] ?? row['invoice_date']);
  final expiry = docDate(row['expiry_date']);
  return [
    name.isEmpty ? 'No customer' : name,
    if (date != null) ddMMMyyyy(date),
    if (expiry != null) 'Expires ${ddMMMyyyy(expiry)}',
  ].join(' · ');
}

String quotationConfirmText(String number, num amount) =>
    'Make a tax invoice from quotation $number for ${inr(amount, maxFraction: 2)}? The quotation is marked converted.';

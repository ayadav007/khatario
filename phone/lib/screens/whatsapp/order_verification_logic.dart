import '../../format.dart';

/// One item of a WhatsApp order (`sales_order_items`: `item_name`, `qty`, `line_total`).
class OrderLine {
  const OrderLine({required this.name, required this.qty, required this.total});

  final String name;
  final num qty;
  final num total;

  /// "2 × Rice 5kg".
  String get text => '${jsNumberString(qty)} × $name';
}

/// Which payment panel the website shows for an order.
enum OrderProof {
  /// The payment provider reported a (full or part) payment; no screenshot is needed.
  online,

  /// The customer sent a screenshot; the AI check is shown.
  screenshot,

  /// Nothing yet.
  none,
}

String _status(String? status) => (status ?? '').trim().toLowerCase();

/// Website `hasProviderPaymentRecorded`.
bool hasProviderPaymentRecorded(String? status) {
  final s = _status(status);
  return s == 'paid' || s == 'partial_paid' || s == 'partially_paid' || s == 'partial';
}

String onlinePaymentTitle(String? status) => _status(status) == 'paid' ? 'Payment received (online)' : 'Partial payment received';

/// The AI reading of a payment screenshot (`ocr_data`).
class OrderOcr {
  const OrderOcr({this.source, this.amount, this.confidence, this.modelConfidence, this.upi, this.summary, this.note});

  final String? source;
  final num? amount;

  /// `effective_confidence`, else `confidenceScore`.
  final num? confidence;

  /// `confidenceScore` when it differs from the effective one.
  final num? modelConfidence;
  final String? upi;
  final String? summary;
  final String? note;

  static OrderOcr fromJson(Map json) {
    String? text(String key) {
      final v = json[key]?.toString().trim();
      return (v == null || v.isEmpty) ? null : v;
    }

    num? number(String key) => json[key] == null ? null : (json[key] is num ? json[key] as num : num.tryParse(json[key].toString()));
    final effective = number('effective_confidence');
    final model = number('confidenceScore');
    return OrderOcr(
      source: text('verification_source')?.replaceAll('_', ' '),
      amount: number('extractedAmount'),
      confidence: effective ?? model,
      modelConfidence: effective != null && model != null && effective != model ? model : null,
      upi: text('extractedUPIId'),
      summary: text('validation_summary'),
      note: text('reason'),
    );
  }

  String get amountText => amount == null ? 'N/A' : '$rupeeSign${enIn(amount!)}';

  String get confidenceText {
    final c = confidence;
    if (c == null) return '—';
    final model = modelConfidence;
    return '${jsNumberString(c)}%${model == null ? '' : ' (model ${jsNumberString(model)}%)'}';
  }

  /// Green above 80 on the website, amber otherwise.
  bool get confident => (confidence ?? 0) > 80;
}

/// One WhatsApp order waiting for payment verification (`GET /api/whatsapp/orders`).
class WhatsAppOrderRow {
  const WhatsAppOrderRow({
    required this.id,
    required this.number,
    required this.customer,
    required this.total,
    required this.items,
    this.phone,
    this.date,
    this.placedAt,
    this.paymentProofUrl,
    this.paymentStatus,
    this.paymentReference,
    this.paymentMethod,
    this.ocrStatus,
    this.ocr,
  });

  final String id;
  final String number;
  final String customer;
  final num total;
  final List<OrderLine> items;
  final String? phone;
  final DateTime? date;
  final DateTime? placedAt;
  final String? paymentProofUrl;
  final String? paymentStatus;
  final String? paymentReference;
  final String? paymentMethod;
  final String? ocrStatus;
  final OrderOcr? ocr;

  List<String> get lines => [for (final i in items) i.text];

  OrderProof get proof => hasProviderPaymentRecorded(paymentStatus)
      ? OrderProof.online
      : (paymentProofUrl != null ? OrderProof.screenshot : OrderProof.none);

  static WhatsAppOrderRow? fromJson(dynamic json) {
    if (json is! Map) return null;
    final id = json['id']?.toString();
    if (id == null || id.isEmpty) return null;
    String? text(String key) {
      final v = json[key]?.toString().trim();
      return (v == null || v.isEmpty) ? null : v;
    }

    final items = json['items'];
    final created = text('created_at');
    final dateText = text('order_date') ?? created;
    final ocr = json['ocr_data'];
    return WhatsAppOrderRow(
      id: id,
      number: text('order_number') ?? 'Order',
      customer: text('customer_name') ?? 'Anonymous Customer',
      phone: text('whatsapp_phone') ?? text('customer_phone'),
      total: toNum(json['grand_total']),
      date: dateText == null || dateText.length < 10 ? null : DateTime.tryParse(dateText.substring(0, 10)),
      placedAt: created == null ? null : DateTime.tryParse(created)?.toLocal(),
      paymentProofUrl: text('payment_screenshot_url'),
      paymentStatus: text('payment_status'),
      paymentReference: text('payment_reference'),
      paymentMethod: text('payment_method')?.replaceAll('_', ' '),
      ocrStatus: text('ocr_status'),
      ocr: ocr is Map ? OrderOcr.fromJson(ocr) : null,
      items: [
        if (items is List)
          for (final item in items)
            if (item is Map) orderLine(item),
      ],
    );
  }
}

/// The server sends `qty`; older rows and tests used `quantity`.
OrderLine orderLine(Map item) => OrderLine(
      name: item['item_name']?.toString() ?? 'Item',
      qty: toNum(item['qty'] ?? item['quantity']),
      total: toNum(item['line_total']),
    );

/// "2 × Rice 5kg".
String orderLineText(Map item) => orderLine(item).text;

List<WhatsAppOrderRow> whatsAppOrderRows(dynamic list) =>
    list is List ? list.map(WhatsAppOrderRow.fromJson).whereType<WhatsAppOrderRow>().toList() : const [];

/// Website `ocrStatusPresentation`: the heading and how it is coloured.
enum ProofTone { good, review, bad, info, pending }

(String, ProofTone) ocrProofPresentation(String? status) => switch (status) {
      'verified' => ('Verified', ProofTone.good),
      'requires_review' => ('Review needed', ProofTone.review),
      'rejected' => ('Rejected', ProofTone.bad),
      'awaiting_psp' => ('Awaiting payment provider', ProofTone.info),
      null || '' || 'pending' => ('Pending', ProofTone.pending),
      _ => (status.replaceAll('_', ' '), ProofTone.pending),
    };

/// date-fns `dd MMM yyyy, hh:mm a`.
String orderPlacedText(DateTime d) {
  final hour = d.hour % 12 == 0 ? 12 : d.hour % 12;
  return '${ddMMMyyyy(d)}, ${hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')} ${d.hour < 12 ? 'AM' : 'PM'}';
}

const orderPageSize = 20;

int orderPageCount(int total) => total <= 0 ? 1 : (total + orderPageSize - 1) ~/ orderPageSize;

/// Page [page] (1-based, clamped) of [rows].
List<T> orderPage<T>(List<T> rows, int page) {
  final p = page.clamp(1, orderPageCount(rows.length));
  return rows.skip((p - 1) * orderPageSize).take(orderPageSize).toList();
}

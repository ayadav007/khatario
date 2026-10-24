import '../../format.dart';

/// One WhatsApp order waiting for payment verification (`GET /api/whatsapp/orders`).
class WhatsAppOrderRow {
  const WhatsAppOrderRow({
    required this.id,
    required this.number,
    required this.customer,
    required this.total,
    required this.lines,
    this.phone,
    this.date,
    this.paymentProofUrl,
  });

  final String id;
  final String number;
  final String customer;
  final num total;
  final List<String> lines;
  final String? phone;
  final DateTime? date;
  final String? paymentProofUrl;

  static WhatsAppOrderRow? fromJson(dynamic json) {
    if (json is! Map) return null;
    final id = json['id']?.toString();
    if (id == null || id.isEmpty) return null;
    String? text(String key) {
      final v = json[key]?.toString().trim();
      return (v == null || v.isEmpty) ? null : v;
    }

    final items = json['items'];
    final dateText = text('order_date') ?? text('created_at');
    return WhatsAppOrderRow(
      id: id,
      number: text('order_number') ?? 'Order',
      customer: text('customer_name') ?? text('customer_phone') ?? text('whatsapp_phone') ?? 'Customer',
      phone: text('whatsapp_phone') ?? text('customer_phone'),
      total: toNum(json['grand_total']),
      date: dateText == null || dateText.length < 10 ? null : DateTime.tryParse(dateText.substring(0, 10)),
      paymentProofUrl: text('payment_screenshot_url'),
      lines: [
        if (items is List)
          for (final item in items)
            if (item is Map) orderLineText(item),
      ],
    );
  }
}

/// "2 × Rice 5kg".
String orderLineText(Map item) {
  final qty = toNum(item['quantity']);
  final name = item['item_name']?.toString() ?? 'Item';
  return '${jsNumberString(qty)} × $name';
}

List<WhatsAppOrderRow> whatsAppOrderRows(dynamic list) =>
    list is List ? list.map(WhatsAppOrderRow.fromJson).whereType<WhatsAppOrderRow>().toList() : const [];

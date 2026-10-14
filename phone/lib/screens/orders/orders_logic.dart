import '../../format.dart';
import '../../ui/kit.dart';

/// Orders & delivery: labels, tones and next steps. Mirrors `lib/fulfilment/rules.ts` on the web.

const deliveryLabels = <String, String>{
  'new': 'New',
  'confirmed': 'Confirmed',
  'packed': 'Packed',
  'ready_for_pickup': 'Ready for pickup',
  'shipped': 'Shipped',
  'out_for_delivery': 'Out for delivery',
  'delivered': 'Delivered',
  'delivery_failed': 'Delivery failed',
  'returned': 'Returned',
  'cancelled': 'Cancelled',
};

/// Delivery status as a pill. Untracked sales show "Not tracked".
(KTone, String) deliveryTone(String? status) {
  final s = status ?? '';
  final label = deliveryLabels[s] ?? 'Not tracked';
  return switch (s) {
    'delivered' => (KTone.positive, label),
    'delivery_failed' || 'cancelled' => (KTone.negative, label),
    'returned' || 'new' => (KTone.due, label),
    'shipped' || 'out_for_delivery' || 'ready_for_pickup' || 'packed' || 'confirmed' => (KTone.brand, label),
    _ => (KTone.neutral, label),
  };
}

const channelLabels = <String, String>{
  'online_store': 'Online store',
  'whatsapp': 'WhatsApp',
  'counter': 'Counter',
  'manual': 'Manual',
  'sales_order': 'Sales order',
};

/// The "needs action" buckets, in the order the web shows them.
const needsBuckets = <(String, String)>[
  ('to_confirm', 'To confirm'),
  ('payment_pending', 'Payment pending'),
  ('to_pack', 'To pack'),
  ('to_dispatch', 'To dispatch'),
  ('delivery_failed', 'Delivery failed'),
  ('stale', 'Paid, not dispatched'),
  ('in_transit_late', 'Late in transit'),
];

const fulfilmentTransitions = <String, List<String>>{
  'new': ['confirmed', 'cancelled'],
  'confirmed': ['packed', 'ready_for_pickup', 'shipped', 'cancelled'],
  'packed': ['ready_for_pickup', 'shipped', 'cancelled'],
  'ready_for_pickup': ['delivered', 'cancelled'],
  'shipped': ['out_for_delivery', 'delivered', 'delivery_failed', 'returned'],
  'out_for_delivery': ['delivered', 'delivery_failed', 'returned'],
  'delivery_failed': ['out_for_delivery', 'shipped', 'delivered', 'returned'],
  'delivered': ['returned'],
  'returned': [],
  'cancelled': [],
};

/// The one main next step for a parcel, shown as the primary button.
(String, String)? primaryStep(String? status) => switch (status) {
      'new' => ('confirmed', 'Confirm order'),
      'confirmed' => ('packed', 'Mark packed'),
      'packed' => ('shipped', 'Dispatch'),
      'shipped' => ('out_for_delivery', 'Out for delivery'),
      'out_for_delivery' => ('delivered', 'Mark delivered'),
      'ready_for_pickup' => ('delivered', 'Handed over'),
      _ => null,
    };

const returnStatusLabels = <String, String>{
  'requested': 'Requested',
  'approved': 'Awaiting goods',
  'received': 'Refund due',
  'closed': 'Closed',
  'rejected': 'Rejected',
  'cancelled': 'Cancelled',
};

(KTone, String) returnTone(String status) => switch (status) {
      'requested' => (KTone.due, returnStatusLabels[status]!),
      'approved' => (KTone.brand, returnStatusLabels[status]!),
      'received' => (KTone.due, returnStatusLabels[status]!),
      'closed' => (KTone.positive, returnStatusLabels[status]!),
      'rejected' || 'cancelled' => (KTone.negative, returnStatusLabels[status]!),
      _ => (KTone.neutral, status),
    };

const returnReasonLabels = <String, String>{
  'damaged': 'Damaged or defective',
  'wrong_item': 'Wrong item sent',
  'not_as_described': 'Not as described',
  'size_fit': 'Size or fit',
  'not_needed': 'No longer needed',
  'not_delivered': 'Not delivered (came back)',
  'other': 'Other',
};

String orderMoney(dynamic v) => '₹${enIn(toNum(v), maxFraction: 2)}';

/// "2h", "3d" since a timestamp.
String ageOf(dynamic iso, {DateTime? now}) {
  final t = DateTime.tryParse(iso?.toString() ?? '');
  if (t == null) return '';
  final d = (now ?? DateTime.now()).difference(t.toLocal());
  if (d.inHours < 1) return '${d.inMinutes < 1 ? 1 : d.inMinutes}m';
  if (d.inHours < 48) return '${d.inHours}h';
  return '${d.inDays}d';
}

/// Payment state of an order as a pill: COD reads "COD", not a raw code.
(KTone, String) paymentTone(String? status) => switch (status ?? 'unpaid') {
      'cod' => (KTone.due, 'COD'),
      'paid' => (KTone.positive, 'Paid'),
      'failed' => (KTone.negative, 'Payment failed'),
      final s => statusTone(s),
    };

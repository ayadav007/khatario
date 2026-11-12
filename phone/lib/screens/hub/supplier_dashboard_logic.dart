import '../../format.dart';

/// The supplier dashboard (`/suppliers/dashboard`, `/analytics`, `/thresholds`): paths and rows.
/// No screen code here, so tests can reach it. The server takes the business from the session, so no
/// path or body carries a business id (the routes accept `supplier_business_id` only as an optional
/// check against the session).

const supplierDashboardPath = '/api/suppliers/dashboard';
String supplierAnalyticsPath(String period) =>
    '$supplierDashboardPath/analytics?period=$period';
const supplierThresholdsPath = '/api/suppliers/thresholds';
String supplierThresholdDeletePath(String id) =>
    '$supplierThresholdsPath?id=${Uri.encodeQueryComponent(id)}';
const linkedCustomerPath = '/api/suppliers/hub/linked-customer';
const supplyOrdersPath = '/api/supply-orders';
String supplierDismissPath(String id) =>
    '$supplierDashboardPath/dismiss-alert?alert_id=${Uri.encodeQueryComponent(id)}';

/// The dashboard also lists customer items that are below their reorder level but have no alert row
/// yet. Their id is `item-<item id>`, which is not an alert, so the server cannot dismiss it.
bool alertCanBeDismissed(String id) => !id.startsWith('item-');

String _text(dynamic v) => v?.toString().trim() ?? '';

String _joinPlace(String city, String state, [String pincode = '']) {
  final place = [city, state].where((s) => s.isNotEmpty).join(', ');
  return [place, pincode].where((s) => s.isNotEmpty).join(' ');
}

class SupplierAlert {
  const SupplierAlert({
    required this.id,
    required this.itemName,
    required this.itemCode,
    required this.stock,
    required this.threshold,
    required this.customerName,
    required this.phone,
    required this.email,
    required this.address,
    required this.location,
  });

  final String id;
  final String itemName;
  final String itemCode;
  final num stock;
  final num threshold;
  final String customerName;
  final String phone;
  final String email;
  final String address;
  final String location;

  num get shortage => threshold > stock ? threshold - stock : 0;

  static SupplierAlert? fromJson(dynamic json) {
    if (json is! Map) return null;
    final id = _text(json['id']);
    if (id.isEmpty) return null;
    return SupplierAlert(
      id: id,
      itemName: _text(json['item_name']),
      itemCode: _text(json['item_code']),
      stock: toNum(json['current_stock']),
      threshold: toNum(json['threshold']),
      customerName: _text(json['customer_name']),
      phone: _text(json['customer_phone']),
      email: _text(json['customer_email']),
      address: _text(json['customer_address']),
      location: _joinPlace(
        _text(json['customer_city']),
        _text(json['customer_state']),
        _text(json['customer_pincode']),
      ),
    );
  }
}

class GroupItem {
  const GroupItem({
    required this.itemId,
    required this.name,
    required this.code,
    required this.stock,
    required this.threshold,
  });

  final String itemId;
  final String name;
  final String code;
  final num stock;
  final num threshold;

  /// The website pre-fills the proposal with this.
  num get shortage => threshold > stock ? threshold - stock : 0;
}

/// One customer with items low on stock (`customer_groups` of the dashboard reply).
class SupplierGroup {
  const SupplierGroup({
    required this.customerBusinessId,
    required this.name,
    required this.phone,
    required this.email,
    required this.location,
    required this.itemsCount,
    required this.totalShortage,
    required this.items,
  });

  /// The buyer's business id. The server checks it against an approved link to this business.
  final String customerBusinessId;
  final String name;
  final String phone;
  final String email;
  final String location;
  final int itemsCount;
  final num totalShortage;
  final List<GroupItem> items;

  static SupplierGroup? fromJson(dynamic json) {
    if (json is! Map) return null;
    final items = json['items'] is List
        ? [
            for (final i in json['items'] as List)
              if (i is Map)
                GroupItem(
                  itemId: _text(i['item_id']),
                  name: _text(i['item_name']),
                  code: _text(i['item_code']),
                  stock: toNum(i['current_stock']),
                  threshold: toNum(i['threshold']),
                ),
          ]
        : <GroupItem>[];
    return SupplierGroup(
      customerBusinessId: _text(json['customer_business_id']),
      name: _text(json['customer_name']),
      phone: _text(json['customer_phone']),
      email: _text(json['customer_email']),
      location: _joinPlace(
        _text(json['customer_city']),
        _text(json['customer_state']),
      ),
      itemsCount: toNum(json['items_count']).toInt(),
      totalShortage: toNum(json['total_shortage']),
      items: items,
    );
  }
}

/// `5` and `2.5`, as typed in a quantity box.
String quantityText(num n) =>
    n == n.roundToDouble() ? n.toInt().toString() : n.toString();

/// The lines of the proposal: items with an id and a quantity above zero, in the buyer's unit.
List<Map<String, dynamic>> proposalLines(
  List<GroupItem> items,
  List<String> quantities,
) {
  final lines = <Map<String, dynamic>>[];
  for (var i = 0; i < items.length && i < quantities.length; i++) {
    final qty = double.tryParse(quantities[i].trim());
    if (items[i].itemId.isEmpty || qty == null || qty <= 0) continue;
    lines.add({
      'buyer_item_id': items[i].itemId,
      'buyer_qty': qty == qty.roundToDouble() ? qty.toInt() : qty,
    });
  }
  return lines;
}

/// `POST /api/suppliers/hub/linked-customer`: the buyer is a counterparty, not the session business.
Map<String, dynamic> linkedCustomerBody(String buyerBusinessId) => {
  'buyer_business_id': buyerBusinessId,
};

/// `POST /api/supply-orders` for a vendor: sent at once for the buyer to confirm.
Map<String, dynamic> proposeOrderBody(
  String customerId,
  List<Map<String, dynamic>> lines,
) => {'customer_id': customerId, 'lines': lines, 'send': true};

/// The website's Contact button: `https://wa.me/<digits>`. Null without a phone.
Uri? whatsAppUri(String phone) {
  final digits = phone.replaceAll(RegExp(r'\D'), '');
  return digits.isEmpty ? null : Uri.parse('https://wa.me/$digits');
}

class SupplierDashboard {
  const SupplierDashboard({
    this.activeCustomers = 0,
    this.lowStockAlerts = 0,
    this.monitoredItems = 0,
    this.alerts = const [],
    this.groups = const [],
  });

  final int activeCustomers;
  final int lowStockAlerts;
  final int monitoredItems;
  final List<SupplierAlert> alerts;
  final List<SupplierGroup> groups;

  factory SupplierDashboard.fromJson(Map<String, dynamic> json) {
    final stats = json['stats'] is Map
        ? Map<String, dynamic>.from(json['stats'] as Map)
        : <String, dynamic>{};
    final list = json['low_stock_alerts'];
    final groups = json['customer_groups'];
    return SupplierDashboard(
      activeCustomers: toNum(stats['active_customers']).toInt(),
      lowStockAlerts: toNum(stats['low_stock_alerts']).toInt(),
      monitoredItems: toNum(stats['total_thresholds']).toInt(),
      alerts: list is List
          ? [for (final a in list) ?SupplierAlert.fromJson(a)]
          : const [],
      groups: groups is List
          ? [for (final g in groups) ?SupplierGroup.fromJson(g)]
          : const [],
    );
  }
}

// ---------------------------------------------------------------- area performance

/// The website's period buttons.
const analyticsPeriods = <(String, String)>[
  ('30d', 'Last 30 days'),
  ('90d', 'Last 90 days'),
  ('fy', 'This financial year'),
];

/// Map is a drawing of India on the website; the phone has the pivot and the ranking.
const analyticsViews = <(String, String)>[
  ('pivot', 'Pivot'),
  ('rank', 'Ranking'),
];
const analyticsGrains = <(String, String)>[
  ('state', 'State'),
  ('city', 'City'),
  ('pincode', 'Pincode'),
];

String areaBandLabel(String band) => switch (band) {
  'strong' => 'Doing well',
  'watch' => 'Watch',
  'weak' => 'Needs attention',
  _ => 'No movement',
};

class AreaRow {
  const AreaRow({
    required this.label,
    required this.customers,
    required this.sellIn,
    required this.sellThrough,
    required this.lowStock,
    required this.band,
  });

  final String label;
  final int customers;
  final num sellIn;
  final num sellThrough;
  final int lowStock;
  final String band;

  static AreaRow? fromJson(dynamic json) {
    if (json is! Map) return null;
    return AreaRow(
      label: _text(json['label']),
      customers: toNum(json['customerCount']).toInt(),
      sellIn: toNum(json['sellIn']),
      sellThrough: toNum(json['sellThrough']),
      lowStock: toNum(json['lowStockItems']).toInt(),
      band: _text(json['band']),
    );
  }
}

class PivotRow {
  const PivotRow(this.state, this.cells, this.total);

  final String state;
  final Map<String, num> cells;
  final num total;
}

class AreaAnalytics {
  const AreaAnalytics({
    this.from = '',
    this.to = '',
    this.states = const [],
    this.cities = const [],
    this.pincodes = const [],
    this.pivotItems = const [],
    this.pivot = const [],
    this.minShops = 3,
    this.shopsSharing = 0,
    this.hidden = const {},
  });

  final String from;
  final String to;
  final List<AreaRow> states;
  final List<AreaRow> cities;
  final List<AreaRow> pincodes;
  final List<String> pivotItems;
  final List<PivotRow> pivot;
  final int minShops;
  final int shopsSharing;
  final Map<String, int> hidden;

  factory AreaAnalytics.fromJson(Map<String, dynamic> json) {
    List<AreaRow> rows(String key) => json[key] is List
        ? [for (final r in json[key] as List) ?AreaRow.fromJson(r)]
        : const [];
    final period = json['period'] is Map ? json['period'] as Map : const {};
    final hidden = json['hidden_shops'] is Map
        ? json['hidden_shops'] as Map
        : const {};
    final matrix = json['pivot_matrix'];
    return AreaAnalytics(
      from: _text(period['from']),
      to: _text(period['to']),
      states: rows('states'),
      cities: rows('cities'),
      pincodes: rows('pincodes'),
      pivotItems: json['pivot_items'] is List
          ? [for (final i in json['pivot_items'] as List) i.toString()]
          : const [],
      pivot: matrix is List
          ? [
              for (final r in matrix)
                if (r is Map)
                  PivotRow(_text(r['state']), {
                    for (final e
                        in (r['cells'] is Map ? r['cells'] as Map : const {})
                            .entries)
                      e.key.toString(): toNum(e.value),
                  }, toNum(r['total'])),
            ]
          : const [],
      minShops: json['min_shops_per_area'] == null
          ? 3
          : toNum(json['min_shops_per_area']).toInt(),
      shopsSharing: toNum(json['shops_sharing']).toInt(),
      hidden: {
        'state': toNum(hidden['states']).toInt(),
        'city': toNum(hidden['cities']).toInt(),
        'pincode': toNum(hidden['pincodes']).toInt(),
      },
    );
  }

  List<AreaRow> rowsFor(String grain) => switch (grain) {
    'city' => cities,
    'pincode' => pincodes,
    _ => states,
  };

  int hiddenFor(String grain) => hidden[grain] ?? 0;

  /// The website's words when there is nothing to show yet.
  String? get emptyNote {
    if (states.isNotEmpty) return null;
    if (shopsSharing > 0) {
      return '$shopsSharing shop${shopsSharing == 1 ? ' shares' : 's share'} with you so far. Area totals appear once at least $minShops shops in an area share, so no single shop\'s sales can be seen.';
    }
    return 'No connected shops share their stock and sales with you yet.';
  }
}

// ---------------------------------------------------------------- thresholds

class SupplierThreshold {
  const SupplierThreshold({
    required this.id,
    required this.customerName,
    required this.phone,
    required this.itemName,
    required this.itemCode,
    required this.level,
    required this.stock,
    required this.location,
  });

  final String id;
  final String customerName;
  final String phone;
  final String itemName;
  final String itemCode;
  final num level;
  final num stock;
  final String location;

  bool get isLow => stock <= level;
}

List<SupplierThreshold> supplierThresholds(Map<String, dynamic> json) {
  final list = json['thresholds'];
  if (list is! List) return const [];
  return [
    for (final t in list)
      if (t is Map && _text(t['id']).isNotEmpty)
        SupplierThreshold(
          id: _text(t['id']),
          customerName: _text(t['customer_name']),
          phone: _text(t['customer_phone']),
          itemName: _text(t['item_name']),
          itemCode: _text(t['item_code']),
          level: toNum(t['low_stock_threshold']),
          stock: toNum(t['current_stock']),
          location: _joinPlace(
            _text(t['customer_city']),
            _text(t['customer_state']),
          ),
        ),
  ];
}

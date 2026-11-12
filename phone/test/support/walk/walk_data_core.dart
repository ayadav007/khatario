import 'dart:convert';
import 'dart:io';

import 'walk_fixtures.dart';

/// A real reply captured from staging and trimmed to one or two rows (test/fixtures/walk).
Object? walkFile(String name) => jsonDecode(File('test/fixtures/walk/$name.json').readAsStringSync());

const walkToday = '2026-11-10';
const walkNow = '2026-11-10T09:30:00.000Z';

Map<String, dynamic> _copy(Map<String, dynamic> m) => Map<String, dynamic>.from(jsonDecode(jsonEncode(m)) as Map);

/// A customer row, as `SELECT * FROM customers` returns it.
Map<String, dynamic> walkCustomer([String id = 'c1', String name = 'Anil Traders']) => {
      'id': id,
      'business_id': 'b1',
      'name': name,
      'company_name': '$name Pvt Ltd',
      'phone': '9876543210',
      'email': 'accounts@example.com',
      'gstin': '27AABCU9603R1ZM',
      'pan': 'AABCU9603R',
      'address': '12 Market Road',
      'billing_address': '12 Market Road, Pune',
      'shipping_address': '12 Market Road, Pune',
      'city': 'Pune',
      'state': 'Maharashtra',
      'state_code': '27',
      'pincode': '411001',
      'opening_balance': '1000.00',
      'opening_balance_type': 'receivable',
      'current_balance': '2500.00',
      'credit_limit': '50000.00',
      'credit_days': 30,
      'customer_type': 'b2b',
      'price_level_id': null,
      'is_active': true,
      'portal_enabled': false,
      'created_at': walkNow,
      'updated_at': walkNow,
    };

Map<String, dynamic> walkSupplier([String id = 's1', String name = 'Bharat Wholesale']) => {
      'id': id,
      'business_id': 'b1',
      'name': name,
      'company_name': '$name Pvt Ltd',
      'phone': '9876543211',
      'email': 'sales@example.com',
      'gstin': '27AAACB1234F1Z5',
      'pan': 'AAACB1234F',
      'address': '5 Industrial Area',
      'city': 'Mumbai',
      'state': 'Maharashtra',
      'state_code': '27',
      'pincode': '400001',
      'opening_balance': '0.00',
      'opening_balance_type': 'payable',
      'current_balance': '4200.00',
      'is_active': true,
      'linked_business_id': null,
      'allow_low_stock_access': false,
      'created_at': walkNow,
      'updated_at': walkNow,
    };

Map<String, dynamic> walkInvoiceRow([int n = 0]) {
  final rows = (walkFile('invoices_list') as Map)['invoices'] as List;
  final r = _copy(Map<String, dynamic>.from(rows[n % rows.length] as Map));
  r['customer_id'] = 'c1';
  r['customer_name'] = 'Anil Traders';
  return r;
}

Map<String, dynamic> walkPagination([int total = 2]) => {'page': 1, 'limit': 50, 'total': total, 'totalPages': 1};

/// The reply of a list route: [rows] under each of [keys], plus paging.
Map<String, dynamic> walkList(List<dynamic> rows, List<String> keys, [Map<String, dynamic> extra = const {}]) => {
      for (final k in keys) k: rows,
      'pagination': walkPagination(rows.length),
      'total': rows.length,
      'page': 1,
      'totalPages': 1,
      'hasMore': false,
      ...extra,
    };

void registerCore(WalkFixtures f) {
  // Shell
  f.get('/api/badges/counts', {'unpaid_invoices': 3, 'low_stock_items': 4});
  f.get('/api/businesses/my', {
    'businesses': [
      {'id': 'b1', 'name': 'Sharma Textiles', 'role': 'owner'},
      {'id': 'b2', 'name': 'Sharma Traders', 'role': 'owner'},
    ],
  });
  f.get('/api/notifications', {
    'notifications': [
      {
        'id': 'n1',
        'type': 'invoice',
        'title': 'Invoice viewed',
        'message': 'Anil Traders viewed INV-035',
        'is_read': false,
        'reference_type': 'invoice',
        'reference_id': 'inv1',
        'created_at': walkNow,
      },
      {
        'id': 'n2',
        'type': 'low_stock_alert',
        'title': 'Low stock',
        'message': 'Biryani Rice is running low',
        'is_read': true,
        'reference_type': 'item',
        'reference_id': 'item1',
        'created_at': walkNow,
      },
      for (final (i, t) in [
        ('invoice_overdue', 'invoice'),
        ('todo_reminder', 'todo'),
        ('store_enquiry', 'store_enquiry'),
        ('gst_compliance', 'gst'),
        ('supplier_request', 'supplier_request'),
        ('general', 'whatsapp_conversation'),
        ('general', 'whatsapp_lead'),
        ('general', 'supplier'),
      ].indexed)
        {
          'id': 'n${i + 3}',
          'type': t.$1,
          'title': 'Alert ${t.$1}',
          'message': 'Sample ${t.$2} alert',
          'is_read': true,
          'reference_type': t.$2,
          'reference_id': t.$2 == 'invoice' ? 'inv1' : 'ref1',
          'created_at': walkNow,
        },
    ],
    'unreadCount': 1,
    'unread_count': 1,
    'stream_cursor': '2',
  });
  f.get('/api/promotions/active', {'promotions': []});
  f.get('/api/subscriptions/current', (_) => walkFile('subscription_current'));
  f.get('/api/subscriptions/feature-plan', (_) => walkFile('subscription_feature_plan'));
  f.get('/api/subscriptions/check-limit', {'allowed': true, 'current': 3, 'limit': 100});
  f.get('/api/subscriptions/limit-plan', {'requiredPlan': (walkFile('subscription_feature_plan') as Map)['requiredPlan']});

  // Dashboard
  f.get('/api/dashboard/overview', (_) => walkFile('dash_overview'));
  f.get('/api/dashboard/sales-trend', (_) => walkFile('dash_sales_trend'));
  f.get('/api/dashboard/recent-transactions', (_) => walkFile('dash_recent'));
  f.get('/api/dashboard/cash-flow', (_) => walkFile('dash_cash_flow'));
  f.get('/api/dashboard/charts', {'chartData': []});
  f.get('/api/dashboard/widgets', {
    'widgets': [
      for (final (i, t) in [
        ('sales_summary', 'Sales'),
        ('recent_invoices', 'Recent Invoices'),
        ('top_customers', 'Top Customers'),
        ('cash_flow', 'Cash Flow'),
        ('pending_payments', 'Pending Payments'),
        ('inventory_alerts', 'Inventory Alerts'),
        ('sales_chart', 'Sales Chart'),
        ('top_products', 'Top Products'),
        ('dead_stock', 'Dead Stock'),
      ].indexed)
        {
          'id': 'widget-$i',
          'size': {'width': 1, 'height': 1},
          'type': t.$1,
          'title': t.$2,
          'position': {'x': 0, 'y': i},
        },
    ],
  });
  f.get('/api/dashboard/sales-summary', (_) => walkFile('dash_sales_summary'));
  f.get('/api/dashboard/recent-invoices', (_) => walkFile('dash_recent_invoices'));
  f.get('/api/dashboard/top-customers', (_) => walkFile('dash_top_customers'));
  f.get('/api/dashboard/receivables', (_) => walkFile('dash_receivables'));
  f.get('/api/dashboard/low-stock', (_) => walkFile('dash_low_stock'));
  f.get('/api/dashboard/top-products', (_) => walkFile('dash_top_products'));
  f.get('/api/dashboard/dead-stock', (_) => walkFile('dash_dead_stock'));
  f.get('/api/dashboard/dead-stock/suggestions', {'suggestions': []});

  // Invoices
  f.get('/api/invoices', (u) {
    final list = walkFile('invoices_list') as Map<String, dynamic>;
    return {...list, 'invoices': [for (var i = 0; i < 2; i++) walkInvoiceRow(i)]};
  });
  f.get('/api/invoices/for-reminders', {
    'invoices': [walkInvoiceRow(0)..['days_overdue'] = 12],
    'pagination': walkPagination(1),
  });
  f.get('/api/invoices/next-number', {'invoice_number': 'INV-036', 'next_number': 'INV-036'});
  f.get('/api/invoices/:id', (_) => walkFile('invoice_detail'));
  f.get('/api/invoices/:id/history', (_) => walkFile('invoice_history'));
  f.get('/api/invoices/:id/public-link', {'url': 'https://khatario.com/i/abc123', 'link': 'https://khatario.com/i/abc123', 'token': 'abc123'});

  // Items
  f.get('/api/items', (_) => walkFile('items_list'));
  f.get('/api/items/search', (_) => {'items': (walkFile('items_list') as Map)['items']});
  f.get('/api/items/labelable', (_) => {'items': (walkFile('items_list') as Map)['items']});
  f.get('/api/items/units', {'units': {}});
  f.get('/api/items/:id', (_) => walkFile('item_detail'));
  f.get('/api/items/:id/transactions', (_) => walkFile('item_transactions'));
  f.get('/api/items/:id/history', {'history': []});
  f.get('/api/items/:id/units', {'units': []});
  f.get('/api/categories', {
    'categories': [
      {'id': 'cat1', 'name': 'Rice', 'parent_id': null, 'item_count': 3},
    ],
  });

  // Parties
  f.get('/api/customers', walkList([walkCustomer(), walkCustomer('c2', 'Meera Stores')], ['customers']));
  f.get('/api/suppliers', walkList([walkSupplier(), walkSupplier('s2', 'Kiran Agencies')], ['suppliers']));

  f.get('/api/search', {
    'results': [
      {'type': 'customer', 'id': 'c1', 'title': 'Anil Traders', 'subtitle': '9876543210', 'label': 'Anil Traders'},
      {'type': 'item', 'id': 'item1', 'title': 'BIRYANI RICE', 'subtitle': 'KGS', 'label': 'BIRYANI RICE'},
    ],
  });
}

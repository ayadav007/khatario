import 'walk_data_core.dart';
import 'walk_fixtures.dart';

// Settings, plan, Supplier Hub, tools and the reports overview. Business, defaults, orders and store replies are
// copied from settings_golden_test; the Supplier Hub rows from hub_test.

void registerSettings(WalkFixtures f) {
  f.get('/api/businesses/:id', {
    'business': {
      'id': 'b1',
      'name': 'Sharma Textiles',
      'phone': '9822041567',
      'email': 'accounts@sharmatextiles.in',
      'address_line1': 'Shop 14, Laxmi Road',
      'city': 'Pune',
      'state': 'Maharashtra',
      'pincode': '411002',
      'gstin': '27AAKFS4821M1Z3',
      'pan': 'AAKFS4821M',
      'gst_registration_type': 'regular',
      'aggregate_turnover_above_5cr': false,
      'logo_url': null,
      'signature_url': null,
    },
  });
  f.get('/api/branches', {
    'branches': [
      {'id': 'br1', 'name': 'Pune (main)', 'is_active': true, 'is_default': true, 'city': 'Pune', 'gstin': '27AAKFS4821M1Z3'},
    ],
  });
  f.get('/api/payment-methods', {
    'methods': [
      {'id': 'pm1', 'type': 'upi', 'method_type': 'upi', 'name': 'UPI', 'upi_id': 'sharma@upi', 'is_active': true, 'is_default': true},
    ],
  });
  f.get('/api/settings/payment-providers', {
    'providers': [
      {'provider': 'razorpay', 'name': 'Razorpay', 'configured': false, 'is_active': false},
    ],
    'settings': {},
  });
  f.get('/api/settings/payments', {'settings': {}, 'upi_id': 'sharma@upi'});
  f.get('/api/settings/invoice-defaults', {
    'defaults': {'dueDays': 15, 'pricesIncludeGst': true, 'roundOff': true, 'quantityDecimals': 2, 'notes': 'Thank you!', 'terms': '', 'lowStockAlert': 5},
  });
  f.get('/api/settings/product-variants', {'product_variants_enabled': true});
  f.get('/api/settings/document-language', {'document_language': 'en', 'can_change': false});
  f.get('/api/settings/number-series', {
    'branches': [
      {'id': 'br1', 'is_default': true, 'invoice_prefix': 'INV-', 'next_numbers': {'tax_invoice': 248, 'bill_of_supply': 1, 'proforma_invoice': 31}},
    ],
    'branchPrefixes': <String, dynamic>{},
  });
  f.get('/api/settings/item-sales-stock', {
    'settings': {'allow_sale_when_out_of_stock': false, 'low_stock_alert': 5},
    'allow_sale_when_out_of_stock': false,
  });
  f.get('/api/orders/settings', {
    'settings': {
      'notify': {'confirmed': true, 'packed': false, 'ready_for_pickup': true, 'shipped': true, 'out_for_delivery': true, 'delivered': true, 'delivery_failed': true, 'cancelled': true},
      'dispatchSlaHours': 24,
      'merchantDispatchAlert': false,
      'autoTrackShippedBills': true,
      'stuckNoticeDays': 3,
    },
  });
  f.get('/api/settings/online-store', {
    'store_subdomain': 'sharmatextiles',
    'store_enabled': true,
    'store_min_order_amount': 499,
    'store_allow_cod': true,
    'store_delivery_provider': 'shiprocket',
    'store_return_window_days': 7,
    'shiprocket_configured': true,
    'shiprocket_webhook_configured': true,
  });
  f.get('/api/settings/portal-theme', {'theme': {'primary': '#0d9488'}, 'primary_color': '#0d9488'});
  f.get('/api/settings/customer-surface', {'enabled': true, 'portal_enabled': true, 'settings': {}});
  f.get('/api/custom-fields', {
    'fields': [
      {'id': 'cf1', 'field_name': 'Batch no', 'field_type': 'text', 'entity_type': 'item', 'is_required': false, 'options': <Object>[]},
    ],
  });
  f.get('/api/template-catalog', {
    'templates': [
      {'id': 'tpl1', 'name': 'Classic', 'documentTypes': ['tax_invoice'], 'is_premium': false},
    ],
  });
  f.get('/api/template-assignments', {
    'assignments': [
      {'document_type': 'tax_invoice', 'template_id': null},
    ],
  });
  f.get('/api/financial-years', {
    'years': [
      {'id': 'fy1', 'name': 'FY 2026-27', 'start_date': '2026-04-01', 'end_date': '2027-03-31', 'is_current': true, 'is_closed': false},
    ],
    'financialYears': [
      {'id': 'fy1', 'name': 'FY 2026-27', 'start_date': '2026-04-01', 'end_date': '2027-03-31', 'is_current': true, 'is_closed': false},
    ],
  });
  f.get('/api/period-locks', {
    'locks': [
      {'id': 'pl1', 'lock_date': '2026-09-30', 'locked_until': '2026-09-30', 'reason': 'GST filed'},
    ],
    'periodLocks': [
      {'id': 'pl1', 'lock_date': '2026-09-30', 'locked_until': '2026-09-30', 'reason': 'GST filed'},
    ],
  });
  f.get('/api/settings/account-mappings', {
    'mappings': {'sales': 'a3'},
    'settings': {},
  });
  f.get('/api/settings/users', {
    'users': [
      {'id': 'u1', 'name': 'Rakesh Sharma', 'email': 'rakesh@example.com', 'role': 'owner', 'role_name': 'Owner', 'is_active': true, 'is_primary_admin': true, 'seat_type': 'full'},
      {'id': 'u2', 'name': 'Asha Rao', 'email': 'asha@example.com', 'role': 'staff', 'role_name': 'Accountant', 'is_active': true, 'is_primary_admin': false, 'seat_type': 'full'},
    ],
  });
  f.get('/api/settings/roles', {
    'roles': [
      {'id': 'r1', 'name': 'Accountant', 'role_name': 'Accountant', 'description': 'Books and GST', 'user_count': 1, 'permissions': <String, dynamic>{}},
    ],
  });
  f.get('/api/modules', {
    'modules': [
      {'id': 'billing', 'name': 'Billing', 'enabled': true},
      {'id': 'connect', 'name': 'Connect', 'enabled': true},
      {'id': 'hr', 'name': 'HR', 'enabled': true},
    ],
  });
  f.get('/api/backup/schedule', {
    'schedule': {'enabled': false, 'frequency': 'daily', 'hour': 2},
  });
  f.get('/api/subscriptions/modules/current', {
    'modules': [
      {'id': 'billing', 'name': 'Billing', 'active': true},
    ],
    'addons': <Object>[],
  });
  f.get('/api/subscriptions/billing-history', {
    'history': [
      {'id': 'bh1', 'amount': 999, 'status': 'paid', 'created_at': walkNow, 'description': 'Growth plan'},
    ],
    'invoices': <Object>[],
  });
  f.get('/api/subscriptions/plans', {
    'plans': [
      {'id': 'pl-free', 'name': 'Free', 'price': 0, 'plan_name': 'Free', 'features': <Object>[]},
      {'id': 'pl-grow', 'name': 'Growth', 'price': 999, 'plan_name': 'Growth', 'features': <Object>[]},
    ],
  });

  // WhatsApp-linked settings
  f.get('/api/settings/whatsapp-templates', {
    'templates': [
      {'id': 'wt1', 'name': 'payment_reminder', 'status': 'APPROVED', 'category': 'UTILITY', 'language': 'en', 'body': 'Hello {{1}}, your bill is due.'},
    ],
  });
  f.get('/api/settings/email', {'config': {'enabled': false, 'host': ''}, 'configured': false});

  f.get('/api/offline-sync/history', {
    'history': [
      {'id': 'os1', 'action': 'Created invoice INV-036', 'entity': 'invoice', 'status': 'synced', 'created_at': walkNow},
    ],
  });

  // Tools
  f.get('/api/todos', (_) => walkFile('todos'));
  f.get('/api/todos/stats', {'total': 2, 'completed': 0, 'pending': 2, 'overdue': 0, 'due_today': 1});
  f.get('/api/todos/users', {
    'users': [
      {'id': 'u1', 'name': 'Rakesh Sharma'},
    ],
  });
  f.get('/api/todos/:id', {'todo': (walkFile('todos') as List).first});
  f.get('/api/hsn/lookup', {
    'results': [
      {'code': '1006', 'description': 'Rice', 'gst_rate': 5},
    ],
  });
  f.get('/api/gstin/lookup', {'legal_name': 'Anil Traders', 'trade_name': 'Anil Traders', 'address': '12 Market Road', 'city': 'Pune', 'state': 'Maharashtra', 'pincode': '411001', 'state_code': '27', 'api_configured': true});

  // Reports overview tiles and statements
  f.get('/api/reports/sales-summary', {
    'summary': {'total_sales': 125000, 'invoice_count': 12},
  });
  f.get('/api/reports/purchase-summary', {
    'summary': {'total_amount': 64000, 'bill_count': 5},
  });
  f.get('/api/reports/profit-loss', {
    'net_profit': 22000,
    'sections': [
      {'key': 'income', 'title': 'Income', 'total': 125000, 'accounts': [{'id': 'a3', 'account_code': '4001', 'account_name': 'Sales', 'amount': 125000}]},
      {'key': 'expense', 'title': 'Expenses', 'total': 103000, 'accounts': [{'id': 'a5', 'account_code': '5201', 'account_name': 'Rent expense', 'amount': 103000}]},
    ],
    'total_income': 125000,
    'total_expense': 103000,
  });
  f.get('/api/reports/profit-loss/drilldown', {
    'entries': [
      {'id': 'e1', 'entry_date': '2026-11-03', 'narration': 'Sale INV-7', 'debit': 0, 'credit': 500, 'voucher_number': 'INV-7'},
    ],
    'lines': [
      {'id': 'e1', 'entry_date': '2026-11-03', 'narration': 'Sale INV-7', 'debit': 0, 'credit': 500, 'voucher_number': 'INV-7'},
    ],
    'total': 500,
  });
  f.get('/api/reports/balance-sheet', {
    'sections': [
      {'key': 'assets', 'title': 'Assets', 'total': 80000, 'accounts': [{'id': 'a1', 'account_code': '1001', 'account_name': 'Cash in hand', 'amount': 80000}]},
      {'key': 'liabilities', 'title': 'Liabilities', 'total': 80000, 'accounts': [{'id': 'a9', 'account_code': '2001', 'account_name': 'Capital', 'amount': 80000}]},
    ],
    'total_assets': 80000,
    'total_liabilities': 80000,
  });
  f.get('/api/reports/trial-balance', {
    'accounts': [
      {'id': 'a1', 'account_code': '1001', 'account_name': 'Cash in hand', 'account_type': 'asset', 'debit': 80000, 'credit': 0},
      {'id': 'a9', 'account_code': '2001', 'account_name': 'Capital', 'account_type': 'liability', 'debit': 0, 'credit': 80000},
    ],
    'total_debit': 80000,
    'total_credit': 80000,
  });
  f.get('/api/reports/cash-flow', (_) => walkFile('dash_cash_flow'));
  final aging = {
    'buckets': [
      {'label': '0-30', 'amount': 4000},
      {'label': '31-60', 'amount': 1500},
    ],
    'rows': [
      {'party_id': 'c1', 'party_name': 'Anil Traders', 'customer_name': 'Anil Traders', 'supplier_name': 'Bharat Wholesale', 'current': 1000, 'd1_30': 2000, 'd31_60': 1500, 'd61_90': 0, 'd90_plus': 0, 'total': 4500, 'balance': 4500},
    ],
    'summary': {'total': 4500},
    'total': 4500,
  };
  f.get('/api/reports/aging/:kind', aging);

  // Supplier Hub
  f.get('/api/suppliers/hub/home', {
    'inbox': [
      {'key': 'k1', 'kind': 'order', 'title': 'Order proposed', 'detail': 'Good Day 75g x 3', 'href': '/supply-orders/o1', 'side': 'buying', 'action': 'Review', 'orderId': 'o1'},
    ],
    'roles': {'buying': true, 'selling': true},
    'access': {'buying': true, 'selling': true},
    'buying': {'openOrders': 2, 'billsToReceive': 1, 'newCollections': 1},
    'selling': {'openOrders': 1},
  });
  final orderRow = {
    'id': 'o1',
    'status': 'proposed',
    'origin': 'suggested',
    'supplier_name': 'Sharma Traders',
    'buyer_name': 'Me',
    'business_name': 'Sharma Traders',
    'other_business_name': 'Sharma Traders',
    'line_count': 1,
    'updated_at': walkNow,
    'mine': true,
  };
  f.get('/api/supply-orders', {
    'orders': [orderRow],
  });
  f.get('/api/supply-orders/suggest', {'orders': [orderRow]});
  f.get('/api/supply-orders/:id', {
    'role': 'buyer',
    'order': orderRow,
    'lines': [
      {'id': 'ol1', 'item_name': 'Good Day 75g', 'qty': 3, 'confirmed_qty': null, 'factor': 12, 'buyer_item_name': 'Good Day 75g', 'buyer_unit': 'PCS', 'buyer_current_stock': 4, 'vendor_item_name': 'Good Day 75g', 'vendor_unit': 'CTN', 'vendor_current_stock': 20, 'unit_price': 480, 'min_stock': 10},
    ],
  });
  f.get('/api/supply-orders/:id/comments', {
    'comments': [
      {'id': 'cm1', 'body': 'Please confirm by Friday', 'name': 'Sharma Traders', 'created_at': walkNow},
    ],
  });
  f.get('/api/supply-orders/:id/invoice-draft', {'lines': <Object>[]});
  f.get('/api/suppliers/hub/directory', {
    'businesses': [
      {
        'id': 'hb1',
        'name': 'Sharma Traders',
        'display_name': 'Sharma Traders',
        'city': 'Pune',
        'state': 'Maharashtra',
        'district': 'Pune',
        'gstin': '27AAKFS4821M1Z3',
        'is_linked': false,
        'pending_request_id': null,
        'featured_categories': ['Biscuits'],
        'trust': {'score': 80},
        'profile_summary': 'Wholesale biscuits',
      },
    ],
  });
  f.get('/api/suppliers/hub/profile/:id', {
    'business': {'id': 'hb1', 'name': 'Sharma Traders', 'city': 'Pune', 'state': 'Maharashtra', 'phone': '9876543210', 'email': 'sales@example.com'},
    'discovery': {'featured_categories': ['Biscuits'], 'lead_time_text': '2 days'},
    'listings': [
      {'id': 'pl1', 'item_name': 'Good Day 75g', 'price_display': '₹480', 'moq': 1},
    ],
    'viewer': {'is_linked': false},
  });
  f.get('/api/suppliers/hub/connection-requests', {
    'incoming': [
      {'id': 'cr1', 'status': 'pending', 'business_name': 'Gupta Stores', 'name': 'Gupta Stores', 'message': 'Please connect', 'created_at': walkNow, 'counterparty_name': 'Gupta Stores', 'email': 'gupta@example.com', 'phone': '9876543210'},
    ],
    'outgoing': <Object>[],
  });
  f.get('/api/suppliers/hub/connection-requests/:id', {
    'request': {'id': 'cr1', 'status': 'pending', 'business_name': 'Gupta Stores'},
    'matches': <Object>[],
  });
  f.get('/api/suppliers/hub/new-arrivals', {
    'collections': [
      {
        'id': 'nc1',
        'name': 'Festive biscuits',
        'description': 'Diwali range',
        'season': 'Diwali',
        'supplier_id': 's1',
        'supplier_name': 'Sharma Traders',
        'items': [
          {'id': 'ni1', 'name': 'Festive pack', 'price': 250, 'moq': 6, 'unit': 'PCS', 'order_multiple': 6, 'pack_label': 'Box of 6', 'lead_time_text': '3 days', 'vendor_item_id': 'vi1', 'my_item_name': null},
        ],
      },
    ],
    'suppliers': [
      {'id': 's1', 'name': 'Sharma Traders', 'mute_launches': false},
    ],
    'catalog': <Object>[],
  });
  f.get('/api/suppliers/hub/published-listings', {
    'listings': [
      {'id': 'pl1', 'item_name': 'Good Day 75g', 'display_name': 'Good Day 75g', 'label': 'Good Day 75g', 'price': 480, 'moq': 1, 'order_multiple': 1, 'pack_label': 'Box', 'is_active': true, 'image_url': null},
    ],
  });
  f.get('/api/suppliers/hub/link', {'link': null, 'linked': false});
  f.get('/api/suppliers/dashboard', {
    'success': true,
    'low_stock_alerts': <Object>[],
    'stats': {'total_buyers': 3, 'low_stock_items': 4, 'open_orders': 2, 'total_value': 12000},
  });
  f.get('/api/suppliers/dashboard/analytics', {
    'areas': <Object>[],
    'pivot_items': ['Biscuits'],
    'rows': <Object>[],
  });
  f.get('/api/suppliers/thresholds', {
    'items': [
      {'item_id': 'item1', 'item_name': 'BIRYANI RICE', 'min_stock': 10, 'threshold': 10, 'current_stock': 3},
    ],
  });
  f.get('/api/suppliers/:id/items', {
    'items': [
      {'id': 'item1', 'name': 'BIRYANI RICE', 'unit': 'KGS'},
    ],
  });
  f.get('/api/suppliers/:id', {
    'supplier': walkSupplier(),
    'purchases': [
      {'id': 'pu1', 'bill_number': 'BILL-1', 'bill_date': '2026-11-03', 'grand_total': '5900.00', 'payment_status': 'unpaid', 'balance_amount': '5900.00'},
    ],
    'payments': [
      {'id': 'sp1', 'payment_number': 'PAY-9', 'payment_date': '2026-11-04', 'amount': '1700.00', 'payment_method': 'upi'},
    ],
    'totalPayable': 4200,
  });
  f.get('/api/suppliers/:id/history', {'history': <Object>[]});
  f.get('/api/customers/:id', {
    'customer': walkCustomer(),
    'transactions': [
      {'id': 'inv1', 'type': 'invoice', 'transaction_type': 'invoice', 'date': '2026-11-01', 'transaction_date': '2026-11-01', 'number': 'INV-035', 'reference': 'INV-035', 'amount': 74, 'debit': 74, 'credit': 0, 'balance': 74, 'status': 'unpaid'},
    ],
    'totalReceivable': 2500,
  });
  f.get('/api/customers/:id/history', {'history': <Object>[]});
  final ledger = {
    'opening_balance': 500,
    'closing_balance': 1250,
    'transactions': [
      {'reference_number': 'INV-9', 'transaction_date': '2026-10-03', 'transaction_type': 'invoice', 'description': 'Sale', 'debit': 1500, 'credit': 0, 'running_balance': 2000},
      {'reference_number': 'PAY-12', 'transaction_date': '2026-10-08', 'transaction_type': 'payment', 'description': 'UPI received', 'debit': 0, 'credit': 750, 'running_balance': 1250},
    ],
  };
  f.get('/api/reports/party/ledger', ledger);
  f.get('/api/reports/party/statement', {
    ...ledger,
    'party': {'id': 'c1', 'name': 'Anil Traders', 'phone': '9876543210', 'gstin': '27AABCU9603R1ZM', 'address': '12 Market Road, Pune'},
    'business': {'name': 'Sharma Textiles', 'gstin': '27AAKFS4821M1Z3', 'phone': '9822041567'},
    'from_date': '2026-10-01',
    'to_date': '2026-10-31',
  });
}

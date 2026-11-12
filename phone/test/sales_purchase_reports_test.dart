import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/invoices/invoice_detail_screen.dart';
import 'package:khatario_phone/screens/invoices/invoice_form_screen.dart';
import 'package:khatario_phone/screens/items/item_detail_screen.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/parties/customer_detail_screen.dart';
import 'package:khatario_phone/screens/parties/supplier_detail_screen.dart';
import 'package:khatario_phone/screens/payments/payment_in_screen.dart';
import 'package:khatario_phone/screens/purchases/purchase_section.dart';
import 'package:khatario_phone/screens/reports/other_reports.dart';
import 'package:khatario_phone/screens/reports/purchase_reports.dart';
import 'package:khatario_phone/screens/reports/reports_home_screen.dart';
import 'package:khatario_phone/screens/reports/sales_reports.dart';
import 'package:khatario_phone/screens/reports/table_report_screen.dart';
import 'package:khatario_phone/screens/sales/credit_debit_notes_screen.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/fake_session.dart';

/// Each reply below was written from the route and the function it calls (see the report), not recorded.
Map<String, dynamic> _fixture(String name) =>
    jsonDecode(File('test/fixtures/reports/$name.json').readAsStringSync()) as Map<String, dynamic>;

/// One report: the link, the fixture it is drawn from, the route and the query names it sends, the tiles
/// (label, figure) and the texts of its first row.
class _Case {
  const _Case(this.href, this.fixture, this.path, this.tiles, this.row, {this.query = const {'from_date', 'to_date'}});

  final String href, fixture, path;
  final Set<String> query;
  final List<(String, String)> tiles;
  final List<String> row;
}

const _cases = <_Case>[
  _Case('/reports/sales/summary', 'sales_summary', '/api/reports/sales/summary', [
    ('Net sales (excl. tax)', '₹25,300'),
    ('Credit notes', '₹1,200'),
    ('Tax', '₹4,554'),
    ('Net sales with tax', '₹29,854'),
    ('Invoices', '6'),
  ], ['08 Nov 2026', '₹17,300'], query: {'from_date', 'to_date', 'period'}),
  _Case('/reports/sales/invoice-wise', 'sales_invoice_wise', '/api/reports/sales/invoice-wise', [
    ('Posted invoices', '1'),
    ('Sales (excl. tax)', '₹10,000'),
    ('Sales with tax', '₹11,800'),
    ('Balance due', '₹6,800'),
    ('Drafts', '1'),
    ('Cancelled', '0'),
  ], ['INV-2026-0042', '₹11,800']),
  _Case('/reports/sales/item-wise', 'sales_item_wise', '/api/reports/sales/item-wise', [
    ('Quantity sold (net)', '32'),
    ('Amount (excl. tax)', '₹13,840'),
    ('Tax', '₹744'),
    ('Discount given', '₹120'),
  ], ['Basmati Rice 5kg', '₹13,440']),
  _Case('/reports/sales/party-wise', 'sales_party_wise', '/api/reports/sales/party-wise', [
    ('Net sales (excl. tax)', '₹25,300'),
    ('Net sales with tax', '₹29,854'),
    ('Balance due', '₹6,544'),
    ('Invoices', '6'),
  ], ['Sharma Traders', '₹20,800']),
  _Case('/reports/sales/tax-wise', 'sales_tax_wise', '/api/reports/sales/tax-wise', [
    ('Taxable value', '₹33,440'),
    ('Total tax', '₹4,272'),
    ('CGST', '₹2,136'),
    ('SGST', '₹2,136'),
    ('IGST', '₹0'),
  ], ['18%', '₹3,600']),
  _Case('/reports/sales/payment-mode', 'sales_payment_mode', '/api/reports/sales/payment-mode', [
    ('Invoices', '12'),
    ('Total amount', '₹31,064.50'),
  ], ['Upi', '₹18,400']),
  _Case('/reports/sales/discount', 'sales_discount', '/api/reports/sales/discount', [
    ('Invoices', '2'),
    ('Total subtotal', '₹12,800'),
    ('Total discount', '₹640'),
    ('Average discount %', '5'),
  ], ['INV-2026-0042', '₹600']),
  _Case('/reports/sales/credit', 'sales_credit', '/api/reports/sales/credit', [
    ('Invoices', '2'),
    ('Total sales', '₹16,000'),
    ('Outstanding', '₹11,000'),
    ('Overdue', '₹6,800'),
  ], ['INV-2026-0036', '₹6,800']),
  _Case('/reports/sales/cancelled', 'sales_cancelled', '/api/reports/sales/cancelled', [
    ('Cancelled', '1'),
    ('Total amount', '₹2,360'),
    ('Total tax', '₹360'),
  ], ['INV-2026-0038', '₹2,360']),
  _Case('/reports/sales/returns', 'sales_returns', '/api/reports/sales/returns', [
    ('Returns', '1'),
    ('Total amount', '₹1,416'),
    ('Total refunded', '₹0'),
    ('Refund pending', '1'),
  ], ['CN-2026-0007', '₹1,416']),
  _Case('/reports/sales/b2b-b2c', 'sales_b2b_b2c', '/api/reports/sales/b2b-b2c', [
    ('Invoices', '6'),
    ('Total sales', '₹31,270'),
    ('Total tax', '₹4,770'),
    ('Total pending', '₹6,500'),
  ], ['B2B', '₹25,960']),
  _Case('/reports/purchase/summary', 'purchase_summary', '/api/reports/purchase/summary', [
    ('Net purchases (excl. tax)', '₹20,000'),
    ('Purchase returns', '₹1,000'),
    ('Input tax', '₹2,820'),
    ('Balance due', '₹6,520'),
    ('Bills', '3'),
  ], ['09 Nov 2026', '₹14,000'], query: {'from_date', 'to_date', 'period'}),
  _Case('/reports/purchase/invoice-wise', 'purchase_invoice_wise', '/api/reports/purchase/invoice-wise', [
    ('Posted bills', '1'),
    ('Purchases (excl. tax)', '₹9,000'),
    ('Purchases with tax', '₹10,620'),
    ('Balance due', '₹5,620'),
    ('Drafts', '1'),
    ('Cancelled', '0'),
  ], ['BILL-2026-0018', '₹10,620']),
  _Case('/reports/purchase/supplier-wise', 'purchase_supplier_wise', '/api/reports/purchase/supplier-wise', [
    ('Net purchases (excl. tax)', '₹20,000'),
    ('Net purchases with tax', '₹22,820'),
    ('Balance due', '₹6,520'),
    ('Bills', '3'),
  ], ['Agro Wholesale Co', '₹14,000']),
  _Case('/reports/purchase/item-wise', 'purchase_item_wise', '/api/reports/purchase/item-wise', [
    ('Quantity purchased (net)', '58'),
    ('Goods amount (excl. tax)', '₹20,000'),
    ('Incidental freight (net, excl. tax)', '₹500'),
    ('Independent services (excl. tax)', '₹250'),
  ], ['Basmati Rice 5kg', '₹19,680']),
  _Case('/reports/purchase/returns', 'purchase_returns', '/api/reports/purchase/returns', [
    ('Returns', '1'),
    ('Returned (excl. tax)', '₹1,000'),
    ('Returned with tax', '₹1,180'),
    ('Refunded', '₹0'),
  ], ['PR-2026-0003', '₹1,180']),
  _Case('/reports/purchase/credit', 'purchase_credit', '/api/reports/purchase/credit', [
    ('Unpaid bills', '2'),
    ('Bill total', '₹13,620'),
    ('Outstanding', '₹8,620'),
    ('Overdue', '₹3,000'),
  ], ['BILL-2026-0018', '₹5,620']),
  _Case('/reports/purchase/tax-wise', 'purchase_tax_wise', '/api/reports/purchase/tax-wise', [
    ('Taxable value', '₹27,680'),
    ('Input tax', '₹2,424'),
    ('CGST', '₹1,212'),
    ('SGST', '₹1,212'),
    ('IGST', '₹0'),
  ], ['18%', '₹1,440']),
  _Case('/reports/profit-by-invoice', 'profit_by_invoice', '/api/reports/profit-by-invoice', [], ['INV-2026-0042', '₹2,600', '-₹20'],
      query: {'start_date', 'end_date'}),
  _Case('/reports/deleted', 'deleted_items', '/api/reports/deleted-items', [], ['INV-2026-0035', '₹2,360', 'BILL-2026-0009'], query: {}),
  _Case('/reports/credit-risk', 'credit_risk', '/api/reports/credit-risk', [
    ('Total receivables', '₹18,500'),
    ('Total payables', '₹9,200'),
    ('Parties over limit', '1'),
  ], ['Sharma Traders', '₹12,500', 'Agro Wholesale Co'], query: {}),
  _Case('/reports/inter-branch-reconciliation', 'inter_branch', '/api/reports/inter-branch-reconciliation', [
    ('Inter-branch receivables', '₹15,000'),
    ('Inter-branch payables', '₹14,000'),
    ('Difference', '₹1,000'),
  ], ['Main Branch', '₹15,000', 'Pune Branch', 'Transfer to Pune'], query: {'as_on_date'}),
  _Case('/reports/label-print-log', 'label_print_log', '/api/reports/label-print-log', [
    ('Print jobs', '2'),
    ('Labels printed', '144'),
  ], ['Purchase / GRN', '120 labels'], query: {'from', 'to'}),
];

Widget? _screen(AppSession s, String href) => salesReportScreen(s, href) ?? purchaseReportScreen(s, href) ?? otherReportScreen(s, href);

const _menu = {
  'sections': [
    {
      'title': 'Reports',
      'items': [
        {'href': '/reports/sales/summary', 'label': 'Sales Summary', 'locked': false},
        {'href': '/reports/purchase/summary', 'label': 'Purchase Summary', 'locked': false},
      ],
    },
  ],
};

Object? Function(RequestOptions) _reply(Map<String, String> fixtureByPath) => (o) {
      final name = fixtureByPath[o.uri.path];
      return name == null ? <String, dynamic>{} : _fixture(name);
    };

Future<List<RequestOptions>> _openCase(WidgetTester t, _Case c) async {
  t.view.physicalSize = const Size(800, 3200);
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.reset);
  final (s, sent) = fakeSession(_reply({c.path: c.fixture}));
  await t.pumpWidget(MaterialApp(home: _screen(s, c.href)!));
  await t.pumpAndSettle();
  return sent;
}

/// Opens [href] from its own fixture, taps [rowText] and lets the pushed screen start.
Future<void> _tapRow(WidgetTester t, String href, String rowText) async {
  final c = _cases.firstWhere((c) => c.href == href);
  await _openCase(t, c);
  await t.tap(find.text(rowText));
  await t.pump();
  await t.pump(const Duration(milliseconds: 400));
}

void main() {
  test('every sales, purchase and other report href has a spec, a native screen', () {
    final (s, _) = fakeSession((_) => {});
    final hrefs = [...salesReportHrefs, ...purchaseReportHrefs, ...otherReportHrefs];
    expect(salesReportHrefs.length, 11);
    expect(purchaseReportHrefs.length, 7);
    expect(otherReportHrefs.length, 5);
    expect(hrefs.toSet(), _cases.map((c) => c.href).toSet());
    for (final href in hrefs) {
      expect(_screen(s, href), isA<TableReportScreen>(), reason: href);
      expect(nativeScreenFor(s, href), isA<TableReportScreen>(), reason: href);
      expect(routeTier(s, href), RouteTier.native, reason: href);
    }
    expect(nativeScreenFor(s, '/reports/sales/unknown'), isNull);
  });

  for (final c in _cases) {
    testWidgets('${c.href}: ${c.path} with the route\'s query names, the server totals and the first row', (t) async {
      final sent = await _openCase(t, c);
      expect(sent, hasLength(1));
      final uri = sent.single.uri;
      expect(uri.path, c.path);
      expect(uri.queryParameters.keys.toSet(), c.query);
      for (final k in ['business_id', 'user_id', 'created_by']) {
        expect(uri.queryParameters.containsKey(k), isFalse, reason: k);
      }
      for (final (label, figure) in c.tiles) {
        expect(find.text(label), findsWidgets, reason: label);
        expect(find.text(figure), findsWidgets, reason: '$label $figure');
      }
      for (final text in c.row) {
        expect(find.text(text), findsWidgets, reason: text);
      }
    });
  }

  group('period query', () {
    testWidgets('label print log sends from and to as the website does, ending at 23:59:59', (t) async {
      final sent = await _openCase(t, _cases.last);
      final q = sent.single.uri.queryParameters;
      expect(q['from'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
      expect(q['to'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}T23:59:59$')));
      expect(q.containsKey('from_date'), isFalse);
    });

    testWidgets('sales reports send a month-to-date range', (t) async {
      final sent = await _openCase(t, _cases.first);
      final q = sent.single.uri.queryParameters;
      expect(q['from_date'], matches(RegExp(r'^\d{4}-\d{2}-01$')));
      expect(q['to_date'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
    });

    testWidgets('inter-branch reconciliation sends as_on_date', (t) async {
      final sent = await _openCase(t, _cases.firstWhere((c) => c.href == '/reports/inter-branch-reconciliation'));
      expect(sent.single.uri.queryParameters['as_on_date'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
    });
  });

  group('rows open the record', () {
    for (final (href, row) in [
      ('/reports/sales/invoice-wise', 'INV-2026-0042'),
      ('/reports/sales/discount', 'INV-2026-0042'),
      ('/reports/sales/credit', 'INV-2026-0036'),
      ('/reports/sales/cancelled', 'INV-2026-0038'),
      ('/reports/profit-by-invoice', 'INV-2026-0042'),
    ]) {
      testWidgets('$href opens the invoice', (t) async {
        await _tapRow(t, href, row);
        expect(find.byType(InvoiceDetailScreen), findsOneWidget);
        final screen = t.widget<InvoiceDetailScreen>(find.byType(InvoiceDetailScreen));
        expect(screen.invoiceId, startsWith('5a1d0c10'));
      });
    }

    testWidgets('party-wise sales opens the customer; the walk-in row has no record', (t) async {
      await _tapRow(t, '/reports/sales/party-wise', 'Sharma Traders');
      expect(find.byType(CustomerDetailScreen), findsOneWidget);
      expect(t.widget<CustomerDetailScreen>(find.byType(CustomerDetailScreen)).customerId, startsWith('7c0a0c10'));
    });

    testWidgets('party-wise sales: a row without a customer does nothing', (t) async {
      await _tapRow(t, '/reports/sales/party-wise', 'Walk-in / Cash Sale');
      expect(find.byType(CustomerDetailScreen), findsNothing);
      expect(find.byType(TableReportScreen), findsOneWidget);
    });

    testWidgets('item-wise sales opens the item; a free-text line does nothing', (t) async {
      await _tapRow(t, '/reports/sales/item-wise', 'Basmati Rice 5kg');
      expect(find.byType(ItemDetailScreen), findsOneWidget);
      expect(t.widget<ItemDetailScreen>(find.byType(ItemDetailScreen)).itemId, startsWith('0c1d6f10'));
    });

    testWidgets('item-wise sales: a free-text line does nothing', (t) async {
      await _tapRow(t, '/reports/sales/item-wise', 'Delivery help');
      expect(find.byType(ItemDetailScreen), findsNothing);
    });

    testWidgets('sales returns open the credit note', (t) async {
      await _tapRow(t, '/reports/sales/returns', 'CN-2026-0007');
      expect(find.byType(NoteDetailScreen), findsOneWidget);
      expect(t.widget<NoteDetailScreen>(find.byType(NoteDetailScreen)).noteId, startsWith('9d0e0c10'));
    });

    for (final (href, row, path) in [
      ('/reports/purchase/invoice-wise', 'BILL-2026-0018', '/api/purchases/'),
      ('/reports/purchase/credit', 'BILL-2026-0018', '/api/purchases/'),
      ('/reports/purchase/returns', 'PR-2026-0003', '/api/purchase-returns/'),
    ]) {
      testWidgets('$href opens the purchase detail', (t) async {
        await _tapRow(t, href, row);
        expect(find.byType(PurchaseDetailScreen), findsOneWidget);
        expect(t.widget<PurchaseDetailScreen>(find.byType(PurchaseDetailScreen)).path, startsWith(path));
      });
    }

    testWidgets('supplier-wise purchases open the supplier', (t) async {
      await _tapRow(t, '/reports/purchase/supplier-wise', 'Agro Wholesale Co');
      expect(find.byType(SupplierDetailScreen), findsOneWidget);
      expect(t.widget<SupplierDetailScreen>(find.byType(SupplierDetailScreen)).supplierId, startsWith('8e3f0c10'));
    });

    testWidgets('item-wise purchases open the item', (t) async {
      await _tapRow(t, '/reports/purchase/item-wise', 'Basmati Rice 5kg');
      expect(find.byType(ItemDetailScreen), findsOneWidget);
    });

    testWidgets('tax-wise sales rows open a sheet of their columns', (t) async {
      await _tapRow(t, '/reports/sales/tax-wise', '18%');
      expect(find.text('HSN/SAC'), findsOneWidget);
      expect(find.text('8517'), findsOneWidget);
      expect(find.text('₹23,600'), findsOneWidget);
    });

  });

  group('deleted items', () {
    late List<RequestOptions> sent;

    Future<void> open(WidgetTester t, {Object? Function(RequestOptions)? post}) async {
      t.view.physicalSize = const Size(800, 3200);
      t.view.devicePixelRatio = 1;
      addTearDown(t.view.reset);
      final (s, log) = fakeSession((o) {
        if (o.method == 'POST') return post?.call(o) ?? {'success': true};
        return _fixture('deleted_items');
      });
      sent = log;
      await t.pumpWidget(MaterialApp(home: otherReportScreen(s, '/reports/deleted')!));
      await t.pumpAndSettle();
    }

    testWidgets('Restore asks first, posts once with the id only, then reloads the list', (t) async {
      await open(t);
      await t.tap(find.text('INV-2026-0035'));
      await t.pumpAndSettle();
      await t.tap(find.text('Restore'));
      await t.pumpAndSettle();
      expect(sent.where((o) => o.method == 'POST'), isEmpty, reason: 'asks before posting');
      expect(find.textContaining('Restore invoice'), findsOneWidget);
      await t.tap(find.text('Yes, restore'));
      await t.pumpAndSettle();
      final posts = sent.where((o) => o.method == 'POST').toList();
      expect(posts, hasLength(1));
      expect(posts.single.uri.path, '/api/invoices/restore');
      expect(posts.single.data, {'id': '5a1d0c10-0000-4000-8000-0000000000a9'});
      expect(sent.where((o) => o.method == 'GET'), hasLength(2), reason: 'list loaded again');
    });

    testWidgets('a purchase and a payment go to their own restore routes', (t) async {
      await open(t);
      await t.tap(find.text('BILL-2026-0009'));
      await t.pumpAndSettle();
      await t.tap(find.text('Restore'));
      await t.pumpAndSettle();
      await t.tap(find.text('Yes, restore'));
      await t.pumpAndSettle();
      expect(sent.firstWhere((o) => o.method == 'POST').uri.path, '/api/purchases/restore');
      await t.tap(find.text('Payment in · 2026-10-30'));
      await t.pumpAndSettle();
      await t.tap(find.text('Restore'));
      await t.pumpAndSettle();
      await t.tap(find.text('Yes, restore'));
      await t.pumpAndSettle();
      expect(sent.where((o) => o.method == 'POST').last.uri.path, '/api/payments/restore');
    });

    testWidgets('Not now posts nothing', (t) async {
      await open(t);
      await t.tap(find.text('INV-2026-0035'));
      await t.pumpAndSettle();
      await t.tap(find.text('Restore'));
      await t.pumpAndSettle();
      await t.tap(find.text('Not now'));
      await t.pumpAndSettle();
      expect(sent.where((o) => o.method == 'POST'), isEmpty);
    });

    testWidgets('a failed restore shows a message and does not reload the list', (t) async {
      await open(t, post: (o) => throw DioException(requestOptions: o, type: DioExceptionType.connectionError));
      await t.tap(find.text('INV-2026-0035'));
      await t.pumpAndSettle();
      await t.tap(find.text('Restore'));
      await t.pumpAndSettle();
      await t.tap(find.text('Yes, restore'));
      await t.pumpAndSettle();
      expect(sent.where((o) => o.method == 'POST'), hasLength(1));
      expect(sent.where((o) => o.method == 'GET'), hasLength(1));
    });
  });

  group('reports home', () {
    for (final label in ['Sales summary', 'Purchase summary']) {
      testWidgets('the $label row opens the native report', (t) async {
        t.view.physicalSize = const Size(800, 3000);
        t.view.devicePixelRatio = 1;
        addTearDown(t.view.reset);
        final fixtures = _reply({'/api/reports/sales/summary': 'sales_summary', '/api/reports/purchase/summary': 'purchase_summary'});
        final (s, _) = fakeSession((o) => switch (o.uri.path) {
              '/api/navigation/more' => _menu,
              '/api/reports/sales-summary' => {'summary': {'total_sales': 1}},
              '/api/reports/purchase-summary' => {'summary': {'total_amount': 1}},
              '/api/reports/expense/summary' => {'totals': {'total_amount': 1}},
              '/api/reports/profit-loss' => {'net_profit': 1},
              _ => fixtures(o),
            });
        await t.pumpWidget(MaterialApp(home: ReportsHomeScreen(session: s)));
        await t.pumpAndSettle();
        await t.scrollUntilVisible(find.text(label), 200, scrollable: find.byType(Scrollable).first);
        await t.tap(find.text(label));
        await t.pumpAndSettle();
        expect(find.byType(TableReportScreen), findsOneWidget, reason: label);
        expect(find.byType(ReportsHomeScreen), findsNothing);
      });
    }
  });

  group('filters', () {
    Future<List<RequestOptions>> openWith(WidgetTester t, String href, {Map<String, dynamic> Function(Map<String, dynamic>)? edit}) async {
      t.view.physicalSize = const Size(800, 3200);
      t.view.devicePixelRatio = 1;
      addTearDown(t.view.reset);
      final c = _cases.firstWhere((c) => c.href == href);
      final (s, sent) = fakeSession((o) {
        if (o.uri.path != c.path) return <String, dynamic>{};
        final f = _fixture(c.fixture);
        return edit == null ? f : edit(f);
      });
      await t.pumpWidget(MaterialApp(home: _screen(s, href)!));
      await t.pumpAndSettle();
      return sent;
    }

    Future<void> chip(WidgetTester t, String label) async {
      final f = find.widgetWithText(KChip, label);
      await t.ensureVisible(f);
      await t.pumpAndSettle();
      await t.tap(f);
      await t.pumpAndSettle();
    }

    for (final href in ['/reports/sales/summary', '/reports/purchase/summary']) {
      testWidgets('$href: period chips send period=day, week, month', (t) async {
        final sent = await openWith(t, href);
        expect(sent.last.uri.queryParameters['period'], 'day');
        await chip(t, 'Week');
        expect(sent.last.uri.queryParameters['period'], 'week');
        await chip(t, 'Month');
        expect(sent.last.uri.queryParameters['period'], 'month');
        expect(sent.last.uri.queryParameters.containsKey('business_id'), isFalse);
      });
    }

    for (final href in ['/reports/sales/invoice-wise', '/reports/purchase/invoice-wise']) {
      testWidgets('$href: status filter adds status, All removes it', (t) async {
        final sent = await openWith(t, href);
        expect(sent.last.uri.queryParameters.containsKey('status'), isFalse);
        await chip(t, 'Draft');
        expect(sent.last.uri.queryParameters['status'], 'draft');
        await chip(t, 'Cancelled');
        expect(sent.last.uri.queryParameters['status'], 'cancelled');
        await chip(t, 'Final');
        expect(sent.last.uri.queryParameters['status'], 'final');
        await chip(t, 'All');
        expect(sent.last.uri.queryParameters.containsKey('status'), isFalse);
      });
    }

    testWidgets('sales invoice-wise: source filter adds channel, All sources removes it', (t) async {
      final sent = await openWith(t, '/reports/sales/invoice-wise');
      await chip(t, 'Online store');
      expect(sent.last.uri.queryParameters['channel'], 'online_store');
      await chip(t, 'Sales order');
      expect(sent.last.uri.queryParameters['channel'], 'sales_order');
      await chip(t, 'All sources');
      expect(sent.last.uri.queryParameters.containsKey('channel'), isFalse);
    });

    testWidgets('sales invoice-wise: orders without a bill are noted above the list', (t) async {
      await openWith(t, '/reports/sales/invoice-wise', edit: (f) => {...f, 'unbilled_orders': {'count': 2, 'amount': 1500}});
      expect(find.textContaining('2 online store / WhatsApp orders worth ₹1,500'), findsOneWidget);
    });

    testWidgets('deleted items: type filter, and dates only after Choose dates', (t) async {
      final sent = await openWith(t, '/reports/deleted');
      expect(sent.last.uri.queryParameters, isEmpty);
      await chip(t, 'Invoices');
      expect(sent.last.uri.queryParameters, {'type': 'invoice'});
      await chip(t, 'Suppliers');
      expect(sent.last.uri.queryParameters['type'], 'supplier');
      await chip(t, 'All types');
      expect(sent.last.uri.queryParameters, isEmpty);
      await chip(t, 'Choose dates');
      final q = sent.last.uri.queryParameters;
      expect(q['date_from'], matches(RegExp(r'^\d{4}-\d{2}-01$')));
      expect(q['date_to'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
      expect(q.containsKey('from_date'), isFalse);
      await chip(t, 'All time');
      expect(sent.last.uri.queryParameters, isEmpty);
    });

    testWidgets('label print log: purpose filter, and a period bar that keeps ending at 23:59:59', (t) async {
      final sent = await openWith(t, '/reports/label-print-log');
      expect(sent.last.uri.queryParameters.containsKey('purpose'), isFalse);
      await chip(t, 'Purchase / GRN');
      expect(sent.last.uri.queryParameters['purpose'], 'purchase');
      await chip(t, 'Item Create');
      expect(sent.last.uri.queryParameters['purpose'], 'item_create');
      await chip(t, 'All');
      expect(sent.last.uri.queryParameters.containsKey('purpose'), isFalse);
      await chip(t, 'Last month');
      final q = sent.last.uri.queryParameters;
      expect(q['from'], matches(RegExp(r'^\d{4}-\d{2}-01$')));
      expect(q['to'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}T23:59:59$')));
    });

    testWidgets('credit risk: a customer row opens the customer, a supplier row the supplier', (t) async {
      await openWith(t, '/reports/credit-risk');
      await t.tap(find.text('Sharma Traders'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      expect(t.widget<CustomerDetailScreen>(find.byType(CustomerDetailScreen)).customerId, startsWith('7c0a0c10'));
      Navigator.of(t.element(find.byType(CustomerDetailScreen))).pop();
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      await t.tap(find.text('Agro Wholesale Co'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      expect(t.widget<SupplierDetailScreen>(find.byType(SupplierDetailScreen)).supplierId, startsWith('8e3f0c10'));
    });

    testWidgets('a customer opened from a report: + New under quotes opens a quotation form, + New under payments opens Payments in', (t) async {
      final (session, _) = fakeSession((o) => o.uri.path == '/api/customers/c1'
          ? {
              'customer': {'id': 'c1', 'name': 'Asha', 'phone': '9876543210', 'is_active': true},
              'transactions': [
                {'type': 'invoice', 'id': 'i1', 'ref_no': 'INV-1', 'date': '2026-11-01', 'amount': 100, 'balance_amount': 0, 'document_type': 'tax_invoice'},
              ],
              'totalReceivable': 0,
            }
          : <String, dynamic>{});
      late BuildContext host;
      await t.pumpWidget(MaterialApp(home: Builder(builder: (c) {
        host = c;
        return const Scaffold();
      })));
      reportOpenCustomer(host, session, 'c1');
      await t.pumpAndSettle();
      await t.tap(find.text('Transactions'));
      await t.pumpAndSettle();
      Future<void> tapNew(int index) async {
        await t.ensureVisible(find.text('+ New').at(index));
        await t.tap(find.text('+ New').at(index));
        await t.pumpAndSettle();
      }

      expect(find.text('+ New'), findsNWidgets(3));
      await tapNew(1);
      expect(find.byType(InvoiceFormScreen), findsOneWidget);
      Navigator.of(t.element(find.byType(InvoiceFormScreen))).pop();
      await t.pumpAndSettle();
      await tapNew(2);
      expect(find.byType(PaymentInScreen), findsOneWidget);
    });

    testWidgets('deleted items: without can_restore, Restore shows the upgrade sheet and posts nothing', (t) async {
      final sent = await openWith(t, '/reports/deleted', edit: (f) => {...f, 'can_restore': false});
      await t.tap(find.text('INV-2026-0035'));
      await t.pumpAndSettle();
      await t.tap(find.text('Restore'));
      await t.pumpAndSettle();
      expect(sent.where((o) => o.method == 'POST'), isEmpty);
      expect(find.text('Yes, restore'), findsNothing);
      expect(find.byType(BottomSheet), findsOneWidget);
    });
  });
}

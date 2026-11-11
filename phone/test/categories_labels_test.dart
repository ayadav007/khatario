import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/printing/thermal_printers.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/stock/item_categories_screen.dart';
import 'package:khatario_phone/screens/stock/print_labels_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support/finders.dart';
import 'support/recorded_session.dart';

const _refusal = 'Cannot delete category with existing items. Please reassign items first.';

/// `GET /api/categories` replies `{ categories: [{ id, name, description, item_count (a count, so text), size_chart }] }`.
List<Map<String, dynamic>> _cats() => [
      {'id': 'c1', 'name': 'Grocery', 'description': 'Food and staples', 'item_count': '3', 'size_chart': null},
      {'id': 'c2', 'name': 'Offers', 'description': null, 'item_count': '0', 'size_chart': null},
      {'id': 'c3', 'name': 'Shirts', 'description': null, 'item_count': '1', 'size_chart': {'columns': ['Size', 'Chest'], 'rows': [['S', '38'], ['M', '40']]}},
    ];

Handler _categoriesServer(List<Map<String, dynamic>> cats, {int failLoads = 0, String? failCode}) {
  var fails = failLoads;
  return (o, body) {
    if (o.method == 'GET' && o.uri.path == '/api/categories') {
      if (fails > 0) {
        fails--;
        return (failCode == null ? 500 : 403, {'error': 'Failed to fetch categories', 'code': ?failCode});
      }
      return (200, {'categories': cats});
    }
    if (o.method == 'POST' && o.uri.path == '/api/categories') {
      final made = {'id': 'new1', 'name': body['name'], 'description': body['description'], 'item_count': '0', 'size_chart': null};
      cats.add(made);
      return (201, {'category': made});
    }
    if (o.method == 'PATCH' && o.uri.path == '/api/categories') {
      return (200, {'category': {'id': body['id']}});
    }
    if (o.method == 'DELETE' && o.uri.path == '/api/categories') {
      final id = o.uri.queryParameters['id'];
      final row = cats.firstWhere((c) => c['id'] == id);
      if ((int.tryParse('${row['item_count']}') ?? 0) > 0) return (400, {'error': _refusal});
      cats.remove(row);
      return (200, {'success': true, 'message': 'Category deleted successfully'});
    }
    return (404, {'error': 'no route'});
  };
}

void main() {
  group('item categories', () {
    testWidgets('lists the categories with their item counts', (t) async {
      final (s, sent) = recordedSession(_categoriesServer(_cats()));
      await pumpScreen(t, ItemCategoriesScreen(session: s));
      expect(find.text('Grocery'), findsOneWidget);
      expect(find.textContaining('3 items'), findsOneWidget);
      expect(find.textContaining('1 item'), findsWidgets);
      expect(find.textContaining('0 items'), findsOneWidget);
      expect(find.textContaining('Food and staples'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/categories'), 1);
      expect(sent.single.uri.query, isEmpty);
    });

    testWidgets('the route opens it, and has no leftovers on the automatic list', (t) async {
      final (s, _) = recordedSession(_categoriesServer(_cats()));
      expect(nativeScreenFor(s, '/items/categories'), isA<ItemCategoriesScreen>());
      expect(nativeScreenFor(s, '/items/barcodes'), isA<PrintLabelsScreen>());
    });

    testWidgets('empty, error with Try again, and plan lock', (t) async {
      var (s, _) = recordedSession(_categoriesServer([]));
      await pumpScreen(t, ItemCategoriesScreen(session: s));
      expect(find.text('No categories yet'), findsOneWidget);

      (s, _) = recordedSession(_categoriesServer(_cats(), failLoads: 1));
      await pumpScreen(t, ItemCategoriesScreen(session: s));
      expect(find.text('Could not load categories'), findsOneWidget);
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Grocery'), findsOneWidget);

      (s, _) = recordedSession(_categoriesServer(_cats(), failLoads: 9, failCode: 'FEATURE_NOT_IN_PLAN'));
      await pumpScreen(t, ItemCategoriesScreen(session: s));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('add sends only the name and description, then shows the new category', (t) async {
      final cats = _cats();
      final (s, sent) = recordedSession(_categoriesServer(cats));
      await pumpScreen(t, ItemCategoriesScreen(session: s));
      await t.tap(find.text('Add category'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Category name'), '  Best Seller ');
      await t.enterText(textFieldLabelled('Description'), 'Top picks');
      await t.tap(find.text('Save category'));
      await t.pumpAndSettle();
      final body = lastBody(sent, 'POST', '/api/categories');
      expect(body, {'name': 'Best Seller', 'description': 'Top picks'});
      expectNoIdentity(body);
      expect(find.text('Best Seller'), findsOneWidget);
      expect(find.text('Category added'), findsOneWidget);
    });

    testWidgets('add without a name asks for one and sends nothing', (t) async {
      final (s, sent) = recordedSession(_categoriesServer(_cats()));
      await pumpScreen(t, ItemCategoriesScreen(session: s));
      await t.tap(find.text('Add category'));
      await t.pumpAndSettle();
      await t.tap(find.text('Save category'));
      await t.pumpAndSettle();
      expect(find.text('Enter a category name'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/categories'), 0);
    });

    testWidgets('delete asks first by name, then removes an unused category', (t) async {
      final cats = _cats();
      final (s, sent) = recordedSession(_categoriesServer(cats));
      await pumpScreen(t, ItemCategoriesScreen(session: s));
      await t.tap(find.text('Offers'));
      await t.pumpAndSettle();
      await t.tap(find.text('Delete category'));
      await t.pumpAndSettle();
      expect(find.textContaining('"Offers"'), findsOneWidget);
      expect(requestCount(sent, 'DELETE', '/api/categories'), 0);
      await t.tap(find.text('Delete'));
      await t.pumpAndSettle();
      expect(requestsOf(sent, 'DELETE', '/api/categories').single.uri.queryParameters, {'id': 'c2'});
      expect(find.text('Offers'), findsNothing);
      expect(find.text('Category deleted'), findsOneWidget);
    });

    testWidgets('cancelling the question deletes nothing', (t) async {
      final (s, sent) = recordedSession(_categoriesServer(_cats()));
      await pumpScreen(t, ItemCategoriesScreen(session: s));
      await t.tap(find.text('Offers'));
      await t.pumpAndSettle();
      await t.tap(find.text('Delete category'));
      await t.pumpAndSettle();
      await t.tap(find.text('Keep it'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'DELETE', '/api/categories'), 0);
      expect(find.text('Offers'), findsOneWidget);
    });

    testWidgets('a category in use is refused by the server and its message shows', (t) async {
      final (s, sent) = recordedSession(_categoriesServer(_cats()));
      await pumpScreen(t, ItemCategoriesScreen(session: s));
      await t.tap(find.text('Grocery'));
      await t.pumpAndSettle();
      await t.tap(find.text('Delete category'));
      await t.pumpAndSettle();
      await t.tap(find.text('Delete'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'DELETE', '/api/categories'), 1);
      expect(find.text(_refusal), findsOneWidget);
      expect(find.text('Grocery'), findsOneWidget);
    });

    testWidgets('size chart: columns and rows go to PATCH with the id and nothing else', (t) async {
      final (s, sent) = recordedSession(_categoriesServer(_cats()));
      await pumpScreen(t, ItemCategoriesScreen(session: s));
      await t.tap(find.text('Grocery'));
      await t.pumpAndSettle();
      await t.tap(find.text('Size chart'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Columns (separated by commas)'), 'Size, Chest');
      await t.enterText(textFieldLabelled('Rows (one per line, values separated by commas)'), 'S, 38\nM, 40');
      await t.tap(find.text('Save size chart'));
      await t.pumpAndSettle();
      final body = lastBody(sent, 'PATCH', '/api/categories');
      expect(body, {
        'id': 'c1',
        'size_chart': {
          'columns': ['Size', 'Chest'],
          'rows': [
            ['S', '38'],
            ['M', '40'],
          ],
        },
      });
      expectNoIdentity(body);
      expect(find.text('Size chart saved'), findsOneWidget);
    });

    testWidgets('a row with the wrong number of values is caught before any request', (t) async {
      final (s, sent) = recordedSession(_categoriesServer(_cats()));
      await pumpScreen(t, ItemCategoriesScreen(session: s));
      await t.tap(find.text('Grocery'));
      await t.pumpAndSettle();
      await t.tap(find.text('Size chart'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Columns (separated by commas)'), 'Size, Chest');
      await t.enterText(textFieldLabelled('Rows (one per line, values separated by commas)'), 'S');
      await t.tap(find.text('Save size chart'));
      await t.pumpAndSettle();
      expect(find.text('Every row needs one value per column'), findsOneWidget);
      expect(requestCount(sent, 'PATCH', '/api/categories'), 0);
    });

    testWidgets('removing a size chart sends null', (t) async {
      final (s, sent) = recordedSession(_categoriesServer(_cats()));
      await pumpScreen(t, ItemCategoriesScreen(session: s));
      await t.tap(find.text('Shirts'));
      await t.pumpAndSettle();
      await t.tap(find.text('Size chart'));
      await t.pumpAndSettle();
      await t.tap(find.text('Remove size chart'));
      await t.pumpAndSettle();
      expect(lastBody(sent, 'PATCH', '/api/categories'), {'id': 'c3', 'size_chart': null});
    });
  });

  group('size chart text', () {
    test('parses columns and rows', () {
      final r = parseSizeChart('Size, Chest', 'S, 38\n\nM, 40');
      expect(r.error, isNull);
      expect(r.chart, {
        'columns': ['Size', 'Chest'],
        'rows': [
          ['S', '38'],
          ['M', '40'],
        ],
      });
    });
    test('no columns is an error; blank rows are allowed', () {
      expect(parseSizeChart('', '').error, 'Add at least one column');
      expect(parseSizeChart('Size', '').chart, {'columns': ['Size'], 'rows': <List<String>>[]});
    });
    test('writes a saved chart back as text', () {
      final t = sizeChartText({'columns': ['Size', 'Chest'], 'rows': [['S', '38']]});
      expect(t.columns, 'Size, Chest');
      expect(t.rows, 'S, 38');
    });
  });

  group('print labels', () {
    final entries = [
      {'row_id': 'item:i1', 'item_id': 'i1', 'variant_id': null, 'name': 'Rice 5kg', 'code': 'R5', 'barcode': '8901234567890', 'barcode_type': 'EAN13', 'selling_price': 480, 'mrp': 500, 'current_stock': 42, 'unit': 'BAG', 'item_type': 'goods', 'is_weighed': false, 'plu_code': null, 'weight_barcode_mode': 'weight'},
      {'row_id': 'variant:v1', 'item_id': 'i2', 'variant_id': 'v1', 'name': 'Shirt - M', 'code': 'SH-M', 'barcode': '8900000000017', 'barcode_type': null, 'selling_price': 999, 'mrp': 1099, 'current_stock': 4, 'unit': 'PCS', 'item_type': 'goods'},
      {'row_id': 'item:i3', 'item_id': 'i3', 'variant_id': null, 'name': 'Loose Sugar', 'code': 'SUG', 'barcode': '', 'barcode_type': null, 'selling_price': 44, 'mrp': null, 'current_stock': 90, 'unit': 'KG', 'item_type': 'goods', 'is_weighed': true, 'plu_code': '1234', 'weight_barcode_mode': 'weight'},
    ];
    final templates = [
      {'id': 't1', 'name': 'Roll 50x25', 'format': 'ROLL', 'is_system': true},
      {'id': 't2', 'name': 'My shelf tag', 'format': 'ROLL', 'is_system': false},
    ];

    Handler server({int failEntries = 0, String? failCode, bool noEntries = false, int printStatus = 200}) {
      var fails = failEntries;
      return (o, body) {
        if (o.uri.path == '/api/items/labelable') {
          if (fails > 0) {
            fails--;
            return (failCode == null ? 500 : 403, {'error': 'Failed to load printable items', 'code': ?failCode});
          }
          return (200, {'entries': noEntries ? [] : entries});
        }
        if (o.uri.path == '/api/label-templates') return (200, {'templates': templates});
        if (o.uri.path == '/api/labels/print') {
          if (printStatus != 200) return (printStatus, {'error': 'Label printing is not on your plan'});
          return (200, {'template': {'id': 't1'}, 'lines': body['lines'], 'businessName': 'Demo Shop'});
        }
        return (404, {'error': 'no route'});
      };
    }

    Future<void> withPrinter() async {
      final printer = ThermalPrinter(id: 'p1', name: 'Shelf printer', connection: PrinterConnection.network, address: '10.0.0.5:9100', language: PrinterLanguage.tspl, forLabels: true);
      SharedPreferences.setMockInitialValues({'khatario.thermal-printers.b': jsonEncode([printer.toJson()])});
    }

    testWidgets('shows what can be labelled, loaded from the labelable route and the templates route', (t) async {
      await withPrinter();
      final (s, sent) = recordedSession(server());
      await pumpScreen(t, PrintLabelsScreen(session: s));
      expect(find.text('Rice 5kg'), findsOneWidget);
      expect(find.text('Shirt - M'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/items/labelable'), 1);
      expect(requestCount(sent, 'GET', '/api/label-templates'), 1);
      expect(find.text('Design a template'), findsOneWidget);
      expect(find.text('Print labels'), findsWidgets);
    });

    testWidgets('empty list, error with Try again, plan lock', (t) async {
      await withPrinter();
      var (s, _) = recordedSession(server(noEntries: true));
      await pumpScreen(t, PrintLabelsScreen(session: s));
      expect(find.text('No items with barcodes'), findsOneWidget);

      (s, _) = recordedSession(server(failEntries: 1));
      await pumpScreen(t, PrintLabelsScreen(session: s));
      expect(find.text('Could not load printable items'), findsOneWidget);
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Rice 5kg'), findsOneWidget);

      (s, _) = recordedSession(server(failEntries: 9, failCode: 'FEATURE_NOT_IN_PLAN'));
      await pumpScreen(t, PrintLabelsScreen(session: s));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('pick a template, items and copies, then print through the saved label printer', (t) async {
      await withPrinter();
      final (s, sent) = recordedSession(server());
      final printed = <(ThermalPrinter, Map<String, dynamic>)>[];
      await pumpScreen(t, PrintLabelsScreen(session: s, sendToPrinter: (p, labels) async => printed.add((p, labels))));
      await t.tap(find.text('Default layout'));
      await t.pumpAndSettle();
      await t.tap(find.text('Roll 50x25 (system)'));
      await t.pumpAndSettle();
      await t.tap(find.text('Rice 5kg'));
      await t.pumpAndSettle();
      await t.tap(find.bySemanticsLabel('More copies'));
      await t.pumpAndSettle();
      await t.tap(find.bySemanticsLabel('More copies'));
      await t.pumpAndSettle();
      await t.tap(find.text('Shirt - M'));
      await t.pumpAndSettle();
      expect(find.text('Print 4 labels'), findsOneWidget);
      await t.tap(find.text('Print 4 labels'));
      await t.pumpAndSettle();

      final body = lastBody(sent, 'POST', '/api/labels/print');
      expectNoIdentity(body);
      expect(body['template_id'], 't1');
      expect(body.containsKey('layout'), isFalse);
      expect(body['format'], 'json');
      expect(body['purpose'], 'standalone');
      expect(body['lines'], [
        {'item_id': 'i1', 'variant_id': null, 'copies': 3},
        {'item_id': 'i2', 'variant_id': 'v1', 'copies': 1},
      ]);
      expect(printed, hasLength(1));
      expect(printed.single.$1.name, 'Shelf printer');
      expect(printed.single.$2['businessName'], 'Demo Shop');
      expect(find.text('4 labels sent to Shelf printer'), findsOneWidget);
    });

    testWidgets('no template sends the roll layout, and a weighed item sends its weight', (t) async {
      await withPrinter();
      final (s, sent) = recordedSession(server());
      await pumpScreen(t, PrintLabelsScreen(session: s, sendToPrinter: (p, labels) async {}));
      await t.tap(find.text('Loose Sugar'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Weight in grams'), '750');
      await t.tap(find.text('Print 1 label'));
      await t.pumpAndSettle();
      final body = lastBody(sent, 'POST', '/api/labels/print');
      expect(body['layout'], 'ROLL');
      expect(body.containsKey('template_id'), isFalse);
      expect(body['lines'], [
        {'item_id': 'i3', 'variant_id': null, 'copies': 1, 'weight_measure': 750},
      ]);
    });

    testWidgets('nothing picked sends nothing', (t) async {
      await withPrinter();
      final (s, sent) = recordedSession(server());
      await pumpScreen(t, PrintLabelsScreen(session: s, sendToPrinter: (p, labels) async {}));
      expect(find.text('Print 0 labels'), findsOneWidget);
      await t.tap(find.text('Print 0 labels'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/labels/print'), 0);
      expect(find.text('Pick at least one item to print'), findsOneWidget);
    });

    testWidgets('search narrows the list; select all picks what is shown', (t) async {
      await withPrinter();
      final (s, _) = recordedSession(server());
      await pumpScreen(t, PrintLabelsScreen(session: s, sendToPrinter: (p, labels) async {}));
      await t.enterText(find.byType(TextField).first, 'shirt');
      await t.pumpAndSettle();
      expect(find.text('Rice 5kg'), findsNothing);
      expect(find.text('Shirt - M'), findsOneWidget);
      await t.tap(find.text('Select all (1)'));
      await t.pumpAndSettle();
      expect(find.text('Print 1 label'), findsOneWidget);
    });

    testWidgets('a refused print shows the server message and the printer gets nothing', (t) async {
      await withPrinter();
      final (s, _) = recordedSession(server(printStatus: 403));
      final printed = <Object>[];
      await pumpScreen(t, PrintLabelsScreen(session: s, sendToPrinter: (p, labels) async => printed.add(labels)));
      await t.tap(find.text('Rice 5kg'));
      await t.pumpAndSettle();
      await t.tap(find.text('Print 1 label'));
      await t.pumpAndSettle();
      expect(find.text('Label printing is not on your plan'), findsOneWidget);
      expect(printed, isEmpty);
    });

    testWidgets('a printer that fails shows its message', (t) async {
      await withPrinter();
      final (s, _) = recordedSession(server());
      await pumpScreen(t, PrintLabelsScreen(session: s, sendToPrinter: (p, labels) async => throw PrintFailure('No printer answered at 10.0.0.5.')));
      await t.tap(find.text('Rice 5kg'));
      await t.pumpAndSettle();
      await t.tap(find.text('Print 1 label'));
      await t.pumpAndSettle();
      expect(find.text('No printer answered at 10.0.0.5.'), findsOneWidget);
    });

    testWidgets('no saved label printer says so and sends nothing', (t) async {
      SharedPreferences.setMockInitialValues({});
      final (s, sent) = recordedSession(server());
      await pumpScreen(t, PrintLabelsScreen(session: s, sendToPrinter: (p, labels) async {}, askForPrinter: () async => null));
      await t.tap(find.text('Rice 5kg'));
      await t.pumpAndSettle();
      await t.tap(find.text('Print 1 label'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/labels/print'), 0);
      expect(find.text('Add your label printer first.'), findsOneWidget);
    });
  });
}

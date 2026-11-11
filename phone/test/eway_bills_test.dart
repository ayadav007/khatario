import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/reports/eway_bills_screen.dart';
import 'package:khatario_phone/ui/form_kit.dart';

import 'support/finders.dart';
import 'support/gst_server.dart';

const _list = '/api/eway-bills';
const _one = '/api/eway-bills/e1000000-0000-4000-8000-000000000001';

Future<void> _open(WidgetTester t, Widget screen) async {
  t.view.physicalSize = const Size(800, 6000);
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.reset);
  await t.pumpWidget(MaterialApp(home: screen));
  await t.pumpAndSettle();
}

void main() {
  Object? server(RequestOptions o, {Map<String, GstReply>? write, Object? list}) {
    if (o.method != 'GET') return write?[o.uri.path] ?? gstFixture('eway_bill');
    return switch (o.uri.path) {
      _list => list ?? gstFixture('eway_bills'),
      _one => gstFixture('eway_bill'),
      _ => <String, dynamic>{},
    };
  }

  group('list', () {
    testWidgets('loads GET /api/eway-bills with no query and shows number, document, validity and value', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, EwayBillsScreen(session: s));
      expect(gstCalls(sent, 'GET', _list).single.uri.query, isEmpty);
      expect(find.text('281001234567'), findsOneWidget);
      expect(find.text('281009876543'), findsOneWidget);
      expect(find.textContaining('INV-2026-0042'), findsOneWidget);
      expect(find.textContaining('DC-2026-0004'), findsOneWidget);
      expect(find.text('₹59,000'), findsOneWidget);
      expect(find.text('₹1,20,000'), findsOneWidget);
      expect(find.text('Active'), findsWidgets);
      expect(find.text('Expired'), findsWidgets);
      expect(find.text('12 hours left'), findsOneWidget);
    });

    testWidgets('a status chip sends status to the route', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, EwayBillsScreen(session: s));
      await t.tap(find.text('Expired').first);
      await t.pumpAndSettle();
      final calls = gstCalls(sent, 'GET', _list);
      expect(calls, hasLength(2));
      expect(calls.last.uri.queryParameters, {'status': 'expired'});
    });

    testWidgets('nothing recorded shows an empty state', (t) async {
      final (s, _) = gstSession((o) => server(o, list: {'eway_bills': []}));
      await _open(t, EwayBillsScreen(session: s));
      expect(find.text('No e-way bills recorded yet.'), findsOneWidget);
    });

    testWidgets('a server error offers Try again', (t) async {
      var calls = 0;
      final (s, _) = gstSession((o) => ++calls == 1 ? const GstReply({'error': 'Failed to load e-way bills'}, status: 500) : server(o));
      await _open(t, EwayBillsScreen(session: s));
      expect(find.text('Failed to load e-way bills'), findsOneWidget);
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('281001234567'), findsOneWidget);
    });

    testWidgets('FEATURE_NOT_IN_PLAN says so', (t) async {
      final (s, _) = gstSession((o) => const GstReply({'error': 'x', 'code': 'FEATURE_NOT_IN_PLAN'}, status: 403));
      await _open(t, EwayBillsScreen(session: s));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('importing the portal CSV opens the website, nothing is posted', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, EwayBillsScreen(session: s));
      expect(find.text('Import inward e-way bills on the website'), findsOneWidget);
      expect(sent.where((o) => o.method != 'GET'), isEmpty);
    });
  });

  group('detail', () {
    Future<List<RequestOptions>> openDetail(WidgetTester t, {Map<String, GstReply>? write}) async {
      final (s, sent) = gstSession((o) => server(o, write: write));
      await _open(t, EwayBillsScreen(session: s));
      await t.tap(find.text('281001234567'));
      await t.pumpAndSettle();
      return sent;
    }

    testWidgets('a bill opens GET /api/eway-bills/[id] with its figures', (t) async {
      final sent = await openDetail(t);
      expect(gstCalls(sent, 'GET', _one), hasLength(1));
      expect(find.text('MH12AB1234'), findsOneWidget);
      expect(find.text('Shree Roadways'), findsOneWidget);
      expect(find.text('27AAAPL1234C1ZV'), findsOneWidget);
      expect(find.text('120 km'), findsOneWidget);
      expect(find.text('Handle with care'), findsOneWidget);
    });

    testWidgets('Cancel asks first with the number, patches action cancel once and reloads', (t) async {
      final sent = await openDetail(t);
      await t.tap(find.text('Cancel e-way bill'));
      await t.pumpAndSettle();
      expect(find.textContaining('Cancel e-way bill 281001234567?'), findsOneWidget);
      expect(gstCalls(sent, 'PATCH', _one), isEmpty);
      await t.enterText(find.byType(TextField), 'Wrong vehicle');
      await t.pump();
      await t.tap(find.text('Cancel bill'));
      await t.pumpAndSettle();
      final patches = gstCalls(sent, 'PATCH', _one);
      expect(patches, hasLength(1));
      expect(patches.single.data, {'action': 'cancel', 'reason': 'Wrong vehicle'});
      expect(gstCalls(sent, 'GET', _one).length, greaterThanOrEqualTo(2));
    });

    testWidgets('Cancel without a reason sends only the action', (t) async {
      final sent = await openDetail(t);
      await t.tap(find.text('Cancel e-way bill'));
      await t.pumpAndSettle();
      await t.tap(find.text('Cancel bill'));
      await t.pumpAndSettle();
      expect(gstCalls(sent, 'PATCH', _one).single.data, {'action': 'cancel'});
    });

    testWidgets('a refused cancel shows the server message and the bill stays', (t) async {
      final sent = await openDetail(t, write: {_one: const GstReply({'error': 'An e-way bill can only be cancelled within 24 hours of generation'}, status: 409)});
      await t.tap(find.text('Cancel e-way bill'));
      await t.pumpAndSettle();
      await t.tap(find.text('Cancel bill'));
      await t.pumpAndSettle();
      expect(find.text('An e-way bill can only be cancelled within 24 hours of generation'), findsOneWidget);
      expect(find.text('MH12AB1234'), findsOneWidget);
      expect(gstCalls(sent, 'PATCH', _one), hasLength(1));
    });

    testWidgets('Close asks first and patches action close', (t) async {
      final sent = await openDetail(t);
      await t.tap(find.text('Close e-way bill'));
      await t.pumpAndSettle();
      expect(find.textContaining('Close e-way bill 281001234567?'), findsOneWidget);
      expect(gstCalls(sent, 'PATCH', _one), isEmpty);
      await t.tap(find.text('Yes, close it'));
      await t.pumpAndSettle();
      expect(gstCalls(sent, 'PATCH', _one).single.data, {'action': 'close'});
    });

    testWidgets('Extend validity takes the distance still to go, asks, and patches', (t) async {
      final sent = await openDetail(t);
      await t.tap(find.text('Extend validity'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Distance still to go (km)'), '150');
      await t.pump();
      await t.tap(find.text('Review extension'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      expect(find.textContaining('Extend e-way bill 281001234567 for 150 km more?'), findsOneWidget);
      await t.tap(find.text('Extend now'));
      await t.pumpAndSettle();
      expect(gstCalls(sent, 'PATCH', _one).single.data, {'action': 'extend', 'remaining_km': 150});
    });

    testWidgets('Change vehicle patches the new vehicle and transporter', (t) async {
      final sent = await openDetail(t);
      await t.tap(find.text('Change vehicle'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Vehicle number'), 'mh14 cd 5678');
      await t.pump();
      await t.tap(find.text('Review vehicle change'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      await t.tap(find.text('Change now'));
      await t.pumpAndSettle();
      final data = gstCalls(sent, 'PATCH', _one).single.data as Map;
      expect(data['action'], 'vehicle');
      expect(data['vehicle_number'], 'MH14 CD 5678');
      expect(data.keys.toSet().difference({'action', 'vehicle_number', 'transporter_name'}), isEmpty);
    });

    testWidgets('a bill that cannot be cancelled does not offer Cancel', (t) async {
      final bill = gstFixture('eway_bill');
      final one = {'eway_bill': {...(bill['eway_bill'] as Map<String, dynamic>), 'can_cancel': false, 'can_extend': false}};
      final (s, _) = gstSession((o) => o.uri.path == _one ? one : server(o));
      await _open(t, EwayBillsScreen(session: s));
      await t.tap(find.text('281001234567'));
      await t.pumpAndSettle();
      expect(find.text('Cancel e-way bill'), findsNothing);
      expect(find.text('Extend validity'), findsNothing);
      expect(find.text('Close e-way bill'), findsOneWidget);
    });

    testWidgets('an expired bill offers no change at all', (t) async {
      final bill = gstFixture('eway_bill');
      final one = {'eway_bill': {...(bill['eway_bill'] as Map<String, dynamic>), 'status': 'expired', 'can_cancel': false, 'can_extend': false}};
      final (s, _) = gstSession((o) => o.uri.path == _one ? one : server(o));
      await _open(t, EwayBillsScreen(session: s));
      await t.tap(find.text('281001234567'));
      await t.pumpAndSettle();
      expect(find.text('Close e-way bill'), findsNothing);
      expect(find.text('Change vehicle'), findsNothing);
    });

    testWidgets('a bill that cannot be loaded shows Try again', (t) async {
      var details = 0;
      final (s, _) = gstSession((o) {
        if (o.uri.path == _one) return ++details == 1 ? const GstReply({'error': 'E-way bill not found'}, status: 404) : gstFixture('eway_bill');
        return server(o);
      });
      await _open(t, EwayBillsScreen(session: s));
      await t.tap(find.text('281001234567'));
      await t.pumpAndSettle();
      expect(find.text('E-way bill not found'), findsOneWidget);
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('MH12AB1234'), findsOneWidget);
    });
  });

  group('add', () {
    Future<void> fillMinimum(WidgetTester t) async {
      await t.tap(find.text('Record e-way bill'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('E-way bill number (12 digits)'), '281001234999');
      await t.pump();
      await t.enterText(textFieldLabelled('Distance (km)'), '250');
      await t.pump();
    }

    testWidgets('posts the website form fields once, with no business, user or created_by', (t) async {
      final (s, sent) = gstSession((o) => server(o, write: {_list: const GstReply({'eway_bill': {'valid_until': '2026-11-12T18:29:59.000Z'}}, status: 201)}));
      await _open(t, EwayBillsScreen(session: s));
      await fillMinimum(t);
      await t.enterText(textFieldLabelled('Goods value', within: KAmountField), '45000');
      await t.pump();
      await t.enterText(textFieldLabelled('Vehicle number'), 'MH12AB1234');
      await t.pump();
      await t.enterText(textFieldLabelled('Transporter'), 'Shree Roadways');
      await t.pump();
      await t.tap(find.text('Save e-way bill'));
      await t.pumpAndSettle();
      final posts = gstCalls(sent, 'POST', _list);
      expect(posts, hasLength(1));
      final body = posts.single.data as Map;
      expect(body.keys.toSet(), {
        'source_type', 'direction', 'ewb_number', 'generated_at', 'distance_km', 'is_odc', 'doc_type', 'sub_supply_type',
        'goods_value', 'vehicle_number', 'transporter_name',
      });
      expect(body['source_type'], 'other');
      expect(body['direction'], 'outward');
      expect(body['ewb_number'], '281001234999');
      expect(body['distance_km'], 250);
      expect(body['goods_value'], 45000);
      expect(body['is_odc'], false);
      expect(body['doc_type'], 'tax_invoice');
      expect(body['sub_supply_type'], 'supply');
      expect(body['vehicle_number'], 'MH12AB1234');
      expect(body['transporter_name'], 'Shree Roadways');
      expect(DateTime.parse(body['generated_at'] as String).isUtc, isTrue);
      expect(gstCalls(sent, 'GET', _list), hasLength(2), reason: 'the list loads again');
      expect(find.text('Record e-way bill'), findsOneWidget, reason: 'only the list button is left');
    });

    testWidgets('Save stays off until the number has 12 digits and a distance is typed', (t) async {
      final (s, sent) = gstSession(server);
      await _open(t, EwayBillsScreen(session: s));
      await t.tap(find.text('Record e-way bill'));
      await t.pumpAndSettle();
      await t.tap(find.text('Save e-way bill'));
      await t.pumpAndSettle();
      expect(gstCalls(sent, 'POST', _list), isEmpty);
      await t.enterText(textFieldLabelled('E-way bill number (12 digits)'), '2810012');
      await t.pump();
      await t.enterText(textFieldLabelled('Distance (km)'), '10');
      await t.pump();
      await t.tap(find.text('Save e-way bill'));
      await t.pumpAndSettle();
      expect(gstCalls(sent, 'POST', _list), isEmpty);
    });

    testWidgets('a refused save shows the server message and keeps every field', (t) async {
      final (s, sent) = gstSession((o) => server(o, write: {_list: const GstReply({'error': 'This e-way bill number is already recorded.'}, status: 409)}));
      await _open(t, EwayBillsScreen(session: s));
      await fillMinimum(t);
      await t.tap(find.text('Save e-way bill'));
      await t.pumpAndSettle();
      expect(find.text('This e-way bill number is already recorded.'), findsOneWidget);
      expect(t.widget<TextField>(textFieldLabelled('E-way bill number (12 digits)')).controller!.text, '281001234999');
      expect(gstCalls(sent, 'GET', _list), hasLength(1));
    });

    testWidgets('the form offers the website choices for direction and document type', (t) async {
      final (s, _) = gstSession(server);
      await _open(t, EwayBillsScreen(session: s));
      await t.tap(find.text('Record e-way bill'));
      await t.pumpAndSettle();
      expect(find.text('Outward'), findsOneWidget);
      expect(find.text('Tax invoice'), findsOneWidget);
      expect(find.text('Supply'), findsOneWidget);
      await t.tap(find.text('Tax invoice'));
      await t.pumpAndSettle();
      for (final o in ['Bill of supply', 'Delivery challan', 'Bill of entry', 'Credit note', 'Others']) {
        expect(find.text(o), findsWidgets, reason: o);
      }
      expect(find.byType(KPickField<String>), findsWidgets);
    });
  });
}

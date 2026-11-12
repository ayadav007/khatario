import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/pages/page_catalog.dart';
import 'package:khatario_phone/screens/purchases/bill_form_numbers.dart';
import 'package:khatario_phone/screens/purchases/bill_form_screen.dart';
import 'package:khatario_phone/screens/sales/credit_debit_notes_screen.dart';
import 'package:khatario_phone/screens/sales/note_logic.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/ui/form_kit.dart';
import 'package:khatario_phone/ui/kit.dart';

Map<String, dynamic> _cn({String status = 'active', String refund = 'pending', String type = 'sales_return', String id = 'cn1', String number = 'CN-1'}) => {
      'id': id,
      'customer_id': 'c1',
      'customer_name': 'Asha',
      'invoice_id': 'i1',
      'invoice_number': 'INV-5',
      'credit_note_number': number,
      'credit_note_date': '2026-11-01',
      'note_type': type,
      'supply_period_from': type == 'post_sale_discount' ? '2026-10-01' : null,
      'supply_period_to': type == 'post_sale_discount' ? '2026-10-31' : null,
      'reason': 'Damaged goods',
      'status': status,
      'cancellation_reason': status == 'cancelled' ? 'Entered twice' : null,
      'refund_status': refund,
      'subtotal': '1000.00',
      'cgst_total': '90.00',
      'sgst_total': '90.00',
      'igst_total': '0.00',
      'tax_total': '180.00',
      'round_off': '0.00',
      'grand_total': '1180.00',
      'notes': 'Box crushed',
      'created_at': '2026-11-01T05:00:00.000Z',
    };

Map<String, dynamic> _dn({String status = 'active', String adjustment = 'pending'}) => {
      'id': 'dn1',
      'customer_id': 'c1',
      'customer_name': 'Asha',
      'invoice_id': null,
      'invoice_number': null,
      'debit_note_number': 'DN-1',
      'debit_note_date': '2026-11-02',
      'reason': 'Freight charged extra',
      'status': status,
      'cancellation_reason': status == 'cancelled' ? 'Wrong rate' : null,
      'adjustment_status': adjustment,
      'subtotal': '500.00',
      'cgst_total': '0.00',
      'sgst_total': '0.00',
      'igst_total': '90.00',
      'round_off': '0.00',
      'grand_total': '590.00',
      'created_at': '2026-11-02T05:00:00.000Z',
    };

Map<String, dynamic> _item() => {
      'id': 'l1',
      'item_id': 'it1',
      'item_name': 'Widget',
      'description': 'Widget',
      'qty': '2',
      'unit': 'PCS',
      'unit_price': '500',
      'tax_rate': '18',
      'line_total': '1180.00',
    };

/// Replies by route. Documents are read at request time so a test can change what the server says.
class _Srv {
  List<Map<String, dynamic>> cnRows = [];
  List<Map<String, dynamic>> dnRows = [];
  Map<String, dynamic> cn = _cn();
  Map<String, dynamic> dn = _dn();
  Map<String, dynamic>? cnPage2;
  (int, Object?)? cnListStatus;
  (int, Object?)? dnListStatus;
  (int, Object?)? docGet;
  Future<(int, Object?)> Function(Map body)? cancel;
  Future<(int, Object?)> Function(Map body)? post;
  (int, Object?)? nextCn = (200, {'next_credit_note_number': 'CN-8'});
  (int, Object?)? nextDn = (200, {'next_debit_note_number': 'DN-4'});
  List<Map<String, dynamic>> soRows = [];
  List<Map<String, dynamic>> poRows = [];
  (int, Object?)? invoiceGet;

  final sent = <RequestOptions>[];
  final bodies = <String, Object?>{};

  AppSession build() {
    final dio = Dio(BaseOptions(baseUrl: 'https://x.test', validateStatus: (s) => s != null && s < 500));
    dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) async {
      sent.add(o);
      if (o.data != null) bodies['${o.method} ${o.uri.path}'] = o.data;
      final body = o.data is Map ? Map<String, dynamic>.from(o.data as Map) : <String, dynamic>{};
      (int, Object?) r;
      final path = o.uri.path;
      final m = o.method;
      if (path == '/api/credit-notes' && m == 'GET' && o.uri.queryParameters['next_number'] == '1') {
        r = nextCn ?? (500, {'error': 'Boom'});
      } else if (path == '/api/debit-notes' && m == 'GET' && o.uri.queryParameters['next_number'] == '1') {
        r = nextDn ?? (500, {'error': 'Boom'});
      } else if (path == '/api/sales-orders' && m == 'GET') {
        r = (200, {'salesOrders': soRows});
      } else if (path == '/api/purchase-orders' && m == 'GET') {
        r = (200, {'purchaseOrders': poRows});
      } else if (path == '/api/sales-orders' && m == 'POST') {
        r = await (post ?? (b) async => (201, {'salesOrder': {'id': 'soN'}}))(body);
      } else if (path == '/api/purchase-orders' && m == 'POST') {
        r = await (post ?? (b) async => (201, {'purchaseOrder': {'id': 'poN'}}))(body);
      } else if (path == '/api/suppliers') {
        r = (200, {'suppliers': [{'id': 's1', 'name': 'Asha', 'state_code': '27'}]});
      } else if (path == '/api/invoices/i1') {
        r = invoiceGet ?? (200, {'invoice': {'id': 'i1', 'invoice_number': 'INV-5'}});
      } else if (path == '/api/credit-notes' && m == 'GET') {
        final page = o.uri.queryParameters['page'];
        r = cnListStatus ??
            (page == '2' && cnPage2 != null
                ? (200, {'creditNotes': [cnPage2], 'pagination': {'page': 2, 'limit': 50, 'total': 51, 'totalPages': 2}})
                : (200, {'creditNotes': cnRows, 'pagination': {'page': 1, 'limit': 50, 'total': cnRows.length, 'totalPages': cnPage2 == null ? 1 : 2}}));
      } else if (path == '/api/debit-notes' && m == 'GET') {
        r = dnListStatus ?? (200, {'debitNotes': dnRows});
      } else if (path == '/api/credit-notes' && m == 'POST') {
        r = await (post ?? (b) async => (201, {'creditNote': {'id': 'cnN'}}))(body);
      } else if (path == '/api/debit-notes' && m == 'POST') {
        r = await (post ?? (b) async => (201, {'debitNote': {'id': 'dnN'}}))(body);
      } else if (path == '/api/documents/credit_notes/cn1') {
        r = docGet ?? (200, {'document': cn, 'items': [_item()]});
      } else if (path == '/api/documents/debit_notes/dn1') {
        r = docGet ?? (200, {'document': dn, 'items': [_item()]});
      } else if (path == '/api/credit-notes/cn1/cancel' && m == 'PATCH') {
        r = await (cancel ??
            (b) async {
              cn = {...cn, 'status': 'cancelled', 'cancellation_reason': b['reason']};
              return (200, {'creditNote': cn});
            })(body);
      } else if (path == '/api/debit-notes/dn1/cancel' && m == 'PATCH') {
        r = await (cancel ??
            (b) async {
              dn = {...dn, 'status': 'cancelled', 'cancellation_reason': b['reason']};
              return (200, {'debitNote': dn});
            })(body);
      } else if (path == '/api/customers') {
        r = (200, {'customers': [{'id': 'c1', 'name': 'Asha', 'state_code': '27'}]});
      } else if (path == '/api/items') {
        r = (200, {'items': [{'id': 'it1', 'name': 'Widget', 'unit': 'PCS', 'tax_rate': 18, 'selling_price': 500, 'hsn_sac': '8517'}]});
      } else {
        r = (200, <String, dynamic>{});
      }
      h.resolve(Response(requestOptions: o, statusCode: r.$1, data: r.$2));
    }));
    return AppSession(KhatarioApi(dio), {'user': {'id': 'u'}, 'business': {'id': 'b', 'state_code': '27'}});
  }

  int count(String method, String path) => sent.where((o) => o.method == method && o.uri.path == path).length;
}

void _tall(WidgetTester t) {
  t.view.physicalSize = const Size(800, 2400);
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.resetPhysicalSize);
  addTearDown(t.view.resetDevicePixelRatio);
}

Future<void> _pump(WidgetTester t, AppSession s, {bool debit = false}) async {
  _tall(t);
  await t.pumpWidget(MaterialApp(home: CreditDebitNotesScreen(session: s, debit: debit)));
  await t.pumpAndSettle();
}

Future<void> _pumpForm(WidgetTester t, AppSession s, BillKind kind) async {
  _tall(t);
  await t.pumpWidget(MaterialApp(home: BillFormScreen(session: s, kind: kind)));
  await t.pumpAndSettle();
}

Future<void> _more(WidgetTester t, String label) async {
  await t.tap(find.byTooltip('More'));
  await t.pumpAndSettle();
  await t.tap(find.text(label));
  await t.pumpAndSettle();
}

Future<void> _fillParty(WidgetTester t) async {
  await t.tap(find.text('Choose').first);
  await t.pumpAndSettle();
  await t.tap(find.text('Asha').last);
  await t.pumpAndSettle();
}

Future<void> _fillItem(WidgetTester t) async {
  await t.tap(find.text('Item 1'));
  await t.pumpAndSettle();
  await t.tap(find.text('Widget').last);
  await t.pumpAndSettle();
}

const _forbidden = ['business_id', 'user_id', 'created_by'];

void main() {
  group('note logic', () {
    test('an active note can be cancelled or shared; a cancelled one only shared', () {
      expect(noteActions(_cn()), [NoteAction.cancel, NoteAction.share]);
      expect(noteActions(_cn(status: 'cancelled')), [NoteAction.share]);
      expect(noteActions(_dn(status: 'cancelled')), [NoteAction.share]);
    });

    test('status: cancelled wins, else the refund (credit) or adjustment (debit) status', () {
      expect(noteStatus(_cn(refund: 'refunded'), debit: false), 'refunded');
      expect(noteStatus(_cn(status: 'cancelled', refund: 'refunded'), debit: false), 'cancelled');
      expect(noteStatus(_dn(adjustment: 'adjusted'), debit: true), 'adjusted');
      expect(noteStatus({}, debit: true), 'pending');
    });

    test('the cancel body carries only the trimmed reason; a blank reason sends nothing', () {
      expect(noteCancelBody('  Entered twice '), {'reason': 'Entered twice'});
      expect(noteCancelBody('   '), isNull);
    });

    test('titles, subtitles and the cancel question name the number and amount', () {
      expect(noteTitle(_cn(), debit: false), 'CN-1');
      expect(noteTitle({}, debit: true), 'Debit note');
      expect(noteSubtitle(_cn(), debit: false), contains('Asha'));
      expect(noteSubtitle(_cn(), debit: false), contains('INV-5'));
      expect(noteSubtitle(_cn(type: 'post_sale_discount'), debit: false), contains('Discount'));
      expect(noteSubtitle(_cn(type: 'post_sale_discount'), debit: false), contains('Oct 2026'));
      final text = noteCancelText('CN-1', 1180, debit: false);
      expect(text, contains('CN-1'));
      expect(text, contains('1,180'));
      expect(noteCancelText('DN-1', 590, debit: true), contains('DN-1'));
    });
  });

  group('credit notes list', () {
    testWidgets('loads rows with number, customer, amount and status', (t) async {
      final srv = _Srv()..cnRows = [_cn(), _cn(id: 'cn2', number: 'CN-2', refund: 'refunded')];
      await _pump(t, srv.build());
      expect(find.text('CN-1'), findsOneWidget);
      expect(find.text('CN-2'), findsOneWidget);
      expect(find.textContaining('Asha'), findsWidgets);
      expect(find.text('₹1,180'), findsWidgets);
      expect(find.text('Refunded'), findsOneWidget);
      expect(srv.count('GET', '/api/credit-notes'), 1);
    });

    testWidgets('search narrows by number or customer', (t) async {
      final srv = _Srv()..cnRows = [_cn(), _cn(id: 'cn2', number: 'CN-2')];
      await _pump(t, srv.build());
      await t.enterText(find.byType(TextField).first, 'CN-2');
      await t.pumpAndSettle();
      expect(find.byType(KListRow), findsOneWidget);
      expect(find.descendant(of: find.byType(KListRow), matching: find.text('CN-2')), findsOneWidget);
    });

    testWidgets('Show more reads the next page', (t) async {
      final srv = _Srv()
        ..cnRows = [_cn()]
        ..cnPage2 = _cn(id: 'cn9', number: 'CN-9');
      await _pump(t, srv.build());
      await t.tap(find.text('Show more'));
      await t.pumpAndSettle();
      expect(find.text('CN-9'), findsOneWidget);
      expect(srv.sent.last.uri.queryParameters['page'], '2');
    });

    testWidgets('empty list', (t) async {
      await _pump(t, _Srv().build());
      expect(find.text('No credit notes yet'), findsOneWidget);
      expect(find.text('New credit note'), findsOneWidget);
    });

    testWidgets('a server error shows Try again, which reloads', (t) async {
      final srv = _Srv()..cnListStatus = (500, {'error': 'Boom'});
      await _pump(t, srv.build());
      expect(find.text('Try again'), findsOneWidget);
      srv.cnListStatus = null;
      srv.cnRows = [_cn()];
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('CN-1'), findsOneWidget);
    });

    testWidgets('FEATURE_NOT_IN_PLAN says so', (t) async {
      final srv = _Srv()..cnListStatus = (403, {'error': 'No', 'code': 'FEATURE_NOT_IN_PLAN'});
      await _pump(t, srv.build());
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });
  });

  group('debit notes list', () {
    testWidgets('loads rows from debitNotes', (t) async {
      final srv = _Srv()..dnRows = [_dn()];
      await _pump(t, srv.build(), debit: true);
      expect(find.text('DN-1'), findsOneWidget);
      expect(find.text('₹590'), findsWidgets);
      expect(srv.count('GET', '/api/debit-notes'), 1);
      expect(find.text('New debit note'), findsOneWidget);
    });

    testWidgets('a server error shows Try again', (t) async {
      final srv = _Srv()..dnListStatus = (500, {'error': 'Boom'});
      await _pump(t, srv.build(), debit: true);
      expect(find.text('Try again'), findsOneWidget);
    });
  });

  group('note detail', () {
    testWidgets('a row opens the note and reads it by id from /api/documents', (t) async {
      final srv = _Srv()..cnRows = [_cn()];
      await _pump(t, srv.build());
      await t.tap(find.text('CN-1'));
      await t.pumpAndSettle();
      expect(srv.count('GET', '/api/documents/credit_notes/cn1'), 1);
      expect(find.text('Credit note'), findsOneWidget);
      expect(find.text('Widget'), findsOneWidget);
      expect(find.text('INV-5'), findsOneWidget);
      expect(find.text('Damaged goods'), findsOneWidget);
    });

    testWidgets('a load failure keeps the list row and shows the error', (t) async {
      final srv = _Srv()
        ..cnRows = [_cn()]
        ..docGet = (500, {'error': 'Boom'});
      await _pump(t, srv.build());
      await t.tap(find.text('CN-1'));
      await t.pumpAndSettle();
      // The row stays drawn from the list while the reload failed, so the page is usable but says why.
      expect(find.text('Boom'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
    });

    testWidgets('a cancelled note has no Cancel action', (t) async {
      final srv = _Srv()
        ..cn = _cn(status: 'cancelled')
        ..cnRows = [_cn(status: 'cancelled')];
      await _pump(t, srv.build());
      await t.tap(find.text('CN-1'));
      await t.pumpAndSettle();
      await t.tap(find.byTooltip('More'));
      await t.pumpAndSettle();
      expect(find.text('Share'), findsOneWidget);
      expect(find.textContaining('Cancel credit note'), findsNothing);
      expect(find.text('Entered twice'), findsOneWidget);
    });
  });

  group('note cancel', () {
    testWidgets('asks for a reason, names the number and amount, posts it once on a double tap, then reloads', (t) async {
      final gate = Completer<(int, Object?)>();
      final srv = _Srv()
        ..cnRows = [_cn()]
        ..cancel = (b) => gate.future;
      await _pump(t, srv.build());
      await t.tap(find.text('CN-1'));
      await t.pumpAndSettle();
      await _more(t, 'Cancel credit note');
      expect(find.textContaining('CN-1'), findsWidgets);
      expect(find.textContaining('1,180'), findsWidgets);
      // No reason: nothing is sent.
      await t.tap(find.widgetWithText(KButton, 'Cancel credit note'));
      await t.pumpAndSettle();
      expect(srv.count('PATCH', '/api/credit-notes/cn1/cancel'), 0);
      expect(find.text('Say why you are cancelling it.'), findsOneWidget);
      await t.enterText(find.byType(TextField).last, ' Wrong item ');
      await t.tap(find.widgetWithText(KButton, 'Cancel credit note'));
      await t.tap(find.widgetWithText(KButton, 'Cancel credit note'), warnIfMissed: false);
      await t.pump(const Duration(milliseconds: 100));
      expect(srv.count('PATCH', '/api/credit-notes/cn1/cancel'), 1);
      expect(srv.bodies['PATCH /api/credit-notes/cn1/cancel'], {'reason': 'Wrong item'});
      srv.cn = {...srv.cn, 'status': 'cancelled', 'cancellation_reason': 'Wrong item'};
      gate.complete((200, {'creditNote': srv.cn}));
      await t.pumpAndSettle();
      expect(srv.count('PATCH', '/api/credit-notes/cn1/cancel'), 1);
      expect(find.text('Credit note CN-1 cancelled'), findsOneWidget);
      expect(find.text('Cancelled'), findsWidgets);
      // The detail reloaded: no Cancel action any more.
      await t.tap(find.byTooltip('More'));
      await t.pumpAndSettle();
      expect(find.text('Cancel credit note'), findsNothing);
      // Back on the list: it reloads.
      await t.tapAt(const Offset(400, 1000));
      await t.pumpAndSettle();
      await t.tap(find.byIcon(LucideIcons.arrowLeft));
      await t.pumpAndSettle();
      expect(srv.count('GET', '/api/credit-notes'), 2);
    });

    testWidgets('Keep leaves the note alone', (t) async {
      final srv = _Srv()..cnRows = [_cn()];
      await _pump(t, srv.build());
      await t.tap(find.text('CN-1'));
      await t.pumpAndSettle();
      await _more(t, 'Cancel credit note');
      await t.tap(find.text('Keep credit note'));
      await t.pumpAndSettle();
      expect(srv.count('PATCH', '/api/credit-notes/cn1/cancel'), 0);
    });

    testWidgets('a GST-filed refusal shows the server text and changes nothing', (t) async {
      const message = 'GST period for November 2026 is filed. You cannot cancel credit note.';
      final srv = _Srv()
        ..cnRows = [_cn()]
        ..cancel = (b) async => (403, {'error': message, 'code': 'GST_PERIOD_FILED'});
      await _pump(t, srv.build());
      await t.tap(find.text('CN-1'));
      await t.pumpAndSettle();
      await _more(t, 'Cancel credit note');
      await t.enterText(find.byType(TextField).last, 'Wrong item');
      await t.tap(find.widgetWithText(KButton, 'Cancel credit note'));
      await t.pumpAndSettle();
      expect(find.text(message), findsOneWidget);
      expect(find.text('Credit note CN-1 cancelled'), findsNothing);
      expect(srv.count('GET', '/api/documents/credit_notes/cn1'), 1);
      // Still cancellable: the screen did not change.
      await t.tap(find.byTooltip('More'));
      await t.pumpAndSettle();
      expect(find.text('Cancel credit note'), findsOneWidget);
    });

    testWidgets('a debit note cancels through its own route', (t) async {
      final srv = _Srv()..dnRows = [_dn()];
      await _pump(t, srv.build(), debit: true);
      await t.tap(find.text('DN-1'));
      await t.pumpAndSettle();
      expect(srv.count('GET', '/api/documents/debit_notes/dn1'), 1);
      await _more(t, 'Cancel debit note');
      expect(find.textContaining('590'), findsWidgets);
      await t.enterText(find.byType(TextField).last, 'Wrong rate');
      await t.tap(find.widgetWithText(KButton, 'Cancel debit note'));
      await t.pumpAndSettle();
      expect(srv.bodies['PATCH /api/debit-notes/dn1/cancel'], {'reason': 'Wrong rate'});
      expect(find.text('Debit note DN-1 cancelled'), findsOneWidget);
    });

    testWidgets('already cancelled (409) reloads the note', (t) async {
      final srv = _Srv()
        ..cnRows = [_cn()]
        ..cancel = (b) async {
          return (409, {'error': 'Credit note is already cancelled', 'code': 'CREDIT_NOTE_ALREADY_CANCELLED'});
        };
      await _pump(t, srv.build());
      await t.tap(find.text('CN-1'));
      await t.pumpAndSettle();
      srv.cn = _cn(status: 'cancelled');
      await _more(t, 'Cancel credit note');
      await t.enterText(find.byType(TextField).last, 'x');
      await t.tap(find.widgetWithText(KButton, 'Cancel credit note'));
      await t.pumpAndSettle();
      expect(find.text('This credit note was already cancelled.'), findsOneWidget);
      expect(find.text('Credit note is already cancelled'), findsNothing);
      expect(srv.count('GET', '/api/documents/credit_notes/cn1'), 2);
    });
  });

  group('note create', () {
    for (final debit in [false, true]) {
      final path = debit ? '/api/debit-notes' : '/api/credit-notes';
      testWidgets('${debit ? 'debit' : 'credit'} note posts once on a double tap, with no forbidden keys', (t) async {
        final gate = Completer<(int, Object?)>();
        final srv = _Srv()..post = (b) => gate.future;
        await _pumpForm(t, srv.build(), debit ? BillKind.debitNote : BillKind.creditNote);
        await _fillParty(t);
        await _fillItem(t);
        await t.tap(find.text('Save'));
        await t.tap(find.text('Save'), warnIfMissed: false);
        await t.pump(const Duration(milliseconds: 100));
        expect(srv.count('POST', path), 1);
        final body = srv.bodies['POST $path'] as Map;
        expect(body['customer_id'], 'c1');
        expect(body[debit ? 'debit_note_date' : 'credit_note_date'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
        expect(body[debit ? 'debit_note_number' : 'credit_note_number'], debit ? 'DN-4' : 'CN-8');
        for (final k in _forbidden) {
          expect(body.containsKey(k), isFalse, reason: k);
        }
        final line = (body['items'] as List).single as Map;
        expect(line['item_id'], 'it1');
        expect(line['qty'], 1);
        expect(line['unit_price'], 500);
        expect(line['tax_rate'], 18);
        expect(line.containsKey('tax_amount'), isFalse);
        gate.complete((201, {debit ? 'debitNote' : 'creditNote': {'id': 'x'}}));
        await t.pumpAndSettle();
        expect(srv.count('POST', path), 1);
      });
    }
  });

  group('next number prefill', () {
    Finder numberField(String label) => find.descendant(of: find.widgetWithText(KTextField, label), matching: find.byType(TextField));
    String numberText(WidgetTester t, String label) => t.widget<TextField>(numberField(label)).controller!.text;

    testWidgets('credit note opens with the server number and a typed change is sent', (t) async {
      final srv = _Srv();
      await _pumpForm(t, srv.build(), BillKind.creditNote);
      expect(srv.count('GET', '/api/credit-notes'), 1);
      expect(numberText(t, 'Number'), 'CN-8');
      await t.enterText(numberField('Number'), 'CN-20');
      await _fillParty(t);
      await _fillItem(t);
      await t.tap(find.text('Save'));
      await t.pumpAndSettle();
      expect((srv.bodies['POST /api/credit-notes'] as Map)['credit_note_number'], 'CN-20');
    });

    testWidgets('credit note: a failed fetch leaves it empty with no error, and Save asks for a number', (t) async {
      final srv = _Srv()..nextCn = null;
      await _pumpForm(t, srv.build(), BillKind.creditNote);
      expect(numberText(t, 'Number'), '');
      expect(find.textContaining('Boom'), findsNothing);
      await _fillParty(t);
      await _fillItem(t);
      await t.tap(find.text('Save'));
      await t.pumpAndSettle();
      expect(find.text('Enter a number.'), findsOneWidget);
      expect(srv.count('POST', '/api/credit-notes'), 0);
      await t.enterText(numberField('Number'), 'CN-1');
      await t.tap(find.text('Save'));
      await t.pumpAndSettle();
      expect((srv.bodies['POST /api/credit-notes'] as Map)['credit_note_number'], 'CN-1');
    });

    testWidgets('debit note opens with the server number', (t) async {
      final srv = _Srv();
      await _pumpForm(t, srv.build(), BillKind.debitNote);
      expect(numberText(t, 'Bill number (optional)'), 'DN-4');
      await _fillParty(t);
      await _fillItem(t);
      await t.tap(find.text('Save'));
      await t.pumpAndSettle();
      expect((srv.bodies['POST /api/debit-notes'] as Map)['debit_note_number'], 'DN-4');
    });

    testWidgets('debit note: a failed fetch leaves it empty and the server numbers it', (t) async {
      final srv = _Srv()..nextDn = null;
      await _pumpForm(t, srv.build(), BillKind.debitNote);
      expect(numberText(t, 'Bill number (optional)'), '');
      await _fillParty(t);
      await _fillItem(t);
      await t.tap(find.text('Save'));
      await t.pumpAndSettle();
      expect((srv.bodies['POST /api/debit-notes'] as Map)['debit_note_number'], isNull);
    });

    testWidgets('sales order takes the first free SO number and sends it', (t) async {
      final srv = _Srv()..soRows = [{'order_number': 'SO-001'}, {'order_number': 'SO-002'}, {'order_number': 'SO-004'}];
      await _pumpForm(t, srv.build(), BillKind.salesOrder);
      expect(numberText(t, 'Number'), 'SO-003');
      await _fillParty(t);
      await _fillItem(t);
      await t.tap(find.text('Save'));
      await t.pumpAndSettle();
      expect((srv.bodies['POST /api/sales-orders'] as Map)['order_number'], 'SO-003');
    });

    testWidgets('purchase order takes the first free PO number and sends it', (t) async {
      final srv = _Srv()..poRows = [{'order_number': 'PO-001'}];
      await _pumpForm(t, srv.build(), BillKind.purchaseOrder);
      expect(numberText(t, 'Number'), 'PO-002');
      await _fillParty(t);
      await _fillItem(t);
      await t.tap(find.text('Save'));
      await t.pumpAndSettle();
      expect((srv.bodies['POST /api/purchase-orders'] as Map)['order_number'], 'PO-002');
    });

    test('firstFreeNumber skips numbers in use', () {
      expect(firstFreeNumber('SO', []), 'SO-001');
      expect(firstFreeNumber('SO', ['SO-001', 'SO-003']), 'SO-002');
    });
  });

  group('invoice number when opened by id', () {
    testWidgets('a note opened with only its id reads the invoice number', (t) async {
      final srv = _Srv()..cn = {..._cn(), 'invoice_number': null};
      final s = srv.build();
      _tall(t);
      await t.pumpWidget(MaterialApp(home: NoteDetailScreen(session: s, noteId: 'cn1')));
      await t.pumpAndSettle();
      expect(srv.count('GET', '/api/invoices/i1'), 1);
      expect(find.text('INV-5'), findsOneWidget);
    });

    testWidgets('a failing invoice read hides the Invoice row', (t) async {
      final srv = _Srv()
        ..cn = {..._cn(), 'invoice_number': null}
        ..invoiceGet = (500, {'error': 'Boom'});
      final s = srv.build();
      _tall(t);
      await t.pumpWidget(MaterialApp(home: NoteDetailScreen(session: s, noteId: 'cn1')));
      await t.pumpAndSettle();
      expect(find.text('Invoice'), findsNothing);
      expect(find.text('Damaged goods'), findsOneWidget);
    });
  });

  group('routing', () {
    test('both links open the native screen and are no longer generic', () {
      final s = _Srv().build();
      expect(nativeScreenFor(s, '/credit-notes'), isA<CreditDebitNotesScreen>());
      expect(nativeScreenFor(s, '/debit-notes'), isA<CreditDebitNotesScreen>());
      expect((nativeScreenFor(s, '/debit-notes') as CreditDebitNotesScreen).debit, isTrue);
      expect(stillGeneric.contains('/credit-notes'), isFalse);
      expect(stillGeneric.contains('/debit-notes'), isFalse);
    });
  });
}

import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/docs/doc_list_screen.dart';
import 'package:khatario_phone/screens/docs/doc_logic.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/fake_session.dart';

DocListSpec _spec({List<DocAction> Function(Map<String, dynamic>)? actions}) => DocListSpec(
      title: 'Quotations',
      href: '/quotations',
      path: '/api/quotations',
      listKey: 'quotations',
      titleOf: (r) => docText(r['number']),
      subtitleOf: (r) => docText(r['party']),
      amountOf: (r) => docNum(r['total']),
      statusOf: (r) => r['status'] is String ? r['status'] as String : null,
      searchKeys: const ['number', 'party'],
      filters: const [('', 'All'), ('draft', 'Draft')],
      rowActions: actions,
    );

Future<void> _pump(WidgetTester t, AppSession s, DocListSpec spec) async {
  await t.pumpWidget(MaterialApp(home: DocListScreen(session: s, spec: spec)));
  await t.pumpAndSettle();
}

/// Like fakeSession, but each reply is a future (status, body) so a test can hold a request back.
(AppSession, List<RequestOptions>) _gated(Future<(int, Object?)> Function(RequestOptions o) reply) {
  final sent = <RequestOptions>[];
  final dio = Dio(BaseOptions(baseUrl: 'https://x.test', validateStatus: (s) => s != null && s < 500));
  dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) async {
    sent.add(o);
    final (status, data) = await reply(o);
    h.resolve(Response(requestOptions: o, statusCode: status, data: data));
  }));
  return (AppSession(KhatarioApi(dio), {'user': {'id': 'u'}, 'business': {'id': 'b'}}), sent);
}

void main() {
  test('non-finite numbers are not numbers', () {
    expect(docNum('NaN'), isNull);
    expect(docNum('Infinity'), isNull);
    expect(docNum('-Infinity'), isNull);
    expect(docNum(double.nan), isNull);
    expect(docNum(double.infinity), isNull);
    expect(docNum(double.negativeInfinity), isNull);
    expect(docNum('12'), 12);
    expect(docPaging({'pagination': {'page': 'NaN', 'totalPages': 3}}), isNull);
    expect(docPaging({'pagination': {'page': 1, 'totalPages': 'Infinity'}}), isNull);
  });

  test('readers never throw on odd values', () {
    expect(docNum('12.50'), 12.5);
    expect(docNum({'a': 1}), isNull);
    expect(docNum(null), isNull);
    expect(docText(['x']), '');
    expect(docText(7), '7');
  });

  test('readPath walks dotted keys and gives null for gaps', () {
    final body = {'summary': {'total': 5, 'deep': {'x': 'y'}}, 'flat': 1, 'list': [1]};
    expect(readPath(body, 'flat'), 1);
    expect(readPath(body, 'summary.total'), 5);
    expect(readPath(body, 'summary.deep.x'), 'y');
    expect(readPath(body, 'summary.missing'), isNull);
    expect(readPath(body, 'flat.more'), isNull);
    expect(readPath(body, 'list.0'), isNull);
    expect(readPath(null, 'a.b'), isNull);
    expect(readPath([1], 'a'), isNull);
  });

  test('paging is read from the reply', () {
    expect(docPaging({'pagination': {'page': 1, 'totalPages': 3}}), (page: 1, totalPages: 3));
    expect(docPaging({'pagination': {'page': 2, 'total_pages': 4}}), (page: 2, totalPages: 4));
    expect(docPaging({'rows': []}), isNull);
  });

  test('rows come from a bare list or the list key; search filters by keys', () {
    expect(docRows([{'a': 1}, 5], 'x'), [{'a': 1}]);
    expect(docRows({'x': [{'a': 1}]}, 'x'), [{'a': 1}]);
    expect(docRows({'y': []}, 'x'), isEmpty);
    final rows = docRows([{'n': 'Q-1', 'p': 'Asha'}, {'n': 'Q-2', 'p': 'Ravi'}], 'x');
    expect(filterDocs(rows, 'rav', ['n', 'p']).single['n'], 'Q-2');
  });

  testWidgets('Show more asks for page 2 and appends', (t) async {
    final (s, sent) = fakeSession((o) {
      final page = o.uri.queryParameters['page'] == '2' ? 2 : 1;
      return {
        'quotations': page == 1
            ? [
                {'id': '1', 'number': 'Q-1', 'total': 100, 'status': 'draft', 'invoice_date': '2026-10-01'},
                {'id': '2', 'number': 'Q-2', 'total': '250.5', 'status': 'paid', 'invoice_date': '2026-10-01'},
              ]
            : [
                {'id': '3', 'number': 'Q-3', 'total': 1, 'invoice_date': '2026-09-30'},
                {'id': '4', 'number': 'Q-4', 'total': 2, 'invoice_date': '2026-09-30'},
              ],
        'pagination': {'page': page, 'totalPages': 2},
      };
    });
    await _pump(t, s, _spec());
    expect(find.text('Q-2'), findsOneWidget);
    expect(find.text('Q-3'), findsNothing);
    await t.tap(find.textContaining('Show more'));
    await t.pumpAndSettle();
    expect(sent.length, 2);
    expect(sent.last.uri.queryParameters['page'], '2');
    for (final n in ['Q-1', 'Q-2', 'Q-3', 'Q-4']) {
      expect(find.text(n), findsOneWidget);
    }
    expect(find.textContaining('Show more'), findsNothing);
    expect(sent.every((o) => !o.uri.queryParameters.containsKey('business_id')), isTrue);
  });

  testWidgets('a chip sends its filter', (t) async {
    final (s, sent) = fakeSession((_) => {'quotations': [{'id': '1', 'number': 'Q-1'}]});
    await _pump(t, s, _spec());
    await t.tap(find.text('Draft'));
    await t.pumpAndSettle();
    expect(sent.last.uri.queryParameters['status'], 'draft');
  });

  testWidgets('long press lists the row actions', (t) async {
    final (s, _) = fakeSession((_) => {'quotations': [{'id': '1', 'number': 'Q-1'}]});
    await _pump(t, s, _spec(actions: (r) => [DocAction('Duplicate', Icons.copy, (_) async => null)]));
    await t.longPress(find.text('Q-1'));
    await t.pumpAndSettle();
    expect(find.text('Duplicate'), findsOneWidget);
  });

  testWidgets('a 403 shows the no-access state without Try again', (t) async {
    final (s, _) = fakeSession((_) => {'error': 'Forbidden'}, status: 403);
    await _pump(t, s, _spec());
    expect(find.text('You do not have access to this'), findsOneWidget);
    expect(find.text('Try again'), findsNothing);
  });

  testWidgets('a plan error shows the lock state without Try again', (t) async {
    final (s, _) = fakeSession((_) => {'error': 'No', 'code': 'FEATURE_NOT_IN_PLAN'}, status: 403);
    await _pump(t, s, _spec());
    expect(find.text('Not included in your current plan'), findsOneWidget);
    expect(find.text('Try again'), findsNothing);
  });

  testWidgets('a server error offers Try again', (t) async {
    final (s, _) = fakeSession((_) => {'error': 'Boom'}, status: 400);
    await _pump(t, s, _spec());
    expect(find.text('Try again'), findsOneWidget);
  });

  testWidgets('an empty reply shows the empty state', (t) async {
    final (s, _) = fakeSession((_) => {'quotations': []});
    await _pump(t, s, _spec());
    expect(find.byType(KEmptyState), findsOneWidget);
  });

  testWidgets('a row with a null amount and a list as status still draws', (t) async {
    final (s, _) = fakeSession((_) => [
          {'id': '1', 'number': 'Q-9', 'total': null, 'status': ['x'], 'party': {'a': 1}},
        ]);
    await _pump(t, s, _spec());
    expect(find.text('Q-9'), findsOneWidget);
    expect(t.takeException(), isNull);
  });

  testWidgets('a Show more that a filter change superseded neither toasts nor appends', (t) async {
    final staleMore = Completer<(int, Object?)>();
    var pageTwoCalls = 0;
    final (s, sent) = _gated((o) {
      final q = o.uri.queryParameters;
      final draft = q['status'] == 'draft';
      if (q['page'] == '2') {
        pageTwoCalls++;
        if (pageTwoCalls == 1) return staleMore.future;
        return Future.value((200, {
          'quotations': [{'id': 'd2', 'number': 'D-2', 'invoice_date': '2026-10-01'}],
          'pagination': {'page': 2, 'totalPages': 2},
        }));
      }
      return Future.value((200, {
        'quotations': [{'id': draft ? 'd1' : 'a1', 'number': draft ? 'D-1' : 'Q-1', 'invoice_date': '2026-10-01'}],
        'pagination': {'page': 1, 'totalPages': 2},
      }));
    });
    await _pump(t, s, _spec());
    await t.tap(find.textContaining('Show more'));
    await t.pump();
    await t.tap(find.text('Draft'));
    await t.pumpAndSettle();
    expect(find.text('D-1'), findsOneWidget);
    expect(find.text('Q-1'), findsNothing);
    staleMore.complete((400, {'error': 'Boom'}));
    await t.pumpAndSettle();
    expect(find.text('Boom'), findsNothing);
    expect(find.text('D-1'), findsOneWidget);
    await t.tap(find.textContaining('Show more'));
    await t.pumpAndSettle();
    expect(sent.last.uri.queryParameters['page'], '2');
    expect(sent.last.uri.queryParameters['status'], 'draft');
    expect(find.text('D-2'), findsOneWidget);
    await t.pump(const Duration(seconds: 4));
  });

  testWidgets('a failed pull to refresh keeps the rows and toasts the message', (t) async {
    var fail = false;
    final (s, _) = _gated((_) async => fail
        ? (400, {'error': 'Boom'})
        : (200, {'quotations': [{'id': '1', 'number': 'Q-1', 'invoice_date': '2026-10-01'}]}));
    await _pump(t, s, _spec());
    fail = true;
    await t.fling(find.text('Q-1'), const Offset(0, 300), 1000);
    await t.pumpAndSettle();
    expect(find.text('Q-1'), findsOneWidget);
    expect(find.text('Boom'), findsOneWidget);
    expect(find.text('Try again'), findsNothing);
    await t.pump(const Duration(seconds: 4));
  });

  testWidgets('a failed filter change still shows the full-page error', (t) async {
    final (s, _) = _gated((o) async => o.uri.queryParameters['status'] == 'draft'
        ? (400, {'error': 'Boom'})
        : (200, {'quotations': [{'id': '1', 'number': 'Q-1', 'invoice_date': '2026-10-01'}]}));
    await _pump(t, s, _spec());
    await t.tap(find.text('Draft'));
    await t.pumpAndSettle();
    expect(find.text('Try again'), findsOneWidget);
    expect(find.text('Q-1'), findsNothing);
  });
}

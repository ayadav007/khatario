import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/docs/doc_detail_screen.dart';
import 'package:khatario_phone/screens/docs/doc_list_screen.dart';
import 'package:khatario_phone/screens/docs/doc_logic.dart';
import 'package:khatario_phone/session.dart';

import 'support/fake_session.dart';

const _doc = {
  'id': '1',
  'number': 'Q-100',
  'party': 'Asha Traders',
  'status': 'draft',
  'total': 1180,
  'valid_till': '',
  'notes': 'Net 15',
};

DocDetailSpec _spec({
  Future<Map<String, dynamic>> Function(KhatarioApi api)? load,
  DocAction? Function(Map<String, dynamic>)? primary,
  List<DocAction> Function(Map<String, dynamic>)? actions,
  String? Function(Map<String, dynamic>)? historyPath,
}) =>
    DocDetailSpec(
      title: 'Quotation',
      load: load ?? (_) async => Map<String, dynamic>.from(_doc),
      numberOf: (d) => docText(d['number']),
      statusOf: (d) => docText(d['status']),
      partyOf: (d) => docText(d['party']),
      amountOf: (d) => docNum(d['total']),
      facts: (d) => [('Valid till', docText(d['valid_till'])), ('Notes', docText(d['notes']))],
      lines: (d) => [DocLine('Widget', subtitle: '2 x 500', amount: 1000)],
      totals: (d) => [('Tax', 180), ('Total', 1180)],
      primary: primary,
      actions: actions,
      historyPath: historyPath,
    );

Future<void> _pump(WidgetTester t, AppSession s, DocDetailSpec spec, {Map<String, dynamic>? seed}) async {
  await t.pumpWidget(MaterialApp(home: DocDetailScreen(session: s, spec: spec, seed: seed)));
  await t.pumpAndSettle();
}

void main() {
  testWidgets('header shows number, party and status', (t) async {
    final (s, _) = fakeSession((_) => {});
    await _pump(t, s, _spec());
    expect(find.text('Q-100'), findsOneWidget);
    expect(find.text('Asha Traders'), findsOneWidget);
    expect(find.text('Draft'), findsOneWidget);
    expect(find.text('Widget'), findsOneWidget);
  });

  testWidgets('facts with empty values are not drawn', (t) async {
    final (s, _) = fakeSession((_) => {});
    await _pump(t, s, _spec());
    expect(find.text('Notes'), findsOneWidget);
    expect(find.text('Net 15'), findsOneWidget);
    expect(find.text('Valid till'), findsNothing);
  });

  testWidgets('a double tap on the primary action sends one request', (t) async {
    final (s, sent) = fakeSession((_) => {});
    final gate = Completer<bool?>();
    final spec = _spec(primary: (d) => DocAction('Send', Icons.send, (ctx) async {
          await s.api.postJson('/api/quotations/1/send', {});
          return gate.future;
        }));
    await _pump(t, s, spec);
    await t.tap(find.text('Send'));
    await t.pump();
    await t.tap(find.text('Send'), warnIfMissed: false);
    await t.pump();
    gate.complete(false);
    await t.pumpAndSettle();
    expect(sent.where((o) => o.method == 'POST').length, 1);
  });

  testWidgets('an action that throws shows the message and stays open', (t) async {
    final (s, _) = fakeSession((_) => {});
    final spec = _spec(primary: (d) => DocAction('Lock', Icons.lock, (ctx) async => throw ApiException('Period is locked')));
    await _pump(t, s, spec);
    await t.tap(find.text('Lock'));
    await t.pumpAndSettle();
    expect(find.text('Period is locked'), findsOneWidget);
    expect(find.byType(DocDetailScreen), findsOneWidget);
  });

  testWidgets('seed is visible before load completes', (t) async {
    final (s, _) = fakeSession((_) => {});
    final gate = Completer<Map<String, dynamic>>();
    await t.pumpWidget(MaterialApp(
      home: DocDetailScreen(session: s, spec: _spec(load: (_) => gate.future), seed: {'number': 'Q-SEED', 'status': 'draft'}),
    ));
    await t.pump();
    expect(find.text('Q-SEED'), findsOneWidget);
    gate.complete(Map<String, dynamic>.from(_doc));
    await t.pumpAndSettle();
    expect(find.text('Q-SEED'), findsNothing);
    expect(find.text('Q-100'), findsOneWidget);
  });

  testWidgets('a load error without seed offers Try again', (t) async {
    final (s, _) = fakeSession((_) => {});
    await _pump(t, s, _spec(load: (_) async => throw ApiException('Boom')));
    expect(find.text('Try again'), findsOneWidget);
  });

  testWidgets('a plan error locks with no retry', (t) async {
    final (s, _) = fakeSession((_) => {});
    await _pump(t, s, _spec(load: (_) async => throw ApiException('No', status: 403, code: 'FEATURE_NOT_IN_PLAN')));
    expect(find.text('Not included in your current plan'), findsOneWidget);
    expect(find.text('Try again'), findsNothing);
  });

  testWidgets('a load error with seed keeps the seed and shows the message', (t) async {
    final (s, _) = fakeSession((_) => {});
    await _pump(t, s, _spec(load: (_) async => throw ApiException('Boom')), seed: {'number': 'Q-SEED'});
    expect(find.text('Q-SEED'), findsOneWidget);
    expect(find.text('Boom'), findsOneWidget);
  });

  testWidgets('More lists actions; a true result reloads and pops true', (t) async {
    final (s, _) = fakeSession((_) => {});
    var loads = 0;
    Object? popped;
    final spec = _spec(
      load: (_) async {
        loads++;
        return Map<String, dynamic>.from(_doc);
      },
      actions: (d) => [DocAction('Approve', Icons.check, (_) async => true)],
    );
    await t.pumpWidget(MaterialApp(
      home: Builder(
        builder: (ctx) => Scaffold(
          body: TextButton(
            onPressed: () async => popped = await Navigator.of(ctx).push<bool>(MaterialPageRoute(builder: (_) => DocDetailScreen(session: s, spec: spec))),
            child: const Text('open'),
          ),
        ),
      ),
    ));
    await t.tap(find.text('open'));
    await t.pumpAndSettle();
    await t.tap(find.byTooltip('More'));
    await t.pumpAndSettle();
    await t.tap(find.text('Approve'));
    await t.pumpAndSettle();
    expect(loads, 2);
    await t.tap(find.byIcon(LucideIcons.arrowLeft));
    await t.pumpAndSettle();
    expect(popped, true);
  });

  testWidgets('history rows are drawn and a failing history draws nothing', (t) async {
    final (s, sent) = fakeSession((o) => [
          {'description': 'Created', 'user_name': 'Ravi', 'created_at': '2026-10-01T10:00:00Z', 'action_type': 'create'},
        ]);
    await _pump(t, s, _spec(historyPath: (d) => '/api/quotations/1/history'));
    expect(find.text('Created'), findsOneWidget);
    expect(sent.single.uri.path, '/api/quotations/1/history');
  });

  testWidgets('a failing history request draws nothing', (t) async {
    final (bad, _) = fakeSession((_) => {'error': 'x'}, status: 400);
    await _pump(t, bad, _spec(historyPath: (d) => '/api/quotations/1/history'));
    expect(find.text('Q-100'), findsOneWidget);
    expect(find.text('History'), findsNothing);
  });

  testWidgets('two taps in one frame run the primary action once', (t) async {
    final (s, _) = fakeSession((_) => {});
    var entered = 0;
    final gate = Completer<bool?>();
    final spec = _spec(primary: (d) => DocAction('Send', Icons.send, (ctx) {
          entered++;
          return gate.future;
        }));
    await _pump(t, s, spec);
    await t.tap(find.text('Send'));
    await t.tap(find.text('Send'), warnIfMissed: false);
    await t.pump();
    expect(entered, 1);
    gate.complete(false);
    await t.pumpAndSettle();
    expect(entered, 1);
  });

  testWidgets('an action picked from More does not start while another is running', (t) async {
    final (s, _) = fakeSession((_) => {});
    var primaryEntered = 0, approveEntered = 0;
    final gate = Completer<bool?>();
    final spec = _spec(
      primary: (d) => DocAction('Send', Icons.send, (ctx) {
        primaryEntered++;
        return gate.future;
      }),
      actions: (d) => [
        DocAction('Approve', Icons.check, (_) async {
          approveEntered++;
          return false;
        }),
      ],
    );
    await _pump(t, s, spec);
    await t.tap(find.text('Send'));
    await t.pump();
    await t.tap(find.byTooltip('More'));
    await t.pump();
    await t.pump(const Duration(seconds: 1)); // the busy spinner never settles
    await t.tap(find.text('Approve'));
    await t.pump(const Duration(seconds: 1));
    expect(approveEntered, 0);
    expect(primaryEntered, 1);
    gate.complete(false);
    await t.pumpAndSettle();
    expect(approveEntered, 0);
  });

  testWidgets('after a failed reload the old document stays but offers no actions until a reload works', (t) async {
    final (s, _) = fakeSession((_) => {});
    var loads = 0;
    final spec = _spec(
      load: (_) async {
        loads++;
        if (loads == 2) throw ApiException('Boom');
        return Map<String, dynamic>.from(_doc);
      },
      primary: (d) => DocAction('Send', Icons.send, (_) async => true),
      actions: (d) => [DocAction('Approve', Icons.check, (_) async => false)],
    );
    await _pump(t, s, spec);
    expect(find.byTooltip('More'), findsOneWidget);
    await t.tap(find.text('Send'));
    await t.pumpAndSettle();
    expect(loads, 2);
    expect(find.text('Q-100'), findsOneWidget);
    expect(find.text('Boom'), findsOneWidget);
    expect(find.text('Send'), findsNothing);
    expect(find.byTooltip('More'), findsNothing);
    await t.pump(const Duration(seconds: 4));

    await t.fling(find.text('Q-100'), const Offset(0, 300), 1000);
    await t.pumpAndSettle();
    expect(loads, 3);
    expect(find.text('Send'), findsOneWidget);
    expect(find.byTooltip('More'), findsOneWidget);
  });
}

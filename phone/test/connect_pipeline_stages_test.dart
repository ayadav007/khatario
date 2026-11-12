import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/chats/pipeline_screen.dart';
import 'package:khatario_phone/screens/chats/pipeline_stages_screen.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/recorded_session.dart';

Map<String, dynamic> _stages() => {
      'stages': [
        {'id': 's1', 'name': 'New', 'color': 'blue', 'kind': 'open', 'position': 1},
        {'id': 's2', 'name': 'Quoted', 'color': 'amber', 'kind': 'open', 'position': 2},
        {'id': 's3', 'name': 'Won', 'color': 'green', 'kind': 'won', 'position': 3},
      ],
    };

Reply _ok(RequestOptions o, Map b) {
  if (o.uri.path == '/api/whatsapp/pipeline/stages' && o.method == 'GET') return (200, _stages());
  if (o.uri.path == '/api/whatsapp/pipeline') return (200, {'columns': []});
  return (200, <String, dynamic>{});
}

Finder _icon(String label) => find.byWidgetPredicate((w) => w is KIconButton && w.tooltip == label);

Future<void> _tapText(WidgetTester t, String text, {bool last = false}) async {
  final f = last ? find.text(text).last : find.text(text).first;
  await t.ensureVisible(f);
  await t.tap(f);
  await t.pumpAndSettle();
}

Future<void> _sheet(WidgetTester t, String text) async {
  await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text(text)));
  await t.pumpAndSettle();
}

void main() {
  testWidgets('the board has a Stages button that opens the manager', (t) async {
    final (s, _) = recordedSession((o, b) => _ok(o, b));
    await pumpScreen(t, PipelineScreen(session: s));
    await t.tap(_icon('Stages'));
    await t.pumpAndSettle();
    expect(find.byType(PipelineStagesScreen), findsOneWidget);
  });

  testWidgets('lists the stages with colour and type; no business id is sent', (t) async {
    final (s, sent) = recordedSession((o, b) => _ok(o, b));
    await pumpScreen(t, PipelineStagesScreen(session: s));
    expect(find.text('New'), findsWidgets);
    expect(find.text('Quoted'), findsWidgets);
    expect(find.text('Blue'), findsOneWidget);
    expect(find.text('Amber'), findsOneWidget);
    expect(sent.map((o) => o.uri.query).where((q) => q.contains('business_id')), isEmpty);
  });

  testWidgets('a server error offers Try again; a plan without Connect does not', (t) async {
    var fail = true;
    final (s, sent) = recordedSession((o, b) => fail ? (400, {'error': 'Could not load stages'}) : _ok(o, b));
    await pumpScreen(t, PipelineStagesScreen(session: s));
    expect(find.text('Could not load stages'), findsOneWidget);
    fail = false;
    await t.tap(find.text('Try again'));
    await t.pumpAndSettle();
    expect(find.text('Quoted'), findsWidgets);
    expect(requestCount(sent, 'GET', '/api/whatsapp/pipeline/stages'), 2);
    final (locked, _) = recordedSession((o, b) => (403, {'error': 'x', 'code': 'FEATURE_NOT_IN_PLAN'}));
    await pumpScreen(t, PipelineStagesScreen(session: locked));
    expect(find.text('Not included in your current plan'), findsOneWidget);
  });

  testWidgets('Add stage posts name and type, and needs a name', (t) async {
    final (s, sent) = recordedSession((o, b) => _ok(o, b));
    await pumpScreen(t, PipelineStagesScreen(session: s));
    await _tapText(t, 'Add stage');
    expect(find.text('Enter a stage name'), findsOneWidget);
    expect(requestCount(sent, 'POST', '/api/whatsapp/pipeline/stages'), 0);
    await t.enterText(find.byType(TextField).first, ' Negotiation ');
    await t.pump();
    await _tapText(t, 'Add stage');
    final body = requestsOf(sent, 'POST', '/api/whatsapp/pipeline/stages').single.data as Map;
    expect(body, {'name': 'Negotiation', 'kind': 'open'});
    expectNoIdentity(body);
    expect(requestCount(sent, 'GET', '/api/whatsapp/pipeline/stages'), 2);
  });

  testWidgets('Rename sends only the name; Colour sends only the colour', (t) async {
    final (s, sent) = recordedSession((o, b) => _ok(o, b));
    await pumpScreen(t, PipelineStagesScreen(session: s));
    await t.tap(_icon('Rename New'));
    await t.pumpAndSettle();
    await t.enterText(find.descendant(of: find.byType(BottomSheet), matching: find.byType(TextField)), ' Fresh ');
    await _sheet(t, 'Rename');
    expect(requestsOf(sent, 'PATCH', '/api/whatsapp/pipeline/stages/s1').single.data, {'name': 'Fresh'});
    await _tapText(t, 'Amber');
    await _sheet(t, 'Red');
    expect(requestsOf(sent, 'PATCH', '/api/whatsapp/pipeline/stages/s2').single.data, {'color': 'red'});
  });

  testWidgets('Changing a stage type asks first, naming the stage, then sends only the type', (t) async {
    final (s, sent) = recordedSession((o, b) => _ok(o, b));
    await pumpScreen(t, PipelineStagesScreen(session: s));
    await _tapText(t, 'Open', last: false);
    await _sheet(t, 'Lost');
    expect(find.text('Make New a Lost stage?'), findsOneWidget);
    await _sheet(t, 'Not now');
    expect(requestCount(sent, 'PATCH', '/api/whatsapp/pipeline/stages/s1'), 0);
    await _tapText(t, 'Open');
    await _sheet(t, 'Lost');
    await _sheet(t, 'Make it Lost');
    expect(requestsOf(sent, 'PATCH', '/api/whatsapp/pipeline/stages/s1').single.data, {'kind': 'lost'});
  });

  testWidgets('Move up and down send the whole new order; the ends cannot move outward', (t) async {
    final (s, sent) = recordedSession((o, b) => _ok(o, b));
    await pumpScreen(t, PipelineStagesScreen(session: s));
    await t.tap(_icon('Move Quoted up'));
    await t.pumpAndSettle();
    expect(requestsOf(sent, 'PUT', '/api/whatsapp/pipeline/stages').single.data, {'order': ['s2', 's1', 's3']});
    expect(_icon('Move New up'), findsNothing);
    expect(_icon('Move Won down'), findsNothing);
  });

  testWidgets('Delete asks which stage takes the chats, then asks to confirm, then deletes once', (t) async {
    final (s, sent) = recordedSession((o, b) => _ok(o, b));
    await pumpScreen(t, PipelineStagesScreen(session: s));
    await t.tap(_icon('Delete Quoted'));
    await t.pumpAndSettle();
    expect(find.text('Move Quoted\'s chats to'), findsOneWidget);
    await _sheet(t, 'New');
    expect(find.text('Delete Quoted?'), findsOneWidget);
    await _sheet(t, 'Not now');
    expect(requestCount(sent, 'DELETE', '/api/whatsapp/pipeline/stages/s2'), 0);
    await t.tap(_icon('Delete Quoted'));
    await t.pumpAndSettle();
    await _sheet(t, 'Take them off the board');
    await _sheet(t, 'Delete stage');
    final del = requestsOf(sent, 'DELETE', '/api/whatsapp/pipeline/stages/s2').single;
    expect(del.uri.query, '');
    await t.tap(_icon('Delete Quoted'));
    await t.pumpAndSettle();
    await _sheet(t, 'New');
    await _sheet(t, 'Delete stage');
    expect(requestsOf(sent, 'DELETE', '/api/whatsapp/pipeline/stages/s2').last.uri.queryParameters, {'move_to': 's1'});
  });

  testWidgets('a refusal shows the server text; a bare 403 says the setup permission is needed', (t) async {
    var mode = 'dup';
    final (s, _) = recordedSession((o, b) {
      if (o.method == 'PATCH') {
        return mode == 'dup' ? (409, {'error': 'A stage with this name already exists', 'code': 'DUPLICATE'}) : (403, {'error': 'Permission denied', 'code': 'PERMISSION_DENIED'});
      }
      return _ok(o, b);
    });
    await pumpScreen(t, PipelineStagesScreen(session: s));
    await t.tap(_icon('Rename New'));
    await t.pumpAndSettle();
    await t.enterText(find.descendant(of: find.byType(BottomSheet), matching: find.byType(TextField)), 'Quoted');
    await _sheet(t, 'Rename');
    expect(find.text('A stage with this name already exists'), findsOneWidget);
    mode = 'forbidden';
    await _tapText(t, 'Amber');
    await _sheet(t, 'Red');
    expect(find.text('You need the WhatsApp setup permission to change stages'), findsOneWidget);
  });
}

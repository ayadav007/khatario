import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/ui/form_kit.dart';
import 'package:khatario_phone/ui/toast.dart';

import 'support/fake_session.dart';

Future<void> _pump(WidgetTester t, Widget home) async {
  await t.pumpWidget(MaterialApp(home: home));
  await t.pumpAndSettle();
}

void main() {
  testWidgets('two fast taps on save send one save', (t) async {
    var calls = 0;
    final gate = Completer<void>();
    await _pump(
      t,
      KFormScaffold(
        title: 'New thing',
        saveLabel: 'Save thing',
        onSave: () {
          calls++;
          return gate.future;
        },
        children: const [],
      ),
    );
    await t.tap(find.text('Save thing'));
    await t.tap(find.text('Save thing'), warnIfMissed: false);
    await t.pump();
    expect(calls, 1);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    gate.complete();
    await t.pumpAndSettle();
    expect(calls, 1);
    expect(find.byType(CircularProgressIndicator), findsNothing);
  });

  testWidgets('a refused save shows the server text and keeps the typed value', (t) async {
    final name = TextEditingController(text: 'Asha Traders');
    addTearDown(name.dispose);
    await _pump(
      t,
      KFormScaffold(
        title: 'New supplier',
        saveLabel: 'Save',
        onSave: () async => throw ApiException('GSTIN already exists', status: 400),
        children: [KTextField(label: 'Name', controller: name)],
      ),
    );
    await t.tap(find.text('Save'));
    await t.pump();
    await t.pump();
    expect(find.text('GSTIN already exists'), findsOneWidget);
    expect(name.text, 'Asha Traders');
    expect(find.text('Asha Traders'), findsOneWidget);
    // Not stuck on the spinner: the button is usable again.
    expect(find.byType(CircularProgressIndicator), findsNothing);
    await t.pump(const Duration(seconds: 4));
    expect(find.text('GSTIN already exists'), findsNothing);
  });

  testWidgets('an unexpected failure shows a plain message', (t) async {
    await _pump(
      t,
      KFormScaffold(title: 'T', saveLabel: 'Save', onSave: () async => throw StateError('boom'), children: const []),
    );
    await t.tap(find.text('Save'));
    await t.pump();
    await t.pump();
    expect(find.text('Could not save. Try again.'), findsOneWidget);
    await t.pump(const Duration(seconds: 4));
  });

  testWidgets('back on a dirty form asks before leaving', (t) async {
    await t.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: TextButton(
              onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(
                builder: (_) => KFormScaffold(title: 'Edit', saveLabel: 'Save', onSave: () async {}, dirty: true, children: const []),
              )),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ));
    await t.tap(find.text('open'));
    await t.pumpAndSettle();
    expect(find.text('Edit'), findsOneWidget);

    await t.tap(find.byIcon(LucideIcons.arrowLeft));
    await t.pumpAndSettle();
    expect(find.text('Discard changes?'), findsOneWidget);
    expect(find.text('Edit'), findsOneWidget);

    await t.tap(find.text('Keep editing'));
    await t.pumpAndSettle();
    expect(find.text('Discard changes?'), findsNothing);
    expect(find.text('Edit'), findsOneWidget);

    await t.tap(find.byIcon(LucideIcons.arrowLeft));
    await t.pumpAndSettle();
    await t.tap(find.text('Discard'));
    await t.pumpAndSettle();
    expect(find.text('Edit'), findsNothing);
    expect(find.text('open'), findsOneWidget);
  });

  testWidgets('back on a clean form leaves at once', (t) async {
    await t.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(
              builder: (_) => KFormScaffold(title: 'Edit', saveLabel: 'Save', onSave: () async {}, children: const []),
            )),
            child: const Text('open'),
          ),
        ),
      ),
    ));
    await t.tap(find.text('open'));
    await t.pumpAndSettle();
    await t.tap(find.byIcon(LucideIcons.arrowLeft));
    await t.pumpAndSettle();
    expect(find.text('Discard changes?'), findsNothing);
    expect(find.text('open'), findsOneWidget);
  });

  testWidgets('KAmountField shows the rupee sign and an error', (t) async {
    final c = TextEditingController();
    addTearDown(c.dispose);
    await _pump(t, Scaffold(body: KAmountField(label: 'Amount', controller: c, error: 'Enter an amount')));
    expect(find.text('₹'), findsOneWidget);
    expect(find.text('Amount'), findsOneWidget);
    expect(find.text('Enter an amount'), findsOneWidget);
    await t.enterText(find.byType(TextField), '12a3.456');
    expect(c.text, '123.45');
  });

  testWidgets('KPickField shows the chosen label and changes it', (t) async {
    String? picked;
    await _pump(
      t,
      Scaffold(
        body: KPickField<String>(
          label: 'Type',
          value: 'b',
          options: const [('a', 'Alpha'), ('b', 'Bravo')],
          onChanged: (v) => picked = v,
        ),
      ),
    );
    expect(find.text('Bravo'), findsOneWidget);
    await t.tap(find.text('Bravo'));
    await t.pumpAndSettle();
    await t.tap(find.text('Alpha'));
    await t.pumpAndSettle();
    expect(picked, 'a');
  });

  testWidgets('KPickField with no value shows a prompt', (t) async {
    await _pump(
      t,
      Scaffold(
        body: KPickField<int>(label: 'Type', value: null, options: const [(1, 'One')], onChanged: (_) {}, searchable: true),
      ),
    );
    expect(find.text('Select'), findsOneWidget);
    await t.tap(find.text('Select'));
    await t.pumpAndSettle();
    expect(find.text('One'), findsOneWidget);
  });

  testWidgets('KToggleField flips and shows help', (t) async {
    var on = false;
    await _pump(
      t,
      StatefulBuilder(
        builder: (context, set) => Scaffold(
          body: KToggleField(label: 'Active', value: on, help: 'Shown in lists', onChanged: (v) => set(() => on = v)),
        ),
      ),
    );
    expect(find.text('Shown in lists'), findsOneWidget);
    await t.tap(find.byType(Switch));
    await t.pump();
    expect(on, isTrue);
  });

  testWidgets('KDateField shows the date', (t) async {
    await _pump(t, Scaffold(body: KDateField(label: 'Date', value: DateTime(2026, 3, 5), onChanged: (_) {})));
    expect(find.text('05 Mar 2026'), findsOneWidget);
  });

  testWidgets('KAsyncPickField searches and returns the pick', (t) async {
    final queries = <String>[];
    String? id;
    await _pump(
      t,
      Scaffold(
        body: KAsyncPickField(
          label: 'Customer',
          valueLabel: null,
          search: (q) async {
            queries.add(q);
            return [('c1', 'Asha', '98200 00000')];
          },
          onPicked: (i, l) => id = '$i/$l',
        ),
      ),
    );
    await t.tap(find.text('Select'));
    await t.pumpAndSettle();
    expect(queries, ['']);
    expect(find.text('98200 00000'), findsOneWidget);
    await t.tap(find.text('Asha'));
    await t.pumpAndSettle();
    expect(id, 'c1/Asha');
  });

  testWidgets('a new toast replaces the old one and goes after 3 seconds', (t) async {
    late BuildContext ctx;
    await _pump(t, Builder(builder: (c) {
      ctx = c;
      return const Scaffold(body: SizedBox());
    }));
    showKToast(ctx, 'First');
    await t.pump();
    showKToast(ctx, 'Second');
    await t.pump();
    expect(find.text('First'), findsNothing);
    expect(find.text('Second'), findsOneWidget);
    await t.pump(const Duration(seconds: 2));
    expect(find.text('Second'), findsOneWidget);
    await t.pump(const Duration(seconds: 2));
    expect(find.text('Second'), findsNothing);
  });

  testWidgets('a toast with no Overlay does not throw', (t) async {
    late BuildContext ctx;
    await t.pumpWidget(Builder(builder: (c) {
      ctx = c;
      return const SizedBox();
    }));
    showKToast(ctx, 'Nothing to show on');
    expect(t.takeException(), isNull);
  });

  group('searches', () {
    test('searchCustomers sends search= and reads customers', () async {
      final (s, sent) = fakeSession((_) => {
            'customers': [
              {'id': 'c1', 'name': 'Asha Traders', 'phone': '9820012345', 'gstin': '27ABCDE1234F1Z5'},
              {'id': 'c2', 'name': 'No Contact'},
              'junk',
            ],
          });
      final rows = await searchCustomers(s.api, ' Asha ');
      expect(sent.single.uri.path, '/api/customers');
      expect(sent.single.uri.queryParameters['search'], 'Asha');
      expect(sent.single.uri.queryParameters.containsKey('business_id'), isFalse);
      expect(rows.first, ('c1', 'Asha Traders', '9820012345 · 27ABCDE1234F1Z5'));
      expect(rows[1], ('c2', 'No Contact', ''));
      expect(rows.length, 2);
    });

    test('searchSuppliers sends search= and reads suppliers', () async {
      final (s, sent) = fakeSession((_) => {
            'suppliers': [
              {'id': 's1', 'name': 'Metro Wholesale', 'phone': '', 'gstin': '29AAAAA0000A1Z5'},
            ],
          });
      final rows = await searchSuppliers(s.api, 'metro');
      expect(sent.single.uri.path, '/api/suppliers');
      expect(sent.single.uri.queryParameters['search'], 'metro');
      expect(rows.single, ('s1', 'Metro Wholesale', '29AAAAA0000A1Z5'));
    });

    test('searchItems sends q= and shows unit and price', () async {
      final (s, sent) = fakeSession((_) => {
            'items': [
              {'id': 'i1', 'name': 'Widget', 'unit': 'pcs', 'selling_price': '250.00', 'code': 'W1'},
            ],
          });
      final rows = await searchItems(s.api, 'wid');
      expect(sent.single.uri.path, '/api/items/search');
      expect(sent.single.uri.queryParameters['q'], 'wid');
      expect(rows.single, ('i1', 'Widget', 'pcs · ₹250'));
    });

    test('searchItems with a blank query browses the catalogue', () async {
      final (s, sent) = fakeSession((_) => {'items': []});
      expect(await searchItems(s.api, '  '), isEmpty);
      expect(sent.single.uri.queryParameters['browse'], '1');
      expect(sent.single.uri.queryParameters.containsKey('q'), isFalse);
    });

    test('searchAccounts sends search= and shows code and group', () async {
      final (s, sent) = fakeSession((_) => {
            'accounts': [
              {'id': 'a1', 'account_name': 'Cash in Hand', 'account_code': '1001', 'account_group_name': 'Cash', 'account_type': 'asset'},
              {'id': 'a2', 'account_name': 'Rent', 'account_type': 'expense'},
            ],
          });
      final rows = await searchAccounts(s.api, 'cash');
      expect(sent.single.uri.path, '/api/accounts');
      expect(sent.single.uri.queryParameters['search'], 'cash');
      expect(rows[0], ('a1', 'Cash in Hand', '1001 · Cash'));
      expect(rows[1], ('a2', 'Rent', 'expense'));
    });

    test('searchEmployees sends search= and shows designation', () async {
      final (s, sent) = fakeSession((_) => {
            'employees': [
              {'id': 'e1', 'user_name': 'Ravi Kumar', 'designation': 'Cashier', 'employee_code': 'E-7'},
            ],
          });
      final rows = await searchEmployees(s.api, 'rav');
      expect(sent.single.uri.path, '/api/employees');
      expect(sent.single.uri.queryParameters['search'], 'rav');
      expect(rows.single, ('e1', 'Ravi Kumar', 'Cashier'));
    });

    test('odd replies give an empty list', () async {
      final (s, _) = fakeSession((_) => 'nope');
      expect(await searchCustomers(s.api, 'x'), isEmpty);
      expect(await searchEmployees(s.api, 'x'), isEmpty);
    });
  });

  testWidgets('a caps field upper-cases typed and pasted text', (t) async {
    final c = TextEditingController();
    addTearDown(c.dispose);
    await _pump(t, Scaffold(body: KTextField(label: 'GSTIN', controller: c, caps: true)));
    await t.enterText(find.byType(TextField), '29abcde1234f1z5');
    expect(c.text, '29ABCDE1234F1Z5');
  });

  testWidgets('capitalisation hint follows caps and keyboard', (t) async {
    final c = TextEditingController();
    addTearDown(c.dispose);
    Future<TextCapitalization> hint({bool caps = false, TextInputType? keyboard}) async {
      await t.pumpWidget(MaterialApp(home: Scaffold(body: KTextField(label: 'F', controller: c, caps: caps, keyboard: keyboard))));
      return t.widget<TextField>(find.byType(TextField)).textCapitalization;
    }

    expect(await hint(caps: true), TextCapitalization.characters);
    expect(await hint(), TextCapitalization.sentences);
    expect(await hint(keyboard: TextInputType.multiline), TextCapitalization.sentences);
    for (final k in [TextInputType.emailAddress, TextInputType.url, TextInputType.number, TextInputType.phone, TextInputType.visiblePassword]) {
      expect(await hint(keyboard: k), TextCapitalization.none, reason: '$k');
    }
  });

  testWidgets('back is ignored while a save is running', (t) async {
    final gate = Completer<void>();
    await t.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(
              builder: (_) => KFormScaffold(title: 'Edit', saveLabel: 'Save', onSave: () => gate.future, children: const []),
            )),
            child: const Text('open'),
          ),
        ),
      ),
    ));
    await t.tap(find.text('open'));
    await t.pumpAndSettle();
    await t.tap(find.text('Save'));
    await t.pump();
    await t.tap(find.byIcon(LucideIcons.arrowLeft));
    await t.pump(const Duration(milliseconds: 500)); // the save spinner never settles
    expect(find.text('Edit'), findsOneWidget);
    await t.binding.handlePopRoute();
    await t.pump(const Duration(milliseconds: 500));
    expect(find.text('Edit'), findsOneWidget);
    expect(find.text('open'), findsNothing);
    gate.complete();
    await t.pumpAndSettle();
    // After the save the page can be left again.
    await t.tap(find.byIcon(LucideIcons.arrowLeft));
    await t.pumpAndSettle();
    expect(find.text('open'), findsOneWidget);
  });
}

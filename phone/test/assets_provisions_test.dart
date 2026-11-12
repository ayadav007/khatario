import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/format.dart';
import 'package:khatario_phone/screens/accounting/assets_tds_logic.dart';
import 'package:khatario_phone/screens/accounting/fixed_assets_screen.dart';
import 'package:khatario_phone/screens/accounting/provisions_screen.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/ui/form_kit.dart';

import 'support/finders.dart';
import 'support/recorded_session.dart';

/// Pump while a bottom sheet is open over a saving form: the save button's spinner never settles.
Future<void> settle(WidgetTester t) async {
  await t.pump();
  await t.pump(const Duration(milliseconds: 100));
  await t.pump(const Duration(seconds: 1));
}

const _assetRow = {
  'id': 'fa1',
  'asset_code': 'FA-001',
  'asset_name': 'Laptop',
  'put_to_use_on': '2026-04-10',
  'purchase_cost': '60000.00',
  'depreciation_method': 'SLM',
  'useful_life_years': 3,
  'depreciation_rate': null,
  'current_book_value': '52000.00',
  'accumulated_depreciation': '8000.00',
  'is_disposed': false,
  'last_depreciated_to': '2026-09-30',
};

void main() {
  group('fixed asset logic', () {
    test('the Schedule II and Income-tax lists are the website lists', () {
      expect(kScheduleIi.length, 15);
      expect(scheduleIiYears('computer_end_user'), 3);
      expect(scheduleIiYears('building_rcc'), 60);
      expect(scheduleIiYears('nope'), isNull);
      expect(scheduleIiOptionLabel(kScheduleIi.first), 'Buildings (RCC frame, other than factory) (60 yrs)');
      expect(kItBlocks.length, 11);
      expect(itBlockOptionLabel(kItBlocks.firstWhere((b) => b.$1 == 'computers')), 'Computers and computer software (40%)');
      expect(itBlockLabel('computers'), 'Computers and computer software');
      expect(itBlockLabel('unknown_block'), 'unknown_block');
      expect(scheduleIiLabel('furniture'), 'Furniture and fittings');
    });

    test('accounts are picked from the website lists: asset 12xx except 1202, proceeds 11xx, any expense', () {
      final assets = {
        'accounts': [
          {'id': 'a1', 'account_code': '1201', 'account_name': 'Furniture'},
          {'id': 'a2', 'account_code': '1202', 'account_name': 'Accumulated depreciation'},
          {'id': 'a3', 'account_code': '1102', 'account_name': 'Bank'},
          {'id': 'a4', 'account_code': '1301', 'account_name': 'Stock'},
        ],
      };
      expect([for (final a in fixedAssetAccounts(assets)) a['id']], ['a1']);
      expect([for (final a in proceedsAccounts(assets)) a['id']], ['a3']);
      expect(accountDefaultId(fixedAssetAccounts(assets), '1201'), 'a1');
      expect(accountDefaultId(fixedAssetAccounts(assets), '9999'), '');
      expect(accountOptionLabel(assets['accounts']![0]), '1201 · Furniture');
    });

    test('a row reads the name, code, method, depreciated-to and the server amounts', () {
      expect(assetRowTitle(_assetRow), 'Laptop');
      expect(assetRowSubtitle(_assetRow), 'FA-001 · SLM 3y');
      expect(assetMethodLabel({'depreciation_method': 'WDV', 'depreciation_rate': '15.00', 'useful_life_years': 8}), 'WDV 15%');
      expect(assetMethodLabel({'depreciation_method': 'WDV', 'depreciation_rate': null, 'useful_life_years': 8}), 'WDV 8y');
      expect(assetDepreciatedTo(_assetRow), '30 Sep 2026');
      expect(assetDepreciatedTo({'last_depreciated_to': null}), 'Not yet');
      expect(assetDepreciatedTo({'is_disposed': true, 'disposal_date': '2026-11-02'}), 'Disposed 02 Nov 2026');
      expect(assetCanAct(_assetRow), isTrue);
      expect(assetCanAct({'is_disposed': true}), isFalse);
    });

    test('the add form names the first thing missing, in the website order', () {
      String? p({
        String code = 'FA-2',
        String name = 'Desk',
        String cost = '1000',
        String life = '5',
        String residual = '',
        DateTime? purchase,
        DateTime? putToUse,
        String account = 'a1',
        String depAccount = 'e1',
      }) =>
          fixedAssetProblem(
            code: code,
            name: name,
            costText: cost,
            lifeText: life,
            residualText: residual,
            purchaseDate: purchase ?? DateTime(2026, 11, 1),
            putToUseDate: putToUse ?? DateTime(2026, 11, 1),
            accountId: account,
            depreciationAccountId: depAccount,
          );
      expect(p(), isNull);
      expect(p(code: ' '), 'Enter the asset code');
      expect(p(name: ''), 'Enter the asset name');
      expect(p(cost: '0'), 'Cost must be above zero');
      expect(p(life: ''), 'Enter the useful life in years');
      expect(p(residual: '1000'), 'Residual value must be at least 0 and below the cost');
      expect(p(putToUse: DateTime(2026, 10, 31)), 'Put to use cannot be before the purchase date');
      expect(p(account: ''), 'Choose the asset account');
      expect(p(depAccount: ''), 'Choose the depreciation expense account');
    });

    test('the add body is the website one: numbers as numbers, optional text left out, no identity', () {
      final b = fixedAssetBody(
        code: ' FA-2 ',
        name: 'Desk',
        scheduleIiCategory: 'furniture',
        itBlock: 'furniture',
        purchaseDate: DateTime(2026, 11, 1),
        putToUseDate: DateTime(2026, 11, 3),
        costText: '1,250.50',
        residualText: '',
        method: 'WDV',
        lifeText: '10',
        rateText: '12.5',
        accountId: 'a1',
        depreciationAccountId: 'e1',
        funding: 'cash',
        vendor: '',
        invoiceNumber: ' INV-9 ',
      );
      expect(b, {
        'asset_code': 'FA-2',
        'asset_name': 'Desk',
        'schedule_ii_category': 'furniture',
        'it_block': 'furniture',
        'purchase_date': '2026-11-01',
        'put_to_use_date': '2026-11-03',
        'purchase_cost': 1250.5,
        'residual_value': 0,
        'depreciation_method': 'WDV',
        'useful_life_years': 10,
        'depreciation_rate': 12.5,
        'account_id': 'a1',
        'depreciation_account_id': 'e1',
        'funding': 'cash',
        'invoice_number': 'INV-9',
      });
      expectNoIdentity(b);
      final slm = fixedAssetBody(
        code: 'x', name: 'y', scheduleIiCategory: '', itBlock: '', purchaseDate: DateTime(2026, 11, 1), putToUseDate: DateTime(2026, 11, 1),
        costText: '10', residualText: '2', method: 'SLM', lifeText: '5', rateText: '9', accountId: 'a', depreciationAccountId: 'e', funding: 'bank', vendor: 'V', invoiceNumber: '',
      );
      expect(slm.containsKey('depreciation_rate'), isFalse, reason: 'the rate is a WDV field');
      expect(slm.containsKey('schedule_ii_category'), isFalse);
      expect(slm.containsKey('it_block'), isFalse);
      expect(slm['residual_value'], 2);
      expect(slm['vendor_name'], 'V');
    });

    test('depreciate and dispose bodies are the website ones, with no identity', () {
      final d = depreciateBody(DateTime(2026, 11, 10));
      expect(d, {'period_end_date': '2026-11-10'});
      expectNoIdentity(d);
      final s = disposeBody(date: DateTime(2026, 11, 10), amountText: '', proceedsAccountId: '', buyer: '', reason: '', chargeDepreciation: true);
      expect(s, {'disposal_date': '2026-11-10', 'disposal_amount': 0, 'charge_depreciation': true});
      final t = disposeBody(date: DateTime(2026, 11, 10), amountText: '5000.5', proceedsAccountId: 'a3', buyer: ' Asha ', reason: 'Replaced', chargeDepreciation: false);
      expect(t, {
        'disposal_date': '2026-11-10',
        'disposal_amount': 5000.5,
        'proceeds_account_id': 'a3',
        'buyer_name': 'Asha',
        'reason': 'Replaced',
        'charge_depreciation': false,
      });
      expectNoIdentity(t);
      expect(disposeProblem('-1'), 'Sale proceeds cannot be negative');
      expect(disposeProblem(''), isNull);
      expect(disposeProblem('0'), isNull);
    });

    test('the messages after posting carry the server figures', () {
      expect(depreciationDoneMessage({'depreciation': {'amount': 1500}, 'message': 'Depreciation posted'}), 'Depreciation of ₹1,500.00 posted');
      expect(depreciationDoneMessage({'depreciation': {'amount': 0}, 'message': 'No depreciation due for this period'}), 'No depreciation due for this period');
      expect(disposalDoneMessage({'disposal': {'gainLoss': 1200.5}}), 'Asset disposed; profit of ₹1,200.50');
      expect(disposalDoneMessage({'disposal': {'gainLoss': '-300'}}), 'Asset disposed; loss of ₹300.00');
      expect(disposalDoneMessage({'disposal': {}}), 'Asset disposed');
    });

    test('schedule rows show the period and the server opening, closing and amount', () {
      final r = {'period_start_date': '2026-04-10', 'period_end_date': '2026-09-30', 'opening_book_value': '60000.00', 'closing_book_value': '52000.00', 'depreciation_amount': '8000.00'};
      expect(scheduleRowTitle(r), '10 Apr 2026 – 30 Sep 2026');
      expect(scheduleRowSubtitle(r), 'Opening ₹60,000.00 → Closing ₹52,000.00');
    });
  });

  group('provision logic', () {
    test('the types and the entry types are the website ones', () {
      expect([for (final t in kProvisionTypes) t.$1], ['bad_debts', 'warranty', 'gratuity', 'leave_encashment', 'employee_benefits', 'litigation', 'others']);
      expect(provisionTypeLabel('leave_encashment'), 'Leave Encashment');
      expect(provisionTypeLabel('weird_kind'), 'Weird kind');
      expect([for (final t in kEntryTypes) t.$1], ['addition', 'reversal', 'utilization']);
      expect(entryTypeLabel('utilization'), 'Utilization');
    });

    test('paths ask for the long financial year the server stores', () {
      expect(provisionsPath('2026-2027'), '/api/provisions?financial_year=2026-2027');
      expect(provisionEntriesPath('p1', '2026-2027'), '/api/provisions/p1/entries?financial_year=2026-2027');
    });

    test('a row reads the name, the code and type, and the server balance', () {
      final p = {'provision_name': 'Bad debts', 'provision_code': 'PROV-1', 'provision_type': 'bad_debts', 'current_balance': '2500', 'entries_count': 3};
      expect(provisionRowTitle(p), 'Bad debts');
      expect(provisionRowSubtitle(p), 'PROV-1 · Bad Debts · 3 entries');
      expect(provisionRowSubtitle({'provision_code': 'P', 'provision_type': 'others', 'entries_count': 1}), 'P · Others · 1 entry');
      expect(provisionRowSubtitle({'provision_code': 'P', 'provision_type': 'others'}), 'P · Others');
    });

    test('the add body sends only what was filled, with no identity', () {
      final b = provisionCreateBody(code: ' PROV-1 ', name: ' Bad debts ', type: 'bad_debts', provisionAccountId: '', expenseAccountId: 'e1', method: '', rateText: '5', description: '');
      expect(b, {'provision_code': 'PROV-1', 'provision_name': 'Bad debts', 'provision_type': 'bad_debts', 'expense_account_id': 'e1', 'calculation_rate': 5});
      expectNoIdentity(b);
      expect(provisionProblem(code: '', name: 'x', rateText: ''), 'Enter the provision code');
      expect(provisionProblem(code: 'x', name: ' ', rateText: ''), 'Enter the provision name');
      expect(provisionProblem(code: 'x', name: 'y', rateText: 'abc'), 'Enter the rate as a number');
      expect(provisionProblem(code: 'x', name: 'y', rateText: ''), isNull);
    });

    test('the edit body changes only the fields the server updates (not the code or accounts)', () {
      final b = provisionUpdateBody(name: 'New', type: 'warranty', method: 'percentage', rateText: '', description: 'Notes');
      expect(b, {'provision_name': 'New', 'provision_type': 'warranty', 'calculation_method': 'percentage', 'calculation_rate': null, 'description': 'Notes'});
      expectNoIdentity(b);
    });

    test('an entry body carries the long financial year, and the counter account only for a utilization', () {
      final a = provisionEntryBody(financialYear: '2026-2027', date: DateTime(2026, 11, 10), type: 'addition', amountText: '1,000', narration: ' Q2 top-up ', counterAccountId: 'c1');
      expect(a, {'financial_year': '2026-2027', 'entry_date': '2026-11-10', 'entry_type': 'addition', 'amount': 1000, 'narration': 'Q2 top-up'});
      expectNoIdentity(a);
      final u = provisionEntryBody(financialYear: '2026-2027', date: DateTime(2026, 11, 10), type: 'utilization', amountText: '400', narration: '', counterAccountId: 'c1');
      expect(u, {'financial_year': '2026-2027', 'entry_date': '2026-11-10', 'entry_type': 'utilization', 'amount': 400, 'counter_account_id': 'c1'});
    });

    test('an entry needs an amount above zero, and a utilization needs a counter account unless bad debts', () {
      String? p({String type = 'addition', String amount = '10', String counter = '', String provisionType = 'warranty'}) =>
          provisionEntryProblem(type: type, amountText: amount, counterAccountId: counter, provisionType: provisionType);
      expect(p(), isNull);
      expect(p(amount: '0'), 'Enter an amount above zero');
      expect(p(type: 'utilization'), 'Choose the account the cost is settled against');
      expect(p(type: 'utilization', counter: 'c1'), isNull);
      expect(p(type: 'utilization', provisionType: 'bad_debts'), isNull);
    });

    test('an entry row shows the type and date, and the server opening, closing and amount', () {
      final e = {'entry_date': '2026-11-03', 'entry_type': 'reversal', 'amount': '200', 'opening_balance': '1000', 'closing_balance': '800', 'narration': 'Recovered'};
      expect(entryRowTitle(e), 'Reversal · 03 Nov 2026');
      expect(entryRowSubtitle(e), 'Recovered · Opening ₹1,000.00 → Closing ₹800.00');
      expect(entryIsAddition({'entry_type': 'addition'}), isTrue);
      expect(entryIsAddition(e), isFalse);
    });
  });

  group('fixed assets screens', () {
    var listFails = 0;
    String? failCode;
    var empty = false;
    String? postRefuse;

    setUp(() {
      listFails = 0;
      failCode = null;
      empty = false;
      postRefuse = null;
    });

    Reply server(RequestOptions o, Map body) {
      final path = o.uri.path;
      if (o.method == 'GET' && path == '/api/fixed-assets') {
        if (listFails > 0) {
          listFails--;
          return (failCode == null ? 500 : 403, {'error': 'Server is down', 'code': ?failCode});
        }
        return (200, {'assets': empty ? [] : [_assetRow, _disposedRow]});
      }
      if (o.method == 'GET' && path == '/api/fixed-assets/depreciation-schedule') {
        return (200, {
          'schedule': [
            {'period_start_date': '2026-04-10', 'period_end_date': '2026-09-30', 'opening_book_value': '60000.00', 'closing_book_value': '52000.00', 'depreciation_amount': '8000.00'},
          ],
        });
      }
      if (o.method == 'GET' && path == '/api/fixed-assets/it-depreciation') {
        return (200, {
          'fy': o.uri.queryParameters['fy'],
          'unclassified': 1,
          'rows': [
            {'block': 'computers', 'label': 'Computers and computer software', 'rate': 40, 'openingWdv': 10000, 'additionsFullRate': 60000, 'additionsHalfRate': 0, 'sales': 0, 'depreciation': 28000, 'closingWdv': 42000, 'shortTermCapitalGain': 0},
          ],
        });
      }
      if (o.method == 'GET' && path == '/api/accounts') {
        final type = o.uri.queryParameters['account_type'];
        if (type == 'expense') {
          return (200, {
            'accounts': [
              {'id': 'e1', 'account_code': '5204', 'account_name': 'Depreciation'},
              {'id': 'e2', 'account_code': '5100', 'account_name': 'Rent'},
            ],
          });
        }
        return (200, {
          'accounts': [
            {'id': 'a1', 'account_code': '1201', 'account_name': 'Furniture and fittings'},
            {'id': 'a2', 'account_code': '1202', 'account_name': 'Accumulated depreciation'},
            {'id': 'a3', 'account_code': '1102', 'account_name': 'HDFC Current'},
          ],
        });
      }
      if (o.method == 'POST' && path == '/api/fixed-assets/fa1/depreciate') {
        if (postRefuse != null) return (409, {'error': postRefuse, 'code': 'OVERLAP'});
        return (201, {'depreciation': {'amount': 1500, 'scheduleId': 's1'}, 'message': 'Depreciation posted'});
      }
      if (o.method == 'POST' && path == '/api/fixed-assets/fa1/dispose') {
        if (postRefuse != null) return (400, {'error': postRefuse, 'code': 'INVALID_DATE'});
        return (201, {'disposal': {'gainLoss': 1200.5}, 'message': 'Asset disposed'});
      }
      if (o.method == 'POST' && path == '/api/fixed-assets') {
        if (postRefuse != null) return (409, {'error': postRefuse});
        return (201, {'asset': {'asset_code': 'FA-2'}, 'message': 'Fixed asset added successfully'});
      }
      return (404, {'error': 'not found ${o.method} $path'});
    }

    Future<List<RequestOptions>> openList(WidgetTester t) async {
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, FixedAssetsScreen(session: session));
      return sent;
    }

    Future<void> openFirstAsset(WidgetTester t) async {
      await t.tap(find.text('Laptop'));
      await t.pumpAndSettle();
    }

    Future<void> pick(WidgetTester t, String label, String option) async {
      await t.tap(find.descendant(of: find.ancestor(of: find.text(label), matching: find.byType(Column)).first, matching: find.byType(InkWell)).first);
      await t.pumpAndSettle();
      await t.tap(find.text(option).last);
      await t.pumpAndSettle();
    }

    testWidgets('the list shows each asset with the server cost, book value and depreciated-to; nothing identifies the business', (t) async {
      final sent = await openList(t);
      final req = requestsOf(sent, 'GET', '/api/fixed-assets').single;
      expect(req.uri.queryParameters.containsKey('business_id'), isFalse);
      expect(find.text('Laptop'), findsOneWidget);
      expect(find.text('FA-001 · SLM 3y'), findsOneWidget);
      expect(find.text('₹52,000.00'), findsOneWidget, reason: 'book value, as the server sent it');
      expect(find.text('Depreciated to 30 Sep 2026'), findsOneWidget);
      expect(find.text('Printer'), findsOneWidget);
      expect(find.text('Disposed 02 Nov 2026'), findsOneWidget);
    });

    testWidgets('empty, server error with Try again, and plan refusal', (t) async {
      empty = true;
      await openList(t);
      expect(find.text('No fixed assets yet'), findsOneWidget);

      empty = false;
      listFails = 1;
      await openList(t);
      expect(find.text('Could not load fixed assets'), findsOneWidget);
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Laptop'), findsOneWidget);

      listFails = 9;
      failCode = 'FEATURE_NOT_IN_PLAN';
      await openList(t);
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('the detail shows the server amounts and the depreciation schedule of that asset', (t) async {
      final sent = await openList(t);
      await openFirstAsset(t);
      final req = requestsOf(sent, 'GET', '/api/fixed-assets/depreciation-schedule').single;
      expect(req.uri.queryParameters['asset_id'], 'fa1');
      expect(find.text('Depreciation schedule'), findsOneWidget);
      expect(find.text('10 Apr 2026 – 30 Sep 2026'), findsOneWidget);
      expect(find.text('Opening ₹60,000.00 → Closing ₹52,000.00'), findsOneWidget);
      expect(find.text('₹8,000.00'), findsWidgets);
      expect(find.text('Depreciate'), findsOneWidget);
      expect(find.text('Dispose'), findsOneWidget);
    });

    testWidgets('a disposed asset has neither Depreciate nor Dispose', (t) async {
      await openList(t);
      await t.tap(find.text('Printer'));
      await t.pumpAndSettle();
      expect(find.text('Depreciate'), findsNothing);
      expect(find.text('Dispose'), findsNothing);
    });

    testWidgets('Depreciate asks first, naming the asset and its server book value, then posts once and reloads', (t) async {
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, FixedAssetsScreen(session: session));
      await openFirstAsset(t);
      await t.tap(find.text('Depreciate'));
      await t.pumpAndSettle();
      expect(find.text('Depreciate up to'), findsOneWidget);
      await t.tap(find.text('Post depreciation').last);
      await settle(t);
      expect(requestCount(sent, 'POST', '/api/fixed-assets/fa1/depreciate'), 0, reason: 'asks first');
      expect(find.textContaining('Laptop (FA-001)'), findsWidgets);
      expect(find.textContaining('book value is ₹52,000.00'), findsOneWidget);
      expect(find.textContaining('The server works out the amount'), findsOneWidget);
      final go = inSheet('Post depreciation');
      await t.tap(go);
      await t.tap(go, warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/fixed-assets/fa1/depreciate'), 1);
      final body = lastBody(sent, 'POST', '/api/fixed-assets/fa1/depreciate');
      expect(body['period_end_date'], ymd(DateTime.now()));
      expectNoIdentity(body);
      expect(find.text('Depreciation of ₹1,500.00 posted'), findsOneWidget, reason: 'the amount the server posted');
      expect(requestCount(sent, 'GET', '/api/fixed-assets/depreciation-schedule'), 2, reason: 'detail reloaded');
      expect(requestCount(sent, 'GET', '/api/fixed-assets'), greaterThanOrEqualTo(3), reason: 'list reloaded');
    });

    testWidgets('a refused depreciation shows the server message and keeps the form', (t) async {
      postRefuse = 'Depreciation is already posted up to 30 Sep 2026; the next period starts on 2026-10-01';
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, FixedAssetsScreen(session: session));
      await openFirstAsset(t);
      await t.tap(find.text('Depreciate'));
      await t.pumpAndSettle();
      await t.tap(find.text('Post depreciation').last);
      await settle(t);
      await t.tap(inSheet('Post depreciation'));
      await t.pumpAndSettle();
      expect(find.text(postRefuse!), findsOneWidget);
      expect(find.text('Depreciate up to'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/fixed-assets/fa1/depreciate'), 1);
    });

    testWidgets('Dispose asks first with the proceeds and book value, posts the website body once, and shows the server gain', (t) async {
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, FixedAssetsScreen(session: session));
      await openFirstAsset(t);
      await t.tap(find.text('Dispose'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Sale proceeds excluding GST (0 if scrapped)', within: KAmountField), '5000.50');
      await t.enterText(textFieldLabelled('Buyer'), 'Asha');
      await t.pumpAndSettle();
      await pick(t, 'Proceeds received in', '1102 · HDFC Current');
      await t.tap(find.text('Dispose asset'));
      await settle(t);
      expect(requestCount(sent, 'POST', '/api/fixed-assets/fa1/dispose'), 0);
      expect(find.textContaining('₹5,000.50'), findsWidgets);
      expect(find.textContaining('book value ₹52,000.00'), findsOneWidget);
      final go = inSheet('Dispose asset');
      await t.tap(go);
      await t.tap(go, warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/fixed-assets/fa1/dispose'), 1);
      final body = lastBody(sent, 'POST', '/api/fixed-assets/fa1/dispose');
      expect(body['disposal_amount'], 5000.5);
      expect(body['proceeds_account_id'], 'a3');
      expect(body['buyer_name'], 'Asha');
      expect(body['charge_depreciation'], true);
      expect(body['disposal_date'], ymd(DateTime.now()));
      expectNoIdentity(body);
      expect(find.text('Asset disposed; profit of ₹1,200.50'), findsOneWidget);
    });

    testWidgets('the dispose ask says depreciation is posted first only while the toggle is on', (t) async {
      final (session, _) = recordedSession(server);
      await pumpScreen(t, FixedAssetsScreen(session: session));
      await openFirstAsset(t);
      await t.tap(find.text('Dispose'));
      await t.pumpAndSettle();
      await t.tap(find.text('Dispose asset'));
      await settle(t);
      expect(find.textContaining('Depreciation up to'), findsOneWidget);
      expect(find.textContaining('is posted first'), findsOneWidget);
      await t.tap(find.text('Keep it'));
      await t.pumpAndSettle();
      await t.tap(find.text('Charge depreciation up to the disposal date first'));
      await t.pumpAndSettle();
      await t.tap(find.text('Dispose asset'));
      await settle(t);
      expect(find.textContaining('Dispose of '), findsWidgets);
      expect(find.textContaining('is posted first'), findsNothing);
    });

    testWidgets('a refused disposal shows the server message and keeps the form filled', (t) async {
      postRefuse = 'Disposal date cannot be before the put-to-use date';
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, FixedAssetsScreen(session: session));
      await openFirstAsset(t);
      await t.tap(find.text('Dispose'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Reason'), 'Replaced');
      await t.tap(find.text('Dispose asset'));
      await settle(t);
      await t.tap(inSheet('Dispose asset'));
      await t.pumpAndSettle();
      expect(find.text(postRefuse!), findsOneWidget);
      expect(find.text('Replaced'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/fixed-assets/fa1/dispose'), 1);
    });

    testWidgets('adding an asset fills the Schedule II life, posts the website body once and reloads', (t) async {
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, FixedAssetsScreen(session: session));
      await t.tap(find.text('Add asset'));
      await t.pumpAndSettle();
      expect(find.text('1201 · Furniture and fittings'), findsOneWidget, reason: 'the website preselects 1201');
      expect(find.text('5204 · Depreciation'), findsOneWidget, reason: 'and 5204');
      await t.enterText(textFieldLabelled('Asset code'), 'FA-2');
      await t.enterText(textFieldLabelled('Asset name'), 'Desk');
      await pick(t, 'Schedule II category', 'Furniture and fittings (10 yrs)');
      expect(find.text('10'), findsOneWidget, reason: 'useful life from the category');
      await t.enterText(textFieldLabelled('Cost (excl. GST where ITC is claimed)', within: KAmountField), '12500');
      await t.pumpAndSettle();
      final save = find.text('Capitalise asset');
      await t.tap(save);
      await t.tap(save, warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/fixed-assets'), 1);
      final body = lastBody(sent, 'POST', '/api/fixed-assets');
      expect(body['asset_code'], 'FA-2');
      expect(body['purchase_cost'], 12500);
      expect(body['useful_life_years'], 10);
      expect(body['schedule_ii_category'], 'furniture');
      expect(body['account_id'], 'a1');
      expect(body['depreciation_account_id'], 'e1');
      expect(body['funding'], 'bank');
      expectNoIdentity(body);
      expect(find.text('Asset FA-2 capitalised'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/fixed-assets'), 2, reason: 'reloaded');
    });

    testWidgets('a refused capitalisation shows the server message and keeps the form filled', (t) async {
      postRefuse = 'Asset code already exists';
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, FixedAssetsScreen(session: session));
      await t.tap(find.text('Add asset'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Asset code'), 'FA-1');
      await t.enterText(textFieldLabelled('Asset name'), 'Desk');
      await t.enterText(textFieldLabelled('Useful life (years)'), '5');
      await t.enterText(textFieldLabelled('Cost (excl. GST where ITC is claimed)', within: KAmountField), '100');
      await t.pumpAndSettle();
      await t.tap(find.text('Capitalise asset'));
      await t.pumpAndSettle();
      expect(find.text('Asset code already exists'), findsOneWidget);
      expect(find.text('FA-1'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/fixed-assets'), 1);
    });

    testWidgets('Income-tax depreciation shows the server rows for the year', (t) async {
      final sent = await openList(t);
      await t.tap(find.text('Income-tax depreciation'));
      await t.pumpAndSettle();
      final req = requestsOf(sent, 'GET', '/api/fixed-assets/it-depreciation').single;
      expect(req.uri.queryParameters['fy'], matches(RegExp(r'^\d{4}-\d{2}$')));
      expect(find.text('Computers and computer software'), findsOneWidget);
      expect(find.text('₹28,000.00'), findsOneWidget);
      expect(find.textContaining('1 asset(s) have no Income-tax block'), findsOneWidget);
    });

    testWidgets('the route table opens the fixed assets screen', (t) async {
      final (session, _) = recordedSession(server);
      expect(nativeScreenFor(session, '/fixed-assets'), isA<FixedAssetsScreen>());
    });
  });

  group('provisions screens', () {
    var listFails = 0;
    String? failCode;
    var empty = false;
    String? postRefuse;

    setUp(() {
      listFails = 0;
      failCode = null;
      empty = false;
      postRefuse = null;
    });

    Reply server(RequestOptions o, Map body) {
      final path = o.uri.path;
      if (o.method == 'GET' && path == '/api/provisions') {
        if (listFails > 0) {
          listFails--;
          return (failCode == null ? 500 : 403, {'error': 'Server is down', 'code': ?failCode});
        }
        return (200, {'provisions': empty ? [] : [_provision]});
      }
      if (o.method == 'GET' && path == '/api/provisions/p1/entries') {
        return (200, {
          'entries': [
            {'id': 'e1', 'entry_date': '2026-11-03', 'entry_type': 'addition', 'amount': '2500.00', 'opening_balance': '0.00', 'closing_balance': '2500.00', 'narration': 'Q2 top-up'},
          ],
        });
      }
      if (o.method == 'GET' && path == '/api/accounts') {
        return (200, {
          'accounts': [
            {'id': 'l1', 'account_code': '2108', 'account_name': 'Provision for bad debts', 'account_type': 'liability'},
            {'id': 'x1', 'account_code': '5207', 'account_name': 'Provision expense', 'account_type': 'expense'},
          ],
        });
      }
      if (o.method == 'POST' && path == '/api/provisions') {
        if (postRefuse != null) return (500, {'error': postRefuse});
        return (201, {'provision': {'id': 'p2'}});
      }
      if (o.method == 'PATCH' && path == '/api/provisions/p1') {
        if (postRefuse != null) return (500, {'error': postRefuse});
        return (200, {'provision': _provision});
      }
      if (o.method == 'DELETE' && path == '/api/provisions/p1') return (200, {'success': true});
      if (o.method == 'POST' && path == '/api/provisions/p1/entries') {
        if (postRefuse != null) return (500, {'error': postRefuse});
        return (201, {'id': 'e2'});
      }
      return (404, {'error': 'not found ${o.method} $path'});
    }

    Future<List<RequestOptions>> openList(WidgetTester t) async {
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, ProvisionsScreen(session: session));
      return sent;
    }

    Future<void> pick(WidgetTester t, String label, String option) async {
      await t.tap(find.descendant(of: find.ancestor(of: find.text(label), matching: find.byType(Column)).first, matching: find.byType(InkWell)).first);
      await t.pumpAndSettle();
      await t.tap(find.text(option).last);
      await t.pumpAndSettle();
    }

    testWidgets('the list shows each provision with the server balance, for the financial year asked in the long form', (t) async {
      final sent = await openList(t);
      final req = requestsOf(sent, 'GET', '/api/provisions').single;
      expect(req.uri.queryParameters['financial_year'], matches(RegExp(r'^\d{4}-\d{4}$')));
      expect(req.uri.queryParameters.containsKey('business_id'), isFalse);
      expect(find.text('Bad debts'), findsOneWidget);
      expect(find.text('PROV-1 · Bad Debts · 1 entry'), findsOneWidget);
      expect(find.text('₹2,500.00'), findsOneWidget);
    });

    testWidgets('empty, server error with Try again, and plan refusal', (t) async {
      empty = true;
      await openList(t);
      expect(find.text('No provisions yet'), findsOneWidget);

      empty = false;
      listFails = 1;
      await openList(t);
      expect(find.text('Could not load provisions'), findsOneWidget);
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Bad debts'), findsOneWidget);

      listFails = 9;
      failCode = 'FEATURE_NOT_IN_PLAN';
      await openList(t);
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('a new provision posts the website body once, with the chosen accounts, and the list reloads', (t) async {
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, ProvisionsScreen(session: session));
      await t.tap(find.text('New provision'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Provision code'), 'PROV-2');
      await t.enterText(textFieldLabelled('Provision name'), 'Warranty claims');
      await pick(t, 'Provision type', 'Warranty');
      await t.enterText(textFieldLabelled('Calculation rate (%)', within: KAmountField), '2.5');
      await t.pumpAndSettle();
      final save = find.text('Create provision');
      await t.tap(save);
      await t.tap(save, warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/provisions'), 1);
      final body = lastBody(sent, 'POST', '/api/provisions');
      expect(body['provision_code'], 'PROV-2');
      expect(body['provision_name'], 'Warranty claims');
      expect(body['provision_type'], 'warranty');
      expect(body['calculation_rate'], 2.5);
      expect(body.containsKey('provision_account_id'), isFalse, reason: 'left to the server default');
      expectNoIdentity(body);
      expect(requestCount(sent, 'GET', '/api/provisions'), 2, reason: 'reloaded');
    });

    testWidgets('a refused save shows the server message and keeps the form filled', (t) async {
      postRefuse = 'Failed to create provision';
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, ProvisionsScreen(session: session));
      await t.tap(find.text('New provision'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Provision code'), 'PROV-2');
      await t.enterText(textFieldLabelled('Provision name'), 'Warranty claims');
      await t.tap(find.text('Create provision'));
      await t.pumpAndSettle();
      expect(find.text('Failed to create provision'), findsOneWidget);
      expect(find.text('PROV-2'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/provisions'), 1);
    });

    testWidgets('the detail shows the entries with the server opening and closing, and Edit sends only the editable fields', (t) async {
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, ProvisionsScreen(session: session));
      await t.tap(find.text('Bad debts'));
      await t.pumpAndSettle();
      final req = requestsOf(sent, 'GET', '/api/provisions/p1/entries').single;
      expect(req.uri.queryParameters['financial_year'], matches(RegExp(r'^\d{4}-\d{4}$')));
      expect(find.text('Addition · 03 Nov 2026'), findsOneWidget);
      expect(find.text('Q2 top-up · Opening ₹0.00 → Closing ₹2,500.00'), findsOneWidget);
      await t.tap(find.byTooltip('Edit'));
      await t.pumpAndSettle();
      expect(find.text('Edit provision'), findsOneWidget);
      await t.enterText(textFieldLabelled('Provision name'), 'Bad debts reserve');
      await t.tap(find.text('Save changes'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'PATCH', '/api/provisions/p1'), 1);
      final body = lastBody(sent, 'PATCH', '/api/provisions/p1');
      expect(body['provision_name'], 'Bad debts reserve');
      expect(body['provision_type'], 'bad_debts');
      expect(body['calculation_rate'], 5);
      expect(body.containsKey('provision_code'), isFalse);
      expectNoIdentity(body);
    });

    testWidgets('an entry asks first, naming the provision and the amount, then posts once and the entries reload', (t) async {
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, ProvisionsScreen(session: session));
      await t.tap(find.text('Bad debts'));
      await t.pumpAndSettle();
      await t.tap(find.text('Add entry'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Amount', within: KAmountField), '1000');
      await t.enterText(textFieldLabelled('Narration'), 'Top-up');
      await t.pumpAndSettle();
      await t.tap(find.text('Post entry').last);
      await settle(t);
      expect(requestCount(sent, 'POST', '/api/provisions/p1/entries'), 0, reason: 'asks first');
      expect(find.textContaining('Bad debts'), findsWidgets);
      expect(find.textContaining('₹1,000.00'), findsWidgets);
      final go = inSheet('Post entry');
      await t.tap(go);
      await t.tap(go, warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'POST', '/api/provisions/p1/entries'), 1);
      final body = lastBody(sent, 'POST', '/api/provisions/p1/entries');
      expect(body['entry_type'], 'addition');
      expect(body['amount'], 1000);
      expect(body['narration'], 'Top-up');
      expect(body['financial_year'], matches(RegExp(r'^\d{4}-\d{4}$')));
      expect(body['entry_date'], ymd(DateTime.now()));
      expectNoIdentity(body);
      expect(requestCount(sent, 'GET', '/api/provisions/p1/entries'), 2, reason: 'entries reloaded');
    });

    testWidgets('a refused entry shows the server message and keeps the form', (t) async {
      postRefuse = 'This accounting period is locked.';
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, ProvisionsScreen(session: session));
      await t.tap(find.text('Bad debts'));
      await t.pumpAndSettle();
      await t.tap(find.text('Add entry'));
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Amount', within: KAmountField), '400');
      await t.tap(find.text('Post entry').last);
      await settle(t);
      await t.tap(inSheet('Post entry'));
      await t.pumpAndSettle();
      expect(find.text('This accounting period is locked.'), findsOneWidget);
      expect(find.text('400'), findsOneWidget);
    });

    testWidgets('Delete asks first, then deletes once and the list reloads', (t) async {
      final (session, sent) = recordedSession(server);
      await pumpScreen(t, ProvisionsScreen(session: session));
      await t.tap(find.text('Bad debts'));
      await t.pumpAndSettle();
      await t.tap(find.byTooltip('Delete'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'DELETE', '/api/provisions/p1'), 0);
      final go = inSheet('Delete provision');
      await t.tap(go);
      await t.tap(go, warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'DELETE', '/api/provisions/p1'), 1);
      expect(requestsOf(sent, 'DELETE', '/api/provisions/p1').single.uri.queryParameters.containsKey('business_id'), isFalse);
      expect(find.text('Provision deleted'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/provisions'), 3, reason: 'the detail read the list too, then the list reloaded');
    });

    testWidgets('the route table opens the provisions screen', (t) async {
      final (session, _) = recordedSession(server);
      expect(nativeScreenFor(session, '/provisions'), isA<ProvisionsScreen>());
    });
  });
}

const _disposedRow = {
  'id': 'fa2',
  'asset_code': 'FA-000',
  'asset_name': 'Printer',
  'put_to_use_on': '2025-04-10',
  'purchase_cost': '9000.00',
  'depreciation_method': 'WDV',
  'useful_life_years': 5,
  'depreciation_rate': '15.00',
  'current_book_value': '0.00',
  'accumulated_depreciation': '9000.00',
  'is_disposed': true,
  'disposal_date': '2026-11-02',
  'last_depreciated_to': null,
};

const _provision = {
  'id': 'p1',
  'provision_code': 'PROV-1',
  'provision_name': 'Bad debts',
  'provision_type': 'bad_debts',
  'calculation_method': 'percentage',
  'calculation_rate': '5.00',
  'description': 'Doubtful receivables',
  'current_balance': '2500.00',
  'entries_count': 1,
};

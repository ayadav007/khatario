import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/pages/page_catalog.dart';
import 'package:khatario_phone/screens/stock/insurance_claims_screen.dart';
import 'package:khatario_phone/screens/stock/manufacturing_screen.dart';
import 'package:khatario_phone/screens/stock/stock_holds_screen.dart';
import 'package:khatario_phone/screens/stock/stock_misc_logic.dart';
import 'package:khatario_phone/session.dart';
import 'package:khatario_phone/ui/form_kit.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/recorded_session.dart';

Map<String, dynamic> _hold({String id = 'h1', num qty = 5, String purpose = 'qc_hold'}) => {
      'hold_id': id,
      'hold_number': 'HOLD-0001',
      'item_id': 'i1',
      'item_name': 'Rice',
      'purpose': purpose,
      'hold_date': '2026-11-05',
      'qty': qty,
      'warehouse_id': 'w1',
      'warehouse_name': 'Main godown',
      'reference': null,
    };

Map<String, dynamic> _goods() => {
      'id': 'g1',
      'owner_name': 'Asha',
      'owner_type': 'other',
      'description': 'Motor for rewinding',
      'unit': 'PCS',
      'qty': 2,
      'received_date': '2026-11-01',
      'days_held': 9,
      'reason': 'repair',
      'warehouse_name': 'Main godown',
    };

Map<String, dynamic> _bom() => {
      'id': 'b1',
      'name': 'Biscuit batch',
      'output_item_id': 'i9',
      'output_item_name': 'Biscuits',
      'output_qty': '10.000',
      'is_active': true,
      'lines': [
        {'item_id': 'i1', 'item_name': 'Flour', 'unit': 'KG', 'role': 'input', 'qty': '20.000', 'recovery_rate': '0'},
        {'item_id': 'i2', 'item_name': 'Sugar', 'unit': 'KG', 'role': 'input', 'qty': '5.000', 'recovery_rate': '0'},
        {'item_id': 'i3', 'item_name': 'Crumbs', 'unit': 'KG', 'role': 'scrap', 'qty': '1.000', 'recovery_rate': '12.00'},
      ],
    };

Map<String, dynamic> _entry() => {
      'id': 'p1',
      'entry_number': 'PRD-0001',
      'entry_date': '2026-11-06',
      'output_item_name': 'Biscuits',
      'output_qty': '20.000',
      'input_cost': '1500.00',
      'recovery_value': '24.00',
      'output_cost': '1476.00',
      'lines': [
        {'item_name': 'Flour', 'role': 'input', 'qty': '40.000', 'value': '1200'},
        {'item_name': 'Sugar', 'role': 'input', 'qty': '10.000', 'value': '300'},
        {'item_name': 'Crumbs', 'role': 'scrap', 'qty': '2.000', 'value': '24'},
      ],
    };

Map<String, dynamic> _claim({String status = 'lodged'}) => {
      'id': 'c1',
      'claim_number': 'CLM-0001',
      'loss_date': '2026-11-03',
      'cause': 'theft',
      'insurer': 'New India',
      'policy_number': 'P-77',
      'fir_number': 'FIR-12',
      'fir_date': '2026-11-04',
      'surveyor': 'Mr Rao',
      'loss_value': '4200.00',
      'claimed_amount': '5000.00',
      'admitted_amount': status == 'lodged' ? null : '4500.00',
      'settled_amount': null,
      'status': status,
      'write_offs': [
        {'id': 'a1', 'number': 'ADJ-1', 'item': 'Rice', 'qty': '20', 'value': '4200'},
      ],
    };

class _Srv {
  List<Map<String, dynamic>> holds = [_hold()];
  List<Map<String, dynamic>> goods = [_goods()];
  List<Map<String, dynamic>> boms = [_bom()];
  List<Map<String, dynamic>> entries = [_entry()];
  List<Map<String, dynamic>> claims = [_claim()];
  List<Map<String, dynamic>> warehouses = [
    {'id': 'w1', 'name': 'Main godown', 'is_active': true},
  ];
  List<Map<String, dynamic>> accounts = [
    {'id': 'x2', 'account_code': '1102', 'account_name': 'Bank'},
  ];
  List<Map<String, dynamic>> adjustments = [
    {'id': 'a1', 'adjustment_number': 'ADJ-1', 'item_name': 'Rice', 'direction': 'DECREASE', 'reason_code': 'THEFT', 'quantity_change': '-20', 'value_change': '-4200'},
  ];
  Reply? listReply;
  Reply? writeReply;

  (AppSession, List<RequestOptions>) build() => recordedSession((o, body) {
        final p = o.uri.path;
        if (o.method == 'GET') {
          if (p == '/api/warehouses') return (200, {'warehouses': warehouses});
          if (p == '/api/stock-holds') return listReply ?? (200, {'holds': holds});
          if (p == '/api/inward-custody') return listReply ?? (200, {'goods': goods});
          if (p == '/api/manufacturing/boms') return listReply ?? (200, {'boms': boms});
          if (p == '/api/manufacturing/production') return listReply ?? (200, {'entries': entries});
          if (p == '/api/insurance-claims') return listReply ?? (200, {'claims': claims});
          if (p == '/api/accounts') return (200, {'accounts': accounts});
          if (p == '/api/inventory-adjustments') return (200, {'adjustments': adjustments});
          if (p == '/api/items/search') {
            return (200, {'items': [{'id': 'i1', 'name': 'Rice', 'unit': 'KG', 'current_stock': '40'}]});
          }
        }
        if (writeReply != null && o.method != 'GET') return writeReply!;
        if (o.method == 'POST' && p == '/api/stock-holds') return (201, {'id': 'h2'});
        if (o.method == 'POST' && p.startsWith('/api/stock-holds/')) {
          holds = [];
          return (200, {'closed': true, 'adjustmentId': null});
        }
        if (o.method == 'POST' && p == '/api/inward-custody') return (201, {'id': 'g2'});
        if (o.method == 'PATCH' && p.startsWith('/api/inward-custody/')) {
          goods = [];
          return (200, {'status': 'returned'});
        }
        if (o.method == 'POST' && p == '/api/manufacturing/boms') return (201, {'id': 'b2'});
        if (o.method == 'POST' && p == '/api/manufacturing/production') {
          return (201, {'id': 'p2', 'number': 'PRD-0002', 'input_cost': 1500, 'output_cost': 1476, 'output_unit_cost': 73.8});
        }
        if (o.method == 'POST' && p == '/api/insurance-claims') return (201, {'id': 'c2'});
        if (o.method == 'PATCH' && p.startsWith('/api/insurance-claims/')) {
          final next = {'admit': 'admitted', 'settle': 'settled', 'reject': 'rejected'}[body['action']]!;
          claims = [
            for (final c in claims)
              {...c, 'status': next, 'admitted_amount': next == 'admitted' ? body['amount'] : c['admitted_amount'] ?? '4500.00'},
          ];
          return (200, {'ok': true});
        }
        return (404, {'error': 'not faked: ${o.method} $p'});
      });
}

Future<void> _sheetUp(WidgetTester t) async {
  await t.pump();
  await t.pump(const Duration(seconds: 1));
}

Finder _pick(String label) => find.byWidgetPredicate((w) => w is KPickField && w.label == label);

Finder _apick(String label) => find.byWidgetPredicate((w) => w is KAsyncPickField && w.label == label);

Finder _inSheet(Finder f) => find.descendant(of: find.byType(BottomSheet), matching: f);

Finder _tf(String label) => find.descendant(of: find.ancestor(of: find.text(label), matching: find.byType(KTextField)), matching: find.byType(TextField));

Future<void> _yes(WidgetTester t, String label) async {
  final b = _inSheet(find.text(label));
  await t.tap(b);
  await t.tap(b, warnIfMissed: false);
  await _sheetUp(t);
  await t.pumpAndSettle();
}

Future<void> _chooseItem(WidgetTester t, Finder field) async {
  await t.tap(field);
  await _sheetUp(t);
  await t.tap(find.text('Rice').last);
  await _sheetUp(t);
}

void main() {
  group('held goods logic', () {
    test('purpose and reason words are the website ones', () {
      expect(kHoldPurposes.map((p) => p.$1), ['quarantine', 'qc_hold', 'damaged', 'return_inspection']);
      expect(holdPurposeLabel('qc_hold'), 'QC hold');
      expect(holdPurposeLabel('damaged'), 'Damaged, awaiting decision');
      expect(holdPurposeLabel('something_new'), 'Something new');
      expect(kOthersReasons.map((p) => p.$1), ['repair', 'job_work', 'storage', 'sold_not_collected', 'other']);
      expect(othersReasonLabel('repair'), 'In for repair');
      expect(othersReasonLabel('sold_not_collected'), 'Sold, not collected');
    });

    test('a hold row reads item, quantity, why, number, date and godown', () {
      expect(holdTitle(_hold()), 'Rice');
      expect(holdSubtitle(_hold()), '5 held · QC hold · HOLD-0001 · since 05 Nov 2026 · Main godown');
      expect(holdId(_hold()), 'h1');
    });

    test('an others\' goods row reads goods, owner, why, date and days', () {
      expect(othersTitle(_goods()), 'Motor for rewinding');
      expect(othersSubtitle(_goods()), '2 PCS · Asha · In for repair · received 01 Nov 2026 · 9 days · Main godown');
    });

    test('put on hold sends the website fields with one godown and no identity', () {
      final body = holdBody(itemId: 'i1', qty: 5, purpose: 'qc_hold', date: DateTime(2026, 11, 10), warehouseId: 'w1', branchId: 'b1', reference: ' ');
      expect(body, {'item_id': 'i1', 'qty': 5, 'purpose': 'qc_hold', 'date': '2026-11-10', 'warehouse_id': 'w1'});
      expectNoIdentity(body);
      final branch = holdBody(itemId: 'i1', qty: 1.5, purpose: 'damaged', date: DateTime(2026, 11, 10), branchId: 'b1', reference: ' bin 4 ');
      expect(branch, {'item_id': 'i1', 'qty': 1.5, 'purpose': 'damaged', 'date': '2026-11-10', 'branch_id': 'b1', 'reference': 'bin 4'});
    });

    test('release and write off send one quantity; only a write-off carries a reason', () {
      expect(settleBody(date: DateTime(2026, 11, 10), release: 3), {'date': '2026-11-10', 'release': 3});
      final off = settleBody(date: DateTime(2026, 11, 10), writeOff: 2, reason: 'EXPIRED');
      expect(off, {'date': '2026-11-10', 'write_off': 2, 'reason': 'EXPIRED'});
      expectNoIdentity(off);
      expect(kWriteOffReasons.map((r) => r.$1), ['DAMAGE', 'EXPIRED', 'WRITE_DOWN', 'THEFT']);
    });

    test('the questions name the item, the quantity and what happens to stock', () {
      expect(releaseText(_hold(), 3), 'Release 3 of Rice (HOLD-0001) back to saleable stock?');
      expect(writeOffText(_hold(), 2, 'Damaged'), 'Write off 2 of Rice (HOLD-0001) as Damaged? It leaves stock for good.');
    });

    test('a quantity must be a positive number', () {
      expect(positiveQty('3'), 3);
      expect(positiveQty(' 2.5 '), 2.5);
      expect(positiveQty('0'), isNull);
      expect(positiveQty('-1'), isNull);
      expect(positiveQty('abc'), isNull);
      expect(positiveQty(''), isNull);
    });

    test('others\' goods: record and hand back bodies are the website ones', () {
      final rec = othersBody(
        owner: ' Asha ',
        description: ' Motor ',
        qty: 2,
        unit: ' ',
        reason: 'repair',
        date: DateTime(2026, 11, 10),
        warehouseId: 'w1',
        reference: '',
      );
      expect(rec, {
        'owner_type': 'other',
        'owner_name': 'Asha',
        'description': 'Motor',
        'qty': 2,
        'unit': 'PCS',
        'reason': 'repair',
        'received_date': '2026-11-10',
        'warehouse_id': 'w1',
      });
      expectNoIdentity(rec);
      expect(returnBody(1.5, DateTime(2026, 11, 10)), {'qty': 1.5, 'date': '2026-11-10'});
      expect(returnText(_goods(), 1), 'Hand back 1 of Motor for rewinding to Asha?');
    });

    test('add refusals are the website ones', () {
      expect(holdRefusal(itemId: '', qty: 1), 'Choose the item and quantity');
      expect(holdRefusal(itemId: 'i1', qty: 0), 'Choose the item and quantity');
      expect(holdRefusal(itemId: 'i1', qty: 1, needsGodown: true, godownId: ''), 'Choose the godown');
      expect(holdRefusal(itemId: 'i1', qty: 1), isNull);
      expect(othersRefusal(owner: ' ', description: 'x', qty: 1), 'Enter the owner, the goods and the quantity');
      expect(othersRefusal(owner: 'a', description: '', qty: 1), 'Enter the owner, the goods and the quantity');
      expect(othersRefusal(owner: 'a', description: 'x', qty: 0), 'Enter the owner, the goods and the quantity');
      expect(othersRefusal(owner: 'a', description: 'x', qty: 1, needsGodown: true, godownId: ''), 'Choose the godown');
      expect(othersRefusal(owner: 'a', description: 'x', qty: 1), isNull);
    });

    test('an already-closed hold or handed-back entry is a quiet reload; a too-large quantity is a refusal', () {
      expect(holdAlreadyChanged(ApiException('This hold is already closed.', status: 409)), isTrue);
      expect(holdAlreadyChanged(ApiException('These goods have already gone back.', status: 409)), isTrue);
      expect(holdAlreadyChanged(ApiException('Only 2 is still held.', status: 409)), isFalse);
      expect(holdAlreadyChanged(ApiException('x', status: 400)), isFalse);
    });

    test('godowns are the active warehouses from /api/warehouses', () {
      final opts = godownOptions({
        'warehouses': [
          {'id': 'w1', 'name': 'Main godown', 'is_active': true},
          {'id': 'w2', 'name': 'Old shed', 'is_active': false},
          {'id': 'w3', 'name': 'Back room'},
          {'name': 'No id'},
        ],
      });
      expect(opts, [('w1', 'Main godown'), ('w3', 'Back room')]);
      expect(godownOptions(null), isEmpty);
    });
  });

  group('manufacturing logic', () {
    test('a recipe row reads name, what it makes and what goes in', () {
      expect(bomTitle(_bom()), 'Biscuit batch');
      expect(bomSubtitle(_bom()), 'Makes 10 Biscuits · 2 inputs, 1 scrap');
      expect(bomIsActive(_bom()), isTrue);
      expect(bomIsActive({..._bom(), 'is_active': false}), isFalse);
    });

    test('a recipe line reads quantity, item and any value it fetches', () {
      final lines = bomLineRows(_bom());
      expect(lines.map((l) => l.$1), ['Input', 'Input', 'Scrap']);
      expect(lines[0].$2, '20 KG Flour');
      expect(lines[2].$2, '1 KG Crumbs · fetches ₹12 each');
    });

    test('one batch is described from the server\'s own figures, never scaled on the phone', () {
      expect(bomBatchText(_bom()), 'Each batch takes 20 KG Flour, 5 KG Sugar and makes 10 Biscuits.');
    });

    test('roles are the website ones', () {
      expect(kBomRoles, [('input', 'Input'), ('byproduct', 'By-product'), ('scrap', 'Scrap')]);
    });

    test('create recipe body is the website one, with no identity; blank lines are dropped', () {
      final body = bomBody(
        name: ' Biscuit batch ',
        outputItemId: 'i9',
        outputQty: 10,
        lines: [
          (itemId: 'i1', role: 'input', qty: 20, recovery: 0),
          (itemId: '', role: 'input', qty: 3, recovery: 0),
          (itemId: 'i3', role: 'scrap', qty: 1, recovery: 12.5),
        ],
      );
      expect(body, {
        'name': 'Biscuit batch',
        'output_item_id': 'i9',
        'output_qty': 10,
        'lines': [
          {'item_id': 'i1', 'role': 'input', 'qty': 20, 'recovery_rate': 0},
          {'item_id': 'i3', 'role': 'scrap', 'qty': 1, 'recovery_rate': 12.5},
        ],
      });
      expectNoIdentity(body);
    });

    test('recipe refusals use the server\'s words', () {
      String? r({String name = 'A', String out = 'i9', num qty = 1, List<({String itemId, String role, num qty, num recovery})> lines = const [(itemId: 'i1', role: 'input', qty: 1, recovery: 0)]}) =>
          bomRefusal(name: name, outputItemId: out, outputQty: qty, lines: lines);
      expect(r(), isNull);
      expect(r(name: ' '), 'Name the bill of materials');
      expect(r(out: ''), 'Choose what it makes');
      expect(r(qty: 0), 'Output quantity must be more than zero');
      expect(r(lines: const []), 'Add at least one input');
      expect(r(lines: const [(itemId: 'i1', role: 'scrap', qty: 1, recovery: 0)]), 'Add at least one input');
      expect(r(lines: const [(itemId: 'i1', role: 'input', qty: 0, recovery: 0)]), 'Add at least one input');
    });

    test('a production row reads number, output, date and what was used; amount is the server cost', () {
      expect(productionTitle(_entry()), 'PRD-0001');
      expect(productionSubtitle(_entry()), '20 Biscuits · 06 Nov 2026 · used 40 Flour, 10 Sugar');
      expect(productionCost(_entry()), 1476);
    });

    test('post production sends the website fields with one godown and no identity', () {
      final body = productionBody(bomId: 'b1', batches: 2, date: DateTime(2026, 11, 10), warehouseId: 'w1', branchId: 'b1');
      expect(body, {'bom_id': 'b1', 'batches': 2, 'date': '2026-11-10', 'warehouse_id': 'w1'});
      expectNoIdentity(body);
      expect(productionBody(bomId: 'b1', batches: 1, date: DateTime(2026, 11, 10), branchId: 'br')['branch_id'], 'br');
    });

    test('production refusals and the question', () {
      expect(productionRefusal(bomId: '', batches: 1), 'Choose a bill of materials');
      expect(productionRefusal(bomId: 'b1', batches: 0), 'Enter how many batches');
      expect(productionRefusal(bomId: 'b1', batches: 1, needsGodown: true, godownId: ''), 'Choose the godown');
      expect(productionRefusal(bomId: 'b1', batches: 1), isNull);
      final q = productionAskText(_bom(), 2);
      expect(q, allOf(contains('2 batches'), contains('Biscuit batch'), contains('out of stock'), contains('adds'), contains('Each batch takes 20 KG Flour')));
      expect(productionAskText(_bom(), 1), contains('1 batch of'));
    });

    test('the done message uses the server number and unit cost', () {
      expect(productionDoneText({'number': 'PRD-0002', 'output_unit_cost': 73.8}), 'PRD-0002 posted: output at ₹73.8 each');
      expect(productionDoneText({}), 'Production posted');
    });
  });

  group('insurance claims logic', () {
    test('causes and statuses are the website ones', () {
      expect(kClaimCauses.map((c) => c.$1), ['theft', 'fire', 'flood', 'transit', 'damage', 'other']);
      expect(claimCauseLabel('theft'), 'Theft');
      expect(claimStatusLabel('lodged'), 'Lodged');
      expect(kClaimFilters.map((f) => f.$1), ['', 'lodged', 'admitted', 'settled', 'rejected']);
      expect(claimMatchesFilter(_claim(), 'lodged'), isTrue);
      expect(claimMatchesFilter(_claim(), 'settled'), isFalse);
    });

    test('a claim row reads number, loss date, cause, insurer and FIR; amount is the claim', () {
      expect(claimTitle(_claim()), 'CLM-0001');
      expect(claimSubtitle(_claim()), '03 Nov 2026 · Theft · New India · FIR FIR-12');
      expect(claimClaimed(_claim()), 5000);
    });

    test('which actions each status offers, as the website does', () {
      expect(claimActions('lodged'), [ClaimAction.admit, ClaimAction.reject]);
      expect(claimActions('admitted'), [ClaimAction.settle, ClaimAction.reject]);
      expect(claimActions('settled'), isEmpty);
      expect(claimActions('rejected'), isEmpty);
    });

    test('lodge body is the website one with no identity; empty optional fields are left out', () {
      final body = claimBody(
        lossDate: DateTime(2026, 11, 3),
        cause: 'theft',
        insurer: ' New India ',
        policy: ' P-77 ',
        firNumber: 'FIR-12',
        firDate: DateTime(2026, 11, 4),
        surveyor: ' ',
        claimed: 5000,
        adjustmentIds: ['a1'],
      );
      expect(body, {
        'loss_date': '2026-11-03',
        'cause': 'theft',
        'insurer': 'New India',
        'policy_number': 'P-77',
        'fir_number': 'FIR-12',
        'fir_date': '2026-11-04',
        'claimed_amount': 5000,
        'adjustment_ids': ['a1'],
      });
      expectNoIdentity(body);
    });

    test('lodge refusals use the server\'s words', () {
      String? r({String cause = 'fire', String insurer = 'X', num claimed = 1, String fir = ''}) =>
          claimRefusal(cause: cause, insurer: insurer, claimed: claimed, firNumber: fir);
      expect(r(), isNull);
      expect(r(insurer: ' '), 'Name the insurer');
      expect(r(claimed: 0), 'Enter the amount claimed');
      expect(r(cause: 'theft'), 'A theft claim needs the FIR number');
      expect(r(cause: 'theft', fir: 'F1'), isNull);
    });

    test('status change bodies are the website ones', () {
      expect(admitBody(4500, DateTime(2026, 11, 10)), {'action': 'admit', 'amount': 4500, 'date': '2026-11-10'});
      expect(settleClaimBody(4000, DateTime(2026, 11, 10), 'acc1'), {'action': 'settle', 'amount': 4000, 'date': '2026-11-10', 'account_id': 'acc1'});
      expect(rejectBody(DateTime(2026, 11, 10)), {'action': 'reject', 'date': '2026-11-10'});
      for (final b in [admitBody(1, DateTime(2026, 11, 10)), settleClaimBody(1, DateTime(2026, 11, 10), 'a'), rejectBody(DateTime(2026, 11, 10))]) {
        expectNoIdentity(b);
      }
    });

    test('the questions name what the ledger will do', () {
      expect(admitText(_claim(), 4500), allOf(contains('CLM-0001'), contains('₹4,500'), contains('Insurance Claims Receivable')));
      expect(settleText(_claim(status: 'admitted'), 4000, '1102 Bank'), allOf(contains('₹4,000'), contains('1102 Bank'), contains('shortfall')));
      expect(rejectText(_claim()), allOf(contains('CLM-0001'), contains('rejected')));
      expect(rejectText(_claim(status: 'admitted')), contains('goes back to the loss'));
    });

    test('write-offs a claim can cover are quantity decreases for loss reasons', () {
      final rows = [
        {'id': 'a1', 'adjustment_number': 'ADJ-1', 'item_name': 'Rice', 'direction': 'DECREASE', 'reason_code': 'THEFT', 'quantity_change': '-20', 'value_change': '-4200'},
        {'id': 'a2', 'adjustment_number': 'ADJ-2', 'item_name': 'Oil', 'direction': 'INCREASE', 'reason_code': 'STOCK_TAKE', 'quantity_change': '5'},
        {'id': 'a3', 'adjustment_number': 'ADJ-3', 'item_name': 'Soap', 'direction': 'DECREASE', 'reason_code': 'FREE_SAMPLE', 'quantity_change': '-1'},
      ];
      final w = claimWriteOffs(rows);
      expect(w.map((r) => r['id']), ['a1']);
      expect(claimWriteOffLabel(w.first), 'ADJ-1 · Rice · 20 · ₹4,200');
    });

    test('bank and cash accounts are picked as the website does', () {
      final accounts = [
        {'id': 'x1', 'account_code': '1101', 'account_name': 'Cash in hand'},
        {'id': 'x2', 'account_code': '1102', 'account_name': 'Bank'},
        {'id': 'x3', 'account_code': '1200', 'account_name': 'Stock'},
        {'id': 'x4', 'account_code': '1300', 'account_name': 'HDFC Bank account'},
      ];
      final opts = bankAccountOptions(accounts);
      expect(opts.map((o) => o.$1), ['x1', 'x2', 'x4']);
      expect(opts.first.$2, '1101 Cash in hand');
      expect(defaultBankAccount(opts), 'x2');
      expect(defaultBankAccount([opts.first]), 'x1');
      expect(defaultBankAccount(const []), '');
    });

    test('a claim that has already moved on is a quiet reload', () {
      expect(claimAlreadyChanged(ApiException('A settled claim cannot be admitted', status: 409)), isTrue);
      expect(claimAlreadyChanged(ApiException('Admit the claim before recording the settlement', status: 409)), isTrue);
      expect(claimAlreadyChanged(ApiException('A rejected claim cannot be rejected', status: 409)), isTrue);
      expect(claimAlreadyChanged(ApiException('Admitted amount must be between 0 and the amount claimed', status: 400)), isFalse);
    });
  });

  group('held goods screens', () {
    Future<(_Srv, List<RequestOptions>)> open(WidgetTester t, {_Srv? srv}) async {
      final server = srv ?? _Srv();
      final (s, sent) = server.build();
      await pumpScreen(t, StockHoldsScreen(session: s));
      return (server, sent);
    }

    testWidgets('both lists load with no identity; empty, error and plan states are handled', (t) async {
      final (_, sent) = await open(t);
      expect(find.text('Rice'), findsOneWidget);
      expect(find.textContaining('HOLD-0001'), findsOneWidget);
      expect(requestsOf(sent, 'GET', '/api/stock-holds').first.uri.queryParameters.containsKey('business_id'), isFalse);
      await t.tap(find.text("Others' goods"));
      await t.pumpAndSettle();
      expect(find.text('Motor for rewinding'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/inward-custody'), 1);

      var (s, _) = (_Srv()..holds = []).build();
      await pumpScreen(t, StockHoldsScreen(session: s));
      expect(find.text('Nothing is on hold'), findsOneWidget);
      final bad = _Srv()..listReply = (500, {'error': 'Boom'});
      (s, _) = bad.build();
      await pumpScreen(t, StockHoldsScreen(session: s));
      expect(find.text('Try again'), findsOneWidget);
      (s, _) = (_Srv()..listReply = (403, {'error': 'Upgrade', 'code': 'FEATURE_NOT_IN_PLAN'})).build();
      await pumpScreen(t, StockHoldsScreen(session: s));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('Put on hold asks first, then posts once with the godown and no identity, and the list reloads', (t) async {
      final (srv, sent) = await open(t);
      await t.tap(find.text('Put on hold'));
      await t.pumpAndSettle();
      await _chooseItem(t, _apick('Item'));
      await t.enterText(_tf('Quantity'), '3');
      await t.tap(_pick('Godown'));
      await _sheetUp(t);
      await t.tap(find.text('Main godown').last);
      await _sheetUp(t);
      srv.holds = [_hold(), _hold(id: 'h2')];
      await t.tap(find.widgetWithText(KButton, 'Put on hold'));
      await _sheetUp(t);
      expect(find.textContaining('Put 3 of Rice on hold (QC hold)'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/stock-holds'), 0);
      await _yes(t, 'Put on hold');
      final posts = requestsOf(sent, 'POST', '/api/stock-holds').toList();
      expect(posts, hasLength(1));
      final body = posts.single.data as Map;
      expect(body['item_id'], 'i1');
      expect(body['qty'], 3);
      expect(body['purpose'], 'qc_hold');
      expect(body['warehouse_id'], 'w1');
      expectNoIdentity(body);
      expect(find.text('Stock put on hold'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/stock-holds'), 2, reason: 'reloaded');
    });

    testWidgets('Put on hold without an item or godown is refused before sending', (t) async {
      final (_, sent) = await open(t);
      await t.tap(find.text('Put on hold'));
      await t.pumpAndSettle();
      await t.tap(find.widgetWithText(KButton, 'Put on hold'));
      await t.pumpAndSettle();
      expect(find.text('Choose the item and quantity'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/stock-holds'), 0);
    });

    testWidgets('Release asks for the quantity, then asks first, then posts once and reloads', (t) async {
      final (_, sent) = await open(t);
      await t.tap(find.text('Rice'));
      await _sheetUp(t);
      await t.tap(find.text('Release to saleable stock'));
      await _sheetUp(t);
      await t.enterText(_tf('Quantity (5 held)'), '3');
      await t.tap(_inSheet(find.text('Continue')));
      await _sheetUp(t);
      expect(inSheet('Release 3 of Rice (HOLD-0001) back to saleable stock?'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/stock-holds/h1'), 0);
      await _yes(t, 'Release');
      final posts = requestsOf(sent, 'POST', '/api/stock-holds/h1').toList();
      expect(posts, hasLength(1));
      final body = posts.single.data as Map;
      expect(body['release'], 3);
      expect(body.containsKey('write_off'), isFalse);
      expectNoIdentity(body);
      expect(find.text('Released to saleable stock'), findsOneWidget);
      expect(find.text('Nothing is on hold'), findsOneWidget);
    });

    testWidgets('Write off sends the quantity and the chosen reason', (t) async {
      final (_, sent) = await open(t);
      await t.tap(find.text('Rice'));
      await _sheetUp(t);
      await t.tap(find.text('Write off'));
      await _sheetUp(t);
      await t.tap(_pick('Reason'));
      await _sheetUp(t);
      await t.tap(find.text('Expired').last);
      await _sheetUp(t);
      await t.tap(_inSheet(find.text('Continue')));
      await _sheetUp(t);
      expect(inSheet('Write off 5 of Rice (HOLD-0001) as Expired? It leaves stock for good.'), findsOneWidget);
      await _yes(t, 'Write off');
      expect(requestsOf(sent, 'POST', '/api/stock-holds/h1').single.data, {'date': (requestsOf(sent, 'POST', '/api/stock-holds/h1').single.data as Map)['date'], 'write_off': 5, 'reason': 'EXPIRED'});
    });

    testWidgets('keeping the hold at the question sends nothing', (t) async {
      final (_, sent) = await open(t);
      await t.tap(find.text('Rice'));
      await _sheetUp(t);
      await t.tap(find.text('Release to saleable stock'));
      await _sheetUp(t);
      await t.tap(_inSheet(find.text('Continue')));
      await _sheetUp(t);
      await t.tap(find.text('Not yet'));
      await _sheetUp(t);
      expect(requestCount(sent, 'POST', '/api/stock-holds/h1'), 0);
    });

    testWidgets('a refusal is shown as the server words it and the list is unchanged; an already-closed hold reloads quietly', (t) async {
      final srv = _Srv()..writeReply = (409, {'error': 'Only 2 is still held.'});
      final (_, sent) = await open(t, srv: srv);
      await t.tap(find.text('Rice'));
      await _sheetUp(t);
      await t.tap(find.text('Release to saleable stock'));
      await _sheetUp(t);
      await t.tap(_inSheet(find.text('Continue')));
      await _sheetUp(t);
      await _yes(t, 'Release');
      expect(find.text('Only 2 is still held.'), findsOneWidget);
      expect(find.text('Rice'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/stock-holds'), 1);

      srv.writeReply = (409, {'error': 'This hold is already closed.'});
      srv.holds = [];
      await t.pump(const Duration(seconds: 4));
      await t.tap(find.text('Rice'));
      await _sheetUp(t);
      await t.tap(find.text('Release to saleable stock'));
      await _sheetUp(t);
      await t.tap(_inSheet(find.text('Continue')));
      await _sheetUp(t);
      await _yes(t, 'Release');
      expect(find.text(kHoldChangedText), findsOneWidget);
      expect(find.text('Nothing is on hold'), findsOneWidget);
    });

    testWidgets('others\' goods: record posts once; handed back asks first then PATCHes', (t) async {
      final (srv, sent) = await open(t);
      await t.tap(find.text("Others' goods"));
      await t.pumpAndSettle();
      await t.tap(find.text('Record goods'));
      await t.pumpAndSettle();
      await t.tap(find.widgetWithText(KButton, 'Record'));
      await t.pumpAndSettle();
      expect(find.text('Enter the owner, the goods and the quantity'), findsOneWidget);
      await t.enterText(_tf('Owner'), 'Asha');
      await t.enterText(_tf('Goods'), 'Motor');
      await t.enterText(_tf('Quantity'), '2');
      await t.tap(_pick('Godown'));
      await _sheetUp(t);
      await t.tap(find.text('Main godown').last);
      await _sheetUp(t);
      await t.tap(find.widgetWithText(KButton, 'Record'));
      await t.tap(find.widgetWithText(KButton, 'Record'), warnIfMissed: false);
      await t.pumpAndSettle();
      final posts = requestsOf(sent, 'POST', '/api/inward-custody').toList();
      expect(posts, hasLength(1));
      final body = posts.single.data as Map;
      expect(body['owner_name'], 'Asha');
      expect(body['owner_type'], 'other');
      expect(body['warehouse_id'], 'w1');
      expectNoIdentity(body);

      expect(srv.goods, isNotEmpty);
      await t.tap(find.text('Motor for rewinding'));
      await _sheetUp(t);
      await t.tap(_inSheet(find.text('Continue')));
      await _sheetUp(t);
      expect(inSheet('Hand back 2 of Motor for rewinding to Asha?'), findsOneWidget);
      await _yes(t, 'Hand back');
      final patches = requestsOf(sent, 'PATCH', '/api/inward-custody/g1').toList();
      expect(patches, hasLength(1));
      expect((patches.single.data as Map)['qty'], 2);
      expect(find.text("No one else's goods are here"), findsOneWidget);
    });
  });

  group('manufacturing screens', () {
    Future<(_Srv, List<RequestOptions>)> open(WidgetTester t, {_Srv? srv}) async {
      final server = srv ?? _Srv();
      final (s, sent) = server.build();
      await pumpScreen(t, ManufacturingScreen(session: s));
      return (server, sent);
    }

    testWidgets('recipes and production load as two tabs with the server\'s own figures', (t) async {
      final (_, sent) = await open(t);
      expect(find.text('Biscuit batch'), findsOneWidget);
      expect(find.textContaining('Makes 10 Biscuits'), findsOneWidget);
      expect(requestsOf(sent, 'GET', '/api/manufacturing/boms').first.uri.queryParameters.containsKey('business_id'), isFalse);
      await t.tap(find.text('Production'));
      await t.pumpAndSettle();
      expect(find.text('PRD-0001'), findsOneWidget);
      expect(find.textContaining('20 Biscuits'), findsOneWidget);
      expect(find.text('₹1,476'), findsOneWidget, reason: 'the server\'s output cost');
      var (s, _) = (_Srv()..boms = []).build();
      await pumpScreen(t, ManufacturingScreen(session: s));
      expect(find.text('No recipes yet'), findsOneWidget);
      (s, _) = (_Srv()..listReply = (500, {'error': 'Boom'})).build();
      await pumpScreen(t, ManufacturingScreen(session: s));
      expect(find.text('Try again'), findsOneWidget);
      (s, _) = (_Srv()..listReply = (403, {'error': 'Upgrade', 'code': 'FEATURE_NOT_IN_PLAN'})).build();
      await pumpScreen(t, ManufacturingScreen(session: s));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('a new recipe is refused when blank, then posts once with its lines', (t) async {
      final (_, sent) = await open(t);
      await t.tap(find.text('New recipe'));
      await t.pumpAndSettle();
      await t.tap(find.widgetWithText(KButton, 'Save recipe'));
      await t.pumpAndSettle();
      expect(find.text('Name the bill of materials'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/manufacturing/boms'), 0);
      await t.enterText(_tf('Name'), 'Rice pack');
      await _chooseItem(t, _apick('Makes'));
      await t.enterText(_tf('Quantity per batch').first, '10');
      await _chooseItem(t, find.byKey(const ValueKey('line-0-item')));
      await t.enterText(find.descendant(of: find.byKey(const ValueKey('line-0-qty')), matching: find.byType(TextField)), '12');
      await t.tap(find.widgetWithText(KButton, 'Save recipe'));
      await t.tap(find.widgetWithText(KButton, 'Save recipe'), warnIfMissed: false);
      await t.pumpAndSettle();
      final posts = requestsOf(sent, 'POST', '/api/manufacturing/boms').toList();
      expect(posts, hasLength(1));
      final body = posts.single.data as Map;
      expect(body['name'], 'Rice pack');
      expect(body['output_item_id'], 'i1');
      expect(body['output_qty'], 10);
      expect(body['lines'], [
        {'item_id': 'i1', 'role': 'input', 'qty': 12, 'recovery_rate': 0},
      ]);
      expectNoIdentity(body);
      expect(find.text('Bill of materials saved'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/manufacturing/boms'), 2, reason: 'the list reloaded');
    });

    testWidgets('Produce on a recipe asks first, names the recipe and that stock moves, posts once and shows the cost', (t) async {
      final (_, sent) = await open(t);
      await t.tap(find.text('Biscuit batch'));
      await _sheetUp(t);
      expect(find.text('Each batch takes 20 KG Flour, 5 KG Sugar and makes 10 Biscuits.'), findsOneWidget);
      await t.tap(find.widgetWithText(KButton, 'Produce'));
      await t.pumpAndSettle();
      await t.tap(_pick('Godown'));
      await _sheetUp(t);
      await t.tap(find.text('Main godown').last);
      await _sheetUp(t);
      await t.enterText(_tf('Batches'), '2');
      await t.tap(find.widgetWithText(KButton, 'Post production'));
      await _sheetUp(t);
      expect(find.textContaining('Post production of 2 batches of Biscuit batch?'), findsOneWidget);
      expect(find.textContaining('out of stock'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/manufacturing/production'), 0);
      await _yes(t, 'Post production');
      final posts = requestsOf(sent, 'POST', '/api/manufacturing/production').toList();
      expect(posts, hasLength(1));
      final body = posts.single.data as Map;
      expect(body['bom_id'], 'b1');
      expect(body['batches'], 2);
      expect(body['warehouse_id'], 'w1');
      expectNoIdentity(body);
      expect(find.text('PRD-0002 posted: output at ₹73.8 each'), findsOneWidget);
    });

    testWidgets('a refused production shows the server\'s words and stays on the form', (t) async {
      final srv = _Srv()..writeReply = (400, {'error': 'Insufficient stock for Flour. Available: 5'});
      final (_, sent) = await open(t, srv: srv);
      await t.tap(find.text('Production'));
      await t.pumpAndSettle();
      await t.tap(find.text('Post production'));
      await t.pumpAndSettle();
      await t.tap(find.widgetWithText(KButton, 'Post production'));
      await t.pumpAndSettle();
      expect(find.text('Choose a bill of materials'), findsOneWidget);
      await t.tap(_pick('Recipe'));
      await _sheetUp(t);
      await t.tap(find.textContaining('Biscuit batch').last);
      await _sheetUp(t);
      await t.tap(_pick('Godown'));
      await _sheetUp(t);
      await t.tap(find.text('Main godown').last);
      await _sheetUp(t);
      await t.tap(find.widgetWithText(KButton, 'Post production'));
      await _sheetUp(t);
      await _yes(t, 'Post production');
      expect(find.text('Insufficient stock for Flour. Available: 5'), findsOneWidget);
      expect(find.widgetWithText(KButton, 'Post production'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/manufacturing/production'), 1);
    });
  });

  group('insurance claims screens', () {
    Future<(_Srv, List<RequestOptions>)> open(WidgetTester t, {_Srv? srv}) async {
      final server = srv ?? _Srv();
      final (s, sent) = server.build();
      await pumpScreen(t, InsuranceClaimsScreen(session: s));
      return (server, sent);
    }

    testWidgets('lists claims with the server\'s amount and a status chip filter; empty, error and plan states', (t) async {
      final srv = _Srv()..claims = [_claim(), {..._claim(status: 'settled'), 'id': 'c3', 'claim_number': 'CLM-0003'}];
      final (_, sent) = await open(t, srv: srv);
      expect(find.text('CLM-0001'), findsOneWidget);
      expect(find.text('CLM-0003'), findsOneWidget);
      expect(find.text('₹5,000'), findsWidgets);
      expect(requestsOf(sent, 'GET', '/api/insurance-claims').first.uri.queryParameters.containsKey('business_id'), isFalse);
      await t.tap(find.text('Settled').first);
      await t.pumpAndSettle();
      expect(find.text('CLM-0003'), findsOneWidget);
      expect(find.text('CLM-0001'), findsNothing);
      var (s, _) = (_Srv()..claims = []).build();
      await pumpScreen(t, InsuranceClaimsScreen(session: s));
      expect(find.text('No claims yet'), findsOneWidget);
      (s, _) = (_Srv()..listReply = (500, {'error': 'Boom'})).build();
      await pumpScreen(t, InsuranceClaimsScreen(session: s));
      expect(find.text('Try again'), findsOneWidget);
      (s, _) = (_Srv()..listReply = (403, {'error': 'Upgrade', 'code': 'FEATURE_NOT_IN_PLAN'})).build();
      await pumpScreen(t, InsuranceClaimsScreen(session: s));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('Lodge a claim: a theft needs the FIR; then it posts once with the write-offs it covers', (t) async {
      final (_, sent) = await open(t);
      await t.tap(find.text('Lodge claim'));
      await t.pumpAndSettle();
      await t.enterText(_tf('Insurer'), 'New India');
      await t.enterText(_tf('Amount claimed'), '5000');
      await t.tap(find.widgetWithText(KButton, 'Lodge claim'));
      await t.pumpAndSettle();
      expect(find.text('A theft claim needs the FIR number'), findsOneWidget);
      expect(requestCount(sent, 'POST', '/api/insurance-claims'), 0);
      await t.enterText(_tf('FIR number (required)'), 'FIR-12');
      await t.tap(find.textContaining('ADJ-1'));
      await t.pump();
      await t.tap(find.widgetWithText(KButton, 'Lodge claim'));
      await t.tap(find.widgetWithText(KButton, 'Lodge claim'), warnIfMissed: false);
      await t.pumpAndSettle();
      final posts = requestsOf(sent, 'POST', '/api/insurance-claims').toList();
      expect(posts, hasLength(1));
      final body = posts.single.data as Map;
      expect(body['cause'], 'theft');
      expect(body['insurer'], 'New India');
      expect(body['claimed_amount'], 5000);
      expect(body['fir_number'], 'FIR-12');
      expect(body['adjustment_ids'], ['a1']);
      expectNoIdentity(body);
      expect(find.text('Claim lodged'), findsOneWidget);
    });

    Future<(_Srv, List<RequestOptions>)> openDetail(WidgetTester t, {String status = 'lodged', Reply? write}) async {
      final srv = _Srv()
        ..claims = [_claim(status: status)]
        ..writeReply = write;
      final r = await open(t, srv: srv);
      await t.tap(find.text('CLM-0001'));
      await t.pumpAndSettle();
      return r;
    }

    testWidgets('a claim opens with its facts and write-offs; a lodged one offers Admitted and, under More, Rejected', (t) async {
      await openDetail(t);
      expect(find.text('New India'), findsWidgets);
      expect(find.text('FIR-12'), findsOneWidget);
      expect(find.text('Mr Rao'), findsOneWidget);
      expect(find.textContaining('ADJ-1'), findsOneWidget);
      expect(find.widgetWithText(KButton, 'Admitted'), findsOneWidget);
      expect(find.byTooltip('More'), findsOneWidget);
    });

    testWidgets('Admitted asks for the amount, then asks first naming the ledger move, then PATCHes once', (t) async {
      final (_, sent) = await openDetail(t);
      await t.tap(find.widgetWithText(KButton, 'Admitted'));
      await _sheetUp(t);
      await t.enterText(_tf('Amount the insurer admitted'), '4500');
      await t.tap(_inSheet(find.text('Continue')));
      await _sheetUp(t);
      expect(find.textContaining('Admit ₹4,500 on CLM-0001'), findsOneWidget);
      expect(find.textContaining('Insurance Claims Receivable'), findsOneWidget);
      expect(requestCount(sent, 'PATCH', '/api/insurance-claims/c1'), 0);
      await _yes(t, 'Admit');
      final patches = requestsOf(sent, 'PATCH', '/api/insurance-claims/c1').toList();
      expect(patches, hasLength(1));
      final body = patches.single.data as Map;
      expect(body['action'], 'admit');
      expect(body['amount'], 4500);
      expect(RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(body['date'] as String), isTrue);
      expectNoIdentity(body);
      expect(find.text('Claim admitted'), findsOneWidget);
      expect(find.widgetWithText(KButton, 'Received'), findsOneWidget, reason: 'reloaded as admitted');
    });

    testWidgets('Received picks the bank account, asks first, and PATCHes the settlement once', (t) async {
      final (_, sent) = await openDetail(t, status: 'admitted');
      await t.tap(find.widgetWithText(KButton, 'Received'));
      await _sheetUp(t);
      await _sheetUp(t);
      await t.enterText(_tf('Amount received'), '4000');
      await t.tap(_inSheet(find.text('Continue')));
      await _sheetUp(t);
      expect(find.textContaining('Record ₹4,000 received into 1102 Bank for CLM-0001'), findsOneWidget);
      await _yes(t, 'Record received');
      final body = requestsOf(sent, 'PATCH', '/api/insurance-claims/c1').single.data as Map;
      expect(body['action'], 'settle');
      expect(body['amount'], 4000);
      expect(body['account_id'], 'x2');
      expectNoIdentity(body);
    });

    testWidgets('Rejected is under More, asks first, and PATCHes once', (t) async {
      final (_, sent) = await openDetail(t);
      await t.tap(find.byTooltip('More'));
      await t.pumpAndSettle();
      await t.tap(find.text('Rejected'));
      await _sheetUp(t);
      expect(find.textContaining('Mark CLM-0001 as rejected?'), findsOneWidget);
      expect(requestCount(sent, 'PATCH', '/api/insurance-claims/c1'), 0);
      await _yes(t, 'Reject claim');
      expect((requestsOf(sent, 'PATCH', '/api/insurance-claims/c1').single.data as Map)['action'], 'reject');
    });

    testWidgets('a refusal shows the server\'s words and leaves the claim as it was; a moved-on claim reloads quietly', (t) async {
      final (srv, sent) = await openDetail(t, write: (400, {'error': 'Admitted amount must be between 0 and the amount claimed'}));
      await t.tap(find.widgetWithText(KButton, 'Admitted'));
      await _sheetUp(t);
      await t.tap(_inSheet(find.text('Continue')));
      await _sheetUp(t);
      await _yes(t, 'Admit');
      expect(find.text('Admitted amount must be between 0 and the amount claimed'), findsOneWidget);
      expect(find.widgetWithText(KButton, 'Admitted'), findsOneWidget);
      expect(requestCount(sent, 'PATCH', '/api/insurance-claims/c1'), 1);

      srv.writeReply = (409, {'error': 'A admitted claim cannot be admitted'});
      srv.claims = [_claim(status: 'admitted')];
      await t.pump(const Duration(seconds: 4));
      await t.tap(find.widgetWithText(KButton, 'Admitted'));
      await _sheetUp(t);
      await t.tap(_inSheet(find.text('Continue')));
      await _sheetUp(t);
      await _yes(t, 'Admit');
      expect(find.text(kClaimChangedText), findsOneWidget);
      expect(find.widgetWithText(KButton, 'Received'), findsOneWidget);
    });
  });

  group('wiring', () {
    test('the other three links have phone screens and are no longer website links', () {
      final session = recordedSession((o, b) => (404, {})).$1;
      expect(nativeScreenFor(session, '/stock-holds'), isA<StockHoldsScreen>());
      expect(nativeScreenFor(session, '/manufacturing'), isA<ManufacturingScreen>());
      expect(nativeScreenFor(session, '/insurance-claims'), isA<InsuranceClaimsScreen>());
      for (final h in ['/stock-holds', '/manufacturing', '/insurance-claims']) {
        expect(websiteForNow.contains(h), isFalse);
        expect(stillGeneric.contains(h), isFalse);
        expect(routeTier(session, h), RouteTier.native);
      }
    });
  });

}

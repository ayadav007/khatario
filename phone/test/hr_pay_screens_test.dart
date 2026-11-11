import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/hr/commissions_screen.dart';
import 'package:khatario_phone/screens/hr/employee_expenses_screen.dart';
import 'package:khatario_phone/screens/hr/salary_advances_screen.dart';
import 'package:khatario_phone/screens/hr/targets_screen.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/pages/page_catalog.dart';
import 'package:khatario_phone/screens/reports/statement_pdf.dart';
import 'package:khatario_phone/ui/form_kit.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/finders.dart';
import 'support/hr_fake_api.dart';

const _fullPlan = ['hr_payroll', 'hr_payroll_setup', 'hr_leaves', 'hr_commissions', 'hr_advanced'];
const _noIdentity = ['business_id', 'user_id', 'created_by', 'approved_by', 'requested_by', 'updated_by_user_id', 'processed_by'];

Finder _pick(bool Function(Widget w) match) => find.descendant(of: find.byWidgetPredicate(match), matching: find.byType(InkWell));

void _noIdentity0(Map<String, dynamic>? body) {
  for (final k in _noIdentity) {
    expect(body!.containsKey(k), isFalse, reason: '$k must not be sent');
  }
}

FakeHrApi _api(Object? Function(String m, String p, Map<String, dynamic>? b) h, {List<String> plan = _fullPlan}) => FakeHrApi((m, p, b) => planReply(p, plan) ?? h(m, p, b));

Finder _iconButton(String tooltip) => find.byWidgetPredicate((w) => w is KIconButton && w.tooltip == tooltip);

Future<void> _open(WidgetTester t, Widget screen) => openScreen(t, KeyedSubtree(key: UniqueKey(), child: screen));

Future<void> _tapText(WidgetTester t, String text, {bool last = false}) async {
  await t.tap(last ? find.text(text).last : find.text(text).first);
  await t.pumpAndSettle();
}

void main() {
  group('salary advances', () {
    final pending = {'id': 'a1', 'employee_name': 'Asha Rao', 'employee_code': 'E1', 'advance_date': '2026-11-02', 'advance_amount': '5000', 'recovered_amount': '0', 'remaining_amount': '5000', 'status': 'pending'};

    FakeHrApi server({Object? Function(String m, String p, Map<String, dynamic>? b)? onWrite, List<Map<String, dynamic>>? rows}) => _api((m, p, b) {
          if (p.startsWith('/api/employees/salary/advances/balance')) return {'pending_balance': 3000, 'awaiting_approval_amount': 0, 'suggested_recovery': 1000};
          if (p.startsWith('/api/employees/salary/advances') && m == 'GET') return {'advances': rows ?? [pending]};
          if (p.startsWith('/api/employees?')) {
            return {
              'employees': [
                {'id': 'e1', 'user_name': 'Asha Rao', 'employee_code': 'E1'},
              ],
            };
          }
          if (m == 'POST' || m == 'PATCH') return onWrite?.call(m, p, b) ?? {'advance': {'id': 'a1'}};
          return null;
        });

    testWidgets('lists advances with the server amounts', (t) async {
      final api = server();
      await _open(t, SalaryAdvancesScreen(session: hrSession(api)));
      expect(find.text('Asha Rao'), findsOneWidget);
      expect(find.textContaining('₹5,000'), findsWidgets);
      expect(find.text('Pending'), findsWidgets);
    });

    testWidgets('approving asks naming the employee and the amount, patches once and reloads', (t) async {
      final gate = Completer<Object?>();
      final api = server(onWrite: (m, p, b) => gate.future);
      await _open(t, SalaryAdvancesScreen(session: hrSession(api)));
      await _tapText(t, 'Approve');
      expect(find.textContaining('Approve the advance of ₹5,000 for Asha Rao'), findsOneWidget);
      expect(api.paths('PATCH'), isEmpty);
      await t.tap(find.text('Approve').last);
      await t.pump();
      await t.pump();
      expect(api.paths('PATCH'), ['/api/employees/salary/advances/a1/approve']);
      expect(api.bodies('PATCH', '/api/employees/salary/advances').single, {'approved': true, 'payment_mode': 'bank_transfer'});
      final before = api.paths('GET', '/api/employees/salary/advances?').length + api.paths('GET', '/api/employees/salary/advances').length;
      gate.complete({'advance': {'id': 'a1'}});
      await t.pumpAndSettle();
      expect(api.paths('PATCH').length, 1);
      expect(api.paths('GET', '/api/employees/salary/advances').where((p) => !p.contains('balance')).length, greaterThanOrEqualTo(2), reason: 'reloaded after approving ($before before)');
    });

    testWidgets("a refusal is shown in the server's words", (t) async {
      final api = server(onWrite: (m, p, b) => ApiException('Advance is already approved', status: 400));
      await _open(t, SalaryAdvancesScreen(session: hrSession(api)));
      await _tapText(t, 'Approve');
      await t.tap(find.text('Approve').last);
      await t.pumpAndSettle();
      expect(find.text('Advance is already approved'), findsOneWidget);
    });

    testWidgets('rejecting asks for a reason and sends it', (t) async {
      final api = server();
      await _open(t, SalaryAdvancesScreen(session: hrSession(api)));
      await _tapText(t, 'Reject');
      await t.enterText(find.byType(TextField).last, 'Not eligible');
      await t.tap(find.text('Reject advance'));
      await t.pumpAndSettle();
      expect(api.bodies('PATCH', '/api/employees/salary/advances').single, {'approved': false, 'rejection_reason': 'Not eligible'});
    });

    testWidgets('new advance shows the pending balance and posts the website fields', (t) async {
      final api = server();
      await _open(t, SalaryAdvancesScreen(session: hrSession(api)));
      await t.tap(find.text('Request advance').last);
      await t.pumpAndSettle();
      await t.tap(_pick((w) => w is KAsyncPickField && w.label == 'Employee'));
      await t.pumpAndSettle();
      await t.tap(find.text('Asha Rao').last);
      await t.pumpAndSettle();
      expect(find.textContaining('Pending advance'), findsOneWidget);
      await t.enterText(textFieldLabelled('Advance amount', within: KAmountField), '2000');
      await t.enterText(textFieldLabelled('Reason'), 'Medical');
      await t.pump();
      await t.tap(find.text('Submit request'));
      await t.pumpAndSettle();
      final body = api.bodies('POST', '/api/employees/salary/advances').single!;
      _noIdentity0(body);
      expect(body['employee_id'], 'e1');
      expect(body['advance_amount'], 2000);
      expect(body['reason'], 'Medical');
      expect(body['recovery_method'], 'salary_deduction');
    });

    testWidgets('FEATURE_NOT_IN_PLAN and server errors have their own states, with Try again', (t) async {
      var fail = ApiException('Not in plan', status: 403, code: 'FEATURE_NOT_IN_PLAN');
      final api = _api((m, p, b) => p.startsWith('/api/employees/salary/advances') ? fail : null);
      await _open(t, SalaryAdvancesScreen(session: hrSession(api)));
      expect(find.text('Not included in your current plan'), findsOneWidget);
      fail = ApiException('Boom', status: 500);
      await _open(t, SalaryAdvancesScreen(session: hrSession(api)));
      expect(find.text('Try again'), findsOneWidget);
    });

    testWidgets('an empty list says so', (t) async {
      await _open(t, SalaryAdvancesScreen(session: hrSession(server(rows: []))));
      expect(find.text('No salary advances found'), findsOneWidget);
    });
  });

  group('employee expenses', () {
    final pending = {'id': 'x1', 'employee_name': 'Asha Rao', 'employee_code': 'E1', 'category_name': 'Travel', 'expense_date': '2026-11-03', 'amount': '850', 'status': 'pending', 'description': 'Cab'};
    final approved = {...pending, 'id': 'x2', 'status': 'approved'};

    FakeHrApi server({List<Map<String, dynamic>>? rows, Object? Function(String m, String p, Map<String, dynamic>? b)? onWrite, Object? upload}) => _api((m, p, b) {
          if (p.startsWith('/api/employees/expenses') && m == 'GET') {
            return {'expenses': rows ?? [pending], 'totals': {'pending': 850, 'approved': 0, 'reimbursed': 0, 'total': 850}};
          }
          if (p == '/api/expense-categories') {
            return {
              'categories': [
                {'id': 'c1', 'category_name': 'Travel'},
              ],
            };
          }
          if (p.startsWith('/api/employees?')) {
            return {
              'employees': [
                {'id': 'e1', 'user_name': 'Asha Rao', 'employee_code': 'E1'},
              ],
            };
          }
          if (m == 'POST' || m == 'PATCH') return onWrite?.call(m, p, b) ?? {'expense': {'id': 'x9'}};
          return null;
        });

    testWidgets('lists expenses with the server totals', (t) async {
      await _open(t, EmployeeExpensesScreen(session: hrSession(server())));
      expect(find.text('Cab'), findsOneWidget);
      expect(find.textContaining('₹850'), findsWidgets);
    });

    testWidgets('approve asks naming the employee and the recorded amount, then patches once', (t) async {
      final api = server();
      await _open(t, EmployeeExpensesScreen(session: hrSession(api)));
      await _tapText(t, 'Approve');
      expect(find.text('Approve the expense of ₹850 from Asha Rao?'), findsOneWidget);
      await t.tap(find.text('Approve').last);
      await t.pumpAndSettle();
      expect(api.paths('PATCH'), ['/api/employees/expenses/x1']);
      expect(api.bodies('PATCH', '/api/employees/expenses/x1').single, {'action': 'approve'});
    });

    testWidgets('reject takes a reason; a refusal is shown', (t) async {
      final api = server(onWrite: (m, p, b) => ApiException('Only pending expenses can be rejected', status: 400));
      await _open(t, EmployeeExpensesScreen(session: hrSession(api)));
      await _tapText(t, 'Reject');
      await t.enterText(find.byType(TextField).last, 'No bill');
      await t.tap(find.text('Reject expense'));
      await t.pumpAndSettle();
      expect(api.bodies('PATCH', '/api/employees/expenses/x1').single, {'action': 'reject', 'rejection_reason': 'No bill'});
      expect(find.text('Only pending expenses can be rejected'), findsOneWidget);
    });

    testWidgets('an approved expense can be reimbursed with a reference', (t) async {
      final api = server(rows: [approved]);
      await _open(t, EmployeeExpensesScreen(session: hrSession(api)));
      await _tapText(t, 'Reimburse');
      await t.enterText(find.byType(TextField).last, 'UTR9');
      await t.tap(find.text('Mark reimbursed'));
      await t.pumpAndSettle();
      expect(api.bodies('PATCH', '/api/employees/expenses/x2').single, {'action': 'reimburse', 'reimbursement_reference': 'UTR9'});
    });

    testWidgets('the voucher opens in the shared PDF viewer', (t) async {
      final api = _ApiBytes(server());
      await _open(t, EmployeeExpensesScreen(session: hrSession(api)));
      await t.tap(find.text('Voucher').first);
      await t.pump();
      await t.pump(const Duration(milliseconds: 500));
      expect(api.bytesPaths, ['/api/employees/expenses/x1/voucher/pdf']);
      expect(find.byType(PdfViewerScreen), findsOneWidget);
    });

    testWidgets('new expense uploads the bill, posts it as receipt_url and sends no creator', (t) async {
      final api = _ApiBytes(server());
      await openScreen(
        t,
        EmployeeExpensesScreen(
          session: hrSession(api),
          pickReceipt: () async => (bytes: <int>[1, 2, 3], name: 'bill.jpg'),
        ),
      );
      await t.tap(find.text('Submit expense').last);
      await t.pumpAndSettle();
      await t.tap(_pick((w) => w is KAsyncPickField && w.label == 'Employee'));
      await t.pumpAndSettle();
      await t.tap(find.text('Asha Rao').last);
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Amount', within: KAmountField), '850');
      await t.enterText(textFieldLabelled('Description'), 'Cab');
      await t.tap(find.text('Add bill photo'));
      await t.pumpAndSettle();
      expect(api.uploads, ['/api/upload/image']);
      await t.tap(find.text('Submit expense').last);
      await t.pumpAndSettle();
      final body = api.bodies('POST', '/api/employees/expenses').single!;
      _noIdentity0(body);
      expect(body['employee_id'], 'e1');
      expect(body['amount'], 850);
      expect(body['receipt_url'], 'data:image/jpeg;base64,AAA');
    });

    testWidgets('plan-less, empty and error states', (t) async {
      await _open(t, EmployeeExpensesScreen(session: hrSession(server(rows: []))));
      expect(find.text('No expenses found'), findsOneWidget);
      final noPlan = _api((m, p, b) => p.startsWith('/api/employees/expenses') ? ApiException('x', status: 403, code: 'FEATURE_NOT_IN_PLAN') : null);
      await _open(t, EmployeeExpensesScreen(session: hrSession(noPlan)));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });
  });

  group('commissions and targets', () {
    final pending = {'id': 'c1', 'employee_name': 'Asha Rao', 'employee_code': 'E1', 'invoice_number': 'INV-9', 'sale_amount': '10000', 'commission_rate': '2.5', 'commission_amount': '250', 'status': 'pending'};
    final approved = {...pending, 'id': 'c2', 'status': 'approved'};

    FakeHrApi server({List<Map<String, dynamic>>? rows, Object? Function(String m, String p, Map<String, dynamic>? b)? onWrite, List<String> plan = _fullPlan}) => _api((m, p, b) {
          if (p.startsWith('/api/employees/commissions') && m == 'GET') {
            return {'commissions': rows ?? [pending], 'totals': {'pending': 250, 'approved': 0, 'paid': 0, 'total': 250}};
          }
          if (p == '/api/employees/targets' && m == 'GET') {
            return {
              'targets': [
                {'id': 't1', 'employee_id': 'e1', 'employee_name': 'Asha Rao', 'employee_code': 'E1', 'target_period': 'monthly', 'target_year': 2026, 'target_month': 11, 'target_amount': '100000', 'target_invoices': 20},
              ],
            };
          }
          if (p.startsWith('/api/employees?')) {
            return {
              'employees': [
                {'id': 'e1', 'user_name': 'Asha Rao', 'employee_code': 'E1'},
              ],
            };
          }
          if (m == 'POST' || m == 'DELETE') return onWrite?.call(m, p, b) ?? {'ok': true};
          return null;
        }, plan: plan);

    testWidgets('approve asks naming the employee and amount, posts the commission id and action only', (t) async {
      final api = server();
      await _open(t, CommissionsScreen(session: hrSession(api)));
      await _tapText(t, 'Approve');
      expect(find.text('Approve the commission of ₹250 for Asha Rao?'), findsOneWidget);
      expect(api.paths('POST'), isEmpty);
      await t.tap(find.text('Approve').last);
      await t.pumpAndSettle();
      expect(api.bodies('POST', '/api/employees/commissions').single, {'commission_id': 'c1', 'action': 'approve'});
    });

    testWidgets('pay asks first and a refusal is shown', (t) async {
      final api = server(rows: [approved], onWrite: (m, p, b) => ApiException('Only approved commissions can be paid', status: 400));
      await _open(t, CommissionsScreen(session: hrSession(api)));
      await _tapText(t, 'Pay');
      expect(find.textContaining('Pay the commission of ₹250 to Asha Rao'), findsOneWidget);
      await t.tap(find.text('Pay').last);
      await t.pumpAndSettle();
      expect(api.bodies('POST', '/api/employees/commissions').single, {'commission_id': 'c2', 'action': 'pay'});
      expect(find.text('Only approved commissions can be paid'), findsOneWidget);
    });

    testWidgets('the targets link follows the plan (hr_advanced)', (t) async {
      await _open(t, CommissionsScreen(session: hrSession(server())));
      expect(_iconButton('Targets'), findsOneWidget);
      await _open(t, CommissionsScreen(session: hrSession(server(plan: const ['hr_payroll', 'hr_commissions']))));
      expect(_iconButton('Targets'), findsNothing);
    });

    testWidgets('targets list, set a target (no business id) and delete after asking', (t) async {
      final api = server();
      await _open(t, TargetsScreen(session: hrSession(api)));
      expect(find.text('November 2026'), findsOneWidget);
      expect(find.textContaining('₹1,00,000'), findsOneWidget);
      await t.tap(find.text('Set target').last);
      await t.pumpAndSettle();
      await t.tap(_pick((w) => w is KAsyncPickField && w.label == 'Employee'));
      await t.pumpAndSettle();
      await t.tap(find.text('Asha Rao').last);
      await t.pumpAndSettle();
      await t.enterText(textFieldLabelled('Target amount', within: KAmountField), '120000');
      await t.pump();
      await t.tap(find.text('Save target'));
      await t.pumpAndSettle();
      final body = api.bodies('POST', '/api/employees/targets').single!;
      _noIdentity0(body);
      expect(body['employee_id'], 'e1');
      expect(body['target_amount'], 120000);
      await t.tap(_iconButton('Delete target').first);
      await t.pumpAndSettle();
      expect(api.paths('DELETE'), isEmpty);
      await t.tap(find.text('Delete').last);
      await t.pumpAndSettle();
      expect(api.paths('DELETE'), ['/api/employees/targets/t1']);
    });

    testWidgets('the website links open these native screens', (t) async {
      final s = hrSession(server());
      expect(nativeScreenFor(s, '/employees/salary/advances'), isA<SalaryAdvancesScreen>());
      expect(nativeScreenFor(s, '/employees/expenses'), isA<EmployeeExpensesScreen>());
      expect(nativeScreenFor(s, '/employees/commissions'), isA<CommissionsScreen>());
      expect(nativeScreenFor(s, '/employees/targets'), isA<TargetsScreen>());
      for (final h in ['/employees/salary/advances', '/employees/expenses', '/employees/commissions']) {
        expect(stillGeneric.contains(h), isFalse, reason: h);
      }
    });
  });
}

/// A fake that also answers binary downloads and uploads.
class _ApiBytes extends FakeHrApi {
  _ApiBytes(FakeHrApi inner) : super(inner.handler);

  final bytesPaths = <String>[];
  final uploads = <String>[];

  @override
  Future<List<int>> getBytes(String path) async {
    bytesPaths.add(path);
    return <int>[37, 80, 68, 70];
  }

  @override
  Future<Map<String, dynamic>> uploadImage(String path, {required List<int> bytes, required String fileName, Map<String, String> fields = const {}}) async {
    uploads.add(path);
    return {'url': 'data:image/jpeg;base64,AAA'};
  }
}

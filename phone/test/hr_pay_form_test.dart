import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/hr/payslip_screen.dart';
import 'package:khatario_phone/screens/hr/salary_payment_form_screen.dart';
import 'package:khatario_phone/screens/hr/salary_payments_screen.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
import 'package:khatario_phone/screens/reports/statement_pdf.dart';
import 'package:khatario_phone/ui/form_kit.dart';

import 'support/finders.dart';
import 'support/hr_fake_api.dart';

Finder _pick(bool Function(Widget w) match) => find.descendant(of: find.byWidgetPredicate(match), matching: find.byType(InkWell));
Finder _employee() => _pick((w) => w is KAsyncPickField && w.label == 'Employee');

const _fullPlan = ['hr_payroll', 'hr_payroll_setup', 'hr_leaves', 'hr_commissions', 'hr_advanced'];
const _litePlan = ['hr_payroll'];

FakeHrApi _server({
  List<String> plan = _fullPlan,
  Object? Function(String m, String p, Map<String, dynamic>? b)? onPost,
  Object? Function(String p)? prefill,
  num pending = 0,
}) {
  return FakeHrApi((m, p, b) {
    final plan0 = planReply(p, plan);
    if (plan0 != null) return plan0;
    if (p.startsWith('/api/employees?')) {
      return {
        'employees': [
          {'id': 'e1', 'user_name': 'Asha Rao', 'employee_code': 'E1'},
        ],
      };
    }
    if (p.startsWith('/api/employees/salary/payments/prefill')) {
      return prefill?.call(p) ??
          {
            'source': 'salary_structure',
            'fields': {'basic_salary': 20000, 'hra': 5000, 'provident_fund': 1800, 'esi_employee': 0},
            'attendance_deduction': {'total': 500, 'lines': [], 'summary': null},
            'component_breakdown': [],
          };
    }
    if (p.startsWith('/api/employees/salary/advances/balance')) {
      return {'pending_balance': pending, 'awaiting_approval_amount': 0, 'suggested_recovery': pending};
    }
    if (m == 'POST') {
      return onPost?.call(m, p, b) ??
          {
            'salary_payment': {'id': 'p1', 'net_salary': '22700.00', 'gross_salary': 25000, 'total_deductions': '2300'},
            'advance_recoveries': 0,
          };
    }
    return null;
  });
}

Future<void> _pickEmployee(WidgetTester t) async {
  await t.tap(_employee());
  await t.pumpAndSettle();
  await t.tap(find.text('Asha Rao'));
  await t.pumpAndSettle();
}

void main() {
  group('pay salary form', () {
    testWidgets('picking the employee fills the form from the server prefill and shows the net payable', (t) async {
      final api = _server();
      await openScreen(t, SalaryPaymentFormScreen(session: hrSession(api)));
      await _pickEmployee(t);
      expect(api.paths('GET', '/api/employees/salary/payments/prefill').single, startsWith('/api/employees/salary/payments/prefill?employee_id=e1&from_date='));
      expect(api.paths('GET').any((p) => p.contains('business_id') || p.contains('user_id')), isFalse);
      expect(t.widget<TextField>(textFieldLabelled('Basic salary', within: KAmountField)).controller!.text, '20000.00');
      expect(t.widget<TextField>(textFieldLabelled('Attendance deduction (late / LWP)', within: KAmountField)).controller!.text, '500.00');
      // 20000 + 5000 - 1800 - 500
      expect(find.text('₹22,700'), findsOneWidget);
    });

    testWidgets('asks naming the employee and the net, posts once, and shows the server net after', (t) async {
      final gate = Completer<Object?>();
      final api = _server(onPost: (m, p, b) => gate.future);
      await openScreen(t, SalaryPaymentFormScreen(session: hrSession(api)));
      await _pickEmployee(t);
      await t.tap(find.text('Process salary'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      expect(find.textContaining('Pay Asha Rao ₹22,700 (form total) for'), findsOneWidget);
      expect(find.textContaining('pending leave encashment or overtime'), findsOneWidget);
      expect(api.paths('POST'), isEmpty);
      await t.tap(find.text('Pay salary'));
      await t.pump();
      await t.pump();
      expect(api.paths('POST'), ['/api/employees/salary/payments']);
      final body = api.bodies('POST', '/api/employees/salary/payments').single!;
      expect(body['employee_id'], 'e1');
      expect(body['basic_salary'], 20000);
      expect(body['generate_payslip'], true);
      for (final k in ['business_id', 'user_id', 'created_by', 'processed_by']) {
        expect(body.containsKey(k), isFalse);
      }
      gate.complete({
        'salary_payment': {'id': 'p1', 'net_salary': '22650.00', 'gross_salary': 25000, 'total_deductions': '2350'},
        'advance_recoveries': 0,
      });
      await t.pumpAndSettle();
      expect(api.paths('POST').length, 1);
      expect(find.byType(SalaryPaymentFormScreen), findsNothing);
    });

    testWidgets('cancelling the ask posts nothing', (t) async {
      final api = _server();
      await openScreen(t, SalaryPaymentFormScreen(session: hrSession(api)));
      await _pickEmployee(t);
      await t.tap(find.text('Process salary'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      await t.tap(find.text('Not now'));
      await t.pumpAndSettle();
      expect(api.paths('POST'), isEmpty);
      expect(find.byType(SalaryPaymentFormScreen), findsOneWidget);
    });

    testWidgets("a refusal (already paid for the month) keeps the form and shows the server's words", (t) async {
      final api = _server(onPost: (m, p, b) => ApiException('Salary payment already exists for this month', status: 409));
      await openScreen(t, SalaryPaymentFormScreen(session: hrSession(api)));
      await _pickEmployee(t);
      await t.tap(find.text('Process salary'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      await t.tap(find.text('Pay salary'));
      await t.pumpAndSettle();
      expect(find.text('Salary payment already exists for this month'), findsOneWidget);
      expect(find.byType(SalaryPaymentFormScreen), findsOneWidget);
      expect(textFieldLabelled('Basic salary', within: KAmountField), findsOneWidget);
    });

    testWidgets('saved but not posted to the books: says so, closes the form and reloads the payments list', (t) async {
      final api = FakeHrApi((m, p, b) {
        final plan = planReply(p, _fullPlan);
        if (plan != null) return plan;
        if (p.startsWith('/api/employees?')) {
          return {
            'employees': [
              {'id': 'e1', 'user_name': 'Asha Rao', 'employee_code': 'E1'},
            ],
          };
        }
        if (p.startsWith('/api/employees/salary/payments/prefill')) {
          return {'source': 'employee_salary', 'fields': {'basic_salary': 20000}};
        }
        if (p.startsWith('/api/employees/salary/advances/balance')) return {'pending_balance': 0};
        if (m == 'POST') {
          return ApiException('The period is locked', status: 500, body: {'error': 'The period is locked', 'salary_payment': {'id': 'p1'}});
        }
        if (p == '/api/employees/salary/payments') return {'payments': []};
        return null;
      });
      await openScreen(t, SalaryPaymentsScreen(session: hrSession(api)));
      await t.tap(find.text('Pay salary').last);
      await t.pumpAndSettle();
      await _pickEmployee(t);
      await t.tap(find.text('Process salary'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      await t.tap(find.text('Pay salary').last);
      await t.pumpAndSettle();
      expect(find.byType(SalaryPaymentFormScreen), findsNothing);
      expect(find.textContaining('Salary was saved but could not be posted to the books: The period is locked'), findsOneWidget);
      expect(api.paths('GET', '/api/employees/salary/payments').where((p) => p == '/api/employees/salary/payments').length, 2, reason: 'list reloaded');
    });

    testWidgets('advance recovery above the outstanding advance is refused before asking', (t) async {
      final api = _server(pending: 1000);
      await openScreen(t, SalaryPaymentFormScreen(session: hrSession(api)));
      await _pickEmployee(t);
      await t.enterText(textFieldLabelled('Advance recovery', within: KAmountField), '5000');
      await t.pump();
      expect(find.textContaining('cannot be more than the pending advance'), findsWidgets);
      await t.tap(find.text('Process salary'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      expect(find.text('Pay salary'), findsNothing);
      expect(api.paths('POST'), isEmpty);
    });

    testWidgets('a plan without payroll setup hides the statutory fields, as the website does', (t) async {
      final api = _server(plan: _litePlan);
      await openScreen(t, SalaryPaymentFormScreen(session: hrSession(api)));
      await _pickEmployee(t);
      expect(find.text('Basic salary'), findsOneWidget);
      expect(find.text('HRA'), findsNothing);
      expect(find.text('Employee PF'), findsNothing);
      expect(find.text('Leave days'), findsNothing);
      expect(find.text('Bonus'), findsOneWidget);
    });

    testWidgets('FEATURE_NOT_IN_PLAN on the prefill is shown, not swallowed', (t) async {
      final api = _server(prefill: (_) => ApiException('Not in plan', status: 403, code: 'FEATURE_NOT_IN_PLAN'));
      await openScreen(t, SalaryPaymentFormScreen(session: hrSession(api)));
      await _pickEmployee(t);
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });
  });

  group('salary payments list', () {
    FakeHrApi list({List<Map<String, dynamic>> payments = const []}) => FakeHrApi((m, p, b) {
          final plan = planReply(p, _fullPlan);
          if (plan != null) return plan;
          if (p == '/api/employees/salary/payments') return {'payments': payments};
          return null;
        });
    final one = {'id': 'p1', 'employee_name': 'Asha Rao', 'salary_month': '2026-10', 'net_salary': '22700', 'gross_salary': '25000', 'total_deductions': '2300', 'status': 'processed', 'payment_date': '2026-11-01'};

    testWidgets('Pay salary opens the native form, not the website', (t) async {
      final api = list();
      await openScreen(t, SalaryPaymentsScreen(session: hrSession(api)));
      await t.tap(find.text('Pay salary').last);
      await t.pumpAndSettle();
      expect(find.byType(SalaryPaymentFormScreen), findsOneWidget);
    });

    testWidgets('a row opens its payslip', (t) async {
      final api = list(payments: [one]);
      await openScreen(t, SalaryPaymentsScreen(session: hrSession(api)));
      await t.tap(find.text('Asha Rao'));
      await t.pumpAndSettle();
      expect(find.byType(PayslipScreen), findsOneWidget);
    });

    testWidgets('the payslip shows the server figures and opens the server PDF in the shared viewer', (t) async {
      final api = _Bytes(list(payments: [one]));
      await openScreen(t, SalaryPaymentsScreen(session: hrSession(api)));
      await t.tap(find.text('Asha Rao'));
      await t.pumpAndSettle();
      expect(find.text('Net salary'), findsOneWidget);
      expect(find.text('₹22,700'), findsOneWidget);
      await t.tap(find.text('Open payslip PDF'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 500));
      expect(api.bytesPaths, ['/api/employees/salary/payslips/p1/pdf']);
      expect(find.byType(PdfViewerScreen), findsOneWidget);
    });

    testWidgets('the routes the website uses open native screens', (t) async {
      final s = hrSession(list());
      expect(nativeScreenFor(s, '/employees/salary/payments/new'), isA<SalaryPaymentFormScreen>());
    });
  });
}

/// A fake that also answers binary downloads.
class _Bytes extends FakeHrApi {
  _Bytes(FakeHrApi inner) : super(inner.handler);

  final bytesPaths = <String>[];

  @override
  Future<List<int>> getBytes(String path) async {
    bytesPaths.add(path);
    return <int>[37, 80, 68, 70];
  }
}

import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/hr/pay_logic.dart';

const _identity = ['business_id', 'user_id', 'created_by', 'processed_by', 'requested_by', 'approved_by', 'updated_by_user_id'];

void expectNoIdentity(Map<String, dynamic> body) {
  for (final k in _identity) {
    expect(body.containsKey(k), isFalse, reason: '$k must not be sent');
  }
}

void main() {
  group('salary prefill', () {
    test('asks the server for the employee and the period only', () {
      expect(
        salaryPrefillPath(employeeId: 'e1', from: DateTime(2026, 10, 1), to: DateTime(2026, 10, 31)),
        '/api/employees/salary/payments/prefill?employee_id=e1&from_date=2026-10-01&to_date=2026-10-31',
      );
    });

    test('reads the server figures, the attendance suggestion and the pro-rata note', () {
      final p = SalaryPrefill.fromJson({
        'source': 'salary_structure',
        'fields': {'basic_salary': 20000, 'hra': '5000.50', 'provident_fund': 1800},
        'pro_rata': {'applied': true, 'daysPaid': 20, 'daysInPeriod': 31, 'fullMonthlySalary': 30000, 'proratedAmount': 19354.84, 'joiningDate': '2026-10-12'},
        'attendance_deduction': {
          'total': 500,
          'lines': [
            {'type': 'late', 'date': '2026-10-03', 'label': 'Late 3 Oct', 'amount': 500},
          ],
          'summary': {'daily_rate': 1000, 'late_count': 3, 'billable_late_count': 1},
        },
        'component_breakdown': [
          {'code': 'BASIC', 'name': 'Basic', 'type': 'earning', 'amount': 20000},
        ],
      });
      expect(p.source, 'salary_structure');
      expect(p.field('basic_salary'), '20000.00');
      expect(p.field('hra'), '5000.50');
      expect(p.field('tds'), '0.00');
      expect(p.attendanceDeduction, '500.00');
      expect(p.attendanceLines.single['label'], 'Late 3 Oct');
      expect(p.attendanceSummary?['daily_rate'], 1000);
      expect(p.componentBreakdown.single['code'], 'BASIC');
      expect(p.proRataNote, contains('20 of 31 days'));
      expect(p.workingDays, '31');
      expect(p.presentDays, '20');
    });

    test('a missing or odd reply reads as zeros, not a crash', () {
      final p = SalaryPrefill.fromJson({});
      expect(p.field('basic_salary'), '0.00');
      expect(p.attendanceLines, isEmpty);
      expect(p.proRataNote, isNull);
    });
  });

  group('advance balance', () {
    test('asks for the employee, with the gross as the cap when there is one', () {
      expect(advanceBalancePath('e1'), '/api/employees/salary/advances/balance?employee_id=e1');
      expect(advanceBalancePath('e1', cap: 25000), '/api/employees/salary/advances/balance?employee_id=e1&cap_amount=25000');
    });

    test('reads pending, awaiting and suggested amounts and plan labels', () {
      final b = AdvanceBalance.fromJson({
        'pending_balance': 6000,
        'awaiting_approval_amount': '1000',
        'suggested_recovery': 2000,
        'recovery_breakdown': [
          {'plan_label': '1 of 3 months'},
          {'plan_label': null},
        ],
      });
      expect((b.pending, b.awaiting, b.suggested), (6000, 1000, 2000));
      expect(b.planLabels, ['1 of 3 months']);
    });
  });

  group('salary totals and body', () {
    final values = <String, String>{
      'basic_salary': '20000',
      'hra': '5000',
      'bonus': '1000',
      'provident_fund': '1800',
      'advance_recovery': '2000',
      'attendance_deduction': '500',
      'esi_employee': '150',
    };

    test('totals follow the website summary: earnings, deductions (with ESI), net', () {
      final t = salaryTotals(values);
      expect(t.earnings, 26000);
      expect(t.deductions, 4450);
      expect(t.net, 21550);
    });

    test('empty or odd text counts as zero', () {
      expect(salaryTotals({'basic_salary': '', 'hra': 'x'}).net, 0);
    });

    test('the body carries the website fields and no person or business', () {
      final body = salaryPaymentBody(
        employeeId: 'e1',
        month: '2026-10',
        from: DateTime(2026, 10, 1),
        to: DateTime(2026, 10, 31),
        paymentDate: DateTime(2026, 11, 1),
        values: values,
        fullHr: true,
        paymentMode: 'bank_transfer',
        paymentReference: ' UTR1 ',
        notes: '',
        recoveryNote: '',
        attendanceLines: const [
          {'label': 'Late', 'amount': 500},
        ],
        attendanceSummary: const {'daily_rate': 1000},
        componentBreakdown: const [
          {'code': 'BASIC'},
        ],
      );
      expectNoIdentity(body);
      expect(body['employee_id'], 'e1');
      expect(body['salary_month'], '2026-10');
      expect((body['from_date'], body['to_date'], body['payment_date']), ('2026-10-01', '2026-10-31', '2026-11-01'));
      expect(body['basic_salary'], 20000);
      expect(body['advance_recovery'], 2000);
      expect(body['esi_employee'], 150);
      expect(body['payment_mode'], 'bank_transfer');
      expect(body['payment_reference'], 'UTR1');
      expect(body['generate_payslip'], true);
      expect(body['attendance_adjustment_details'], {'lines': [{'label': 'Late', 'amount': 500}], 'summary': {'daily_rate': 1000}});
      expect(body['component_breakdown'], isNotEmpty);
      expect(body.containsKey('notes'), isFalse);
    });

    test('without payroll setup the plan-hidden fields go out as zero, as on the website', () {
      final body = salaryPaymentBody(
        employeeId: 'e1',
        month: '2026-10',
        from: DateTime(2026, 10, 1),
        to: DateTime(2026, 10, 31),
        paymentDate: DateTime(2026, 11, 1),
        values: {...values, 'overtime': '300', 'tds': '90'},
        fullHr: false,
        paymentMode: 'cash',
        paymentReference: '',
        notes: 'n',
        recoveryNote: '',
        attendanceLines: const [
          {'label': 'Late', 'amount': 500},
        ],
        attendanceSummary: null,
        componentBreakdown: const [
          {'code': 'BASIC'},
        ],
      );
      expect(body['hra'], 0);
      expect(body['overtime'], 0);
      expect(body['tds'], 0);
      expect(body['provident_fund'], 0);
      expect(body['attendance_deduction'], 0);
      expect(body['bonus'], 1000);
      expect(body['attendance_adjustment_details'], isNull);
      expect(body['component_breakdown'], isEmpty);
      expect(body['notes'], 'n');
    });

    test('advance recovery above the outstanding advance is refused the way the website says it', () {
      expect(recoveryProblem(pending: 0, recovery: 100), 'Advance recovery has to be 0 until this employee has an approved salary advance.');
      expect(recoveryProblem(pending: 5000, recovery: 6000), contains('cannot be more than the pending advance'));
      expect(recoveryProblem(pending: 5000, recovery: 5000), isNull);
      expect(recoveryProblem(pending: 0, recovery: 0), isNull);
    });

    test('the ask names the employee, the month and the amount', () {
      expect(
        salaryPayAsk(employee: 'Asha Rao', month: '2026-10', net: 21550),
        'Pay Asha Rao ₹21,550 (form total) for October 2026? The server adds any pending leave encashment or overtime and posts the final amount. This posts to your books.',
      );
    });

    test('the server answer: its net, gross and deductions', () {
      final r = SalaryPaid.fromJson({
        'salary_payment': {'id': 'p1', 'net_salary': '21800.00', 'gross_salary': 26000, 'total_deductions': '4200'},
        'advance_recoveries': 1,
      });
      expect((r.id, r.net, r.gross, r.deductions, r.advanceRecoveries), ('p1', 21800, 26000, 4200, 1));
    });

    test('payslip PDF path is the website route', () {
      expect(payslipPdfPath('p1'), '/api/employees/salary/payslips/p1/pdf');
    });
  });
}

import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/hr/pay_logic.dart';

import 'support/recorded_session.dart' show expectNoIdentity;

void main() {
  group('salary advances', () {
    test('list path filters by status only', () {
      expect(advancesPath('all'), '/api/employees/salary/advances');
      expect(advancesPath('pending'), '/api/employees/salary/advances?status=pending');
    });

    test('rows read the server amounts and label the status like the website', () {
      final rows = advanceRows([
        {'id': 'a1', 'employee_name': 'Asha Rao', 'employee_code': 'E1', 'advance_date': '2026-11-02T00:00:00.000Z', 'advance_amount': '5000.00', 'recovered_amount': '1000', 'remaining_amount': 4000, 'status': 'partially_recovered', 'reason': 'Medical'},
        {'employee_name': 'no id'},
      ]);
      expect(rows.length, 1);
      final a = rows.single;
      expect((a.id, a.employeeName, a.amount, a.recovered, a.remaining), ('a1', 'Asha Rao', 5000, 1000, 4000));
      expect(a.date, DateTime(2026, 11, 2));
      expect(advanceStatusLabel('partially_recovered'), 'Partially recovered');
      expect(advanceStatusLabel('pending'), 'Pending');
    });

    test('new advance body: the website fields, months only when recovering from salary', () {
      final b = advanceBody(employeeId: 'e1', amount: '5000', date: DateTime(2026, 11, 10), reason: ' Medical ', method: 'salary_deduction', months: '3');
      expectNoIdentity(b);
      expect(b, {'employee_id': 'e1', 'advance_amount': 5000, 'advance_date': '2026-11-10', 'reason': 'Medical', 'recovery_method': 'salary_deduction', 'recovery_months': 3});
      expect(advanceBody(employeeId: 'e1', amount: '5000', date: DateTime(2026, 11, 10), reason: 'x', method: 'one_time_payment', months: '3')['recovery_months'], isNull);
      expect(advanceBody(employeeId: 'e1', amount: '5000', date: DateTime(2026, 11, 10), reason: 'x', method: 'salary_deduction', months: '')['recovery_months'], isNull);
    });

    test('approve and reject bodies and path', () {
      expect(advanceApprovePath('a1'), '/api/employees/salary/advances/a1/approve');
      expect(advanceDecisionBody(), {'approved': true, 'payment_mode': 'bank_transfer'});
      expect(advanceDecisionBody(rejectionReason: 'Not eligible'), {'approved': false, 'rejection_reason': 'Not eligible'});
      expectNoIdentity(advanceDecisionBody());
    });

    test('the approve ask names the employee and the advance amount from the record', () {
      expect(advanceApproveAsk(employee: 'Asha Rao', amount: 5000), 'Approve the advance of ₹5,000 for Asha Rao? This posts to your books and cannot be undone here.');
    });
  });

  group('employee expenses', () {
    test('list path carries status and dates', () {
      expect(expensesPath(status: 'all', from: DateTime(2026, 11, 1), to: DateTime(2026, 11, 10)), '/api/employees/expenses?start_date=2026-11-01&end_date=2026-11-10');
      expect(expensesPath(status: 'pending', from: DateTime(2026, 11, 1), to: DateTime(2026, 11, 10)), '/api/employees/expenses?status=pending&start_date=2026-11-01&end_date=2026-11-10');
    });

    test('rows and the totals are what the server sent', () {
      final rows = expenseRows([
        {'id': 'x1', 'employee_name': 'Asha Rao', 'employee_code': 'E1', 'category_name': 'Travel', 'expense_date': '2026-11-03T00:00:00.000Z', 'amount': '850.00', 'status': 'pending', 'description': 'Cab', 'receipt_url': 'data:image/png;base64,AAA'},
      ]);
      expect((rows.single.id, rows.single.category, rows.single.amount, rows.single.status, rows.single.hasReceipt), ('x1', 'Travel', 850, 'pending', true));
      final t = ExpenseTotals.fromJson({'pending': 850, 'approved': '100', 'reimbursed': 0, 'total': 950});
      expect((t.pending, t.approved, t.reimbursed, t.total), (850, 100, 0, 950));
    });

    test('new expense body: the website fields, the receipt as receipt_url, no creator', () {
      final b = expenseBody(
        employeeId: 'e1', categoryId: '', date: DateTime(2026, 11, 3), amount: '850', description: ' Cab ', paymentMode: 'cash', vendor: '', receiptUrl: 'data:image/png;base64,AAA',
        billable: false, billableCustomer: '', billableProject: '',
      );
      expectNoIdentity(b);
      expect(b['employee_id'], 'e1');
      expect(b['expense_category_id'], isNull);
      expect(b['amount'], 850);
      expect(b['currency'], 'INR');
      expect(b['description'], 'Cab');
      expect(b['payment_mode'], 'cash');
      expect(b['receipt_url'], 'data:image/png;base64,AAA');
      expect(b['is_billable'], false);
      expect(b.containsKey('vendor_name'), isFalse);
    });

    test('action bodies: approve, reject with a reason, reimburse with a reference, cancel', () {
      expect(expenseActionBody('approve'), {'action': 'approve'});
      expect(expenseActionBody('reject', text: 'No bill'), {'action': 'reject', 'rejection_reason': 'No bill'});
      expect(expenseActionBody('reimburse', text: 'UTR9'), {'action': 'reimburse', 'reimbursement_reference': 'UTR9'});
      expect(expenseActionBody('reimburse', text: ' '), {'action': 'reimburse'});
      expect(expenseActionBody('cancel'), {'action': 'cancel'});
      expectNoIdentity(expenseActionBody('approve'));
      expect(expensePath('x1'), '/api/employees/expenses/x1');
      expect(expenseVoucherPdfPath('x1'), '/api/employees/expenses/x1/voucher/pdf');
    });

    test('a bill must be a JPG, PNG or PDF under 5 MB, as the website says', () {
      expect(receiptProblem(name: 'bill.jpg', size: 1000), isNull);
      expect(receiptProblem(name: 'bill.PDF', size: 1000), isNull);
      expect(receiptProblem(name: 'bill.gif', size: 1000), 'Choose a JPG, PNG or PDF.');
      expect(receiptProblem(name: 'bill.png', size: 6 * 1024 * 1024), 'File size too large. Maximum size is 5MB.');
    });

    test('the asks name the employee and the amount from the record', () {
      expect(expenseAsk('approve', employee: 'Asha Rao', amount: 850), 'Approve the expense of ₹850 from Asha Rao?');
      expect(expenseAsk('reimburse', employee: 'Asha Rao', amount: 850), 'Mark the expense of ₹850 from Asha Rao as reimbursed?');
      expect(expenseAsk('cancel', employee: 'Asha Rao', amount: 850), 'Cancel the expense of ₹850 from Asha Rao?');
    });
  });

  group('commissions and targets', () {
    test('commission list path and action body', () {
      expect(commissionsPath(status: 'approved', from: DateTime(2026, 11, 1), to: DateTime(2026, 11, 10)), '/api/employees/commissions?status=approved&start_date=2026-11-01&end_date=2026-11-10');
      expect(commissionActionBody('c1', 'pay'), {'commission_id': 'c1', 'action': 'pay'});
      expectNoIdentity(commissionActionBody('c1', 'approve'));
    });

    test('commission rows read the server amounts', () {
      final r = commissionRows([
        {'id': 'c1', 'employee_name': 'Asha Rao', 'employee_code': 'E1', 'invoice_number': 'INV-9', 'sale_amount': '10000', 'commission_rate': '2.50', 'commission_amount': '250', 'status': 'approved'},
      ]).single;
      expect((r.id, r.invoiceNumber, r.saleAmount, r.rate, r.amount, r.status), ('c1', 'INV-9', 10000, 2.5, 250, 'approved'));
      final t = CommissionTotals.fromJson({'pending': 1, 'approved': 250, 'paid': 3, 'total': 254});
      expect((t.pending, t.approved, t.paid, t.total), (1, 250, 3, 254));
    });

    test('the commission ask names the employee and the amount', () {
      expect(commissionAsk('pay', employee: 'Asha Rao', amount: 250), 'Pay the commission of ₹250 to Asha Rao? This is recorded as paid and cannot be undone here.');
      expect(commissionAsk('approve', employee: 'Asha Rao', amount: 250), 'Approve the commission of ₹250 for Asha Rao?');
      expect(commissionAsk('cancel', employee: 'Asha Rao', amount: 250), 'Cancel the commission of ₹250 for Asha Rao?');
    });

    test('target body: month only for monthly, no business', () {
      final m = targetBody(employeeId: 'e1', period: 'monthly', year: 2026, month: 11, amount: '100000', invoices: '20');
      expectNoIdentity(m);
      expect(m, {'employee_id': 'e1', 'target_period': 'monthly', 'target_year': 2026, 'target_month': 11, 'target_amount': 100000, 'target_invoices': 20});
      final y = targetBody(employeeId: 'e1', period: 'yearly', year: 2026, month: 11, amount: '1200000', invoices: '');
      expect(y['target_month'], isNull);
      expect(y['target_invoices'], isNull);
      expect(targetPath('t1'), '/api/employees/targets/t1');
    });

    test('target rows and period labels follow the website', () {
      final r = targetRows([
        {'id': 't1', 'employee_name': 'Asha Rao', 'employee_code': 'E1', 'target_period': 'monthly', 'target_year': 2026, 'target_month': 11, 'target_amount': '100000.00', 'target_invoices': 20},
        {'id': 't2', 'employee_name': 'Asha Rao', 'target_period': 'quarterly', 'target_year': 2026, 'target_month': 5, 'target_amount': 5},
        {'id': 't3', 'employee_name': 'Ravi', 'target_period': 'yearly', 'target_year': 2026, 'target_amount': 5},
      ]);
      expect(r.map(targetPeriodLabel), ['November 2026', 'Q2 2026', '2026']);
      expect(r.first.amount, 100000);
      expect(r.first.invoices, 20);
    });
  });
}

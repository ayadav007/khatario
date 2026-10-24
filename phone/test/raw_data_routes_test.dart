import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/hr/employee_logic.dart';
import 'package:khatario_phone/screens/hr/employees_screen.dart';
import 'package:khatario_phone/screens/pages/page_catalog.dart';
import 'package:khatario_phone/screens/pages/record_format.dart';
import 'package:khatario_phone/screens/pages/record_page.dart';
import 'package:khatario_phone/screens/reports/cash_flow_screen.dart';
import 'package:khatario_phone/screens/reports/financial_statements_screens.dart';
import 'package:khatario_phone/screens/reports/report_period.dart';
import 'package:khatario_phone/screens/reports/statement_kit.dart';
import 'package:khatario_phone/screens/settings/settings_router.dart';
import 'package:khatario_phone/session.dart';

void main() {
  final session = AppSession(KhatarioApi(Dio()), {
    'user': {'id': 'u', 'name': 'Rakesh'},
    'business': {'id': 'b', 'name': 'Sharma Textiles'},
  });

  test('employees, cash flow and the statements open their own screens', () {
    expect(dedicatedPageScreen(session, '/employees'), isA<EmployeesScreen>());
    expect(dedicatedPageScreen(session, '/reports/cash-flow'), isA<CashFlowScreen>());
    expect(dedicatedPageScreen(session, '/reports/profit-loss'), isA<ProfitLossScreen>());
    expect(dedicatedPageScreen(session, '/reports/balance-sheet'), isA<BalanceSheetScreen>());
    expect(dedicatedPageScreen(session, '/reports/trial-balance'), isA<TrialBalanceScreen>());
    // "All employees" used to open the app-users settings screen.
    expect(phoneSettingPage(session, '/employees'), isNull);
  });

  test('an employee row reads as name, role and status', () {
    final row = {'user_name': 'Asha Rao', 'employee_code': 'EMP-7', 'designation': 'Cashier', 'department': 'Front', 'is_active': true, 'user_is_active': true};
    expect(employeeName(row), 'Asha Rao');
    expect(employeeSubtitle(row), 'Cashier · Front');
    expect(employeeActive(row), isTrue);
    expect(employeeActive({...row, 'user_is_active': false}), isFalse);
    expect(employeeName({'employee_code': 'EMP-9'}), 'EMP-9');
    expect(employmentLabel('part_time'), 'Part time');
    expect(filterEmployees([row, {'user_name': 'Vikram'}], 'cash').single['user_name'], 'Asha Rao');
    expect(filterEmployees([row], 'emp-7'), hasLength(1));
    expect(maskTail('123456789012'), '•••• 9012');
  });

  test('report periods follow the April financial year', () {
    final oct = DateTime(2026, 10, 17);
    final fy = ReportPeriod.of('this_fy', oct);
    expect((fy.fromIso, fy.toIso), ('2026-04-01', '2026-10-17'));
    final lastFy = ReportPeriod.of('last_fy', oct);
    expect((lastFy.fromIso, lastFy.toIso), ('2025-04-01', '2026-03-31'));
    final feb = ReportPeriod.of('this_fy', DateTime(2027, 2, 3));
    expect(feb.fromIso, '2026-04-01');
    final lastMonth = ReportPeriod.of('last_month', DateTime(2026, 1, 9));
    expect((lastMonth.fromIso, lastMonth.toIso), ('2025-12-01', '2025-12-31'));
    expect(ReportPeriod.of('this_quarter', oct).fromIso, '2026-10-01');
    expect(fy.query, 'from_date=2026-04-01&to_date=2026-10-17');
  });

  test('statement money shows paise and brackets losses', () {
    expect(statementMoney(1234.5), '₹1,234.50');
    expect(statementMoney(-250), '(₹250.00)');
    expect(statementLines([{'label': 'Trade receivables', 'amount': -400}]).single, (label: 'Trade receivables', amount: -400));
  });

  test('the generic record view hides ids and formats money and dates', () {
    final row = {
      'id': '3f1c2a9e-1b2c-4d5e-8f90-123456789abc',
      'business_id': 'b',
      'customer_name': 'Mehta Stores',
      'grand_total': '1180.5',
      'invoice_date': '2026-10-02',
      'is_paid': false,
      'payment_status': 'partially_paid',
      'password_hash': 'x',
      'totals': {'total_debit': 500, 'count': 3},
      'lines': [
        {'name': 'Rice', 'amount': 100},
      ],
    };
    final fields = Map.fromEntries(plainFields(row).map((f) => MapEntry(f.$1, f.$2)));
    expect(fields.keys, isNot(contains('Id')));
    expect(fields.keys, isNot(contains('Business id')));
    expect(fields.keys, isNot(contains('Password hash')));
    expect(fields['Grand total'], '₹1,180.5');
    expect(fields['Invoice date'], '02 Oct 2026');
    expect(fields['Is paid'], 'No');
    expect(fields['Payment status'], 'Partially paid');
    final nested = nestedSections(row);
    expect(nested.whereType<NestedFields>().single.rows, contains(('Total debit', '₹500')));
    expect(nested.whereType<NestedFields>().single.rows, contains(('Count', '3')));
    expect(nested.whereType<NestedList>().single.items.single['name'], 'Rice');
    expect(recordTitle({'id': '3f1c2a9e-1b2c-4d5e-8f90-123456789abc', 'remarks': 'Opening stock'}), 'Opening stock');
    expect(primaryAmount({'qty': 2, 'stock_value': 900}), ('stock_value', 900));
    expect(primaryAmount({'paid_amount': 0, 'grand_total': '960.00'}), ('grand_total', 960));
    expect(formatField('discount_total', '0.00'), '₹0');
    expect(formatField('invoice_count', 3), '3');
    expect(formatField('total_invoices', 11), '11');
    expect(formatField('pending_leaves', 0), '0');
    expect(formatField('total', 1), '1');
    expect(formatField('total_events', 20), '20');
    expect(formatField('total', 1416.5), '₹1,416.5');
    expect(formatField('grand_total', 1416), '₹1,416');
    expect(formatField('total_cgst', 0), '₹0');
    expect(formatField('total_paid', 1447), '₹1,447');
    expect(recordTitle({'user_name': 'Rahul', 'description': 'Created invoice INV-9'}), 'Created invoice INV-9');
    expect(recordTitle({'user_name': 'Reja Ullah', 'employee_code': 'EMP001'}), 'Reja Ullah');
    expect(formatField('mode', 'live_vs_live'), 'Live vs live');
    expect(fieldLabel('b2cs'), 'B2CS');
    expect(fieldLabel('rcm_mode'), 'RCM mode');
    expect(pageForHref('/reports/gst/gstr9')!.withTitle('GSTR-9').title, 'GSTR-9');
    expect(formatField('credit_note_date', '2026-10-10T18:30:00.000Z'), isNot(contains(':')));
    expect(formatField('credit_note_date', '2026-10-11T00:00:00.000Z'), '11 Oct 2026');
    expect(recordTitle({'invoice_number': 'INV-006', 'credit_note_number': 'CN-001'}), 'CN-001');
  });

  testWidgets('a single-object report renders sections, not raw keys', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: RecordSections(row: {
            'id': '3f1c2a9e-1b2c-4d5e-8f90-123456789abc',
            'total_sales': 2500,
            'breakdown': {'taxable_value': 2000, 'cgst': 250},
            'items': [
              {'item_name': 'Soap', 'total': 120},
            ],
          }),
        ),
      ),
    ));
    expect(find.text('Overview'), findsOneWidget);
    expect(find.text('₹2,500'), findsOneWidget);
    expect(find.text('Taxable value'), findsOneWidget);
    expect(find.text('CGST'), findsOneWidget);
    expect(find.text('Soap'), findsOneWidget);
    expect(find.textContaining('3f1c2a9e'), findsNothing);
  });

  test('stock rows are titled by item, and an empty paged list is empty', () {
    expect(recordTitle({'item_id': '3f1c2a9e-1b2c-4d5e-8f90-123456789abc', 'item_name': 'Basmati 5kg', 'stock_value': 45}), 'Basmati 5kg');
    expect(recordsFromBody({'snapshots': [], 'pagination': {'page': 1, 'limit': 50, 'total': 0}}, null), isEmpty);
    // A report object that merely carries an empty warnings list is still shown.
    expect(recordsFromBody({'net_profit': 10, 'warnings': []}, null), hasLength(1));
  });

  test('report rows get a readable title and raw payloads stay hidden', () {
    expect(recordTitle({'period': '2026-10-01', 'sales': 100}), '01 Oct 2026');
    expect(recordTitle({'id': '3f1c2a9e-1b2c-4d5e-8f90-123456789abc', 'provider': 'razorpay', 'currency': 'INR'}), 'razorpay');
    expect(plainFields({'raw_payload': 'x', 'amount': 5}).map((f) => f.$1), ['Amount']);
    expect(nestedSections({'raw_payload': {'a': 1}}), isEmpty);
    expect((nestedSections({'days': ['2026-10-12']}).single as NestedValues).values, ['12 Oct 2026']);
    expect(recordTitle({'tax_rate': 18, 'total_tax': 90}), '18% GST');
    expect(recordTitle({'payment_mode': 'upi', 'total_amount': 21}), 'UPI');
    expect(recordTitle({'sale_type': 'b2c', 'total_sales': 21}), 'B2C');
  });

  test('dashboards are shown whole, wrapped lists stay lists', () {
    expect(isReportObject({'total_employees': 4, 'recent': [{'name': 'A'}]}), isTrue);
    expect(isReportObject({'stock': [{'item_name': 'A'}], 'totals': {'stock_value': 5}}), isTrue);
    expect(isReportObject({'items': [{'name': 'A'}], 'pagination': {'page': 1}}), isFalse);
    expect(isReportObject({'items': [], 'business_id': 'b'}), isFalse);
    // Closing stock with no snapshot: only empty lists, paging and a null cutoff.
    final closing = {'summary': null, 'snapshots': [], 'pagination': {'page': 1, 'total': 0}, 'history': [], 'inventory_lock': {'cutoff_date': null}};
    expect(isReportObject(closing), isFalse);
    expect(nestedSections(closing), isEmpty);
    // A status breakdown object is never printed as an amount.
    expect(recordAmount({'total': {'open': 0, 'closed': 1}}), isNull);
  });

  test('every report and HR route in the catalog still resolves', () {
    expect(pageForHref('/employees/new')?.path, '/employees/new', reason: 'website-only form, not the employee list');
    for (final href in ['/reports/cash-flow', '/employees', '/reports/stock/valuation', '/hr/dashboard']) {
      expect(pageForHref(href), isNotNull, reason: href);
    }
  });
}

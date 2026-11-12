import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/hr/employee_logic.dart';
import 'package:khatario_phone/screens/hr/employees_screen.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';
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
    expect(nativeScreenFor(session, '/employees'), isA<EmployeesScreen>());
    expect(nativeScreenFor(session, '/reports/cash-flow'), isA<CashFlowScreen>());
    expect(nativeScreenFor(session, '/reports/profit-loss'), isA<ProfitLossScreen>());
    expect(nativeScreenFor(session, '/reports/balance-sheet'), isA<BalanceSheetScreen>());
    expect(nativeScreenFor(session, '/reports/trial-balance'), isA<TrialBalanceScreen>());
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
}

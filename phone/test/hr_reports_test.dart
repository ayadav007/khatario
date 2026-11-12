import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/hr/hr_more_logic.dart';
import 'package:khatario_phone/screens/hr/hr_reports_screen.dart';

import 'support/hr_fake_api.dart';

class _Bytes extends FakeHrApi {
  _Bytes(super.handler);
  final fetched = <String>[];

  /// While set, a download waits for it (to test a second tap during a download).
  Completer<void>? gate;

  @override
  Future<List<int>> getBytes(String path) async {
    fetched.add(path);
    await gate?.future;
    if (path.contains('fail')) throw ApiException('Failed to generate report', status: 500);
    return <int>[69, 109, 112]; // "Emp"
  }
}

final _now = DateTime(2026, 11, 10);

Future<void> _download(WidgetTester t, String id) async {
  final f = find.byKey(ValueKey('download-$id'));
  await t.ensureVisible(f);
  await t.tap(f);
  await t.pumpAndSettle();
}

void main() {
  group('HR report catalogue', () {
    test('lists the website reports in order, with the real route names', () {
      expect([for (final r in hrReports) r.id], [
        'attendance', 'leave-balances', 'leave-consumption', 'leave-negative-balances', 'leave-accrual',
        'leave-carry-forward', 'leave-encashment', 'payroll-register', 'statutory-ecr', 'overtime-register',
        'headcount', 'new-joinings', 'employees-registered', 'employees-unregistered',
      ]);
      expect(hrReports.firstWhere((r) => r.id == 'statutory-ecr').route, '/api/hr/reports/statutory-ecr');
      expect(hrReports.firstWhere((r) => r.id == 'headcount').route, '/api/hr/reports/headcount');
    });

    test('a month report sends year, month and salary_month; a year report sends year and month 1; the rest none', () {
      HrReportDef r(String id) => hrReports.firstWhere((x) => x.id == id);
      expect(hrReportPath(r('attendance'), 2026, 11), '/api/hr/reports/attendance?year=2026&month=11&salary_month=2026-11');
      expect(hrReportPath(r('payroll-register'), 2026, 3), '/api/hr/reports/payroll-register?year=2026&month=3&salary_month=2026-03');
      expect(hrReportPath(r('overtime-register'), 2026, 11), '/api/hr/reports/overtime-register?year=2026&month=11&salary_month=2026-11');
      expect(hrReportPath(r('statutory-ecr'), 2026, 11), '/api/hr/reports/statutory-ecr?year=2026&month=11&salary_month=2026-11');
      expect(hrReportPath(r('leave-balances'), 2026, 11), '/api/hr/reports/leave-balances?year=2026&month=1');
      expect(hrReportPath(r('leave-encashment'), 2026, 11), '/api/hr/reports/leave-encashment?year=2026&month=1');
      expect(hrReportPath(r('headcount'), 2026, 11), '/api/hr/reports/headcount');
      expect(hrReportPath(r('new-joinings'), 2026, 11), '/api/hr/reports/new-joinings');
      expect(hrReportPath(r('employees-registered'), 2026, 11), '/api/hr/reports/employees-registered');
    });

    test('file names follow the server', () {
      HrReportDef r(String id) => hrReports.firstWhere((x) => x.id == id);
      final now = DateTime(2026, 11, 10);
      expect(hrReportFileName(r('attendance'), 2026, 11, now), 'attendance-register-2026-11.csv');
      expect(hrReportFileName(r('payroll-register'), 2026, 3, now), 'payroll-register-2026-03.csv');
      expect(hrReportFileName(r('statutory-ecr'), 2026, 11, now), 'statutory-2026-11.csv');
      expect(hrReportFileName(r('leave-balances'), 2026, 11, now), 'leave-balances-2026.csv');
      expect(hrReportFileName(r('headcount'), 2026, 11, now), 'headcount-2026-11-10.csv');
      expect(hrReportFileName(r('new-joinings'), 2026, 11, now), 'new-joinings-2026-11.csv');
    });
  });

  group('HR reports screen', () {
    testWidgets('lists every report with its description', (t) async {
      final api = _Bytes((m, p, b) => null);
      await openScreen(t, HrReportsScreen(session: hrSession(api), now: _now));
      expect(find.text('Monthly attendance register'), findsOneWidget);
      expect(find.text('Statutory PF/ESI CSV'), findsOneWidget);
      expect(find.text('Unregistered employees'), findsOneWidget);
      expect(find.byKey(const ValueKey('download-headcount')), findsOneWidget);
    });

    testWidgets('a month report downloads with the picked month and is shared as CSV', (t) async {
      final api = _Bytes((m, p, b) => null);
      final shared = <(String, int)>[];
      await openScreen(t, HrReportsScreen(session: hrSession(api), now: _now, shareFile: (bytes, name) async => shared.add((name, bytes.length))));
      await _download(t, 'attendance');
      expect(api.fetched, ['/api/hr/reports/attendance?year=2026&month=11&salary_month=2026-11']);
      expect(shared, [('attendance-register-2026-11.csv', 3)]);
    });

    testWidgets('the ECR downloads with salary_month and is shared as CSV', (t) async {
      final api = _Bytes((m, p, b) => null);
      final shared = <String>[];
      await openScreen(t, HrReportsScreen(session: hrSession(api), now: _now, shareFile: (bytes, name) async => shared.add(name)));
      await _download(t, 'statutory-ecr');
      expect(api.fetched, ['/api/hr/reports/statutory-ecr?year=2026&month=11&salary_month=2026-11']);
      expect(shared, ['statutory-2026-11.csv']);
    });

    testWidgets('changing the month changes the query', (t) async {
      final api = _Bytes((m, p, b) => null);
      await openScreen(t, HrReportsScreen(session: hrSession(api), now: _now, shareFile: (bytes, name) async {}));
      await t.tap(find.text('November'));
      await t.pumpAndSettle();
      await t.tap(find.text('March').last);
      await t.pumpAndSettle();
      await _download(t, 'payroll-register');
      expect(api.fetched, ['/api/hr/reports/payroll-register?year=2026&month=3&salary_month=2026-03']);
    });

    testWidgets('a refused download shows the server message and shares nothing', (t) async {
      final api = _Bytes((m, p, b) => null);
      var shared = 0;
      // The route name carries "fail" so the fake refuses it.
      await openScreen(t, HrReportsScreen(session: hrSession(api), now: _now, reports: const [HrReportDef(id: 'fail', title: 'Bad report', description: 'd', kind: HrReportKind.month, filename: 'x')], shareFile: (bytes, name) async => shared++));
      await _download(t, 'fail');
      expect(find.text('Failed to generate report'), findsOneWidget);
      expect(shared, 0);
    });

    testWidgets('a second tap while downloading does nothing', (t) async {
      final api = _Bytes((m, p, b) => null);
      var shared = 0;
      await openScreen(t, HrReportsScreen(session: hrSession(api), now: _now, shareFile: (bytes, name) async => shared++));
      api.gate = Completer<void>();
      final f = find.byKey(const ValueKey('download-headcount'));
      await t.tap(f);
      await t.tap(f, warnIfMissed: false);
      api.gate!.complete();
      await t.pumpAndSettle();
      expect(api.fetched.length, 1);
      expect(shared, 1);
    });

    testWidgets('a plan without advanced HR shows the plan message and no downloads', (t) async {
      final api = _Bytes((m, p, b) => planReply(p, ['hr_leaves']));
      await openScreen(t, HrReportsScreen(session: hrSession(api), now: _now));
      expect(find.text('Not included in your current plan'), findsOneWidget);
      expect(find.byKey(const ValueKey('download-headcount')), findsNothing);
    });

    testWidgets('a plan with advanced HR shows the hub', (t) async {
      final api = _Bytes((m, p, b) => planReply(p, ['hr_advanced']));
      await openScreen(t, HrReportsScreen(session: hrSession(api), now: _now));
      expect(find.byKey(const ValueKey('download-headcount')), findsOneWidget);
    });
  });
}

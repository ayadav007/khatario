import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/reports/aging_logic.dart';

void main() {
  test('an open invoice says how many days it is overdue', () {
    expect(agingDueLabel(outstanding: 100, daysOverdue: 12), '12 d overdue');
    expect(agingDueLabel(outstanding: 100, daysOverdue: 0), 'Due today');
    expect(agingDueLabel(outstanding: 100, daysOverdue: -4), 'Due in 4 d');
    expect(agingDueLabel(outstanding: -20, daysOverdue: 3), 'Credit');
    expect(agingDays('18'), 18);
  });
}

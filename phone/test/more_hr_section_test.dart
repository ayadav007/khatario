import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/more/more_navigation.dart';

void main() {
  test('reads the HR section the server sends', () {
    final section = parseHrNavSection({
      'section': {
        'title': 'HR & Employees',
        'items': [
          {'href': '/employees', 'label': 'All Employees'},
          {'href': '/employees/commissions', 'label': 'Commissions'},
        ],
      },
    });
    expect(section?.title, 'HR & Employees');
    expect(section?.items.map((i) => i.href), ['/employees', '/employees/commissions']);
  });

  test('no section when the server sends none or nothing usable', () {
    expect(parseHrNavSection({'section': null}), isNull);
    expect(parseHrNavSection({'section': {'title': 'Staff', 'items': []}}), isNull);
    expect(parseHrNavSection({}), isNull);
  });
}

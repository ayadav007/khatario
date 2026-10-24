import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/more/more_navigation.dart';

void main() {
  test('reads the menu the server sends, with locks', () {
    final sections = parseMoreMenu({
      'sections': [
        {
          'title': 'HR & Employees',
          'items': [
            {'href': '/employees', 'label': 'All Employees', 'locked': false},
          ],
        },
        {
          'title': 'Connect',
          'items': [
            {'href': '/whatsapp/dashboard', 'label': 'Dashboard', 'locked': true},
          ],
        },
      ],
    });
    expect(sections?.map((s) => s.title), ['HR & Employees', 'Connect']);
    expect(sections?.first.items.single.href, '/employees');
    expect(sections?.last.items.single.isLocked, isTrue);
  });

  test('drops empty or broken sections', () {
    final sections = parseMoreMenu({
      'sections': [
        {'title': 'Staff', 'items': []},
        {'title': 'Tools'},
        'nonsense',
      ],
    });
    expect(sections, isEmpty);
  });

  test('null when the reply is not a menu', () {
    expect(parseMoreMenu({}), isNull);
    expect(parseMoreMenu({'error': 'Failed to load menu'}), isNull);
  });

  test('a tap closes an open section and reopens it', () {
    final closed = toggleMoreSection(const {}, 'Sales');
    expect(closed['Sales'], isFalse);
    expect(toggleMoreSection(closed, 'Sales')['Sales'], isTrue);
  });
}

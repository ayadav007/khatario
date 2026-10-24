import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/notifications/notifications_screen.dart';
import 'package:khatario_phone/screens/search/search_screen.dart';

void main() {
  test('search groups keep the website section order', () {
    final results = SearchResults.fromJson({
      'results': {
        'invoices': [
          {'type': 'invoice', 'id': 'i1', 'title': 'INV-1', 'amount': '120.5'},
        ],
        'customers': [
          {'type': 'customer', 'id': 'c1', 'title': 'Ravi', 'subtitle': '999'},
        ],
        'items': const [],
        'suppliers': const [],
        'estimates': [
          {'type': 'estimate', 'id': 'e1', 'title': 'EST-1'},
        ],
      },
    });
    expect(results.total, 3);
    expect(results.estimates.single.id, 'e1');
    expect(results.invoices.single.amount, 120.5);
    expect(searchTypeLabel('estimate'), 'Estimate');
  });

  test('notification filters and targets match the website page', () {
    final unread = AppNotification(id: '1', type: 'invoice_overdue', title: 'Due', message: 'Pay', isRead: false, referenceId: 'inv');
    final read = AppNotification(id: '2', type: 'todo_reminder', title: 'Todo', message: 'Do it', isRead: true);
    final all = [unread, read];
    expect(filterNotifications(all, 'unread').map((n) => n.id), ['1']);
    expect(filterNotifications(all, 'read').map((n) => n.id), ['2']);
    expect(notificationTarget(unread)?.kind, 'invoice');
    expect(notificationTarget(read)?.label, 'Todo');
    expect(notificationTarget(const AppNotification(id: '3', type: 'other', title: '', message: '', isRead: false)), isNull);
  });

  test('timeAgo uses a suffix', () {
    final now = DateTime(2026, 10, 13, 12);
    expect(timeAgo(now.subtract(const Duration(seconds: 10)), now), 'less than a minute ago');
    expect(timeAgo(now.subtract(const Duration(days: 2)), now), '2 days ago');
  });
}

import '../../format.dart';
import '../docs/doc_logic.dart';

/// Rules for the activity log, copied from the website (`app/(app)/activity-logs/page.tsx`) and
/// `GET /api/activity-logs`. The route answers `logs`, newest first, and pages only by `limit`
/// (default 100, no offset), so "Show more" asks again with a larger limit.

const activityPageSize = 100;

/// The website's module filter.
const activityModules = <(String, String)>[
  ('', 'All modules'),
  ('invoices', 'Invoices'),
  ('items', 'Items'),
  ('customers', 'Customers'),
  ('employees', 'Employees'),
  ('attendance', 'Attendance'),
  ('commissions', 'Commissions'),
  ('leaves', 'Leaves'),
  ('expenses', 'Expenses'),
];

/// The website's action filter.
const activityActions = <(String, String)>[
  ('', 'All actions'),
  ('create', 'Create'),
  ('update', 'Update'),
  ('delete', 'Delete'),
  ('approve', 'Approve'),
  ('reject', 'Reject'),
  ('login', 'Login'),
  ('logout', 'Logout'),
];

/// The website starts a week back.
DateTime activityDefaultFrom(DateTime today) => dateOnly(today).subtract(const Duration(days: 7));

/// `GET /api/activity-logs`. The route compares `created_at <= end_date`, which would drop the end day
/// itself when sent as a bare date, so the end day is sent to its last second.
String activityPath({required DateTime from, required DateTime to, String module = '', String action = '', String userId = '', int limit = activityPageSize}) {
  final q = <String, String>{
    'start_date': ymd(from),
    'end_date': '${ymd(to)} 23:59:59',
    if (module.isNotEmpty) 'module': module,
    if (action.isNotEmpty) 'action_type': action,
    if (userId.isNotEmpty) 'user_id': userId,
    'limit': '$limit',
  };
  return Uri(path: '/api/activity-logs', queryParameters: q).toString();
}

/// More may exist while the last answer filled the limit.
bool activityHasMore(int returned, int limit) => returned >= limit;

int activityNextLimit(int limit, [int pageSize = activityPageSize]) => limit + pageSize;

/// `GET /api/settings/users` (the same settings-read right the log itself needs): `users` with `id` and
/// `name`, for the person filter. The route filters by `user_id`.
String activityPeoplePath() => '/api/settings/users';

List<(String, String)> activityPeople(dynamic body) => [
      for (final u in docRows(body, 'users'))
        if (docText(u['id']).isNotEmpty && docText(u['name']).isNotEmpty) (docText(u['id']), docText(u['name'])),
    ];

class ActivityDay {
  ActivityDay(this.day, this.rows);
  final DateTime day;
  final List<Map<String, dynamic>> rows;
}

/// Rows grouped by the day they happened, newest day and newest row first.
List<ActivityDay> activityGroups(List<Map<String, dynamic>> rows) {
  final dated = <(DateTime, Map<String, dynamic>)>[
    for (final r in rows)
      if (docDate(r['created_at']) != null) (docDate(r['created_at'])!, r),
  ];
  dated.sort((a, b) => b.$1.compareTo(a.$1));
  final out = <ActivityDay>[];
  for (final (at, r) in dated) {
    final day = dateOnly(at);
    if (out.isEmpty || out.last.day != day) out.add(ActivityDay(day, []));
    out.last.rows.add(r);
  }
  return out;
}

String activityDayLabel(DateTime day) => ddMMMyyyy(day);

String _capital(String s) => s.isEmpty ? s : '${s[0].toUpperCase()}${s.substring(1)}';

/// `Create • invoices`, as the website's first line.
String activityTitle(Map<String, dynamic> r) => '${_capital(docText(r['action_type']))} • ${docText(r['module'])}';

String activitySubtitle(Map<String, dynamic> r) => docText(r['description']);

String _two(int n) => n.toString().padLeft(2, '0');

String activityTimeText(Map<String, dynamic> r) {
  final d = docDate(r['created_at']);
  return d == null ? '' : '${_two(d.hour)}:${_two(d.minute)}';
}

/// `Asha (E-7)`, or empty when the entry has no user.
String activityWho(Map<String, dynamic> r) {
  final name = docText(r['user_name']);
  if (name.isEmpty) return '';
  final code = docText(r['employee_code']);
  return code.isEmpty ? name : '$name ($code)';
}

/// What, who and when, for the details sheet. Rows with nothing to say are left out.
List<(String, String)> activityDetailRows(Map<String, dynamic> r) {
  final when = docDate(r['created_at']);
  final rows = <(String, String)>[
    ('Action', _capital(docText(r['action_type']))),
    ('Module', docText(r['module'])),
    ('Description', docText(r['description'])),
    ('By', activityWho(r)),
    ('Email', docText(r['user_email'])),
    ('When', when == null ? '' : '${ddMMMyyyy(when)} ${_two(when.hour)}:${_two(when.minute)}:${_two(when.second)}'),
    ('IP address', docText(r['ip_address'])),
  ];
  return [for (final row in rows) if (row.$2.isNotEmpty) row];
}

/// The invoice an entry is about, the one document the phone can open from here.
String? activityInvoiceId(Map<String, dynamic> r) {
  final id = docText(r['entity_id']);
  if (id.isEmpty) return null;
  final type = docText(r['entity_type']).toLowerCase();
  final module = docText(r['module']).toLowerCase();
  if (type == 'invoice' || (type.isEmpty && module == 'invoices')) return id;
  return null;
}

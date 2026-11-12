import '../../format.dart';

/// The to-do list (`/tools/todo`): paths, rows, the reminder rules and the request bodies. No screen
/// code here, so tests can reach it. No body ever carries `business_id`, `user_id` or `created_by`:
/// the server takes the business and the person from the session. `assigned_to` is a colleague's id,
/// which the server checks belongs to the same business.

const todosPath = '/api/todos';
const todoStatsPath = '$todosPath/stats';
const todoUsersPath = '$todosPath/users';

String todosViewPath(String view) => '$todosPath?view=$view';
String todoPath(String id) => '$todosPath/${Uri.encodeComponent(id)}';
String todoSnoozePath(String id) => '${todoPath(id)}/snooze';

/// The website's five tabs, in its order.
const todoViews = <(String, String)>[
  ('today', 'Today'),
  ('upcoming', 'Upcoming'),
  ('overdue', 'Overdue'),
  ('completed', 'Completed'),
  ('high_priority', 'High Priority'),
];

const todoPriorities = <(String, String)>[
  ('low', 'Low'),
  ('medium', 'Medium'),
  ('high', 'High'),
];
const todoReminderTypes = <(String, String)>[
  ('none', 'No reminder'),
  ('once', 'Once'),
  ('recurring', 'Recurring'),
];

/// "When to remind" without the website's Custom option (a free date and time).
const todoReminderPresets = <(String, String)>[
  ('smart', 'Smart default'),
  ('at_due', 'At due time'),
  ('m10', '10 min before'),
  ('m30', '30 min before'),
  ('h1', '1 hour before'),
];

/// The website's snooze buttons: minutes and label.
const todoSnoozeOptions = <(int, String)>[
  (10, 'Snooze 10 min'),
  (60, 'Snooze 1 hour'),
  (1440, 'Snooze tomorrow'),
];

const todoTitleMax = 255;

class TodoItem {
  const TodoItem({
    required this.id,
    required this.title,
    required this.status,
    required this.priority,
    required this.due,
    this.description,
    this.reminderType = 'none',
    this.reminderTime,
    this.assignedTo,
    this.relatedType,
  });

  final String id;
  final String title;
  final String? description;
  final String status;
  final String priority;
  final DateTime due;
  final String reminderType;
  final DateTime? reminderTime;
  final String? assignedTo;
  final String? relatedType;

  bool get done => status == 'completed';

  /// The website's rule: the server's `overdue`, or not done and past due.
  bool isOverdue(DateTime now) =>
      status == 'overdue' || (!done && due.isBefore(now));

  static TodoItem? fromJson(dynamic json) {
    if (json is! Map) return null;
    final id = json['id']?.toString();
    if (id == null || id.isEmpty) return null;
    String? text(String key) {
      final v = json[key]?.toString();
      return v == null || v.isEmpty ? null : v;
    }

    return TodoItem(
      id: id,
      title: json['title']?.toString() ?? '',
      description: text('description'),
      status: json['status']?.toString() ?? 'pending',
      priority: json['priority']?.toString() ?? 'medium',
      due:
          DateTime.tryParse(json['due_date']?.toString() ?? '')?.toLocal() ??
          DateTime.now(),
      reminderType: json['reminder_type']?.toString() ?? 'none',
      reminderTime: DateTime.tryParse(json['reminder_time']?.toString() ?? '')
          ?.toLocal(),
      assignedTo: text('assigned_to'),
      relatedType: text('related_entity_type'),
    );
  }
}

/// `GET /api/todos` answers a bare list.
List<TodoItem> todoItems(dynamic json) {
  if (json is! List) return const [];
  return [for (final j in json) ?TodoItem.fromJson(j)];
}

List<TodoItem> filterTodos(List<TodoItem> items, String query) {
  final q = query.trim().toLowerCase();
  if (q.isEmpty) return items;
  return [
    for (final i in items)
      if (i.title.toLowerCase().contains(q) ||
          (i.description ?? '').toLowerCase().contains(q))
        i,
  ];
}

class TodoStats {
  const TodoStats({
    this.today = 0,
    this.upcoming = 0,
    this.overdue = 0,
    this.highPriority = 0,
  });

  final int today;
  final int upcoming;
  final int overdue;
  final int highPriority;

  factory TodoStats.fromJson(Map<String, dynamic> json) => TodoStats(
    today: toNum(json['today']).toInt(),
    upcoming: toNum(json['upcoming']).toInt(),
    overdue: toNum(json['overdue']).toInt(),
    highPriority: toNum(json['high_priority']).toInt(),
  );

  /// The website shows no count on Completed.
  int countFor(String view) => switch (view) {
    'today' => today,
    'upcoming' => upcoming,
    'overdue' => overdue,
    'high_priority' => highPriority,
    _ => 0,
  };
}

class TodoUser {
  const TodoUser(this.id, this.label);

  final String id;
  final String label;
}

/// `GET /api/todos/users` -> `{ users: [{ id, name, display_name }] }`.
List<TodoUser> todoUsers(dynamic json) {
  final list = json is Map ? json['users'] : null;
  if (list is! List) return const [];
  return [
    for (final u in list)
      if (u is Map && (u['id']?.toString() ?? '').isNotEmpty)
        TodoUser(
          u['id'].toString(),
          (u['display_name'] ?? u['name'] ?? '').toString(),
        ),
  ];
}

// ---------------------------------------------------------------- dates

const _monthNames = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

String _clock(DateTime d) {
  final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
  return '$h:${d.minute.toString().padLeft(2, '0')} ${d.hour < 12 ? 'AM' : 'PM'}';
}

/// The website's due label: Today, Tomorrow, Overdue • date, or the date.
String todoDueLabel(DateTime due, DateTime now) {
  final day = DateTime(due.year, due.month, due.day);
  final today = DateTime(now.year, now.month, now.day);
  if (day == today) return 'Today, ${_clock(due)}';
  if (day == DateTime(today.year, today.month, today.day + 1)) {
    return 'Tomorrow, ${_clock(due)}';
  }
  final date = '${_monthNames[due.month - 1]} ${due.day}, ${_clock(due)}';
  return due.isBefore(now) ? 'Overdue • $date' : date;
}

/// The website's due time in the detail view: `PPP, h:mm a`.
String todoDueFull(DateTime due) =>
    '${_monthNames[due.month - 1]} ${due.day}, ${due.year}, ${_clock(due)}';

/// Half-hour choices for the time field, `('17:00', '5:00 PM')`.
final todoTimeSlots = <(String, String)>[
  for (var m = 0; m < 24 * 60; m += 30)
    (
      '${(m ~/ 60).toString().padLeft(2, '0')}:${(m % 60).toString().padLeft(2, '0')}',
      _clock(DateTime(2000, 1, 1, m ~/ 60, m % 60)),
    ),
];

String todoSlotOf(DateTime d) =>
    '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';

DateTime todoDueAt(DateTime day, String slot) {
  final parts = slot.split(':');
  return DateTime(
    day.year,
    day.month,
    day.day,
    int.tryParse(parts.first) ?? 17,
    int.tryParse(parts.last) ?? 0,
  );
}

// ---------------------------------------------------------------- reminders

const _minLead = Duration(minutes: 2);

DateTime _clampLead(DateTime candidate, DateTime now) {
  final min = now.add(_minLead);
  return candidate.isBefore(min) ? min : candidate;
}

/// `computeSmartReminderUtc` of the website: past due -> in 5 minutes; due within 2 minutes -> in 2;
/// more than an hour away -> an hour before; more than 10 minutes -> in 5; else at due. Never sooner
/// than two minutes from now.
DateTime smartReminder(DateTime due, DateTime now) {
  final diff = due.difference(now);
  final DateTime candidate;
  if (diff <= Duration.zero) {
    candidate = now.add(const Duration(minutes: 5));
  } else if (diff <= _minLead) {
    candidate = now.add(_minLead);
  } else if (diff > const Duration(hours: 1)) {
    candidate = due.subtract(const Duration(hours: 1));
  } else if (diff > const Duration(minutes: 10)) {
    candidate = now.add(const Duration(minutes: 5));
  } else {
    candidate = due;
  }
  return _clampLead(candidate, now);
}

/// `reminderFromPresetUtc`: "at due" stays at the due time while that is still ahead.
DateTime reminderFor(String preset, DateTime due, DateTime now) {
  if (preset == 'smart') return smartReminder(due, now);
  final raw = switch (preset) {
    'm10' => due.subtract(const Duration(minutes: 10)),
    'm30' => due.subtract(const Duration(minutes: 30)),
    'h1' => due.subtract(const Duration(hours: 1)),
    _ => due,
  };
  if (preset == 'at_due' && !raw.isBefore(now)) return raw;
  return _clampLead(raw, now);
}

// ---------------------------------------------------------------- bodies

String? todoTitleError(String title) {
  final t = title.trim();
  if (t.isEmpty) return 'Title is required';
  if (t.length > todoTitleMax) {
    return 'Title must be at most $todoTitleMax characters';
  }
  return null;
}

String _iso(DateTime d) => d.toUtc().toIso8601String();

/// `POST /api/todos`. [assignedTo] null leaves it unassigned.
Map<String, dynamic> todoCreateBody({
  required String title,
  required String description,
  required DateTime due,
  required String priority,
  required String reminderType,
  required String preset,
  required bool whatsapp,
  required String? assignedTo,
  required DateTime now,
}) {
  return {
    'title': title.trim(),
    'description': description.trim(),
    'due_date': _iso(due),
    'priority': priority,
    'reminder_type': reminderType,
    if (reminderType != 'none')
      'reminder_time': _iso(reminderFor(preset, due, now)),
    'reminder_channels': [
      'in_app',
      if (whatsapp && reminderType != 'none') 'whatsapp',
    ],
    if (assignedTo != null && assignedTo.isNotEmpty) 'assigned_to': assignedTo,
  };
}

/// `PATCH /api/todos/:id` with only what changed. An empty `assigned_to` unassigns. A new due time
/// moves the reminder to the new due time, as the website's
/// Reschedule does.
Map<String, dynamic> todoEditBody(
  TodoItem todo, {
  required String title,
  required String description,
  required DateTime due,
  required String priority,
  required String assignedTo,
  required DateTime now,
}) {
  final body = <String, dynamic>{};
  if (title.trim() != todo.title) body['title'] = title.trim();
  if (description.trim() != (todo.description ?? '')) {
    body['description'] = description.trim();
  }
  if (priority != todo.priority) body['priority'] = priority;
  if (assignedTo != (todo.assignedTo ?? '')) body['assigned_to'] = assignedTo;
  if (!due.isAtSameMomentAs(todo.due)) {
    body['due_date'] = _iso(due);
    if (todo.reminderType != 'none' && todo.reminderTime != null) {
      body['reminder_time'] = _iso(reminderFor('at_due', due, now));
    }
  }
  return body;
}

Map<String, dynamic> todoStatusBody({required bool done}) => {
  'status': done ? 'completed' : 'pending',
};

Map<String, dynamic> todoSnoozeBody(int minutes, DateTime now) => {
  'snooze_until': _iso(now.add(Duration(minutes: minutes))),
};

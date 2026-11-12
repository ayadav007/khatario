/// Pure helpers for engagement, HR documents, HR reports, tasks and performance.
///
/// Every request here leaves out `business_id`, `user_id`, `created_by` and `assigned_by`: the
/// session names the business and the user, and the server takes the author and the assigner from
/// the session. The ids the phone does send (an employee to make a document for, a task's assignee,
/// an announcement to archive) are chosen data the server checks against the business.
library;

import '../../format.dart';

String _t(dynamic v) => v?.toString().trim() ?? '';

String? _orNull(dynamic v) {
  final t = _t(v);
  return t.isEmpty ? null : t;
}

DateTime? _day(dynamic v) {
  final s = _t(v);
  if (s.length < 10) return null;
  final d = DateTime.tryParse(s.substring(0, 10));
  return d == null ? null : dateOnly(d);
}

List<T> _list<T>(dynamic list, T? Function(Map<String, dynamic>) parse) {
  if (list is! List) return <T>[];
  final out = <T>[];
  for (final e in list) {
    if (e is! Map) continue;
    final v = parse(Map<String, dynamic>.from(e));
    if (v != null) out.add(v);
  }
  return out;
}

String _words(String s) {
  final t = s.replaceAll('_', ' ');
  return t.isEmpty ? t : t[0].toUpperCase() + t.substring(1);
}

/// "Appointment letter" style label for a stored type such as `appointment_letter`.
String typeWords(String s) => _words(s);

// ---------------------------------------------------------------------------------------------
// Engagement: `/api/hr/announcements`, `/api/hr/engagement/{polls,articles}`
// ---------------------------------------------------------------------------------------------

const announcementsPath = '/api/hr/announcements';
const pollsPath = '/api/hr/engagement/polls';
const articlesPath = '/api/hr/engagement/articles';
const orgCatalogPath = '/api/settings/hr-org-catalog';

/// Who an announcement or poll goes to: everyone, some departments or some employees.
class HrAudience {
  const HrAudience.everyone()
      : type = 'all',
        departments = const [],
        employeeIds = const [];
  const HrAudience.departments(this.departments)
      : type = 'departments',
        employeeIds = const [];
  const HrAudience.employees(this.employeeIds)
      : type = 'employees',
        departments = const [];

  final String type;
  final List<String> departments;
  final List<String> employeeIds;

  /// The website's `buildEngagementPayload` audience.
  Map<String, dynamic> toJson() => {
        'type': type,
        if (type == 'departments') 'departments': departments,
        if (type == 'employees') 'employee_ids': employeeIds,
      };
}

String _audienceLabel(dynamic audience) {
  if (audience is! Map) return 'Everyone';
  switch (audience['type']) {
    case 'departments':
      final d = audience['departments'];
      final names = d is List ? d.map((e) => e.toString()).where((e) => e.isNotEmpty).toList() : <String>[];
      return names.isEmpty ? 'Specific departments' : names.join(', ');
    case 'employees':
      final e = audience['employee_ids'];
      final n = e is List ? e.length : 0;
      return n == 1 ? '1 employee' : '$n employees';
    default:
      return 'Everyone';
  }
}

String _expiresField(DateTime? d) => d == null ? '' : ymd(d);

class AnnouncementRow {
  const AnnouncementRow({required this.id, required this.title, required this.body, required this.author, required this.published, required this.expires, required this.audienceLabel, required this.isActive});

  final String id, title, body, author, audienceLabel;
  final DateTime? published, expires;
  final bool isActive;
}

List<AnnouncementRow> announcementRows(dynamic list) => _list(list, (j) {
      final id = _t(j['id']);
      if (id.isEmpty) return null;
      return AnnouncementRow(
        id: id,
        title: _t(j['title']),
        body: _t(j['body']),
        author: _t(j['author_name']),
        published: _day(j['published_at']),
        expires: _day(j['expires_at']),
        audienceLabel: _audienceLabel(j['audience']),
        isActive: j['is_active'] != false,
      );
    });

/// `POST /api/hr/announcements`: title, message, audience and an optional expiry date.
Map<String, dynamic> announcementBody({required String title, required String body, required HrAudience audience, DateTime? expiresAt}) => {
      'title': title.trim(),
      'body': body.trim(),
      'audience': audience.toJson(),
      if (expiresAt != null) 'expires_at': _expiresField(expiresAt),
    };

/// `PATCH /api/hr/announcements` with `archive: true` (the website's way to take one down).
Map<String, dynamic> archiveAnnouncementBody(String id) => {'id': id, 'archive': true};

class PollRow {
  const PollRow({required this.id, required this.question, required this.options, required this.audienceLabel, required this.expires, required this.isActive});

  final String id, question, audienceLabel;
  final List<String> options;
  final DateTime? expires;
  final bool isActive;
}

List<PollRow> pollRows(dynamic list) => _list(list, (j) {
      final id = _t(j['id']);
      if (id.isEmpty) return null;
      final opts = j['options'];
      return PollRow(
        id: id,
        question: _t(j['question']),
        options: opts is List ? [for (final o in opts) if (o is Map && _t(o['option_text']).isNotEmpty) _t(o['option_text'])] : const [],
        audienceLabel: _audienceLabel(j['audience']),
        expires: _day(j['expires_at']),
        isActive: j['is_active'] != false,
      );
    });

/// `POST /api/hr/engagement/polls`: the question, at least two options, audience and expiry.
Map<String, dynamic> pollBody({required String question, required List<String> options, required HrAudience audience, DateTime? expiresAt}) => {
      'question': question.trim(),
      'options': [for (final o in options) if (o.trim().isNotEmpty) o.trim()],
      'audience': audience.toJson(),
      if (expiresAt != null) 'expires_at': _expiresField(expiresAt),
    };

bool pollIsValid(String question, List<String> options) => question.trim().isNotEmpty && options.where((o) => o.trim().isNotEmpty).length >= 2;

class ArticleRow {
  const ArticleRow({required this.id, required this.title, required this.text, required this.isPublished, required this.published, required this.expires});

  final String id, title, text;
  final bool isPublished;
  final DateTime? published, expires;
}

/// The readable text of an article's HTML (tags removed, entities decoded, paragraphs on their own lines).
String htmlToText(String html) {
  var s = html.replaceAll(RegExp(r'<\s*br\s*/?\s*>', caseSensitive: false), '\n').replaceAll(RegExp(r'</\s*(p|div|li|h[1-6])\s*>', caseSensitive: false), '\n');
  s = s.replaceAll(RegExp(r'<[^>]*>'), '');
  s = s.replaceAll('&nbsp;', ' ').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&');
  return s.split('\n').map((l) => l.trim()).where((l) => l.isNotEmpty).join('\n');
}

List<ArticleRow> articleRows(dynamic list) => _list(list, (j) {
      final id = _t(j['id']);
      if (id.isEmpty) return null;
      return ArticleRow(
        id: id,
        title: _t(j['title']),
        text: htmlToText(_t(j['body_html'])),
        isPublished: j['is_published'] != false,
        published: _day(j['published_at']),
        expires: _day(j['expires_at']),
      );
    });

String _escape(String s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/// Plain text typed on the phone as the article HTML the website stores: blank lines split paragraphs.
String articleHtmlFromText(String text) {
  final paragraphs = text.trim().split(RegExp(r'\n\s*\n')).map((p) => p.trim()).where((p) => p.isNotEmpty);
  return [for (final p in paragraphs) '<p>${_escape(p).replaceAll('\n', '<br>')}</p>'].join();
}

/// `POST /api/hr/engagement/articles`.
Map<String, dynamic> articleBody({required String title, required String text, DateTime? expiresAt}) => {
      'title': title.trim(),
      'body_html': articleHtmlFromText(text),
      if (expiresAt != null) 'expires_at': _expiresField(expiresAt),
    };

/// `PATCH /api/hr/engagement/articles`: takes an article off the employee portal.
Map<String, dynamic> unpublishArticleBody(String id) => {'id': id, 'is_published': false};

// ---------------------------------------------------------------------------------------------
// HR documents: `/api/hr/document-templates`
// ---------------------------------------------------------------------------------------------

const documentTemplatesPath = '/api/hr/document-templates';

String generateDocumentPath(String templateId) => '$documentTemplatesPath/$templateId/generate';

class TemplateRow {
  const TemplateRow({required this.id, required this.name, required this.documentType});

  final String id, name, documentType;
}

List<TemplateRow> templateRows(dynamic list) => _list(list, (j) {
      final id = _t(j['id']);
      if (id.isEmpty) return null;
      return TemplateRow(id: id, name: _t(j['name']), documentType: _t(j['document_type']));
    });

/// `POST .../[id]/generate`: the employee and the file format. The server sets who generated it.
Map<String, dynamic> generateDocumentBody(String employeeId) => {'employee_id': employeeId, 'format': 'pdf'};

Map<String, dynamic> createTemplateBody(String name) => {'name': name.trim()};

Map<String, dynamic> renameTemplateBody(String id, String name) => {'id': id, 'name': name.trim()};

/// The server's attachment name for a template (`template.name.replace(/\s+/g, '-')`).
String templatePdfName(String name) => '${name.trim().replaceAll(RegExp(r'\s+'), '-')}.pdf';

// ---------------------------------------------------------------------------------------------
// HR reports: `GET /api/hr/reports/[type]` and `/statutory-ecr`, both CSV files
// ---------------------------------------------------------------------------------------------

/// Which period a report asks for: a month, a year, or none.
enum HrReportKind { month, year, none }

class HrReportDef {
  const HrReportDef({required this.id, required this.title, required this.description, required this.kind, required this.filename});

  final String id, title, description, filename;
  final HrReportKind kind;

  String get route => '/api/hr/reports/$id';
}

const hrReports = <HrReportDef>[
  HrReportDef(id: 'attendance', title: 'Monthly attendance register', description: 'Daily attendance rows for all employees in the selected month.', kind: HrReportKind.month, filename: 'attendance-register'),
  HrReportDef(id: 'leave-balances', title: 'Leave balance summary', description: 'Current leave balances by employee and leave type for a year.', kind: HrReportKind.year, filename: 'leave-balances'),
  HrReportDef(id: 'leave-consumption', title: 'Leave consumption', description: 'Approved and pending leave requests for a year.', kind: HrReportKind.year, filename: 'leave-consumption'),
  HrReportDef(id: 'leave-negative-balances', title: 'Negative leave balances', description: 'Employees with negative balances for a leave year.', kind: HrReportKind.year, filename: 'leave-negative-balances'),
  HrReportDef(id: 'leave-accrual', title: 'Leave accrual register', description: 'Scheduled accrual job runs for the year.', kind: HrReportKind.year, filename: 'leave-accrual'),
  HrReportDef(id: 'leave-carry-forward', title: 'Year-end carry forward', description: 'Year-end processing summary for a leave year.', kind: HrReportKind.year, filename: 'leave-carry-forward'),
  HrReportDef(id: 'leave-encashment', title: 'Leave encashment', description: 'Pending and applied encashment entries.', kind: HrReportKind.year, filename: 'leave-encashment'),
  HrReportDef(id: 'payroll-register', title: 'Payroll register', description: 'Salary payment records for the selected month.', kind: HrReportKind.month, filename: 'payroll-register'),
  HrReportDef(id: 'statutory-ecr', title: 'Statutory PF/ESI CSV', description: 'Employee/employer PF & ESI amounts for the month (simplified ECR helper).', kind: HrReportKind.month, filename: 'statutory'),
  HrReportDef(id: 'overtime-register', title: 'Overtime register', description: 'Overtime requests for the selected month.', kind: HrReportKind.month, filename: 'overtime-register'),
  HrReportDef(id: 'headcount', title: 'Headcount', description: 'Active employees grouped by department and employment type.', kind: HrReportKind.none, filename: 'headcount'),
  HrReportDef(id: 'new-joinings', title: 'New joinings (this month)', description: 'Employees who joined in the current calendar month.', kind: HrReportKind.none, filename: 'new-joinings'),
  HrReportDef(id: 'employees-registered', title: 'Registered employees', description: 'Employees who have logged into the employee portal at least once.', kind: HrReportKind.none, filename: 'employees-registered'),
  HrReportDef(id: 'employees-unregistered', title: 'Unregistered employees', description: 'Invited to portal but have not signed in yet.', kind: HrReportKind.none, filename: 'employees-unregistered'),
];

String _two(int n) => n.toString().padLeft(2, '0');

/// The website's download URL: month reports send `year`, `month` and `salary_month`; year reports
/// send `year` and `month=1`; the rest send nothing.
String hrReportPath(HrReportDef r, int year, int month) => switch (r.kind) {
      HrReportKind.month => '${r.route}?year=$year&month=$month&salary_month=$year-${_two(month)}',
      HrReportKind.year => '${r.route}?year=$year&month=1',
      HrReportKind.none => r.route,
    };

/// The attachment name the server gives the file (the share sheet needs one).
String hrReportFileName(HrReportDef r, int year, int month, DateTime now) {
  final suffix = r.id == 'headcount'
      ? ymd(now)
      : r.id.startsWith('leave-')
          ? '$year'
          : '$year-${_two(month)}';
  return '${r.filename}-$suffix.csv';
}

// ---------------------------------------------------------------------------------------------
// Tasks: `/api/tasks`
// ---------------------------------------------------------------------------------------------

const tasksPath = '/api/tasks';

String taskListPath({String? status, String? priority}) {
  final q = [
    if (status != null && status.isNotEmpty) 'status=$status',
    if (priority != null && priority.isNotEmpty) 'priority=$priority',
  ];
  return q.isEmpty ? tasksPath : '$tasksPath?${q.join('&')}';
}

String taskPath(String id) => '$tasksPath/$id';

const taskStatuses = <(String, String)>[('pending', 'Pending'), ('in_progress', 'In progress'), ('completed', 'Completed'), ('cancelled', 'Cancelled')];
const taskPriorities = <(String, String)>[('urgent', 'Urgent'), ('high', 'High'), ('medium', 'Medium'), ('low', 'Low')];

class TaskRow {
  const TaskRow({required this.id, required this.title, required this.description, required this.status, required this.priority, required this.due, required this.assigneeName});

  final String id, title, description, status, priority;
  final DateTime? due;
  final String? assigneeName;

  bool get canComplete => status == 'pending' || status == 'in_progress';
}

List<TaskRow> taskRows(dynamic list) => _list(list, (j) {
      final id = _t(j['id']);
      if (id.isEmpty) return null;
      return TaskRow(
        id: id,
        title: _t(j['title']),
        description: _t(j['description']),
        status: _t(j['status']),
        priority: _t(j['priority']),
        due: _day(j['due_date']),
        assigneeName: _orNull(j['assignee_name']),
      );
    });

/// `POST /api/tasks`: no `business_id` and no `assigned_by`; the server takes both from the session.
Map<String, dynamic> taskCreateBody({required String title, required String description, required String priority, String? assignedTo, DateTime? dueDate}) => {
      'title': title.trim(),
      if (description.trim().isNotEmpty) 'description': description.trim(),
      'priority': priority,
      if (assignedTo != null && assignedTo.isNotEmpty) 'assigned_to': assignedTo,
      if (dueDate != null) 'due_date': ymd(dueDate),
    };

const taskDoneBody = <String, dynamic>{'status': 'completed'};

// ---------------------------------------------------------------------------------------------
// Performance: `GET /api/employees/performance`
// ---------------------------------------------------------------------------------------------

const performancePeriods = <(String, String)>[('daily', 'Daily'), ('weekly', 'Weekly'), ('monthly', 'Monthly')];

String performancePath({required String period, required DateTime from, required DateTime to}) =>
    '/api/employees/performance?period_type=$period&start_date=${ymd(from)}&end_date=${ymd(to)}';

class PerformanceRow {
  const PerformanceRow({required this.id, required this.name, required this.code, required this.designation, required this.date, required this.sales, required this.invoices, required this.average, required this.target, required this.achievement, required this.commission});

  final String id, name, code;
  final String? designation;
  final DateTime? date;
  final num sales, average, commission;
  final int invoices;
  final num? target, achievement;
}

List<PerformanceRow> performanceRows(dynamic list) => _list(list, (j) {
      final id = _t(j['id']);
      if (id.isEmpty) return null;
      return PerformanceRow(
        id: id,
        name: _t(j['employee_name']),
        code: _t(j['employee_code']),
        designation: _orNull(j['designation']),
        date: _day(j['period_date']),
        sales: toNum(j['total_sales']),
        invoices: toNum(j['total_invoices']).toInt(),
        average: toNum(j['average_invoice_value']),
        target: j['target_amount'] == null ? null : toNum(j['target_amount']),
        achievement: j['achievement_percentage'] == null ? null : toNum(j['achievement_percentage']),
        commission: toNum(j['total_commission']),
      );
    });

/// The server's summary block, shown as it is.
class PerformanceSummary {
  const PerformanceSummary({this.sales = 0, this.invoices = 0, this.commission = 0, this.employees = 0});

  final num sales, commission;
  final int invoices, employees;

  factory PerformanceSummary.fromJson(dynamic j) {
    if (j is! Map) return const PerformanceSummary();
    return PerformanceSummary(
      sales: toNum(j['totalSales']),
      invoices: toNum(j['totalInvoices']).toInt(),
      commission: toNum(j['totalCommission']),
      employees: toNum(j['totalEmployees']).toInt(),
    );
  }
}

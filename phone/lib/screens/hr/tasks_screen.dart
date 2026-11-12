import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../sales/doc_action_sheets.dart';
import 'hr_manage_widgets.dart';
import 'hr_more_logic.dart';
import 'pay_widgets.dart';

KTone taskStatusTone(String status) => switch (status) {
      'completed' => KTone.positive,
      'cancelled' => KTone.negative,
      'in_progress' => KTone.brand,
      _ => KTone.due,
    };

KTone taskPriorityTone(String priority) => switch (priority) {
      'urgent' => KTone.negative,
      'high' => KTone.due,
      _ => KTone.neutral,
    };

String _cap(String s) {
  final t = s.replaceAll('_', ' ');
  return t.isEmpty ? t : t[0].toUpperCase() + t.substring(1);
}

/// Website `/employees/tasks`: tasks by status and priority, with Mark done and Delete, and a new
/// task. The task's own view page does not exist on the website, so none is built here.
class TasksScreen extends StatefulWidget {
  const TasksScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<TasksScreen> createState() => _TasksScreenState();
}

class _TasksScreenState extends State<TasksScreen> with HrScreenState<TasksScreen> {
  List<TaskRow> _rows = const [];
  String _status = '';
  String _priority = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() => guardedLoad(() async {
        final body = await widget.session.api.getJson(taskListPath(status: _status, priority: _priority));
        if (!mounted) return;
        _rows = taskRows(body['tasks']);
      });

  Future<void> _done(TaskRow t) => act(
        'done-${t.id}',
        confirm: () async => true,
        send: () => widget.session.api.patchJson(taskPath(t.id), taskDoneBody),
        done: 'Task marked done',
        reload: _load,
      );

  Future<void> _delete(TaskRow t) => act(
        'delete-${t.id}',
        confirm: () => askSheet(context, title: 'Delete task?', text: 'Delete "${t.title}"? This cannot be undone.', confirmLabel: 'Delete task', cancelLabel: 'Not now'),
        send: () => widget.session.api.deleteJson(taskPath(t.id)),
        done: 'Task deleted',
        reload: _load,
      );

  void _add() => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => TaskFormScreen(session: widget.session))).then((_) {
        if (mounted) _load();
      });

  Widget _card(TaskRow t) {
    final meta = [if (t.assigneeName != null) 'Assigned to ${t.assigneeName}', if (t.due != null) 'Due ${ddMMMyyyy(t.due!)}'];
    return KCard(
      key: ValueKey('task-${t.id}'),
      padding: const EdgeInsets.all(14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: Text(t.title, style: AppText.bodyStrong)),
          const SizedBox(width: AppSpace.sm),
          KPill(label: _cap(t.priority), tone: taskPriorityTone(t.priority)),
          const SizedBox(width: AppSpace.xs),
          KPill(label: _cap(t.status), tone: taskStatusTone(t.status)),
        ]),
        if (t.description.isNotEmpty) ...[const SizedBox(height: 4), Text(t.description, style: AppText.body)],
        if (meta.isNotEmpty) ...[const SizedBox(height: 6), Text(meta.join(' · '), style: AppText.caption)],
        const SizedBox(height: AppSpace.sm),
        Wrap(spacing: AppSpace.sm, children: [
          if (t.canComplete) PayRowButton(label: 'Mark done', busy: busy.contains('done-${t.id}'), onTap: () => _done(t)),
          PayRowButton(label: 'Delete', danger: true, busy: busy.contains('delete-${t.id}'), onTap: () => _delete(t)),
        ]),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    return PayListPage(
      title: 'Tasks',
      loading: loading,
      error: error,
      notInPlan: notInPlan,
      onRetry: _load,
      emptyTitle: 'No tasks found',
      emptyBody: 'Tasks you assign to your team show up here.',
      emptyIcon: LucideIcons.squareCheck,
      trailing: KIconButton(icon: LucideIcons.plus, tooltip: 'Create task', onTap: _add),
      header: [
        KChipBar<String>(
          padding: EdgeInsets.zero,
          value: _status,
          options: [('', 'All statuses'), ...taskStatuses],
          onChanged: (v) {
            _status = v;
            _load();
          },
        ),
        const SizedBox(height: AppSpace.sm),
        KChipBar<String>(
          padding: EdgeInsets.zero,
          value: _priority,
          options: [('', 'All priorities'), ...taskPriorities],
          onChanged: (v) {
            _priority = v;
            _load();
          },
        ),
        const SizedBox(height: AppSpace.sm),
      ],
      rows: [for (final t in _rows) _card(t)],
    );
  }
}

/// Website "Create task": title, description, priority, assignee and due date. The server records
/// who assigned it and refuses an assignee who is not one of your employees.
class TaskFormScreen extends StatefulWidget {
  const TaskFormScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<TaskFormScreen> createState() => _TaskFormScreenState();
}

class _TaskFormScreenState extends State<TaskFormScreen> {
  final _title = TextEditingController();
  final _description = TextEditingController();
  String _priority = 'medium';
  String _assigneeId = '';
  String? _assigneeName;
  DateTime? _due;

  @override
  void dispose() {
    _title.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    await widget.session.api.postJson(
      tasksPath,
      taskCreateBody(title: _title.text, description: _description.text, priority: _priority, assignedTo: _assigneeId, dueDate: _due),
    );
    if (!mounted) return;
    showKToast(context, 'Task created', tone: KTone.positive);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'Create task',
      saveLabel: 'Create task',
      dirty: _title.text.isNotEmpty || _description.text.isNotEmpty,
      canSave: _title.text.trim().isNotEmpty,
      onSave: _save,
      children: [
        KTextField(label: 'Title', controller: _title, onChanged: (_) => setState(() {})),
        KPickField<String>(label: 'Priority', value: _priority, options: taskPriorities.reversed.toList(), onChanged: (v) => setState(() => _priority = v)),
        KAsyncPickField(
          label: 'Assign to (optional)',
          valueLabel: _assigneeName,
          search: (q) => searchEmployees(widget.session.api, q),
          onPicked: (id, label) => setState(() {
            _assigneeId = id;
            _assigneeName = label;
          }),
        ),
        KDateField(label: 'Due date (optional)', value: _due, onChanged: (d) => setState(() => _due = d)),
        KTextField(label: 'Description', controller: _description, maxLines: 5, minLines: 3, onChanged: (_) => setState(() {})),
      ],
    );
  }
}

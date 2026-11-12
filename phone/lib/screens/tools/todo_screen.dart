import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../hr/hr_manage_widgets.dart';
import 'todo_logic.dart';

KTone _priorityTone(String p) => switch (p) {
  'high' => KTone.negative,
  'medium' => KTone.due,
  _ => KTone.neutral,
};

String _words(String s) {
  final t = s.replaceAll('_', ' ');
  return t.isEmpty ? t : t[0].toUpperCase() + t.substring(1);
}

/// Website `/tools/todo`: the to-do list with its five views and counts, search, add, mark done,
/// open one to see its activity, snooze, reschedule and assign. Plan and permission come from the
/// server (`FEATURE_NOT_IN_PLAN` shows the "not in your plan" state).
class TodoScreen extends StatefulWidget {
  const TodoScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<TodoScreen> createState() => _TodoScreenState();
}

class _TodoScreenState extends State<TodoScreen> with HrScreenState {
  final _search = TextEditingController();
  String _view = 'today';
  List<TodoItem> _items = const [];
  TodoStats _stats = const TodoStats();
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() {
    final seq = ++_seq;
    final view = _view;
    return guardedLoad(() async {
      final api = widget.session.api;
      final results = await Future.wait<Object?>([
        api.getData(todosViewPath(view)),
        api
            .getJson(todoStatsPath)
            .then<Object?>((v) => v)
            .catchError((_) => <String, dynamic>{}),
      ]);
      if (seq != _seq) return;
      _items = todoItems(results[0]);
      _stats = TodoStats.fromJson(results[1] as Map<String, dynamic>);
    });
  }

  void _pickView(String v) {
    if (v == _view) return;
    setState(() => _view = v);
    _load();
  }

  Future<void> _toggle(TodoItem t) => act(
    'done-${t.id}',
    confirm: () async => true,
    send: () async {
      await widget.session.api.patchJson(
        todoPath(t.id),
        todoStatusBody(done: !t.done),
      );
    },
    done: t.done ? 'Todo marked as pending' : 'Todo marked as completed',
    reload: _load,
  );

  Future<void> _open(TodoItem t) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => TodoDetailScreen(session: widget.session, todo: t),
      ),
    );
    if (changed == true && mounted) _load();
  }

  Future<void> _add() async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => TodoFormScreen(session: widget.session),
      ),
    );
    if (saved == true && mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    final ready = !loading && error == null;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KBackBar(
              'To do',
              trailing: ready
                  ? KIconButton(
                      icon: LucideIcons.plus,
                      tooltip: 'Add to-do',
                      onTap: _add,
                    )
                  : null,
            ),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (loading && _items.isEmpty) {
      return const KSpinner(
        padding: EdgeInsets.symmetric(vertical: AppSpace.xxl * 2),
      );
    }
    if (error != null) {
      return ListView(
        children: [
          KEmptyState(
            icon: notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
            title: notInPlan
                ? 'Not included in your current plan'
                : 'Could not load your to-do list',
            body: error,
            action: notInPlan
                ? null
                : KButton.secondary(
                    label: 'Try again',
                    expand: false,
                    onPressed: _load,
                  ),
          ),
        ],
      );
    }
    final rows = filterTodos(_items, _search.text);
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          AppSpace.gutter,
          AppSpace.xs,
          AppSpace.gutter,
          AppSpace.xxl * 3,
        ),
        children: [
          KChipBar<String>(
            value: _view,
            padding: EdgeInsets.zero,
            options: [
              for (final (v, label) in todoViews)
                (
                  v,
                  _stats.countFor(v) > 0
                      ? '$label (${_stats.countFor(v)})'
                      : label,
                ),
            ],
            onChanged: _pickView,
          ),
          const SizedBox(height: AppSpace.sm),
          KSearchField(
            controller: _search,
            hint: 'Search todos...',
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: AppSpace.md),
          if (rows.isEmpty)
            KEmptyState(
              icon: LucideIcons.clipboardList,
              title: 'Nothing here',
              body: _items.isEmpty
                  ? 'No to-dos in this view. Tap + to add one.'
                  : 'No results. Try a different search.',
            )
          else
            for (final t in rows) ...[
              _card(t),
              const SizedBox(height: AppSpace.sm),
            ],
        ],
      ),
    );
  }

  Widget _card(TodoItem t) {
    final now = DateTime.now();
    final late = t.isOverdue(now);
    final working = busy.contains('done-${t.id}');
    return KCard(
      onTap: () => _open(t),
      padding: const EdgeInsets.fromLTRB(
        AppSpace.xs,
        AppSpace.sm,
        AppSpace.md,
        AppSpace.sm,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          KIconButton(
            icon: t.done ? LucideIcons.circleCheck : LucideIcons.circle,
            tooltip: t.done ? 'Reopen' : 'Mark done',
            color: t.done ? AppColors.positive : AppColors.ink2,
            onTap: working ? () {} : () => _toggle(t),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  t.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.bodyStrong.copyWith(
                    decoration: t.done ? TextDecoration.lineThrough : null,
                  ),
                ),
                const SizedBox(height: AppSpace.xs),
                Text(
                  todoDueLabel(t.due, now),
                  style: AppText.caption.copyWith(
                    color: late && !t.done
                        ? AppColors.negative
                        : AppColors.ink2,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: AppSpace.sm),
          KPill(label: _words(t.priority), tone: _priorityTone(t.priority)),
        ],
      ),
    );
  }
}

/// One to-do: its status, due time, reminder, the Mark complete / Edit / snooze actions and the
/// activity history (`GET /api/todos/:id`). Pops `true` when something changed.
class TodoDetailScreen extends StatefulWidget {
  const TodoDetailScreen({
    super.key,
    required this.session,
    required this.todo,
  });

  final AppSession session;
  final TodoItem todo;

  @override
  State<TodoDetailScreen> createState() => _TodoDetailScreenState();
}

class _TodoDetailScreenState extends State<TodoDetailScreen>
    with HrScreenState {
  late TodoItem _todo = widget.todo;
  List<Map<String, dynamic>> _history = const [];
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    _loadHistory();
  }

  Future<void> _loadHistory() {
    final seq = ++_seq;
    return guardedLoad(() async {
      final data = await widget.session.api.getJson(todoPath(_todo.id));
      if (seq != _seq) return;
      final fresh = TodoItem.fromJson(data['todo']);
      if (fresh != null) _todo = fresh;
      final h = data['history'];
      _history = h is List
          ? [
              for (final e in h)
                if (e is Map) Map<String, dynamic>.from(e),
            ]
          : const [];
    });
  }

  Future<void> _close() async {
    if (mounted) Navigator.of(context).pop(true);
  }

  /// Sends one change. A refusal keeps this page open: the reason shows and the page reloads (the
  /// to-do may have changed elsewhere). Only a success closes it, so the list reloads.
  Future<void> _change(
    String key,
    Future<void> Function() send,
    String done,
  ) async {
    if (busy.contains(key)) return;
    setState(() => busy.add(key));
    var ok = false;
    try {
      await send();
      toast(done, tone: KTone.positive);
      ok = true;
    } on ApiException catch (e) {
      toast(e.message);
    } catch (_) {
      toast('Could not save. Try again.');
    }
    if (mounted) setState(() => busy.remove(key));
    if (ok) {
      await _close();
    } else if (mounted) {
      await _loadHistory();
    }
  }

  Future<void> _status(bool done) => _change('status', () async {
    await widget.session.api.patchJson(
      todoPath(_todo.id),
      todoStatusBody(done: done),
    );
  }, done ? 'Todo marked as completed' : 'Todo marked as pending');

  Future<void> _snooze(int minutes) => _change('snooze', () async {
    await widget.session.api.postJson(
      todoSnoozePath(_todo.id),
      todoSnoozeBody(minutes, DateTime.now()),
    );
  }, 'Todo snoozed successfully');

  Future<void> _edit() async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => TodoFormScreen(session: widget.session, todo: _todo),
      ),
    );
    if (saved == true) await _close();
  }

  Widget _field(String label, String value, {Color? color}) => Padding(
    padding: const EdgeInsets.only(bottom: AppSpace.md),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppText.caption),
        const SizedBox(height: AppSpace.xs),
        Text(
          value,
          style: AppText.bodyStrong.copyWith(color: color ?? AppColors.ink),
        ),
      ],
    ),
  );

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final t = _todo;
    final late = t.isOverdue(now) && !t.done;
    final working = busy.isNotEmpty;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const KBackBar('To-do'),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(
                  AppSpace.gutter,
                  AppSpace.xs,
                  AppSpace.gutter,
                  AppSpace.xxl * 3,
                ),
                children: [
                  Text(t.title, style: AppText.title),
                  if (t.description != null) ...[
                    const SizedBox(height: AppSpace.xs),
                    Text(
                      t.description!,
                      style: AppText.body.copyWith(color: AppColors.ink2),
                    ),
                  ],
                  const SizedBox(height: AppSpace.lg),
                  KCard(
                    padding: const EdgeInsets.all(AppSpace.md),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _field('Status', _words(t.status)),
                        _field('Priority', _words(t.priority)),
                        _field(
                          'Due',
                          late
                              ? '${todoDueFull(t.due)} (Overdue)'
                              : todoDueFull(t.due),
                          color: late ? AppColors.negative : null,
                        ),
                        if (t.reminderTime != null && t.reminderType != 'none')
                          _field(
                            'Reminder',
                            t.reminderTime!.difference(t.due).inSeconds.abs() <=
                                    60
                                ? 'At due time'
                                : todoDueFull(t.reminderTime!),
                          ),
                        if (t.relatedType != null)
                          _field('Linked to', _words(t.relatedType!)),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpace.md),
                  if (!t.done)
                    KButton(
                      label: 'Mark complete',
                      icon: LucideIcons.circleCheck,
                      loading: busy.contains('status'),
                      onPressed: working ? null : () => _status(true),
                    ),
                  if (t.done)
                    KButton(
                      label: 'Reopen',
                      icon: LucideIcons.rotateCcw,
                      loading: busy.contains('status'),
                      onPressed: working ? null : () => _status(false),
                    ),
                  const SizedBox(height: AppSpace.sm),
                  KButton.secondary(
                    label: 'Edit',
                    icon: LucideIcons.pencil,
                    onPressed: working ? null : _edit,
                  ),
                  if (!t.done)
                    for (final (minutes, label) in todoSnoozeOptions) ...[
                      const SizedBox(height: AppSpace.sm),
                      KButton.secondary(
                        label: label,
                        icon: LucideIcons.clock,
                        loading: busy.contains('snooze'),
                        onPressed: working ? null : () => _snooze(minutes),
                      ),
                    ],
                  const SizedBox(height: AppSpace.xl),
                  const KSectionHeader('Activity'),
                  if (loading)
                    const KSpinner()
                  else if (_history.isEmpty)
                    Text('No activity yet', style: AppText.caption)
                  else
                    for (final h in _history) _historyRow(h),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _historyRow(Map<String, dynamic> h) {
    final when = DateTime.tryParse(h['action_date']?.toString() ?? '')
        ?.toLocal();
    final oldV = h['old_value']?.toString() ?? '';
    final newV = h['new_value']?.toString() ?? '';
    final reason = h['reason']?.toString() ?? '';
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            _words(h['action']?.toString() ?? ''),
            style: AppText.bodyStrong,
          ),
          if (oldV.isNotEmpty && newV.isNotEmpty)
            Text('$oldV → $newV', style: AppText.caption),
          if (reason.isNotEmpty)
            Text('Reason: $reason', style: AppText.caption),
          if (when != null) Text(ddMMMyyyyHm(when), style: AppText.small),
        ],
      ),
    );
  }
}

/// The website's Advanced Todo form (new) and its Reschedule (edit). Pops `true` after a save.
class TodoFormScreen extends StatefulWidget {
  const TodoFormScreen({super.key, required this.session, this.todo});

  final AppSession session;
  final TodoItem? todo;

  @override
  State<TodoFormScreen> createState() => _TodoFormScreenState();
}

class _TodoFormScreenState extends State<TodoFormScreen> {
  late final _title = TextEditingController(text: widget.todo?.title);
  late final _description = TextEditingController(
    text: widget.todo?.description,
  );
  late String _assignee = widget.todo != null
      ? (widget.todo!.assignedTo ?? '')
      : _me;
  late DateTime _day = widget.todo?.due ?? DateTime.now();
  late String _slot = widget.todo == null
      ? '17:00'
      : todoSlotOf(widget.todo!.due);
  late String _priority = widget.todo?.priority ?? 'medium';
  String _reminderType = 'once';
  String _preset = 'smart';
  bool _whatsapp = false;
  bool _dueTouched = false;
  bool _dirty = false;
  List<TodoUser> _users = const [];

  String get _me => widget.session.user['id']?.toString() ?? '';

  @override
  void initState() {
    super.initState();
    _loadUsers();
  }

  @override
  void dispose() {
    _title.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _loadUsers() async {
    try {
      final data = await widget.session.api.getJson(todoUsersPath);
      if (mounted) setState(() => _users = todoUsers(data));
    } catch (_) {
      // The list is a convenience; without it the form still offers Myself and Unassigned.
    }
  }

  void _touched([_]) {
    if (!_dirty) setState(() => _dirty = true);
  }

  List<(String, String)> get _assigneeOptions {
    final me = _me;
    final others = [
      for (final u in _users)
        if (u.id != me) (u.id, u.label),
    ];
    final known = {'', me, ...others.map((o) => o.$1)};
    return [
      ('', 'Unassigned'),
      if (me.isNotEmpty) (me, 'Myself'),
      ...others,
      if (!known.contains(_assignee)) (_assignee, 'Someone else'),
    ];
  }

  DateTime get _due => todoDueAt(_day, _slot);

  Future<void> _save() async {
    final problem = todoTitleError(_title.text);
    if (problem != null) {
      showKToast(context, problem, tone: KTone.negative);
      return;
    }
    final api = widget.session.api;
    final existing = widget.todo;
    final now = DateTime.now();
    if (existing == null) {
      await api.postJson(
        todosPath,
        todoCreateBody(
          title: _title.text,
          description: _description.text,
          due: _due,
          priority: _priority,
          reminderType: _reminderType,
          preset: _preset,
          whatsapp: _whatsapp,
          assignedTo: _assignee,
          now: now,
        ),
      );
    } else {
      final body = todoEditBody(
        existing,
        title: _title.text,
        description: _description.text,
        due: _dueTouched ? _due : existing.due,
        priority: _priority,
        assignedTo: _assignee,
        now: now,
      );
      if (body.isNotEmpty) await api.patchJson(todoPath(existing.id), body);
    }
    if (!mounted) return;
    showKToast(
      context,
      existing == null ? 'Todo created successfully!' : 'Todo updated',
      tone: KTone.positive,
    );
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final creating = widget.todo == null;
    final slots = {...todoTimeSlots.map((s) => s.$1)}.contains(_slot)
        ? todoTimeSlots
        : [...todoTimeSlots, (_slot, _slot)];
    return KFormScaffold(
      title: creating ? 'Add to-do' : 'Edit to-do',
      saveLabel: 'Save to-do',
      onSave: _save,
      dirty: _dirty,
      children: [
        KTextField(label: 'Title', controller: _title, onChanged: _touched),
        KTextField(
          label: 'Description',
          controller: _description,
          hint: 'Optional notes...',
          maxLines: 4,
          minLines: 2,
          onChanged: _touched,
        ),
        KPickField<String>(
          label: 'Assign to',
          value: _assignee,
          options: _assigneeOptions,
          onChanged: (v) => setState(() {
            _assignee = v;
            _dirty = true;
          }),
        ),
        KDateField(
          label: 'Due date',
          value: _day,
          onChanged: (d) => setState(() {
            _day = d;
            _dueTouched = true;
            _dirty = true;
          }),
        ),
        KPickField<String>(
          label: 'Time',
          value: _slot,
          options: slots,
          onChanged: (v) => setState(() {
            _slot = v;
            _dueTouched = true;
            _dirty = true;
          }),
        ),
        KPickField<String>(
          label: 'Priority',
          value: _priority,
          options: todoPriorities,
          onChanged: (v) => setState(() {
            _priority = v;
            _dirty = true;
          }),
        ),
        if (creating) ...[
          KPickField<String>(
            label: 'Reminder',
            value: _reminderType,
            options: todoReminderTypes,
            onChanged: (v) => setState(() {
              _reminderType = v;
              _dirty = true;
            }),
          ),
          if (_reminderType != 'none') ...[
            KPickField<String>(
              label: 'When to remind',
              value: _preset,
              options: todoReminderPresets,
              onChanged: (v) => setState(() {
                _preset = v;
                _dirty = true;
              }),
            ),
            KToggleField(
              label: 'WhatsApp message',
              help: 'Also send the reminder on WhatsApp. Needs WhatsApp on your plan.',
              value: _whatsapp,
              onChanged: (v) => setState(() {
                _whatsapp = v;
                _dirty = true;
              }),
            ),
          ],
        ],
      ],
    );
  }
}

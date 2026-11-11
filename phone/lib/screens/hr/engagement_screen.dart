import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../sales/doc_action_sheets.dart';
import 'attendance_leave_logic.dart';
import 'hr_logic.dart';
import 'hr_manage_widgets.dart';
import 'hr_more_logic.dart';
import 'pay_widgets.dart';

enum _Tab { announcements, polls, articles }

/// Website `/hr/engagement`: announcements, polls and articles for the team, each with a list and an
/// add form. Announcements are archived and articles unpublished (the website's routes have no delete);
/// a poll has no owner-side vote or close route, so it is listed with its options only. Rich article
/// layout (HTML) is written on the website; the phone writes plain paragraphs.
class EngagementScreen extends StatefulWidget {
  const EngagementScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<EngagementScreen> createState() => _EngagementScreenState();
}

class _EngagementScreenState extends State<EngagementScreen> with HrScreenState<EngagementScreen> {
  _Tab _tab = _Tab.announcements;
  List<AnnouncementRow> _announcements = const [];
  List<PollRow> _polls = const [];
  List<ArticleRow> _articles = const [];
  HrAccess _access = HrAccess.open;

  @override
  void initState() {
    super.initState();
    _load();
    loadHrAccess(widget.session).then((a) {
      if (mounted) setState(() => _access = a);
    });
  }

  Future<void> _load() => guardedLoad(() async {
        final api = widget.session.api;
        final results = await Future.wait([api.getJson(announcementsPath), api.getJson(pollsPath), api.getJson(articlesPath)]);
        if (!mounted) return;
        _announcements = announcementRows(results[0]['announcements']);
        _polls = pollRows(results[1]['polls']);
        _articles = articleRows(results[2]['articles']);
      });

  void _push(Widget screen) => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen)).then((_) {
        if (mounted) _load();
      });

  Future<void> _archive(AnnouncementRow a) => act(
        'archive-${a.id}',
        confirm: () => askSheet(context, title: 'Archive announcement?', text: 'Archive "${a.title}"? Employees stop seeing it.', confirmLabel: 'Archive', cancelLabel: 'Not now'),
        send: () => widget.session.api.patchJson(announcementsPath, archiveAnnouncementBody(a.id)),
        done: 'Announcement archived',
        reload: _load,
      );

  Future<void> _unpublish(ArticleRow a) => act(
        'unpublish-${a.id}',
        confirm: () => askSheet(context, title: 'Unpublish article?', text: 'Unpublish "${a.title}"? Employees stop seeing it.', confirmLabel: 'Unpublish', cancelLabel: 'Not now'),
        send: () => widget.session.api.patchJson(articlesPath, unpublishArticleBody(a.id)),
        done: 'Article unpublished',
        reload: _load,
      );

  Widget _card({required String title, String? body, required List<String> meta, Widget? action, List<Widget> extra = const []}) {
    return KCard(
      padding: const EdgeInsets.all(14),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: AppText.bodyStrong),
            if (body != null && body.isNotEmpty) ...[const SizedBox(height: 4), Text(body, style: AppText.body)],
            ...extra,
            if (meta.isNotEmpty) ...[const SizedBox(height: 6), Text(meta.join(' · '), style: AppText.caption)],
          ]),
        ),
        if (action != null) ...[const SizedBox(width: AppSpace.sm), action],
      ]),
    );
  }

  List<Widget> _rows() {
    final canWrite = _access.has('settings', 'update');
    switch (_tab) {
      case _Tab.announcements:
        return [
          for (final a in _announcements)
            _card(
              title: a.title,
              body: a.body,
              meta: [a.audienceLabel, if (a.published != null) ddMMMyyyy(a.published!), if (a.expires != null) 'Expires ${ddMMMyyyy(a.expires!)}'],
              action: canWrite ? PayRowButton(label: 'Archive', busy: busy.contains('archive-${a.id}'), onTap: () => _archive(a)) : null,
            ),
        ];
      case _Tab.polls:
        return [
          for (final p in _polls)
            _card(
              title: p.question,
              meta: [p.audienceLabel, if (p.expires != null) 'Expires ${ddMMMyyyy(p.expires!)}'],
              extra: [
                const SizedBox(height: 6),
                for (final o in p.options)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Row(children: [Text('•  ', style: AppText.small), Expanded(child: Text(o, style: AppText.small))]),
                  ),
              ],
            ),
        ];
      case _Tab.articles:
        return [
          for (final a in _articles)
            _card(
              title: a.title,
              body: a.text,
              meta: [a.isPublished ? 'Published' : 'Unpublished', if (a.published != null) ddMMMyyyy(a.published!)],
              action: canWrite && a.isPublished ? PayRowButton(label: 'Unpublish', busy: busy.contains('unpublish-${a.id}'), onTap: () => _unpublish(a)) : null,
            ),
        ];
    }
  }

  @override
  Widget build(BuildContext context) {
    final canWrite = _access.has('settings', 'update');
    final (addLabel, form) = switch (_tab) {
      _Tab.announcements => ('New announcement', () => AnnouncementFormScreen(session: widget.session)),
      _Tab.polls => ('New poll', () => PollFormScreen(session: widget.session)),
      _Tab.articles => ('New article', () => ArticleFormScreen(session: widget.session)),
    };
    final (emptyTitle, emptyBody) = switch (_tab) {
      _Tab.announcements => ('No announcements', 'Messages you publish to your team show up here.'),
      _Tab.polls => ('No polls', 'Polls you create for your team show up here.'),
      _Tab.articles => ('No articles', 'Articles you publish for your team show up here.'),
    };
    return PayListPage(
      title: 'Engagement',
      loading: loading,
      error: error,
      notInPlan: notInPlan,
      onRetry: _load,
      emptyTitle: emptyTitle,
      emptyBody: emptyBody,
      emptyIcon: LucideIcons.megaphone,
      trailing: canWrite ? KIconButton(icon: LucideIcons.plus, tooltip: addLabel, onTap: () => _push(form())) : null,
      header: [
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpace.sm),
          child: KSegmented<_Tab>(
            value: _tab,
            options: const [(_Tab.announcements, 'Announcements'), (_Tab.polls, 'Polls'), (_Tab.articles, 'Articles')],
            onChanged: (v) => setState(() => _tab = v),
          ),
        ),
      ],
      rows: _rows(),
    );
  }
}

/// The audience and expiry fields shared by the announcement and poll forms. Reports every change.
class AudienceFields extends StatefulWidget {
  const AudienceFields({super.key, required this.session, required this.onChanged});

  final AppSession session;
  final void Function(HrAudience audience, DateTime? expiresAt) onChanged;

  @override
  State<AudienceFields> createState() => _AudienceFieldsState();
}

class _AudienceFieldsState extends State<AudienceFields> {
  String _type = 'all';
  List<String> _allDepartments = const [];
  final Set<String> _departments = {};
  final Map<String, String> _employees = {};
  DateTime? _expires;

  @override
  void initState() {
    super.initState();
    widget.session.api.getJson(orgCatalogPath).then((body) {
      if (mounted) setState(() => _allDepartments = catalogList(body, 'departments'));
    }).catchError((_) {
      // Departments are optional: without the list only "Everyone" and "Specific employees" work.
    });
  }

  void _emit() {
    final audience = switch (_type) {
      'departments' => HrAudience.departments(_departments.toList()),
      'employees' => HrAudience.employees(_employees.keys.toList()),
      _ => const HrAudience.everyone(),
    };
    widget.onChanged(audience, _expires);
  }

  void _change(VoidCallback fn) {
    setState(fn);
    _emit();
  }

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      KPickField<String>(
        label: 'Audience',
        value: _type,
        options: const [('all', 'Everyone'), ('departments', 'Specific departments'), ('employees', 'Specific employees')],
        onChanged: (v) => _change(() => _type = v),
      ),
      if (_type == 'departments') ...[
        const SizedBox(height: AppSpace.sm),
        if (_allDepartments.isEmpty)
          Text('Add departments in HR settings first.', style: AppText.caption)
        else
          for (final d in _allDepartments)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpace.xs),
              child: KToggleField(label: d, value: _departments.contains(d), onChanged: (on) => _change(() => on ? _departments.add(d) : _departments.remove(d))),
            ),
      ],
      if (_type == 'employees') ...[
        const SizedBox(height: AppSpace.sm),
        KAsyncPickField(
          label: 'Add an employee',
          valueLabel: null,
          search: (q) => searchEmployees(widget.session.api, q),
          onPicked: (id, label) => _change(() => _employees[id] = label),
        ),
        for (final e in _employees.entries)
          KListRow(title: e.value, trailing: KTextButton(label: 'Remove', onTap: () => _change(() => _employees.remove(e.key)))),
      ],
      const SizedBox(height: AppSpace.sm),
      KDateField(label: 'Expires on (optional)', value: _expires, onChanged: (d) => _change(() => _expires = d)),
    ]);
  }
}

/// Website "New announcement": title, message (no replies), audience, expiry. Publishes at once.
class AnnouncementFormScreen extends StatefulWidget {
  const AnnouncementFormScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<AnnouncementFormScreen> createState() => _AnnouncementFormScreenState();
}

class _AnnouncementFormScreenState extends State<AnnouncementFormScreen> {
  final _title = TextEditingController();
  final _body = TextEditingController();
  HrAudience _audience = const HrAudience.everyone();
  DateTime? _expires;

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    await widget.session.api.postJson(announcementsPath, announcementBody(title: _title.text, body: _body.text, audience: _audience, expiresAt: _expires));
    if (!mounted) return;
    showKToast(context, 'Announcement published', tone: KTone.positive);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'New announcement',
      saveLabel: 'Publish',
      dirty: _title.text.isNotEmpty || _body.text.isNotEmpty,
      canSave: _title.text.trim().isNotEmpty,
      onSave: _save,
      children: [
        KTextField(label: 'Title', controller: _title, onChanged: (_) => setState(() {})),
        KTextField(label: 'Message', hint: 'Message (no replies)', controller: _body, maxLines: 6, minLines: 3, onChanged: (_) => setState(() {})),
        AudienceFields(session: widget.session, onChanged: (a, e) {
          _audience = a;
          _expires = e;
        }),
      ],
    );
  }
}

/// Website "New poll": a question and at least two options, audience, expiry. Asks first because
/// employees see it straight away.
class PollFormScreen extends StatefulWidget {
  const PollFormScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<PollFormScreen> createState() => _PollFormScreenState();
}

class _PollFormScreenState extends State<PollFormScreen> {
  final _question = TextEditingController();
  final _options = [TextEditingController(), TextEditingController()];
  HrAudience _audience = const HrAudience.everyone();
  DateTime? _expires;

  @override
  void dispose() {
    _question.dispose();
    for (final c in _options) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    final options = [for (final c in _options) c.text];
    if (!pollIsValid(_question.text, options)) {
      showKToast(context, 'A poll needs a question and at least two options.', tone: KTone.negative);
      return;
    }
    final who = switch (_audience.type) {
      'departments' => 'the chosen departments',
      'employees' => 'the chosen employees',
      _ => 'everyone',
    };
    final ok = await askSheet(
      context,
      title: 'Publish poll?',
      text: 'Publish "${_question.text.trim()}" to $who? They see it in their portal straight away.',
      confirmLabel: 'Publish poll',
      cancelLabel: 'Not now',
      danger: false,
    );
    if (!ok || !mounted) return;
    await widget.session.api.postJson(pollsPath, pollBody(question: _question.text, options: options, audience: _audience, expiresAt: _expires));
    if (!mounted) return;
    showKToast(context, 'Poll created', tone: KTone.positive);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'New poll',
      saveLabel: 'Create poll',
      dirty: _question.text.isNotEmpty,
      onSave: _save,
      children: [
        KTextField(label: 'Question', controller: _question, onChanged: (_) => setState(() {})),
        for (final (i, c) in _options.indexed) KTextField(label: 'Option ${i + 1}', controller: c),
        KButton.secondary(label: 'Add option', expand: false, onPressed: () => setState(() => _options.add(TextEditingController()))),
        AudienceFields(session: widget.session, onChanged: (a, e) {
          _audience = a;
          _expires = e;
        }),
      ],
    );
  }
}

/// Website "New article": a title, the text (blank lines start a new paragraph) and an optional expiry.
class ArticleFormScreen extends StatefulWidget {
  const ArticleFormScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<ArticleFormScreen> createState() => _ArticleFormScreenState();
}

class _ArticleFormScreenState extends State<ArticleFormScreen> {
  final _title = TextEditingController();
  final _text = TextEditingController();
  DateTime? _expires;

  @override
  void dispose() {
    _title.dispose();
    _text.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    await widget.session.api.postJson(articlesPath, articleBody(title: _title.text, text: _text.text, expiresAt: _expires));
    if (!mounted) return;
    showKToast(context, 'Article published', tone: KTone.positive);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'New article',
      saveLabel: 'Publish',
      dirty: _title.text.isNotEmpty || _text.text.isNotEmpty,
      canSave: _title.text.trim().isNotEmpty,
      onSave: _save,
      children: [
        KTextField(label: 'Title', controller: _title, onChanged: (_) => setState(() {})),
        KTextField(label: 'Article text', hint: 'Leave a blank line between paragraphs', controller: _text, maxLines: 12, minLines: 5, onChanged: (_) => setState(() {})),
        KDateField(label: 'Expires on (optional)', value: _expires, onChanged: (d) => setState(() => _expires = d)),
      ],
    );
  }
}

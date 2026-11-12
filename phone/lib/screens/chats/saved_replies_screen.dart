import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../hr/hr_manage_widgets.dart';
import '../sales/doc_action_sheets.dart';
import 'audience_logic.dart' show savedRepliesPath;
import 'flows_logic.dart';

/// Website `/whatsapp/saved-replies` (Settings > WhatsApp > Team & inbox): the canned replies agents
/// insert in a chat. List, search, filter by category, add, edit and delete. The inbox composer reads
/// the same list.
class SavedRepliesScreen extends StatefulWidget {
  const SavedRepliesScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<SavedRepliesScreen> createState() => _SavedRepliesScreenState();
}

class _SavedRepliesScreenState extends State<SavedRepliesScreen> with HrScreenState {
  final _search = TextEditingController();
  List<SavedReply> _all = const [];
  String _category = '';

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

  Future<void> _load() => guardedLoad(() async {
        _all = savedReplies(await widget.session.api.getJson(savedRepliesPath));
      });

  Future<void> _edit([SavedReply? reply]) async {
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => SavedReplyFormScreen(session: widget.session, reply: reply)));
    if (saved == true && mounted) _load();
  }

  Future<void> _delete(SavedReply r) => act(
        'del-${r.id}',
        confirm: () => askSheet(
          context,
          title: 'Delete saved reply?',
          text: 'Delete "${r.title}"? Agents will no longer see it in the chat.',
          confirmLabel: 'Delete reply',
          cancelLabel: 'Keep it',
        ),
        send: () async {
          await widget.session.api.deleteJson(savedReplyPath(r.id));
        },
        done: 'Reply deleted',
        reload: _load,
      );

  @override
  Widget build(BuildContext context) {
    final ready = !loading && error == null;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          KBackBar('Saved replies', trailing: ready ? KIconButton(icon: LucideIcons.plus, tooltip: 'New reply', onTap: _edit) : null),
          Expanded(child: _body()),
        ]),
      ),
    );
  }

  Widget _body() {
    if (loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: AppSpace.xxl * 2));
    if (error != null) {
      return ListView(children: [
        KEmptyState(
          icon: notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
          title: notInPlan ? 'Not included in your current plan' : 'Could not load saved replies',
          body: error,
          action: notInPlan ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
        ),
      ]);
    }
    final rows = filterSavedReplies(_all, _search.text, _category);
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xxl * 3),
        children: [
          Text('Replies your team can insert in a chat. Type / in the message box to find one.', style: AppText.caption),
          const SizedBox(height: AppSpace.sm),
          KSearchField(controller: _search, hint: 'Search replies', onChanged: (_) => setState(() {})),
          const SizedBox(height: AppSpace.sm),
          KChipBar<String>(
            value: _category,
            padding: EdgeInsets.zero,
            options: [('', 'All'), for (final c in savedReplyCategories) (c, savedReplyCategoryLabel(c))],
            onChanged: (v) => setState(() => _category = v),
          ),
          const SizedBox(height: AppSpace.md),
          if (rows.isEmpty)
            KEmptyState(
              icon: LucideIcons.bookOpen,
              title: _all.isEmpty ? 'No saved replies yet' : 'No results.',
              body: _all.isEmpty ? 'Tap + to add your first one.' : 'Try a different search or category.',
            )
          else
            for (final (category, items) in groupSavedReplies(rows)) ...[
              Padding(
                padding: const EdgeInsets.only(bottom: AppSpace.sm),
                child: Text('${category.toUpperCase()} (${items.length})', style: AppText.caption.copyWith(fontWeight: FontWeight.w600)),
              ),
              for (final r in items) ...[
                _card(r),
                const SizedBox(height: AppSpace.sm),
              ],
              const SizedBox(height: AppSpace.sm),
            ],
        ],
      ),
    );
  }

  Widget _card(SavedReply r) {
    return KCard(
      onTap: () => _edit(r),
      padding: const EdgeInsets.fromLTRB(AppSpace.md, AppSpace.md, AppSpace.xs, AppSpace.md),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Flexible(child: Text(r.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.bodyStrong)),
              if (r.shortcut != null) ...[
                const SizedBox(width: AppSpace.sm),
                Text('/${r.shortcut}', style: AppText.caption.copyWith(color: AppColors.ink2)),
              ],
            ]),
            const SizedBox(height: AppSpace.xs),
            Text(r.message, maxLines: 3, overflow: TextOverflow.ellipsis, style: AppText.body.copyWith(color: AppColors.ink2)),
          ]),
        ),
        KIconButton(icon: LucideIcons.trash2, tooltip: 'Delete reply', onTap: () => _delete(r)),
      ]),
    );
  }
}

/// The website's "Create New Reply" / "Edit Reply" form. Pops `true` after a save.
class SavedReplyFormScreen extends StatefulWidget {
  const SavedReplyFormScreen({super.key, required this.session, this.reply});

  final AppSession session;
  final SavedReply? reply;

  @override
  State<SavedReplyFormScreen> createState() => _SavedReplyFormScreenState();
}

class _SavedReplyFormScreenState extends State<SavedReplyFormScreen> {
  late final _title = TextEditingController(text: widget.reply?.title);
  late final _shortcut = TextEditingController(text: widget.reply?.shortcut);
  late final _message = TextEditingController(text: widget.reply?.message);
  late String _category = widget.reply?.category ?? 'general';
  bool _dirty = false;

  @override
  void dispose() {
    _title.dispose();
    _shortcut.dispose();
    _message.dispose();
    super.dispose();
  }

  void _touched([_]) {
    if (!_dirty) setState(() => _dirty = true);
  }

  Future<void> _save() async {
    final problem = savedReplyError(_title.text, _message.text);
    if (problem != null) {
      showKToast(context, problem, tone: KTone.negative);
      return;
    }
    final body = savedReplyBody(title: _title.text, shortcut: _shortcut.text, message: _message.text, category: _category);
    final existing = widget.reply;
    if (existing == null) {
      await widget.session.api.postJson(savedRepliesPath, body);
    } else {
      await widget.session.api.patchJson(savedReplyPath(existing.id), body);
    }
    if (!mounted) return;
    showKToast(context, existing == null ? 'Reply created' : 'Reply updated', tone: KTone.positive);
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final categories = {...savedReplyCategories, _category}.toList();
    return KFormScaffold(
      title: widget.reply == null ? 'New reply' : 'Edit reply',
      saveLabel: 'Save reply',
      onSave: _save,
      dirty: _dirty,
      children: [
        KTextField(label: 'Title', controller: _title, hint: 'e.g. Payment received', onChanged: _touched),
        KTextField(label: 'Shortcut (optional)', controller: _shortcut, hint: 'e.g. payment', onChanged: _touched),
        KPickField<String>(
          label: 'Category',
          value: _category,
          options: [for (final c in categories) (c, savedReplyCategoryLabel(c))],
          onChanged: (v) => setState(() {
            _category = v;
            _dirty = true;
          }),
        ),
        KTextField(label: 'Message', controller: _message, hint: 'Type the full reply message…', maxLines: 8, minLines: 4, onChanged: _touched),
      ],
    );
  }
}

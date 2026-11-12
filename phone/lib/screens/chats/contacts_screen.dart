import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../pages/website_page_screen.dart';
import '../sales/doc_action_sheets.dart';
import 'audience_logic.dart';
import 'chat_thread_screen.dart';
import 'contact_groups_screen.dart';
import 'send_message_screen.dart';
import 'unsubscribes_screen.dart';

/// Website `/whatsapp/contacts`: saved WhatsApp contacts with search, a source and a group filter,
/// add, edit, delete, groups and unsubscribes. CSV import and export stay on the website.
/// [embedded] is the Contacts bottom tab: no back bar, the shell supplies the page around it.
class ContactsScreen extends StatefulWidget {
  const ContactsScreen({super.key, required this.session, this.embedded = false});

  final AppSession session;
  final bool embedded;

  @override
  State<ContactsScreen> createState() => _ContactsScreenState();
}

class _ContactsScreenState extends State<ContactsScreen> {
  final _searchController = TextEditingController();
  Timer? _debounce;
  int _seq = 0;

  List<Contact> _rows = const [];
  List<ContactGroup> _groups = const [];
  int _total = 0;
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  bool _notInPlan = false;
  String _search = '', _source = '', _groupId = '';

  bool get _filtered => _search.trim().isNotEmpty || _source.isNotEmpty || _groupId.isNotEmpty;

  @override
  void initState() {
    super.initState();
    _load();
    // The group filter is optional: a failed load leaves it out.
    widget.session.api.getJson(groupsPath).then((b) {
      if (mounted) setState(() => _groups = groupsFrom(b));
    }).catchError((_) {});
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  String _path({int offset = 0}) => contactsListPath(search: _search, source: _source, groupId: _groupId, offset: offset);

  Future<void> _load() async {
    final seq = ++_seq;
    setState(() {
      _loading = true;
      _error = null;
      _notInPlan = false;
    });
    try {
      final page = contactsFrom(await widget.session.api.getJson(_path()));
      if (!mounted || seq != _seq) return;
      setState(() {
        _rows = page.rows;
        _total = page.total;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted || seq != _seq) return;
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || seq != _seq) return;
      setState(() {
        _error = 'Could not reach the server.';
        _loading = false;
      });
    }
  }

  Future<void> _loadMore() async {
    if (_loadingMore) return;
    final seq = _seq;
    setState(() => _loadingMore = true);
    try {
      final page = contactsFrom(await widget.session.api.getJson(_path(offset: _rows.length)));
      if (!mounted || seq != _seq) return;
      setState(() {
        _rows = [..._rows, ...page.rows.where((r) => !_rows.any((x) => x.id == r.id))];
        _total = page.total;
      });
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not load more contacts.', tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  void _setFilter(VoidCallback change) {
    setState(change);
    _load();
  }

  void _onSearch(String text) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      if (!mounted || text.trim() == _search.trim()) return;
      _setFilter(() => _search = text);
    });
  }

  void _clear() {
    _searchController.clear();
    _setFilter(() => _search = _source = _groupId = '');
  }

  Future<void> _push(Widget screen) => Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => screen)).then((_) {
        if (mounted) _load();
      });

  Future<void> _add() async {
    final added = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => ContactFormScreen(session: widget.session)));
    if (added == true && mounted) _load();
  }

  Future<void> _open(Contact c) async {
    final changed = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => ContactDetailScreen(session: widget.session, contact: c)));
    if (changed == true && mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    final addButton = _notInPlan ? null : KIconButton(icon: LucideIcons.plus, tooltip: 'Add contact', onTap: _add);
    final content = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (!widget.embedded) KBackBar('Contacts', trailing: addButton),
      if (!_notInPlan) _filters(widget.embedded ? addButton : null),
      Expanded(child: _body()),
    ]);
    if (widget.embedded) return Material(color: AppColors.bg, child: content);
    return Scaffold(backgroundColor: AppColors.bg, body: SafeArea(bottom: false, child: content));
  }

  Widget _filters(Widget? trailing) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, AppSpace.sm),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        KSearchField(controller: _searchController, hint: 'Search name, phone or email', onChanged: _onSearch, trailing: trailing),
        const SizedBox(height: AppSpace.sm),
        KChipBar<String>(value: _source, padding: EdgeInsets.zero, options: contactSources, onChanged: (v) => _setFilter(() => _source = v)),
        if (_groups.isNotEmpty) ...[
          const SizedBox(height: AppSpace.sm),
          KPickField<String>(
            label: 'Group',
            value: _groupId,
            options: [('', 'All groups'), for (final g in _groups) (g.id, g.name)],
            onChanged: (v) => _setFilter(() => _groupId = v),
          ),
        ],
        const SizedBox(height: AppSpace.sm),
        Row(children: [
          KChip(label: 'Groups', selected: false, icon: LucideIcons.users, onTap: () => _push(ContactGroupsScreen(session: widget.session))),
          const SizedBox(width: AppSpace.sm),
          KChip(label: 'Unsubscribed', selected: false, icon: LucideIcons.userX, onTap: () => _push(UnsubscribesScreen(session: widget.session))),
          if (_filtered) ...[const Spacer(), KTextButton(label: 'Clear filters', onTap: _clear)],
        ]),
      ]),
    );
  }

  Widget _body() {
    if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: AppSpace.xxl * 2));
    if (_error != null) {
      return ListView(children: [
        KEmptyState(
          icon: _notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
          title: _notInPlan ? 'Not included in your current plan' : 'Could not load contacts',
          body: _error,
          action: _notInPlan ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
        ),
      ]);
    }
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xxl * 3),
        children: [
          if (_rows.isEmpty)
            KEmptyState(
              icon: LucideIcons.contact,
              title: _filtered ? 'No contacts match these filters' : 'No contacts yet',
              body: _filtered ? null : 'Add a contact, or import a CSV on the website.',
            )
          else ...[
            KCard(
              child: KDivided(children: [
                for (final c in _rows)
                  KListRow(
                    title: c.title,
                    subtitle: [if (c.name != null) c.phoneText, if (c.tags.isNotEmpty) c.tags.join(', ')].join(' · '),
                    leading: KAvatar(name: c.title),
                    trailing: Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink3),
                    onTap: () => _open(c),
                  ),
              ]),
            ),
            Padding(padding: const EdgeInsets.only(top: AppSpace.sm), child: Text('Showing ${_rows.length} of $_total', textAlign: TextAlign.center, style: AppText.caption)),
            if (_rows.length < _total)
              Padding(
                padding: const EdgeInsets.only(top: AppSpace.sm),
                child: KButton.secondary(label: _loadingMore ? 'Loading…' : 'Load more', expand: false, onPressed: _loadingMore ? null : _loadMore),
              ),
          ],
          Padding(
            padding: const EdgeInsets.only(top: AppSpace.lg),
            child: KCard(
              child: KListRow(
                title: 'Import or export contacts',
                subtitle: 'CSV files are handled on the website',
                leading: const Icon(LucideIcons.globe, size: 20, color: AppColors.ink2),
                trailing: Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink3),
                onTap: () => openWebsiteInApp(context, widget.session, '/whatsapp/contacts', 'Contacts'),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// One contact: its details, Send message, Open chat, Edit and Delete. Pops `true` when the
/// contact changed or was deleted, so the list reloads.
class ContactDetailScreen extends StatefulWidget {
  const ContactDetailScreen({super.key, required this.session, required this.contact});

  final AppSession session;
  final Contact contact;

  @override
  State<ContactDetailScreen> createState() => _ContactDetailScreenState();
}

class _ContactDetailScreenState extends State<ContactDetailScreen> {

  bool _busy = false;

  Contact get c => widget.contact;

  Future<void> _edit() async {
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => ContactFormScreen(session: widget.session, contact: c)));
    if (saved == true && mounted) Navigator.of(context).pop(true);
  }

  Future<void> _delete() async {
    if (_busy) return;
    final sure = await askSheet(
      context,
      title: 'Delete contact?',
      text: 'Delete ${c.title} (${c.phoneText})? They are also removed from every group.',
      confirmLabel: 'Delete contact',
      cancelLabel: 'Keep it',
    );
    if (!sure || !mounted || _busy) return;
    setState(() => _busy = true);
    try {
      await widget.session.api.deleteJson(contactDeletePath(c.id));
      if (!mounted) return;
      showKToast(context, 'Contact deleted', tone: KTone.positive);
      Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not delete the contact. Try again.', tone: KTone.negative);
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _sendMessage() => Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => SendMessageScreen(session: widget.session, phone: c.phone)));

  Future<void> _openChat() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final id = chatIdFrom(await widget.session.api.getJson(contactChatPath(c.phone)));
      if (!mounted) return;
      if (id == null) {
        showKToast(context, 'No chat with this number yet. Use Send message to start one.');
      } else {
        await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => ChatThreadScreen(session: widget.session, conversationId: id, title: c.title)));
      }
    } on ApiException catch (e) {
      if (mounted) {
        showKToast(context, e.status == 404 ? 'No chat with this number yet. Use Send message to start one.' : e.message, tone: e.status == 404 ? KTone.neutral : KTone.negative);
      }
    } catch (_) {
      if (mounted) showKToast(context, 'Could not open the chat. Try again.', tone: KTone.negative);
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          KBackBar(c.title),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, AppSpace.xxl * 2),
              children: [
                KInfoCard(title: 'Contact', rows: [
                  ('Phone', c.phoneText),
                  if (c.name != null) ('Name', c.name!),
                  if (c.email != null) ('Email', c.email!),
                  if (c.tags.isNotEmpty) ('Tags', c.tags.join(', ')),
                  if (c.notes != null) ('Notes', c.notes!),
                  if (c.groups.isNotEmpty) ('Groups', c.groups.map((g) => g.name).join(', ')),
                  ('Added', '${c.createdAt == null ? '' : '${ddMMMyyyy(c.createdAt!)} · '}${c.sourceLabel}'),
                ]),
                const SizedBox(height: AppSpace.lg),
                KButton(label: 'Send message', icon: LucideIcons.send, onPressed: _busy ? null : _sendMessage),
                const SizedBox(height: AppSpace.sm),
                KButton.secondary(label: 'Open chat', icon: LucideIcons.messageCircle, loading: _busy, onPressed: _busy ? null : _openChat),
                const SizedBox(height: AppSpace.sm),
                KButton.secondary(label: 'Edit contact', icon: LucideIcons.pencil, onPressed: _busy ? null : _edit),
                const SizedBox(height: AppSpace.sm),
                KButton(label: 'Delete contact', kind: KButtonKind.danger, icon: LucideIcons.trash2, onPressed: _busy ? null : _delete),
              ],
            ),
          ),
        ]),
      ),
    );
  }
}

/// Website "Add Contact" and the edit form: phone (add only), name, email, tags, notes.
/// Pops `true` after a save.
class ContactFormScreen extends StatefulWidget {
  const ContactFormScreen({super.key, required this.session, this.contact});

  final AppSession session;
  final Contact? contact;

  @override
  State<ContactFormScreen> createState() => _ContactFormScreenState();
}

class _ContactFormScreenState extends State<ContactFormScreen> {
  late final _phone = TextEditingController(text: widget.contact?.phone ?? '');
  late final _name = TextEditingController(text: widget.contact?.name ?? '');
  late final _email = TextEditingController(text: widget.contact?.email ?? '');
  late final _tags = TextEditingController(text: widget.contact?.tags.join(', ') ?? '');
  late final _notes = TextEditingController(text: widget.contact?.notes ?? '');

  bool get _editing => widget.contact != null;

  bool get _dirty {
    final c = widget.contact;
    if (c == null) return [_phone, _name, _email, _tags, _notes].any((f) => f.text.isNotEmpty);
    return _name.text != (c.name ?? '') || _email.text != (c.email ?? '') || _tags.text != c.tags.join(', ') || _notes.text != (c.notes ?? '');
  }

  @override
  void dispose() {
    _phone.dispose();
    _name.dispose();
    _email.dispose();
    _tags.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_editing) {
      await widget.session.api.putJson(
        contactsPath,
        editContactBody(id: widget.contact!.id, name: _name.text, email: _email.text, tags: _tags.text, notes: _notes.text),
      );
      if (!mounted) return;
      showKToast(context, 'Contact updated', tone: KTone.positive);
      Navigator.of(context).pop(true);
      return;
    }
    final problem = contactPhoneError(_phone.text);
    if (problem != null) {
      showKToast(context, problem, tone: KTone.negative);
      return;
    }
    await widget.session.api.postJson(
      contactsPath,
      addContactBody(phone: _phone.text, name: _name.text, email: _email.text, tags: _tags.text, notes: _notes.text),
    );
    if (!mounted) return;
    showKToast(context, 'Contact added', tone: KTone.positive);
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: _editing ? 'Edit contact' : 'Add contact',
      saveLabel: _editing ? 'Save changes' : 'Save contact',
      onSave: _save,
      dirty: _dirty,
      children: [
        KTextField(label: 'Phone', controller: _phone, hint: 'e.g. 919876543210', keyboard: TextInputType.phone, enabled: !_editing, onChanged: (_) => setState(() {})),
        KTextField(label: 'Name', controller: _name, hint: 'Contact name', maxLength: 120, onChanged: (_) => setState(() {})),
        KTextField(label: 'Email', controller: _email, hint: 'contact@example.com', keyboard: TextInputType.emailAddress, onChanged: (_) => setState(() {})),
        KTextField(label: 'Tags', controller: _tags, hint: 'customer, vip, lead (comma-separated)', onChanged: (_) => setState(() {})),
        KTextField(label: 'Notes', controller: _notes, hint: 'Additional notes about this contact', maxLines: 3, maxLength: 2000, onChanged: (_) => setState(() {})),
      ],
    );
  }
}

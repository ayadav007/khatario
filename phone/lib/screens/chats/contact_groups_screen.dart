import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../hr/hr_manage_widgets.dart';
import '../hr/pay_widgets.dart';
import '../sales/doc_action_sheets.dart';
import 'audience_logic.dart';
import 'contact_picker.dart';

/// Website `/whatsapp/contacts/groups`: contact groups with their member counts. A group opens its
/// members; new, edit and delete are as on the website.
class ContactGroupsScreen extends StatefulWidget {
  const ContactGroupsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<ContactGroupsScreen> createState() => _ContactGroupsScreenState();
}

class _ContactGroupsScreenState extends State<ContactGroupsScreen> with HrScreenState {
  List<ContactGroup> _groups = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() => guardedLoad(() async {
        _groups = groupsFrom(await widget.session.api.getJson(groupsPath));
      });

  Future<void> _new() async {
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => GroupFormScreen(session: widget.session)));
    if (saved == true && mounted) _load();
  }

  Future<void> _open(ContactGroup g) async {
    final changed = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => GroupMembersScreen(session: widget.session, group: g)));
    if (changed == true && mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    return PayListPage(
      title: 'Contact groups',
      loading: loading,
      error: error,
      notInPlan: notInPlan,
      onRetry: _load,
      emptyTitle: 'No groups yet',
      emptyBody: 'Groups let you message a list of contacts together.',
      emptyIcon: LucideIcons.users,
      fab: KFab(label: 'New group', onTap: _new),
      rows: [
        for (final g in _groups)
          KCard(
            child: KListRow(
              title: g.name,
              subtitle: g.description,
              leading: KAvatar(name: g.name, icon: LucideIcons.users),
              trailing: Text('${g.memberCount} ${g.memberCount == 1 ? 'contact' : 'contacts'}', style: AppText.caption),
              onTap: () => _open(g),
            ),
          ),
      ],
    );
  }
}

/// The contacts in one group: add (from the saved contacts), remove, edit and delete the group.
/// Pops `true` when the group itself changed or was deleted.
class GroupMembersScreen extends StatefulWidget {
  const GroupMembersScreen({super.key, required this.session, required this.group});

  final AppSession session;
  final ContactGroup group;

  @override
  State<GroupMembersScreen> createState() => _GroupMembersScreenState();
}

class _GroupMembersScreenState extends State<GroupMembersScreen> with HrScreenState {
  List<Contact> _members = const [];

  ContactGroup get g => widget.group;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() => guardedLoad(() async {
        _members = membersFrom(await widget.session.api.getJson(groupMembersPath(g.id)));
      });

  Future<void> _add() async {
    if (busy.contains('add')) return;
    final picked = await Navigator.of(context).push<List<Contact>>(
      MaterialPageRoute(builder: (_) => ContactPickerScreen(session: widget.session, title: 'Add contacts to ${g.name}', confirmLabel: (n) => 'Add $n ${n == 1 ? 'contact' : 'contacts'}')),
    );
    if (picked == null || picked.isEmpty || !mounted) return;
    setState(() => busy.add('add'));
    try {
      final reply = await widget.session.api.postJson(groupMembersPath(g.id), addMembersBody([for (final c in picked) c.id]));
      toast(addedMessage(reply), tone: KTone.positive);
    } on ApiException catch (e) {
      toast(e.message);
    } catch (_) {
      toast('Could not add the contacts. Try again.');
    }
    if (mounted) setState(() => busy.remove('add'));
    await _load();
  }

  Future<void> _remove(Contact c) => act(
        'remove-${c.id}',
        confirm: () => askSheet(
          context,
          title: 'Remove from group?',
          text: 'Remove ${c.title} from ${g.name}? The contact itself is kept.',
          confirmLabel: 'Remove from group',
          cancelLabel: 'Keep them',
        ),
        send: () async {
          await widget.session.api.deleteJson(groupMembersRemovePath(g.id, [c.id]));
        },
        done: '${c.title} removed from ${g.name}',
        reload: _load,
      );

  Future<void> _edit() async {
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => GroupFormScreen(session: widget.session, group: g)));
    if (saved == true && mounted) Navigator.of(context).pop(true);
  }

  Future<void> _delete() async {
    if (busy.contains('delete')) return;
    final sure = await askSheet(
      context,
      title: 'Delete group?',
      text: 'Delete ${g.name}? Its ${g.memberCount} contacts stay in your contact list.',
      confirmLabel: 'Delete group',
      cancelLabel: 'Keep it',
    );
    if (!sure || !mounted || busy.contains('delete')) return;
    setState(() => busy.add('delete'));
    try {
      await widget.session.api.deleteJson(groupDeletePath(g.id));
      if (!mounted) return;
      showKToast(context, 'Group deleted', tone: KTone.positive);
      Navigator.of(context).pop(true);
      return;
    } on ApiException catch (e) {
      toast(e.message);
    } catch (_) {
      toast('Could not delete the group. Try again.');
    }
    if (mounted) setState(() => busy.remove('delete'));
  }

  @override
  Widget build(BuildContext context) {
    return PayListPage(
      title: g.name,
      loading: loading,
      error: error,
      notInPlan: notInPlan,
      onRetry: _load,
      emptyTitle: 'No contacts in this group',
      emptyBody: 'Add contacts from your saved contacts.',
      emptyIcon: LucideIcons.users,
      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
        KIconButton(icon: LucideIcons.pencil, tooltip: 'Edit group', onTap: _edit),
        KIconButton(icon: LucideIcons.trash2, tooltip: 'Delete group', onTap: _delete),
      ]),
      header: [
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpace.md),
          child: KButton.secondary(label: 'Add contacts', icon: LucideIcons.userPlus, loading: busy.contains('add'), onPressed: busy.contains('add') ? null : _add),
        ),
      ],
      rows: [
        for (final c in _members)
          KCard(
            child: KListRow(
              title: c.title,
              subtitle: c.name == null ? null : c.phoneText,
              leading: KAvatar(name: c.title),
              trailing: KTextButton(label: 'Remove', onTap: busy.contains('remove-${c.id}') ? null : () => _remove(c)),
            ),
          ),
      ],
    );
  }
}

/// Website group modal: name, description, colour. Pops `true` after a save.
class GroupFormScreen extends StatefulWidget {
  const GroupFormScreen({super.key, required this.session, this.group});

  final AppSession session;
  final ContactGroup? group;

  @override
  State<GroupFormScreen> createState() => _GroupFormScreenState();
}

class _GroupFormScreenState extends State<GroupFormScreen> {
  late final _name = TextEditingController(text: widget.group?.name ?? '');
  late final _description = TextEditingController(text: widget.group?.description ?? '');
  late String _color = widget.group?.color ?? groupColors.first.$1;

  bool get _editing => widget.group != null;

  bool get _dirty {
    final g = widget.group;
    if (g == null) return _name.text.isNotEmpty || _description.text.isNotEmpty || _color != groupColors.first.$1;
    return _name.text != g.name || _description.text != (g.description ?? '') || _color != g.color;
  }

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      showKToast(context, 'Enter a group name', tone: KTone.negative);
      return;
    }
    final body = groupBody(id: widget.group?.id, name: _name.text, description: _description.text, color: _color);
    if (_editing) {
      await widget.session.api.putJson(groupsPath, body);
    } else {
      await widget.session.api.postJson(groupsPath, body);
    }
    if (!mounted) return;
    showKToast(context, _editing ? 'Group updated' : 'Group created', tone: KTone.positive);
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    // A colour the website does not offer (set elsewhere) is kept and shown by its code.
    final colors = [...groupColors, if (!groupColors.any((c) => c.$1 == _color)) (_color, _color)];
    return KFormScaffold(
      title: _editing ? 'Edit group' : 'New group',
      saveLabel: 'Save group',
      onSave: _save,
      dirty: _dirty,
      children: [
        KTextField(label: 'Name', controller: _name, hint: 'e.g. VIP Customers', maxLength: 100, onChanged: (_) => setState(() {})),
        KTextField(label: 'Description', controller: _description, hint: 'Optional description', maxLines: 3, maxLength: 500, onChanged: (_) => setState(() {})),
        KPickField<String>(label: 'Colour', value: _color, options: [for (final c in colors) (c.$1, c.$2)], onChanged: (v) => setState(() => _color = v)),
      ],
    );
  }
}

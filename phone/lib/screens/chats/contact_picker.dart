import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'audience_logic.dart';

/// Pick several saved contacts (search, "Load more") and return them. Used to add members to a
/// group and to choose who a campaign goes to. Only a contact's id and number are read; nothing
/// about the business is sent.
class ContactPickerScreen extends StatefulWidget {
  const ContactPickerScreen({super.key, required this.session, required this.confirmLabel, this.title = 'Choose contacts'});

  final AppSession session;

  /// The bottom button's text for the number chosen, e.g. "Add 3 contacts".
  final String Function(int count) confirmLabel;
  final String title;

  @override
  State<ContactPickerScreen> createState() => _ContactPickerScreenState();
}

class _ContactPickerScreenState extends State<ContactPickerScreen> {
  final _search = TextEditingController();
  Timer? _debounce;
  int _seq = 0;
  List<Contact> _rows = const [];
  int _total = 0;
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  bool _notInPlan = false;
  final Map<String, Contact> _picked = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final seq = ++_seq;
    setState(() {
      _loading = true;
      _error = null;
      _notInPlan = false;
    });
    try {
      final page = contactsFrom(await widget.session.api.getJson(contactsListPath(search: _search.text)));
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

  Future<void> _more() async {
    if (_loadingMore) return;
    final seq = _seq;
    setState(() => _loadingMore = true);
    try {
      final page = contactsFrom(await widget.session.api.getJson(contactsListPath(search: _search.text, offset: _rows.length)));
      if (!mounted || seq != _seq) return;
      setState(() {
        _rows = [..._rows, ...page.rows.where((r) => !_rows.any((x) => x.id == r.id))];
        _total = page.total;
      });
    } catch (_) {
      // The next tap tries again.
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  void _onSearch(String text) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      if (mounted) _load();
    });
  }

  void _toggle(Contact c) => setState(() {
        if (_picked.remove(c.id) == null) _picked[c.id] = c;
      });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          KBackBar(widget.title),
          Padding(
            padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.sm),
            child: KSearchField(controller: _search, hint: 'Search name, phone or email', onChanged: _onSearch),
          ),
          Expanded(child: _body()),
        ]),
      ),
      bottomNavigationBar: _picked.isEmpty
          ? null
          : KBottomBar(children: [Expanded(child: KButton(label: widget.confirmLabel(_picked.length), onPressed: () => Navigator.of(context).pop(_picked.values.toList())))]),
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
    if (_rows.isEmpty) {
      return ListView(children: const [KEmptyState(icon: LucideIcons.contact, title: 'No contacts found', body: 'Add contacts first, then choose them here.')]);
    }
    return ListView(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xxl * 3),
      children: [
        KCard(
          child: KDivided(children: [
            for (final c in _rows)
              KListRow(
                title: c.title,
                subtitle: c.name == null ? null : c.phoneText,
                leading: KAvatar(name: c.title),
                trailing: Icon(_picked.containsKey(c.id) ? LucideIcons.squareCheck : LucideIcons.square, size: 22, color: _picked.containsKey(c.id) ? AppColors.brand : AppColors.ink3),
                onTap: () => _toggle(c),
              ),
          ]),
        ),
        Padding(padding: const EdgeInsets.only(top: AppSpace.sm), child: Text('Showing ${_rows.length} of $_total', textAlign: TextAlign.center, style: AppText.caption)),
        if (_rows.length < _total)
          Padding(
            padding: const EdgeInsets.only(top: AppSpace.sm),
            child: KButton.secondary(label: _loadingMore ? 'Loading…' : 'Load more', expand: false, onPressed: _loadingMore ? null : _more),
          ),
      ],
    );
  }
}

/// Pick several contact groups and return them (website "Select Contact Groups").
class GroupPickerScreen extends StatefulWidget {
  const GroupPickerScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<GroupPickerScreen> createState() => _GroupPickerScreenState();
}

class _GroupPickerScreenState extends State<GroupPickerScreen> {
  List<ContactGroup> _groups = const [];
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;
  final Map<String, ContactGroup> _picked = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _notInPlan = false;
    });
    try {
      final groups = groupsFrom(await widget.session.api.getJson(groupsPath));
      if (!mounted) return;
      setState(() {
        _groups = groups;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not reach the server.';
        _loading = false;
      });
    }
  }

  void _toggle(ContactGroup g) => setState(() {
        if (_picked.remove(g.id) == null) _picked[g.id] = g;
      });

  @override
  Widget build(BuildContext context) {
    final n = _picked.length;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const KBackBar('Choose groups'),
          Expanded(child: _body()),
        ]),
      ),
      bottomNavigationBar: n == 0
          ? null
          : KBottomBar(children: [Expanded(child: KButton(label: 'Use $n ${n == 1 ? 'group' : 'groups'}', onPressed: () => Navigator.of(context).pop(_picked.values.toList())))]),
    );
  }

  Widget _body() {
    if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: AppSpace.xxl * 2));
    if (_error != null) {
      return ListView(children: [
        KEmptyState(
          icon: _notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
          title: _notInPlan ? 'Not included in your current plan' : 'Could not load groups',
          body: _error,
          action: _notInPlan ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
        ),
      ]);
    }
    if (_groups.isEmpty) {
      return ListView(children: const [KEmptyState(icon: LucideIcons.users, title: 'No contact groups found', body: 'Create groups in Contacts first.')]);
    }
    return ListView(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xxl * 3),
      children: [
        KCard(
          child: KDivided(children: [
            for (final g in _groups)
              KListRow(
                title: g.name,
                subtitle: '${g.memberCount} ${g.memberCount == 1 ? 'contact' : 'contacts'}',
                leading: KAvatar(name: g.name, icon: LucideIcons.users),
                trailing: Icon(_picked.containsKey(g.id) ? LucideIcons.squareCheck : LucideIcons.square, size: 22, color: _picked.containsKey(g.id) ? AppColors.brand : AppColors.ink3),
                onTap: () => _toggle(g),
              ),
          ]),
        ),
      ],
    );
  }
}

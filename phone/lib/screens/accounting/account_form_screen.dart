import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../docs/doc_logic.dart';
import 'books_logic.dart';

/// Add an account (`accountId` null: `components/accounts/AccountCreateForm.tsx`, `POST /api/accounts`)
/// or edit one (`accounts/[id]/edit/page.tsx`, `PATCH /api/accounts/[id]` with only the changed fields).
///
/// The business and the user come from the session on the server; nothing here sends them. A refusal
/// by the server is shown as a toast and the form stays filled.
///
/// Left to the website: the Profit & Loss section and Schedule III line, and changing an existing
/// account's group (the website re-derives the P&L section when the group changes).
class AccountFormScreen extends StatefulWidget {
  const AccountFormScreen({super.key, required this.session, this.accountId});

  final AppSession session;
  final String? accountId;

  @override
  State<AccountFormScreen> createState() => _AccountFormScreenState();
}

class _AccountFormScreenState extends State<AccountFormScreen> {
  final _code = TextEditingController();
  final _name = TextEditingController();
  final _opening = TextEditingController();
  final _description = TextEditingController();
  final _groupText = TextEditingController();

  List<Map<String, dynamic>> _groups = const [];
  List<Map<String, dynamic>> _accounts = const [];
  Map<String, dynamic>? _old;

  String _groupId = '';
  String _type = '';
  bool _sub = false;
  String _parentId = '';
  String _side = 'debit';
  bool _sideTouched = false;
  bool _active = true;
  String? _problem;

  bool _loading = true;
  String? _loadError;

  bool get _editing => widget.accountId != null;

  @override
  void initState() {
    super.initState();
    for (final c in [_code, _name, _opening, _description]) {
      c.addListener(_refresh);
    }
    _load();
  }

  @override
  void dispose() {
    _code.dispose();
    _name.dispose();
    _opening.dispose();
    _description.dispose();
    _groupText.dispose();
    super.dispose();
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    final api = widget.session.api;
    try {
      final groups = await api.getData('/api/accounts/groups');
      final accounts = await api.getData('/api/accounts');
      Map<String, dynamic>? old;
      if (_editing) {
        final body = await api.getData('/api/accounts/${widget.accountId}');
        final a = body is Map ? body['account'] : null;
        old = a is Map ? Map<String, dynamic>.from(a) : null;
        if (old == null) throw ApiException('Account not found');
      }
      if (!mounted) return;
      setState(() {
        _groups = docRows(groups, 'groups');
        _accounts = docRows(accounts, 'accounts');
        _old = old;
        if (old != null) {
          _code.text = docText(old['account_code']);
          _name.text = docText(old['account_name']);
          final amount = docNum(old['opening_balance']) ?? 0;
          _opening.text = amount == 0 ? '' : jsNumberString(amount);
          _side = docText(old['opening_balance_type']) == 'credit' ? 'credit' : 'debit';
          _description.text = docText(old['description']);
          _active = old['is_active'] != false;
          _groupId = docText(old['account_group_id']);
          _type = docText(old['account_type']);
          _parentId = docText(old['parent_account_id']);
          _sub = _parentId.isNotEmpty;
          final g = _groups.where((g) => docText(g['id']) == _groupId);
          _groupText.text = g.isEmpty ? (docText(old['account_group_name']).isEmpty ? _type : docText(old['account_group_name'])) : groupPathLabel(_groups, g.first);
        }
        _loading = false;
      });
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _loadError = e.message;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _loadError = 'Could not reach the server.';
          _loading = false;
        });
      }
    }
  }

  List<Map<String, dynamic>> get _eligibleGroups => [
        for (final g in _groups)
          if (natureForAccountType(docText(g['group_type'])) != null) g,
      ];

  String get _suggested => _type.isEmpty ? '' : suggestNextAccountCode([for (final a in _accounts) docText(a['account_code'])], _type);

  /// This account and everything under it cannot be its own parent.
  Set<String> get _excluded {
    final out = <String>{};
    final id = widget.accountId;
    if (id == null) return out;
    out.add(id);
    var grew = true;
    while (grew) {
      grew = false;
      for (final a in _accounts) {
        if (out.contains(docText(a['parent_account_id'])) && out.add(docText(a['id']))) grew = true;
      }
    }
    return out;
  }

  List<(String, String)> get _parentOptions {
    final skip = _excluded;
    return [
      for (final a in _accounts)
        if (docText(a['account_type']) == _type && !skip.contains(docText(a['id']))) (docText(a['id']), '${docText(a['account_code'])} ${docText(a['account_name'])}'),
    ];
  }

  void _chooseGroup(String id) {
    final g = _groups.firstWhere((g) => docText(g['id']) == id);
    final type = docText(g['group_type']);
    setState(() {
      if (type != _type) {
        _parentId = '';
        _sub = false;
      }
      _groupId = id;
      _type = type;
      if (!_sideTouched) _side = natureForAccountType(type) ?? 'debit';
      _problem = null;
    });
  }

  bool get _dirty {
    final old = _old;
    if (old == null) return _groupId.isNotEmpty || _name.text.isNotEmpty || _code.text.isNotEmpty || _opening.text.isNotEmpty || _sub;
    return _changes.isNotEmpty;
  }

  Map<String, dynamic> get _changes => accountEditChanges(
        _old ?? const {},
        code: _code.text,
        name: _name.text,
        parentId: _sub ? _parentId : '',
        openingText: _opening.text,
        openingType: _side,
        description: _description.text,
        active: _active,
      );

  Future<void> _save() async {
    final old = _old;
    if (old == null) {
      final problem = accountCreateProblem(
        name: _name.text,
        groupId: _groupId,
        code: _code.text.trim().isEmpty ? _suggested : _code.text,
        openingText: _opening.text,
        subAccount: _sub,
        parentId: _parentId,
      );
      if (problem != null) return setState(() => _problem = problem);
      setState(() => _problem = null);
      await widget.session.api.postJson(
        '/api/accounts',
        accountCreateBody(
          code: _code.text,
          suggestedCode: _suggested,
          name: _name.text,
          type: _type,
          groupId: _groupId,
          parentId: _sub ? _parentId : null,
          openingText: _opening.text,
          openingType: _side,
        ),
      );
      if (mounted) Navigator.of(context).pop(true);
      return;
    }
    final problem = accountEditProblem(code: _code.text, name: _name.text, openingText: _opening.text);
    if (problem != null) return setState(() => _problem = problem);
    setState(() => _problem = null);
    final changes = _changes;
    if (changes.isEmpty) {
      if (mounted) Navigator.of(context).pop();
      return;
    }
    await widget.session.api.patchJson('/api/accounts/${widget.accountId}', changes);
    if (mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final title = _editing ? 'Edit account' : 'Add account';
    if (_loading || _loadError != null || (_old != null && accountIsSystem(_old!))) {
      return Scaffold(
        backgroundColor: AppColors.bg,
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              KBackBar(title),
              Expanded(
                child: _loading
                    ? const KSpinner(padding: EdgeInsets.symmetric(vertical: 64))
                    : _loadError != null
                        ? ListView(children: [
                            KEmptyState(
                              icon: LucideIcons.cloudOff,
                              title: 'Could not load the account form',
                              body: _loadError,
                              action: KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
                            ),
                          ])
                        : const KEmptyState(icon: LucideIcons.lock, title: 'System accounts cannot be edited', body: 'Their code, name and group are fixed.'),
              ),
            ],
          ),
        ),
      );
    }

    final suggested = _suggested;
    final groupLabels = [
      for (final g in _eligibleGroups) (docText(g['id']), '${docText(g['group_code'])} ${groupPathLabel(_groups, g)}'),
    ];
    return KFormScaffold(
      title: title,
      saveLabel: _editing ? 'Save changes' : 'Save',
      dirty: _dirty,
      onSave: _save,
      children: [
        if (_editing)
          KTextField(label: 'Account type', controller: _groupText, enabled: false)
        else
          KPickField<String>(label: 'Account type', value: _groupId.isEmpty ? null : _groupId, options: groupLabels, searchable: true, onChanged: _chooseGroup),
        KTextField(label: 'Account name', controller: _name, hint: 'e.g. Electricity expense', textCapitalization: TextCapitalization.words),
        KToggleField(
          label: 'Make this a sub-account',
          value: _sub,
          onChanged: (v) => setState(() {
            _sub = v;
            if (!v) _parentId = '';
          }),
        ),
        if (_sub)
          KPickField<String>(
            label: 'Parent account',
            value: _parentId.isEmpty ? null : _parentId,
            options: _parentOptions,
            searchable: true,
            onChanged: (v) => setState(() {
              _parentId = v;
              _problem = null;
            }),
          ),
        KTextField(
          label: 'Account code',
          controller: _code,
          hint: _editing ? null : (suggested.isEmpty ? 'Optional' : 'Suggested $suggested'),
          mono: true,
        ),
        if (_editing)
          Text('The code can only change while the account has no transactions.', style: AppText.caption)
        else
          Text(suggested.isEmpty ? 'Choose an account type to see the next free code.' : 'Leave this blank to use the suggested code. The server still rejects a code that is already used.', style: AppText.caption),
        KAmountField(label: 'Opening balance', controller: _opening),
        KSegmented<String>(
          value: _side,
          options: const [('debit', 'Dr'), ('credit', 'Cr')],
          onChanged: (v) => setState(() {
            _side = v;
            _sideTouched = true;
          }),
        ),
        Text('Zero does not post an opening entry. Saving a new amount replaces the existing opening entry.', style: AppText.caption),
        if (_editing) ...[
          KTextField(label: 'Description', controller: _description, maxLines: 3, minLines: 2),
          KToggleField(label: 'Active', value: _active, help: _active ? null : 'Inactive accounts cannot be picked for new entries. Past amounts still appear in reports.', onChanged: (v) => setState(() => _active = v)),
        ],
        if (_problem != null) Text(_problem!, style: AppText.body.copyWith(color: AppColors.negative)),
      ],
    );
  }
}

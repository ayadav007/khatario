import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';

/// Where the operating expense accounts come from (the website's category form asks for the same).
const _accountsPath = '/api/accounts?account_type=expense&is_active=true&pl_section=operating_expense&limit=500&page=1';

/// Add (when [existing] is null) or edit a category in a sheet. Returns the saved category, or
/// null when closed or nothing changed. `POST /api/expense-categories` takes `name`,
/// `description`, `account_id`; `PATCH /api/expense-categories/[id]` the same, only changed keys.
Future<Map<String, dynamic>?> showExpenseCategorySheet(BuildContext context, AppSession session, {Map<String, dynamic>? existing}) {
  return showKSheet<Map<String, dynamic>>(
    context,
    title: existing == null ? 'Add category' : 'Edit category',
    scrollable: true,
    builder: (ctx) => _CategorySheet(session: session, existing: existing),
  );
}

class _CategorySheet extends StatefulWidget {
  const _CategorySheet({required this.session, this.existing});

  final AppSession session;
  final Map<String, dynamic>? existing;

  @override
  State<_CategorySheet> createState() => _CategorySheetState();
}

class _CategorySheetState extends State<_CategorySheet> {
  final _name = TextEditingController();
  final _description = TextEditingController();
  List<(String, String)> _accounts = const [];
  String _accountId = '';
  bool _loadingAccounts = true;
  String? _accountsError;
  String? _nameError, _accountError;
  bool _saving = false;

  Map<String, dynamic>? get _old => widget.existing;

  @override
  void initState() {
    super.initState();
    final old = _old;
    if (old != null) {
      _name.text = docText(old['name']);
      _description.text = docText(old['description']);
      _accountId = docText(old['account_id']);
    }
    _loadAccounts();
  }

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _loadAccounts() async {
    setState(() {
      _loadingAccounts = true;
      _accountsError = null;
    });
    try {
      final body = await widget.session.api.getData(_accountsPath);
      final rows = docRows(body, 'accounts');
      if (!mounted) return;
      setState(() {
        _accounts = [
          for (final r in rows)
            if (docText(r['id']).isNotEmpty) (docText(r['id']), '${docText(r['account_code'])} — ${docText(r['account_name'])}'),
        ];
        if (_old == null && _accountId.isEmpty) {
          // The website preselects 5201 (or the first account).
          final preferred = rows.where((r) => docText(r['account_code']) == '5201');
          final pick = preferred.isNotEmpty ? preferred.first : (rows.isNotEmpty ? rows.first : null);
          if (pick != null) _accountId = docText(pick['id']);
        }
        _loadingAccounts = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _accountsError = e.message;
        _loadingAccounts = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _accountsError = 'Could not load the expense accounts.';
        _loadingAccounts = false;
      });
    }
  }

  Future<void> _save() async {
    if (_saving) return;
    final name = _name.text.trim();
    final adding = _old == null;
    setState(() {
      _nameError = name.isEmpty ? 'Enter a category name' : null;
      _accountError = adding && _accountId.isEmpty ? 'Choose an operating expense account' : null;
    });
    if (_nameError != null || _accountError != null) return;
    final api = widget.session.api;
    setState(() => _saving = true);
    try {
      Map<String, dynamic> reply;
      if (adding) {
        final description = _description.text.trim();
        reply = await api.postJson('/api/expense-categories', {
          'name': name,
          if (description.isNotEmpty) 'description': description,
          'account_id': _accountId,
        });
      } else {
        final old = _old!;
        final changes = <String, dynamic>{
          if (name != docText(old['name']).trim()) 'name': name,
          if (_description.text.trim() != docText(old['description']).trim()) 'description': _description.text.trim(),
          if (_accountId.isNotEmpty && _accountId != docText(old['account_id'])) 'account_id': _accountId,
        };
        if (changes.isEmpty) {
          if (mounted) Navigator.of(context).pop();
          return;
        }
        reply = await api.patchJson('/api/expense-categories/${old['id']}', changes);
      }
      final saved = reply['category'];
      if (mounted) {
        Navigator.of(context).pop(saved is Map ? Map<String, dynamic>.from(saved) : <String, dynamic>{...?_old, 'name': name});
      }
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not save. Try again.', tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final adding = _old == null;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          KTextField(label: 'Category name', controller: _name, hint: 'e.g. Travel, Utilities, Rent', error: _nameError),
          const SizedBox(height: AppSpace.md),
          KTextField(label: 'Description', controller: _description, hint: 'Optional'),
          const SizedBox(height: AppSpace.md),
          if (_loadingAccounts)
            const KSpinner(padding: EdgeInsets.symmetric(vertical: AppSpace.md))
          else if (_accountsError != null) ...[
            Text(_accountsError!, style: AppText.caption.copyWith(color: AppColors.negative)),
            KTextButton(label: 'Try again', onTap: _loadAccounts),
          ] else ...[
            KPickField<String>(
              label: 'Expense account',
              value: _accountId.isEmpty ? null : _accountId,
              options: _accounts,
              searchable: true,
              onChanged: (v) => setState(() {
                _accountId = v;
                _accountError = null;
              }),
            ),
            if (_accountError != null)
              Padding(
                padding: const EdgeInsets.only(top: 6, left: 2),
                child: Text(_accountError!, style: AppText.caption.copyWith(color: AppColors.negative)),
              ),
            Padding(
              padding: const EdgeInsets.only(top: 6, left: 2),
              child: Text(
                adding ? 'Expenses in this category debit this account.' : 'Expenses in this category post to this account.',
                style: AppText.caption,
              ),
            ),
          ],
          const SizedBox(height: AppSpace.lg),
          KButton(label: adding ? 'Save category' : 'Save changes', loading: _saving, onPressed: _saving ? null : _save),
        ],
      ),
    );
  }
}

/// `app/(app)/expenses/categories/page.tsx`: the categories, add and edit. Rows come from
/// `GET /api/expense-categories` (`categories`).
class ExpenseCategoriesScreen extends StatefulWidget {
  const ExpenseCategoriesScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<ExpenseCategoriesScreen> createState() => _ExpenseCategoriesScreenState();
}

class _ExpenseCategoriesScreenState extends State<ExpenseCategoriesScreen> {
  List<Map<String, dynamic>> _rows = const [];
  bool _loading = true;
  bool _notInPlan = false;
  String? _error;
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool spinner = true}) async {
    final seq = ++_seq;
    if (spinner) {
      setState(() {
        _loading = true;
        _error = null;
        _notInPlan = false;
      });
    }
    try {
      final body = await widget.session.api.getData('/api/expense-categories');
      if (!mounted || seq != _seq) return;
      setState(() {
        _rows = docRows(body, 'categories');
        _loading = false;
        _error = null;
      });
    } on ApiException catch (e) {
      if (!mounted || seq != _seq) return;
      if (!spinner && _rows.isNotEmpty) return showKToast(context, e.message, tone: KTone.negative);
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || seq != _seq) return;
      if (!spinner && _rows.isNotEmpty) return showKToast(context, 'Could not reach the server.', tone: KTone.negative);
      setState(() {
        _error = 'Could not reach the server.';
        _loading = false;
      });
    }
  }

  Future<void> _open({Map<String, dynamic>? existing}) async {
    final saved = await showExpenseCategorySheet(context, widget.session, existing: existing);
    if (saved != null && mounted) {
      showKToast(context, existing == null ? 'Category added' : 'Category updated', tone: KTone.positive);
      _load(spinner: false);
    }
  }

  static String _ledger(Map<String, dynamic> r) {
    final code = docText(r['ledger_account_code']);
    return code.isEmpty ? 'Default generic expense account' : '$code — ${docText(r['ledger_account_name'])}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Stack(
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const KBackBar('Expense categories'),
                Expanded(child: _body()),
              ],
            ),
            if (!_loading && _error == null)
              Positioned(
                right: AppSpace.gutter,
                bottom: AppSpace.lg,
                child: KFab(label: 'Add category', onTap: _open),
              ),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
    if (_error != null) {
      return ListView(children: [
        if (_notInPlan)
          const KEmptyState(icon: LucideIcons.lock, title: 'Not included in your current plan')
        else
          KEmptyState(
            icon: LucideIcons.cloudOff,
            title: 'Could not load expense categories',
            body: _error,
            action: KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
          ),
      ]);
    }
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: () => _load(spinner: false),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(bottom: 112, top: AppSpace.xs),
        children: [
          if (_rows.isEmpty)
            const KEmptyState(icon: LucideIcons.tag, title: 'No expense categories yet', body: 'Add a category to organize your expenses.')
          else
            KCard(
              margin: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
              child: KDivided(indent: 66, children: [
                for (final r in _rows)
                  KListRow(
                    title: docText(r['name']),
                    subtitle: _ledger(r),
                    leading: const KAvatar(name: '', icon: LucideIcons.tag, muted: true),
                    trailing: Icon(LucideIcons.pencil, size: 18, color: AppColors.ink3),
                    onTap: () => _open(existing: r),
                  ),
              ]),
            ),
        ],
      ),
    );
  }
}

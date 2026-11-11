import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';
import 'account_form_screen.dart';
import 'account_ledger_screen.dart';
import 'books_logic.dart';

/// `app/(app)/accounts/page.tsx`: the chart of accounts, grouped by account group.
///
/// Rows come from `GET /api/accounts` (no paging parameters, so the route returns every account),
/// the groups from `GET /api/accounts/groups`, and the balance on each row from
/// `GET /api/accounts/my-accounts` (`closing`, `balance_side`), which is the website's own list of
/// balances. The phone shows those figures and adds nothing up. An account the balances route
/// does not list has never been posted to and shows no balance.
class AccountsScreen extends StatefulWidget {
  const AccountsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<AccountsScreen> createState() => _AccountsScreenState();
}

class _AccountsScreenState extends State<AccountsScreen> {
  final _search = TextEditingController();
  List<Map<String, dynamic>> _accounts = const [];
  List<Map<String, dynamic>> _groups = const [];
  Map<String, AccountBalance> _balances = const {};
  String _type = '';
  bool _loading = true;
  bool _notInPlan = false;
  String? _error;
  bool _busy = false;
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

  Future<void> _load({bool spinner = true}) async {
    final seq = ++_seq;
    if (spinner) {
      setState(() {
        _loading = true;
        _error = null;
        _notInPlan = false;
      });
    }
    final api = widget.session.api;
    // Groups and balances only decorate the list: if either fails the accounts still show.
    final groups = api.getData('/api/accounts/groups').then<dynamic>((b) => b, onError: (_) => null);
    final balances = api.getData('/api/accounts/my-accounts').then<dynamic>((b) => b, onError: (_) => null);
    try {
      final body = await api.getData('/api/accounts');
      final g = await groups;
      final b = await balances;
      if (!mounted || seq != _seq) return;
      setState(() {
        _accounts = docRows(body, 'accounts');
        _groups = docRows(g, 'groups');
        _balances = accountBalances(b);
        _loading = false;
        _error = null;
        _notInPlan = false;
      });
    } on ApiException catch (e) {
      if (!mounted || seq != _seq) return;
      if (!spinner && _accounts.isNotEmpty) return showKToast(context, e.message, tone: KTone.negative);
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || seq != _seq) return;
      if (!spinner && _accounts.isNotEmpty) return showKToast(context, 'Could not reach the server.', tone: KTone.negative);
      setState(() {
        _error = 'Could not reach the server.';
        _loading = false;
      });
    }
  }

  void _openLedger(Map<String, dynamic> a) {
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => AccountLedgerScreen(session: widget.session, accountId: docText(a['id']), accountName: docText(a['account_name'])),
    ));
  }

  Future<void> _openForm({String? accountId}) async {
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute<bool>(
      builder: (_) => AccountFormScreen(session: widget.session, accountId: accountId),
    ));
    if (saved == true && mounted) {
      showKToast(context, accountId == null ? 'Account added' : 'Account updated', tone: KTone.positive);
      _load(spinner: false);
    }
  }

  Future<void> _actions(Map<String, dynamic> a) async {
    final name = docText(a['account_name']);
    final choice = await showKSheet<String>(
      context,
      title: name,
      builder: (ctx) => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          KSheetAction(icon: LucideIcons.bookOpen, label: 'View ledger', onTap: () => Navigator.of(ctx).pop('ledger')),
          if (accountCanEdit(a)) KSheetAction(icon: LucideIcons.pencil, label: 'Edit', onTap: () => Navigator.of(ctx).pop('edit')),
          if (accountCanDeactivate(a)) KSheetAction(icon: LucideIcons.ban, label: 'Deactivate', danger: true, onTap: () => Navigator.of(ctx).pop('deactivate')),
        ],
      ),
    );
    if (!mounted || choice == null) return;
    switch (choice) {
      case 'ledger':
        _openLedger(a);
      case 'edit':
        await _openForm(accountId: docText(a['id']));
      case 'deactivate':
        await _deactivate(a);
    }
  }

  /// The website's delete: it deactivates through `PATCH /api/accounts/[id]` `{is_active: false}`
  /// after asking. Existing transactions stay.
  Future<void> _deactivate(Map<String, dynamic> a) async {
    final sure = await showKSheet<bool>(
      context,
      title: 'Deactivate ${docText(a['account_name'])}?',
      builder: (ctx) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('This account will be deactivated. Existing transactions will remain intact.', style: AppText.body),
            const SizedBox(height: AppSpace.lg),
            KButton(label: 'Deactivate', kind: KButtonKind.danger, onPressed: () => Navigator.of(ctx).pop(true)),
            const SizedBox(height: AppSpace.sm),
            KButton.secondary(label: 'Cancel', onPressed: () => Navigator.of(ctx).pop(false)),
          ],
        ),
      ),
    );
    if (sure != true || !mounted || _busy) return;
    setState(() => _busy = true);
    try {
      await widget.session.api.patchJson('/api/accounts/${docText(a['id'])}', {'is_active': false});
      if (!mounted) return;
      showKToast(context, 'Account deactivated', tone: KTone.positive);
      await _load(spinner: false);
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not deactivate. Try again.', tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
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
                const KBackBar('Chart of Accounts'),
                Expanded(child: _body()),
              ],
            ),
            if (!_loading && _error == null)
              Positioned(
                right: AppSpace.gutter,
                bottom: AppSpace.lg,
                child: KFab(label: 'Add account', onTap: () => _openForm()),
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
            title: 'Could not load the chart of accounts',
            body: _error,
            action: KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
          ),
      ]);
    }
    final sections = accountSections(_accounts, _groups, query: _search.text, type: _type);
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: () => _load(spinner: false),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(bottom: 112, top: AppSpace.xs),
        children: [
          if (_accounts.isEmpty)
            const KEmptyState(icon: LucideIcons.bookOpen, title: 'No accounts yet', body: 'Add an account to start your chart.')
          else ...[
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
              child: KSearchField(controller: _search, hint: 'Search accounts', onChanged: (_) => setState(() {})),
            ),
            const SizedBox(height: AppSpace.md),
            KChipBar<String>(value: _type, options: [('', 'All'), ...kAccountTypes], onChanged: (v) => setState(() => _type = v)),
            const SizedBox(height: AppSpace.sm),
            if (sections.isEmpty)
              const KEmptyState(icon: LucideIcons.search, title: 'Nothing matches', body: 'Try another word or type.')
            else
              for (final s in sections) ...[
                Padding(padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter), child: KSectionHeader(s.name)),
                KCard(
                  margin: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
                  child: KDivided(children: [for (final a in s.rows) _row(a)]),
                ),
                const SizedBox(height: AppSpace.sm),
              ],
          ],
        ],
      ),
    );
  }

  Widget _row(Map<String, dynamic> a) {
    final name = docText(a['account_name']);
    final balance = sidedBalance(_balances[docText(a['id'])]);
    final system = accountIsSystem(a);
    final inactive = a['is_active'] == false;
    final hasActions = accountCanEdit(a) || accountCanDeactivate(a);
    return InkWell(
      onTap: () => _openLedger(a),
      highlightColor: AppColors.sunken,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 64),
        child: Padding(
          padding: const EdgeInsets.only(left: 14, top: 8, bottom: 8, right: 4),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.bodyStrong),
                    const SizedBox(height: 2),
                    Text('${docText(a['account_code'])} · ${docText(a['account_type'])}', maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.caption),
                    if (system || inactive) ...[
                      const SizedBox(height: 4),
                      Wrap(spacing: AppSpace.xs, children: [
                        if (system) const KPill(label: 'System', tone: KTone.brand),
                        if (inactive) const KPill(label: 'Inactive', tone: KTone.neutral),
                      ]),
                    ],
                  ],
                ),
              ),
              if (balance.isNotEmpty) ...[
                const SizedBox(width: AppSpace.md),
                Text(balance, style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
              ],
              if (hasActions)
                KIconButton(icon: LucideIcons.ellipsisVertical, tooltip: 'Actions for $name', onTap: _busy ? () {} : () => _actions(a))
              else
                const SizedBox(width: AppSpace.md),
            ],
          ),
        ),
      ),
    );
  }
}

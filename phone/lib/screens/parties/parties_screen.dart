import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../capability.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'customer_detail_screen.dart';
import 'party_logic.dart';
import 'supplier_detail_screen.dart';

/// `app/(app)/customers/page.tsx` and the suppliers list, on one phone screen:
/// money summary on top, Customers / Suppliers tabs, search and balance filter.
/// New parties come from the shell's floating "Add party" button.
class PartiesScreen extends StatefulWidget {
  const PartiesScreen({
    super.key,
    required this.session,
    required this.capabilities,
    required this.onOpen,
    this.onKindChanged,
    this.banners,
    this.initialKind = PartyKind.customers,
  });

  final AppSession session;
  final Capabilities? capabilities;
  final void Function(String what) onOpen;
  final ValueChanged<PartyKind>? onKindChanged;
  final Widget? banners;
  final PartyKind initialKind;

  @override
  State<PartiesScreen> createState() => _PartiesScreenState();
}

class _PartiesScreenState extends State<PartiesScreen> {
  final _search = TextEditingController();
  late PartyKind _kind = widget.initialKind;
  String _filter = 'all';
  int _page = 1;
  bool _loadingCustomers = true;
  bool _loadingSuppliers = true;
  String? _customersError;
  String? _suppliersError;
  List<Map<String, dynamic>> _customers = const [];
  List<Map<String, dynamic>> _suppliers = const [];
  String? _sendingReminder;

  KhatarioApi get _api => widget.session.api;

  @override
  void initState() {
    super.initState();
    final caps = widget.capabilities;
    if (caps != null && !caps.has('customers')) return;
    widget.onKindChanged?.call(_kind);
    _loadCustomers();
    _loadSuppliers();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _loadCustomers() async {
    try {
      final body = await _api.getJson('/api/customers');
      if (!mounted) return;
      setState(() {
        _customers = _rows(body['customers']);
        _customersError = null;
      });
    } catch (e) {
      if (mounted) setState(() => _customersError = _message(e));
    } finally {
      if (mounted) setState(() => _loadingCustomers = false);
    }
  }

  Future<void> _loadSuppliers() async {
    try {
      final body = await _api.getJson('/api/suppliers?limit=500');
      if (!mounted) return;
      setState(() {
        _suppliers = _rows(body['suppliers']);
        _suppliersError = null;
      });
    } catch (e) {
      if (mounted) setState(() => _suppliersError = _message(e));
    } finally {
      if (mounted) setState(() => _loadingSuppliers = false);
    }
  }

  Future<void> _refresh() => Future.wait([_loadCustomers(), _loadSuppliers()]);

  List<Map<String, dynamic>> _rows(dynamic value) =>
      value is List ? value.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : const [];

  String _message(Object e) => e is ApiException ? e.message : (e is DioException ? 'Could not load data.' : e.toString());

  void _setKind(PartyKind kind) {
    if (kind == _kind) return;
    setState(() {
      _kind = kind;
      _page = 1;
    });
    widget.onKindChanged?.call(kind);
  }

  Future<void> _sendReminder(Map<String, dynamic> customer) async {
    final id = customer['id']?.toString();
    if (id == null) return;
    setState(() => _sendingReminder = id);
    var message = 'Failed to send reminders. Please try again.';
    try {
      final data = await _api.postJson('/api/customers/$id/send-reminder', reminderRequestBody(widget.session.businessId));
      message = reminderOutcome(ok: true, data: data).message;
    } on ApiException catch (e) {
      message = reminderOutcome(ok: false, data: {'error': e.message}).message;
    } catch (_) {}
    if (!mounted) return;
    setState(() => _sendingReminder = null);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  void _openFilters() {
    showKPicker<String>(
      context,
      title: 'Filters',
      value: _filter,
      options: [
        ('all', _kind == PartyKind.customers ? 'All Customers' : 'All Suppliers'),
        ('with-balance', 'With Balance'),
        ('zero-balance', 'Zero Balance'),
      ],
      onChanged: (v) => setState(() {
        _filter = v;
        _page = 1;
      }),
    );
  }

  void _open(Map<String, dynamic> row) {
    final id = row['id']?.toString() ?? '';
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => _kind == PartyKind.suppliers
          ? SupplierDetailScreen(session: widget.session, supplierId: id, onOpen: widget.onOpen)
          : CustomerDetailScreen(session: widget.session, customerId: id, onOpen: widget.onOpen, capabilities: widget.capabilities),
    ));
  }

  /// Sum of positive balances: what customers owe, or what is owed to suppliers.
  num _outstanding(List<Map<String, dynamic>> rows) => rows
      .where((r) => r['is_active'] != false)
      .map((r) => partyBalance(r['current_balance'], r['opening_balance']))
      .where((b) => b > 0.005)
      .fold<num>(0, (a, b) => a + b);

  @override
  Widget build(BuildContext context) {
    final caps = widget.capabilities;
    if (caps != null && !caps.has('customers')) return const _AccessDenied();

    final customers = _kind == PartyKind.customers;
    final loading = customers ? _loadingCustomers : _loadingSuppliers;
    final error = customers ? _customersError : _suppliersError;
    final source = customers ? _customers : _suppliers;
    final filtered = filterParties(source, kind: _kind, search: _search.text, balanceFilter: _filter)
      ..sort((a, b) => (a['name']?.toString() ?? '').toLowerCase().compareTo((b['name']?.toString() ?? '').toLowerCase()));
    final shown = filtered.take(_page * partyPageSize).toList();

    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _refresh,
      child: ListView(
        padding: const EdgeInsets.only(bottom: 112),
        children: [
          ?widget.banners,
          const KPageTitle('Parties'),
          const SizedBox(height: AppSpace.md),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
            child: Row(
              children: [
                Expanded(
                  child: _MoneyTile(
                    label: 'To collect',
                    amount: _outstanding(_customers),
                    tint: AppTints.green,
                    icon: LucideIcons.arrowDownLeft,
                    loading: _loadingCustomers,
                    selected: customers && _filter == 'with-balance',
                    onTap: () {
                      _setKind(PartyKind.customers);
                      setState(() => _filter = _filter == 'with-balance' && customers ? 'all' : 'with-balance');
                    },
                  ),
                ),
                const SizedBox(width: AppSpace.md),
                Expanded(
                  child: _MoneyTile(
                    label: 'To pay',
                    amount: _outstanding(_suppliers),
                    tint: AppTints.rose,
                    icon: LucideIcons.arrowUpRight,
                    loading: _loadingSuppliers,
                    selected: !customers && _filter == 'with-balance',
                    onTap: () {
                      _setKind(PartyKind.suppliers);
                      setState(() => _filter = _filter == 'with-balance' && !customers ? 'all' : 'with-balance');
                    },
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpace.lg),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
            child: KSegmented<PartyKind>(
              value: _kind,
              options: const [(PartyKind.customers, 'Customers'), (PartyKind.suppliers, 'Suppliers')],
              onChanged: _setKind,
            ),
          ),
          const SizedBox(height: AppSpace.md),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
            child: KSearchField(
              controller: _search,
              hint: 'Name or phone',
              onChanged: (_) => setState(() => _page = 1),
              trailing: Tooltip(
                message: 'Filters',
                child: KSquareButton(icon: LucideIcons.slidersHorizontal, label: 'Filters', active: _filter != 'all', onTap: _openFilters),
              ),
            ),
          ),
          if (_filter != 'all')
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter + 2, AppSpace.sm, AppSpace.gutter, 0),
              child: Row(
                children: [
                  Flexible(
                    child: Text(
                      _filter == 'with-balance' ? 'Showing parties with a balance' : 'Showing settled parties',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.caption,
                    ),
                  ),
                  const SizedBox(width: 8),
                  KTextButton(label: 'Show all', onTap: () => setState(() => _filter = 'all')),
                ],
              ),
            ),
          const SizedBox(height: AppSpace.md),
          if (loading)
            const KSpinner(padding: EdgeInsets.symmetric(vertical: 64))
          else if (error != null && shown.isEmpty)
            KEmptyState(icon: LucideIcons.cloudOff, title: error, action: KButton.secondary(label: 'Try again', expand: false, onPressed: _refresh))
          else if (shown.isEmpty)
            KEmptyState(
              icon: LucideIcons.users,
              title: customers ? 'No customers found' : 'No suppliers found',
              body: _search.text.isNotEmpty || _filter != 'all' ? 'Try another name or filter.' : 'Add one with the button below.',
            )
          else ...[
            KCard(
              margin: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
              child: KDivided(
                indent: 66,
                children: [
                  for (final row in shown)
                    _PartyRow(
                      row: row,
                      supplier: !customers,
                      reminding: _sendingReminder == row['id']?.toString(),
                      onOpen: () => _open(row),
                      onRemind: () => _sendReminder(row),
                    ),
                ],
              ),
            ),
            if (shown.length < filtered.length)
              Padding(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.lg, AppSpace.gutter, 0),
                child: KButton.secondary(label: 'Show more (${filtered.length - shown.length} left)', onPressed: () => setState(() => _page++)),
              ),
          ],
        ],
      ),
    );
  }
}

/// "To collect" / "To pay" total that also filters the list to parties with a balance.
class _MoneyTile extends StatelessWidget {
  const _MoneyTile({
    required this.label,
    required this.amount,
    required this.tint,
    required this.icon,
    required this.loading,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final num amount;
  final (Color, Color) tint;
  final IconData icon;
  final bool loading;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      button: true,
      selected: selected,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(AppRadius.lg),
          border: Border.all(color: selected ? tint.$2 : Colors.transparent, width: 1.5),
        ),
        child: KCard(
          onTap: onTap,
          padding: const EdgeInsets.fromLTRB(14, 12, 12, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 28,
                    height: 28,
                    decoration: BoxDecoration(color: tint.$1, borderRadius: BorderRadius.circular(9)),
                    child: Icon(icon, size: 15, color: tint.$2),
                  ),
                  const SizedBox(width: 8),
                  Flexible(child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.label)),
                ],
              ),
              const SizedBox(height: 10),
              loading
                  ? Container(height: 26, width: 80, decoration: BoxDecoration(color: AppColors.sunken, borderRadius: BorderRadius.circular(6)))
                  : FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: KAmount(amount, style: AppText.amount.copyWith(fontSize: 22, height: 26 / 22), color: tint.$2),
                    ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PartyRow extends StatelessWidget {
  const _PartyRow({required this.row, required this.supplier, required this.reminding, required this.onOpen, required this.onRemind});

  final Map<String, dynamic> row;
  final bool supplier;
  final bool reminding;
  final VoidCallback onOpen;
  final VoidCallback onRemind;

  @override
  Widget build(BuildContext context) {
    final balance = partyBalance(row['current_balance'], row['opening_balance']);
    final name = row['name']?.toString() ?? '';
    final phone = row['phone']?.toString() ?? '';
    final settled = isPartyBalanceSettled(balance);
    // Customers with a positive balance owe you; suppliers with a positive balance are owed.
    final youGet = supplier ? balance < 0 : balance > 0;
    final tone = settled ? KTone.neutral : (youGet ? KTone.positive : KTone.negative);
    final caption = settled ? 'Settled' : (youGet ? "You'll get" : "You'll give");
    final showRemind = !supplier && balance > 0.005 && phone.isNotEmpty;
    return KListRow(
      onTap: onOpen,
      padding: const EdgeInsets.fromLTRB(14, 12, 4, 12),
      leading: KAvatar(name: name, muted: settled),
      title: name,
      subtitle: [if (phone.isNotEmpty) phone, if ((row['company_name']?.toString() ?? '').isNotEmpty) row['company_name'].toString()].join(' · '),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 110),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              mainAxisSize: MainAxisSize.min,
              children: [
                FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    settled ? 'Clear' : '$rupeeSign${enIn(balance.abs())}',
                    style: AppText.bodyStrong.copyWith(color: settled ? AppColors.ink3 : tone.fg, fontFeatures: AppText.tabular),
                  ),
                ),
                const SizedBox(height: 1),
                Text(caption, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.small.copyWith(fontSize: 11, color: AppColors.ink3)),
              ],
            ),
          ),
          if (showRemind)
            Tooltip(
              message: 'Remind $name',
              child: reminding
                  ? const SizedBox(width: 44, height: 44, child: KSpinner(size: 18, padding: EdgeInsets.zero))
                  : KIconButton(icon: LucideIcons.bellRing, tooltip: 'Remind $name', color: AppTints.green.$2, onTap: onRemind),
            )
          else
            const SizedBox(width: 12),
        ],
      ),
    );
  }
}

class _AccessDenied extends StatelessWidget {
  const _AccessDenied();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: SingleChildScrollView(
        child: KEmptyState(
          icon: LucideIcons.lock,
          title: 'Access to Customers is restricted',
          body: "You don't have permission to view or manage customers. Ask your organization admin to grant the right role in Settings → Roles.",
        ),
      ),
    );
  }
}

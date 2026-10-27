import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/kit.dart';
import 'hub_common.dart';
import 'new_arrivals_screen.dart';
import 'supply_orders_screen.dart';

String _matchWhy(Map<String, dynamic> match) {
  const labels = {'gstin': 'Same GSTIN', 'phone': 'Same phone', 'email': 'Same email'};
  final reasons = match['reasons'];
  final why = reasons is List ? reasons.map((r) => labels[r] ?? '$r').join(' · ') : '';
  final bits = [why, match['email']?.toString(), match['phone']?.toString(), match['gstin']?.toString()]
      .where((s) => s != null && s.isNotEmpty)
      .join(' · ');
  return bits;
}

/// Find suppliers in the Suppliers Hub and ask to connect.
class HubDirectoryScreen extends StatefulWidget {
  const HubDirectoryScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<HubDirectoryScreen> createState() => _HubDirectoryScreenState();
}

class _HubDirectoryScreenState extends State<HubDirectoryScreen> {
  final _q = TextEditingController();
  List<Map<String, dynamic>> _rows = const [];
  bool _loading = true;
  String? _error;
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _q.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final q = Uri.encodeQueryComponent(_q.text.trim());
      final body = await widget.session.api.getJson('/api/suppliers/hub/directory?q=$q&limit=50');
      if (mounted) setState(() => _rows = hubList(body['businesses']));
    } on ApiException catch (e) {
      if (mounted) setState(() { _rows = const []; _error = e.message; });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: RefreshIndicator(
          color: AppColors.brand,
          onRefresh: _load,
          child: ListView(
            padding: const EdgeInsets.only(top: 8, bottom: 48),
            children: [
              HubTitleBar(
                'Suppliers Hub',
                trailing: KIconButton(
                  icon: LucideIcons.userCheck,
                  tooltip: 'Connection requests',
                  onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ConnectionRequestsScreen(session: widget.session))),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.md, AppSpace.gutter, 0),
                child: KSearchField(
                  controller: _q,
                  hint: 'Name, city or GSTIN',
                  onChanged: (_) {
                    _debounce?.cancel();
                    _debounce = Timer(const Duration(milliseconds: 350), _load);
                  },
                ),
              ),
              if (_loading)
                const KSpinner(padding: EdgeInsets.symmetric(vertical: 64))
              else if (_error != null)
                KEmptyState(icon: LucideIcons.circleAlert, title: 'Could not load', body: _error)
              else if (_rows.isEmpty)
                const KEmptyState(icon: LucideIcons.store, title: 'No suppliers found', body: 'Try another name or city.')
              else
                KCard(
                  margin: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.lg, AppSpace.gutter, 0),
                  child: KDivided(
                    indent: 66,
                    children: [
                      for (final b in _rows)
                        KListRow(
                          leading: KAvatar(name: b['name']?.toString() ?? ''),
                          title: b['name']?.toString() ?? '',
                          subtitle: [
                            [hubText(b['trust'] is Map ? b['trust']['district'] : null) ?? b['city'], b['state']].whereType<Object>().join(', '),
                            ...hubTrustFacts(b['trust']).take(2),
                            ...(b['featured_categories'] is List ? (b['featured_categories'] as List).take(2).map((e) => e.toString()) : const <String>[]),
                          ].where((s) => s.isNotEmpty).join(' · '),
                          onTap: () => Navigator.of(context).push(MaterialPageRoute(
                            builder: (_) => HubProfileScreen(session: widget.session, businessId: b['id'].toString()),
                          )),
                        ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A supplier's hub profile: what they sell, and connect / order.
class HubProfileScreen extends StatefulWidget {
  const HubProfileScreen({super.key, required this.session, required this.businessId});

  final AppSession session;
  final String businessId;

  @override
  State<HubProfileScreen> createState() => _HubProfileScreenState();
}

class _HubProfileScreenState extends State<HubProfileScreen> {
  Map<String, dynamic>? _profile;
  bool _loading = true;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final body = await widget.session.api.getJson('/api/suppliers/hub/profile/${widget.businessId}');
      if (mounted) setState(() => _profile = body);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _connect() async {
    final message = TextEditingController();
    var shareLowStock = true;
    final ok = await showKSheet<bool>(
      context,
      title: 'Ask to connect',
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => Padding(
          padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 4, AppSpace.gutter, AppSpace.md),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text('Once they accept, their bills come straight into your purchases and you can order from them here.', style: AppText.caption),
            const SizedBox(height: AppSpace.sm),
            TextField(controller: message, maxLines: 3, decoration: const InputDecoration(labelText: 'Message (optional)')),
            const SizedBox(height: AppSpace.sm),
            SwitchListTile.adaptive(
              contentPadding: EdgeInsets.zero,
              value: shareLowStock,
              onChanged: (v) => setSheet(() => shareLowStock = v),
              title: Text('Share stock and sales with them', style: AppText.bodyStrong),
              subtitle: Text(
                'They are told when their items reach your reorder level and can propose an order. '
                'Your sales of their items count in their area totals, never shown as your shop alone.',
                style: AppText.caption,
              ),
            ),
            const SizedBox(height: AppSpace.md),
            KButton(label: 'Send request', onPressed: () => Navigator.pop(ctx, true)),
          ]),
        ),
      ),
    );
    if (ok == true && mounted) {
      setState(() => _busy = true);
      try {
        await widget.session.api.postJson('/api/suppliers/hub/connection-requests', {
          'supplier_business_id': widget.businessId,
          'message': message.text.trim(),
          'share_low_stock': shareLowStock,
        });
        if (mounted) hubSnack(context, 'Request sent');
        await _load();
      } on ApiException catch (e) {
        if (mounted) hubSnack(context, e.message);
      } finally {
        if (mounted) setState(() => _busy = false);
      }
    }
    message.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = _profile;
    if (p == null) {
      return Scaffold(
        backgroundColor: AppColors.bg,
        body: SafeArea(
          child: _loading
              ? const KSpinner(padding: EdgeInsets.symmetric(vertical: 80))
              : Column(children: [const HubTitleBar('Supplier'), KEmptyState(icon: LucideIcons.circleAlert, title: 'Could not load', body: _error)]),
        ),
      );
    }
    final business = hubMap(p['business']);
    final discovery = hubMap(p['discovery']);
    final viewer = hubMap(p['viewer']);
    final linked = viewer['is_linked'] == true;
    final pending = hubText(viewer['pending_request_id']) != null;
    final supplierRecord = hubText(viewer['supplier_record_id']);
    final listings = hubList(p['listings']);
    final name = business['name']?.toString() ?? 'Supplier';

    return Scaffold(
      backgroundColor: AppColors.bg,
      bottomNavigationBar: KBottomBar(children: [
        if (linked && supplierRecord != null) ...[
          Expanded(
            child: KButton.secondary(
              label: 'New arrivals',
              icon: LucideIcons.sparkles,
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => NewArrivalsScreen(session: widget.session, supplierId: supplierRecord))),
            ),
          ),
          Expanded(
            child: KButton(
              label: 'New order',
              icon: LucideIcons.packagePlus,
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => NewSupplyOrderScreen(session: widget.session, supplierId: supplierRecord, supplierName: name),
              )),
            ),
          ),
        ] else if (pending)
          const Expanded(child: KButton.secondary(label: 'Request sent', onPressed: null))
        else
          Expanded(child: KButton(label: 'Ask to connect', icon: LucideIcons.userPlus, loading: _busy, onPressed: _connect)),
      ]),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.only(top: 8, bottom: 48),
          children: [
            HubTitleBar(name),
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.md, AppSpace.gutter, 0),
              child: KInfoCard(title: 'About', rows: [
                if ([business['city'], business['state']].any((v) => v != null)) ('Location', [business['city'], business['state']].whereType<Object>().join(', ')),
                if (hubText(business['gstin']) != null) ('GSTIN', business['gstin'].toString()),
                if (hubTrustFacts(p['trust']).isNotEmpty) ('Track record', hubTrustFacts(p['trust']).join(' · ')),
                if (hubText(discovery['profile_summary']) != null) ('About', discovery['profile_summary'].toString()),
                if (discovery['featured_categories'] is List && (discovery['featured_categories'] as List).isNotEmpty)
                  ('Sells', (discovery['featured_categories'] as List).join(', ')),
                ('Status', linked ? 'Connected' : pending ? 'Request sent' : 'Not connected'),
              ]),
            ),
            if (listings.isNotEmpty) ...[
              const KSectionHeader('Catalog'),
              KCard(
                margin: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
                child: KDivided(children: [
                  for (final l in listings)
                    KListRow(
                      title: hubText(l['display_name']) ?? l['item_name']?.toString() ?? '',
                      subtitle: [
                        if (toNum(l['moq']) > 0) 'Min ${qtyText(toNum(l['moq']))}',
                        ?hubText(l['lead_time_text']),
                        if (l['price_display'] == 'from_amount' && l['from_amount'] != null) 'From ${inr(toNum(l['from_amount']))}',
                        if (l['price_display'] == 'on_request') 'Price on request',
                      ].join(' · '),
                    ),
                ]),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Incoming requests to accept as a supplier, and requests this business sent.
class ConnectionRequestsScreen extends StatefulWidget {
  const ConnectionRequestsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<ConnectionRequestsScreen> createState() => _ConnectionRequestsScreenState();
}

class _ConnectionRequestsScreenState extends State<ConnectionRequestsScreen> {
  String _tab = 'incoming';
  List<Map<String, dynamic>> _incoming = const [];
  List<Map<String, dynamic>> _outgoing = const [];
  bool _loading = true;
  String? _busyId;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final body = await widget.session.api.getJson('/api/suppliers/hub/connection-requests');
      if (!mounted) return;
      setState(() {
        _incoming = hubList(body['incoming']);
        _outgoing = hubList(body['outgoing']);
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _accept(Map<String, dynamic> r) async {
    final id = r['id']?.toString();
    if (id == null) return;
    setState(() => _busyId = id);
    Map<String, dynamic> preview;
    try {
      preview = await widget.session.api.getJson('/api/suppliers/hub/connection-requests/$id');
    } on ApiException catch (e) {
      if (mounted) hubSnack(context, e.message);
      if (mounted) setState(() => _busyId = null);
      return;
    }
    if (!mounted) return;
    setState(() => _busyId = null);

    final buyer = preview['buyer'] is Map ? Map<String, dynamic>.from(preview['buyer'] as Map) : <String, dynamic>{};
    final name = buyer['name']?.toString() ?? 'this shop';
    final already = preview['already_linked'] is Map;
    final matches = <Map<String, dynamic>>[
      for (final row in (preview['matches'] as List? ?? const []))
        if (row is Map) Map<String, dynamic>.from(row),
    ];

    final decision = await showKSheet<Map<String, dynamic>>(
      context,
      title: 'Connect $name',
      scrollable: true,
      builder: (ctx) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              already
                  ? 'This shop is already a customer. Accepting keeps that record.'
                  : matches.isEmpty
                      ? 'Nothing on your books matches this shop. Create a customer only if you want to connect.'
                      : 'A customer on your books matches this shop. Connect that customer, or create a new one.',
              style: AppText.body,
            ),
            const SizedBox(height: AppSpace.md),
            if (!already)
              for (final m in matches) ...[
                Text(_matchWhy(m), style: AppText.caption),
                const SizedBox(height: 6),
                KButton(
                  label: 'Connect to ${m['name'] ?? 'this customer'}',
                  onPressed: () => Navigator.pop(ctx, {'choice': 'link', 'customer_id': m['id']}),
                ),
                const SizedBox(height: AppSpace.sm),
              ],
            if (!already)
              matches.isEmpty
                  ? KButton(label: 'Create $name', onPressed: () => Navigator.pop(ctx, {'choice': 'create'}))
                  : KButton.secondary(label: 'Create $name', onPressed: () => Navigator.pop(ctx, {'choice': 'create'})),
            if (already) KButton(label: 'Accept connection', onPressed: () => Navigator.pop(ctx, <String, dynamic>{})),
          ],
        ),
      ),
    );
    if (decision == null || !mounted) return;
    setState(() => _busyId = id);
    try {
      final body = <String, dynamic>{'action': 'accept'};
      if (decision.isNotEmpty) body['customer_decision'] = decision;
      await widget.session.api.patchJson('/api/suppliers/hub/connection-requests/$id', body);
      if (mounted) hubSnack(context, 'Connected');
      await _load();
    } on ApiException catch (e) {
      if (mounted) hubSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _resolve(Map<String, dynamic> r, String action) async {
    setState(() => _busyId = r['id']?.toString());
    try {
      await widget.session.api.patchJson('/api/suppliers/hub/connection-requests/${r['id']}', {'action': action});
      if (mounted) hubSnack(context, action == 'accept' ? 'Connected' : action == 'decline' ? 'Declined' : 'Withdrawn');
      await _load();
    } on ApiException catch (e) {
      if (mounted) hubSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = _tab == 'incoming' ? _incoming : _outgoing;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: RefreshIndicator(
          color: AppColors.brand,
          onRefresh: _load,
          child: ListView(
            padding: const EdgeInsets.only(top: 8, bottom: 48),
            children: [
              const HubTitleBar('Connection requests'),
              const SizedBox(height: AppSpace.md),
              KChipBar<String>(
                value: _tab,
                options: [('incoming', 'From buyers (${_incoming.where((r) => r['status'] == 'pending').length})'), ('outgoing', 'Sent')],
                onChanged: (v) => setState(() => _tab = v),
              ),
              if (_loading)
                const KSpinner(padding: EdgeInsets.symmetric(vertical: 64))
              else if (_error != null)
                KEmptyState(icon: LucideIcons.circleAlert, title: 'Could not load', body: _error)
              else if (rows.isEmpty)
                const KEmptyState(icon: LucideIcons.userCheck, title: 'No requests')
              else
                for (final r in rows)
                  KCard(
                    margin: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.md, AppSpace.gutter, 0),
                    padding: const EdgeInsets.all(14),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Row(children: [
                        Expanded(child: Text(r['counterparty_name']?.toString() ?? '', style: AppText.bodyStrong)),
                        KStatusDot.status(r['status']?.toString() ?? ''),
                      ]),
                      if (hubText(r['message']) != null) Text(r['message'].toString(), style: AppText.caption),
                      Text(hubDate(r['created_at']), style: AppText.caption),
                      if (r['status'] == 'pending') ...[
                        const SizedBox(height: AppSpace.sm),
                        Row(children: [
                          if (_tab == 'incoming') ...[
                            Expanded(child: KButton.secondary(label: 'Decline', height: 40, onPressed: _busyId != null ? null : () => _resolve(r, 'decline'))),
                            const SizedBox(width: AppSpace.sm),
                            Expanded(child: KButton(label: 'Accept', height: 40, loading: _busyId == r['id'], onPressed: () => _accept(r))),
                          ] else
                            Expanded(child: KButton.secondary(label: 'Withdraw', height: 40, onPressed: _busyId != null ? null : () => _resolve(r, 'cancel'))),
                        ]),
                      ],
                    ]),
                  ),
            ],
          ),
        ),
      ),
    );
  }
}

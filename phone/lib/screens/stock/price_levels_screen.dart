import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';
import '../sales/doc_action_sheets.dart';
import 'price_list_screen.dart';
import 'pricing_forms.dart';
import 'pricing_logic.dart';

/// Website `/pricing/levels`: rate lists such as Wholesale, Retail or Dealer. A customer on a level
/// gets its rates unless they have a price of their own (set in Party pricing).
class PriceLevelsScreen extends StatefulWidget {
  const PriceLevelsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<PriceLevelsScreen> createState() => _PriceLevelsScreenState();
}

class _PriceLevelsScreenState extends State<PriceLevelsScreen> {
  List<PriceLevel> _levels = const [];
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = _levels.isEmpty;
      _error = null;
      _notInPlan = false;
    });
    try {
      final body = await widget.session.api.getData('/api/pricing/levels');
      if (!mounted) return;
      setState(() {
        _levels = priceLevels(body);
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      final fail = failureOf(e);
      setState(() {
        _loading = false;
        _error = fail.message;
        _notInPlan = fail.notInPlan;
      });
    }
  }

  Future<void> _open(PriceLevel level) async {
    await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => PriceLevelDetailScreen(session: widget.session, level: level)));
    if (mounted) _load();
  }

  Future<void> _add() async {
    String? createdId;
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => SingleFieldFormPage(
        title: 'New price level',
        label: 'Name',
        hint: 'e.g. Wholesale',
        saveLabel: 'Create level',
        onSave: (text) async {
          if (text.isEmpty) return 'Give the price level a name';
          final reply = await widget.session.api.postJson('/api/pricing/levels', levelCreateBody(text));
          final level = reply['level'];
          createdId = level is Map ? docText(level['id']) : null;
          return null;
        },
      ),
    ));
    if (saved != true || !mounted) return;
    showKToast(context, 'Price level created', tone: KTone.positive);
    await _load();
    if (!mounted) return;
    for (final l in _levels) {
      if (l.id == createdId) {
        await _open(l);
        break;
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      floatingActionButton: _error == null && !_loading ? KFab(label: 'Add level', onTap: _add) : null,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const KBackBar('Price levels'),
            Expanded(
              child: RefreshIndicator(
                color: AppColors.brand,
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, 96),
                  children: [
                    Text(
                      'Rate lists such as Wholesale, Retail or Dealer, with quantity slabs and dates. A customer on a level gets these rates unless they have their own price.',
                      style: AppText.caption,
                    ),
                    const SizedBox(height: AppSpace.md),
                    ..._body(),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _body() {
    if (_loading) return const [KSpinner(padding: EdgeInsets.symmetric(vertical: 48))];
    if (_error != null) return [PricingFailure(title: 'Could not load price levels', message: _error!, notInPlan: _notInPlan, onRetry: _load)];
    if (_levels.isEmpty) {
      return const [KEmptyState(icon: LucideIcons.layers, title: 'No price levels yet', body: 'Add a level such as Wholesale to give a group of customers their own rates.')];
    }
    return [
      KCard(
        child: KDivided(indent: 0, children: [
          for (final l in _levels)
            KListRow(
              title: l.isActive ? l.name : '${l.name} (inactive)',
              subtitle: l.counts,
              trailing: Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink3),
              onTap: () => _open(l),
            ),
        ]),
      ),
    ];
  }
}

/// One level: rename, activate, delete, its rates, bulk changes and the customers on it.
class PriceLevelDetailScreen extends StatefulWidget {
  const PriceLevelDetailScreen({super.key, required this.session, required this.level});

  final AppSession session;
  final PriceLevel level;

  @override
  State<PriceLevelDetailScreen> createState() => _PriceLevelDetailScreenState();
}

class _PriceLevelDetailScreenState extends State<PriceLevelDetailScreen> {
  late PriceLevel _level = widget.level;
  LevelRates _data = levelRatesReply(null);
  Map<String, Map<String, dynamic>> _items = const {};
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;
  bool _busy = false;

  KhatarioApi get _api => widget.session.api;

  @override
  void initState() {
    super.initState();
    _load();
    _api.getData('/api/items?limit=500').then<void>((body) {
      if (mounted) setState(() => _items = itemsById(body));
    }).catchError((_) {});
  }

  Future<void> _load() async {
    setState(() {
      _loading = _data.rates.isEmpty && _data.customers.isEmpty;
      _error = null;
      _notInPlan = false;
    });
    try {
      final body = await _api.getData(levelRatesPath(_level.id));
      if (!mounted) return;
      setState(() {
        _data = levelRatesReply(body);
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      final fail = failureOf(e);
      setState(() {
        _loading = false;
        _error = fail.message;
        _notInPlan = fail.notInPlan;
      });
    }
  }

  /// Runs a save or delete once at a time; shows the server's words when it is refused.
  Future<bool> _run(Future<void> Function() work) async {
    if (_busy) return false;
    setState(() => _busy = true);
    try {
      await work();
      return true;
    } catch (e) {
      if (mounted) showKToast(context, failureOf(e).message, tone: KTone.negative);
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _rename() async {
    var name = _level.name;
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => SingleFieldFormPage(
        title: 'Rename level',
        label: 'Name',
        initial: _level.name,
        onSave: (text) async {
          if (text.isEmpty) return 'Give the price level a name';
          await _api.postJson('/api/pricing/levels', levelUpdateBody(_level, name: text));
          name = text;
          return null;
        },
      ),
    ));
    if (saved == true && mounted) {
      setState(() => _level = PriceLevel(id: _level.id, name: name, description: _level.description, isActive: _level.isActive, customerCount: _level.customerCount, rateCount: _level.rateCount));
      showKToast(context, 'Saved', tone: KTone.positive);
    }
  }

  Future<void> _toggleActive() async {
    final next = !_level.isActive;
    final ok = await _run(() async {
      await _api.postJson('/api/pricing/levels', levelUpdateBody(_level, isActive: next));
    });
    if (ok && mounted) {
      setState(() => _level = PriceLevel(id: _level.id, name: _level.name, description: _level.description, isActive: next, customerCount: _level.customerCount, rateCount: _level.rateCount));
      showKToast(context, 'Saved', tone: KTone.positive);
    }
  }

  Future<void> _delete() async {
    final ok = await askSheet(
      context,
      title: 'Delete level?',
      text: 'Delete "${_level.name}" and its ${_data.rates.length} rate(s)? Its customers go back to item prices.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
    );
    if (!ok || !mounted) return;
    final done = await _run(() async {
      await _api.deleteJson(levelDeletePath(_level.id));
    });
    if (done && mounted) {
      showKToast(context, 'Price level deleted', tone: KTone.positive);
      Navigator.of(context).pop();
    }
  }

  Future<void> _bulk(LevelBulk kind) async {
    final raise = kind == LevelBulk.raise;
    num changed = 0;
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => SingleFieldFormPage(
        title: raise ? 'Raise all rates' : 'Fill from item prices',
        label: 'Percentage',
        initial: raise ? '5' : '-10',
        numeric: true,
        help: raise
            ? 'Raise every rate on this level by this %. Use a minus sign to lower, for example -5.'
            : 'Add a rate for every item without one, at the item price plus this %. For example -10 is 10% below the item price.',
        saveLabel: 'Apply',
        onSave: (text) async {
          final pct = parsePercent(text);
          if (pct == null) return 'Enter a number';
          final reply = await _api.postJson(levelRatesPath(_level.id), levelBulkBody(kind, pct));
          changed = docNum(reply['changed']) ?? 0;
          return null;
        },
      ),
    ));
    if (saved == true && mounted) {
      showKToast(context, '${plainNum(changed)} rate(s) ${raise ? 'changed' : 'added'}', tone: KTone.positive);
      await _load();
    }
  }

  Future<void> _editRate(LevelRate? existing) async {
    final title = existing == null ? '' : rateTitle(_items, _data.variants, existing.itemId, existing.variantId);
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => RateFormPage(
        session: widget.session,
        title: existing == null ? 'Add rate' : 'Change rate',
        pickItem: existing == null,
        itemId: existing?.itemId ?? '',
        subject: existing == null ? null : title,
        variants: _data.variants,
        variantId: existing?.variantId ?? '',
        showMinQty: true,
        initialMinQty: existing == null ? '0' : plainNum(existing.minQty),
        initial: existing?.draft ?? const RateDraft(),
        onSave: (v) async {
          await _api.postJson(
            levelRatesPath(_level.id),
            levelRateBody(existing?.itemId ?? v.itemId, existing == null ? v.variantId : existing.variantId, v.minQty, v.rate),
          );
        },
        onRemove: existing == null
            ? null
            : () async {
                await _api.postJson(
                  levelRatesPath(_level.id),
                  levelRateBody(existing.itemId, existing.variantId, plainNum(existing.minQty), RateFields(validFrom: existing.validFrom, validTo: existing.validTo)),
                );
              },
        hint: existing == null ? null : 'Changing the minimum quantity or the From date saves a new rate and keeps the old one.',
        removeLabel: 'Remove rate',
        removeTitle: 'Remove rate?',
        removeText: 'Remove this rate for $title from ${_level.name}?',
      ),
    ));
    if (saved == true && mounted) {
      showKToast(context, 'Rate saved', tone: KTone.positive);
      await _load();
    }
  }

  Future<void> _assign(String? levelId, String customerId) async {
    final ok = await _run(() async {
      await _api.postJson('/api/pricing/levels', assignLevelBody(levelId, customerId));
    });
    if (ok && mounted) {
      showKToast(context, levelId == null ? 'Customer removed from the level' : 'Customer added', tone: KTone.positive);
      await _load();
    }
  }

  Future<void> _removeCustomer(Map<String, dynamic> c) async {
    final name = docText(c['name']);
    final ok = await askSheet(
      context,
      title: 'Remove customer?',
      text: 'Take $name off ${_level.name}? They go back to item prices.',
      confirmLabel: 'Remove',
      cancelLabel: 'Keep them',
    );
    if (ok && mounted) await _assign(null, docText(c['id']));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KBackBar(_level.name),
            Expanded(
              child: RefreshIndicator(
                color: AppColors.brand,
                onRefresh: _load,
                child: ListView(
                  keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
                  children: _body(),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _body() {
    if (_loading) return const [KSpinner(padding: EdgeInsets.symmetric(vertical: 48))];
    if (_error != null) return [PricingFailure(title: 'Could not load the rates', message: _error!, notInPlan: _notInPlan, onRetry: _load)];
    return [
      if (!_level.isActive) Padding(padding: const EdgeInsets.only(bottom: AppSpace.sm), child: Text('This level is inactive.', style: AppText.caption)),
      Row(children: [
        Expanded(child: KButton.secondary(label: 'Rename', onPressed: _busy ? null : _rename)),
        const SizedBox(width: AppSpace.sm),
        Expanded(child: KButton.secondary(label: _level.isActive ? 'Deactivate' : 'Activate', onPressed: _busy ? null : _toggleActive)),
      ]),
      const KSectionHeader('Rates'),
      Text(
        'Minimum quantity 0 is the base rate; add more rows with a higher minimum for quantity slabs. A rate with the same item, variant, minimum quantity and start date replaces the old one.',
        style: AppText.caption,
      ),
      const SizedBox(height: AppSpace.md),
      KButton(label: 'Add a rate', icon: LucideIcons.plus, onPressed: _busy ? null : () => _editRate(null)),
      const SizedBox(height: AppSpace.md),
      if (_data.rates.isEmpty)
        const KEmptyState(icon: LucideIcons.tag, title: 'No rates on this level yet')
      else
        KCard(
          child: KDivided(indent: 0, children: [
            for (final r in _data.rates)
              KListRow(
                title: rateTitle(_items, _data.variants, r.itemId, r.variantId),
                subtitle: ['Min ${plainNum(r.minQty)}', dateRange(r.validFrom, r.validTo)].where((s) => s.isNotEmpty).join(' · '),
                trailing: Text(rateText(r.price, r.discountPercent), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
                onTap: () => _editRate(r),
              ),
          ]),
        ),
      const SizedBox(height: AppSpace.md),
      KButton.secondary(label: 'Fill from item prices ±%', onPressed: _busy ? null : () => _bulk(LevelBulk.fill)),
      const SizedBox(height: AppSpace.sm),
      KButton.secondary(label: 'Raise all rates by %', onPressed: _busy || _data.rates.isEmpty ? null : () => _bulk(LevelBulk.raise)),
      const KSectionHeader('Customers on this level'),
      KAsyncPickField(
        label: 'Add a customer',
        valueLabel: null,
        search: (q) => searchCustomers(_api, q),
        onPicked: (id, _) => _assign(_level.id, id),
      ),
      const SizedBox(height: AppSpace.md),
      if (_data.customers.isEmpty)
        Text('No customers yet. You can also set a customer\'s level in Party pricing.', style: AppText.caption)
      else
        KCard(
          child: KDivided(indent: 0, children: [
            for (final c in _data.customers)
              KListRow(
                title: docText(c['name']),
                trailing: KTextButton(label: 'Remove', onTap: _busy ? null : () => _removeCustomer(c), color: AppColors.negative),
              ),
          ]),
        ),
      const SizedBox(height: AppSpace.xl),
      KButton(label: 'Delete level', kind: KButtonKind.danger, onPressed: _busy ? null : _delete),
    ];
  }
}

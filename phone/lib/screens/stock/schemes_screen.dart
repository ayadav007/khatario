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

/// Website `/pricing/schemes`: free goods on quantity, such as buy 10, get 1 free. When a bill
/// reaches the quantity the free units are added as their own line at no charge.
class SchemesScreen extends StatefulWidget {
  const SchemesScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<SchemesScreen> createState() => _SchemesScreenState();
}

enum _Act { edit, toggle, delete }

class _SchemesScreenState extends State<SchemesScreen> {
  List<Scheme> _schemes = const [];
  List<Map<String, dynamic>> _variants = const [];
  List<PriceLevel> _levels = const [];
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;
  bool _busy = false;

  KhatarioApi get _api => widget.session.api;

  @override
  void initState() {
    super.initState();
    _load();
    _api.getData('/api/pricing/levels').then<void>((body) {
      if (mounted) setState(() => _levels = priceLevels(body));
    }).catchError((_) {});
  }

  Future<void> _load() async {
    setState(() {
      _loading = _schemes.isEmpty;
      _error = null;
      _notInPlan = false;
    });
    try {
      final body = await _api.getData('/api/pricing/schemes');
      if (!mounted) return;
      setState(() {
        _schemes = schemeRows(body);
        _variants = docRows(body, 'variants');
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

  Future<void> _form(Scheme? existing) async {
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => SchemeFormPage(session: widget.session, existing: existing, variants: _variants, levels: _levels),
    ));
    if (saved == true && mounted) {
      showKToast(context, 'Scheme saved', tone: KTone.positive);
      await _load();
    }
  }

  Future<void> _act(Scheme s) async {
    final act = await showKSheet<_Act>(
      context,
      title: s.title,
      builder: (ctx) => Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        KSheetAction(icon: LucideIcons.pencil, label: 'Edit', onTap: () => Navigator.of(ctx).pop(_Act.edit)),
        KSheetAction(
          icon: s.isActive ? LucideIcons.pause : LucideIcons.play,
          label: s.isActive ? 'Pause' : 'Resume',
          onTap: () => Navigator.of(ctx).pop(_Act.toggle),
        ),
        KSheetAction(icon: LucideIcons.trash2, label: 'Delete', danger: true, onTap: () => Navigator.of(ctx).pop(_Act.delete)),
      ]),
    );
    if (act == null || !mounted) return;
    switch (act) {
      case _Act.edit:
        await _form(s);
      case _Act.toggle:
        await _run(() => _api.postJson('/api/pricing/schemes', schemeToggleBody(s)), s.isActive ? 'Scheme paused' : 'Scheme resumed');
      case _Act.delete:
        final ok = await askSheet(
          context,
          title: 'Delete scheme?',
          text: 'Delete the scheme on ${s.itemName}?',
          confirmLabel: 'Delete',
          cancelLabel: 'Keep it',
        );
        if (ok && mounted) await _run(() => _api.deleteJson(schemeDeletePath(s.id)), 'Scheme deleted');
    }
  }

  /// One change at a time; the list reloads after it, and a refusal shows the server's words.
  Future<void> _run(Future<Object?> Function() work, String done) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await work();
      if (!mounted) return;
      showKToast(context, done, tone: KTone.positive);
      await _load();
    } catch (e) {
      if (mounted) showKToast(context, failureOf(e).message, tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      floatingActionButton: _error == null && !_loading ? KFab(label: 'Add scheme', onTap: () => _form(null)) : null,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const KBackBar('Schemes'),
            Expanded(
              child: RefreshIndicator(
                color: AppColors.brand,
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, 96),
                  children: [
                    Text(
                      'Free goods on quantity, such as buy 10, get 1 free. When a bill reaches the quantity, the free units are added as their own line at no charge, so stock goes down and no GST is charged on them.',
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
    if (_error != null) return [PricingFailure(title: 'Could not load schemes', message: _error!, notInPlan: _notInPlan, onRetry: _load)];
    if (_schemes.isEmpty) {
      return const [KEmptyState(icon: LucideIcons.gift, title: 'No schemes yet', body: 'Add one to give free units when a bill reaches a quantity.')];
    }
    return [
      KCard(
        child: KDivided(indent: 0, children: [
          for (final s in _schemes)
            Opacity(
              opacity: s.isActive ? 1 : 0.6,
              child: KListRow(
                title: s.title,
                subtitle: [if (!s.isActive) 'Paused', s.audience, s.dates].join(' · '),
                trailing: Text(s.summary, style: AppText.bodyStrong),
                onTap: () => _act(s),
              ),
            ),
        ]),
      ),
    ];
  }
}

/// Add or change a scheme. Posts `POST /api/pricing/schemes` (with `id` when changing) and pops
/// with true; a refusal keeps the form as it is.
class SchemeFormPage extends StatefulWidget {
  const SchemeFormPage({super.key, required this.session, this.existing, required this.variants, required this.levels});

  final AppSession session;
  final Scheme? existing;
  final List<Map<String, dynamic>> variants;
  final List<PriceLevel> levels;

  @override
  State<SchemeFormPage> createState() => _SchemeFormPageState();
}

class _SchemeFormPageState extends State<SchemeFormPage> {
  late final SchemeDraft _start = widget.existing == null ? const SchemeDraft() : SchemeDraft.of(widget.existing!);
  late final _buy = TextEditingController(text: _start.buy);
  late final _free = TextEditingController(text: _start.free);
  late String _itemId = _start.itemId;
  late String _itemName = widget.existing?.itemName ?? '';
  late String _variantId = _start.variantId;
  late String _levelId = _start.levelId;
  late String _from = _start.from;
  late String _to = _start.to;
  bool _touched = false;

  @override
  void dispose() {
    _buy.dispose();
    _free.dispose();
    super.dispose();
  }

  SchemeDraft get _draft => SchemeDraft(id: _start.id, itemId: _itemId, variantId: _variantId, levelId: _levelId, buy: _buy.text, free: _free.text, from: _from, to: _to);

  Future<void> _save() async {
    final problem = checkScheme(_draft);
    if (problem != null) {
      showKToast(context, problem, tone: KTone.negative);
      return;
    }
    // Keep a paused scheme paused: the route reads a missing is_active as true.
    await widget.session.api.postJson('/api/pricing/schemes', schemeBody(_draft, isActive: widget.existing?.isActive));
    if (mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: widget.existing == null ? 'New scheme' : 'Change scheme',
      saveLabel: 'Save scheme',
      dirty: _touched,
      onSave: _save,
      children: [
        KAsyncPickField(
          label: 'Item',
          valueLabel: _itemName.isEmpty ? null : _itemName,
          search: (q) => searchItems(widget.session.api, q),
          onPicked: (id, name) => setState(() {
            if (id != _itemId) _variantId = '';
            _itemId = id;
            _itemName = name;
            _touched = true;
          }),
        ),
        VariantPickField(
          itemId: _itemId,
          variants: widget.variants,
          value: _variantId,
          onChanged: (v) => setState(() {
            _variantId = v;
            _touched = true;
          }),
        ),
        KPickField<String>(
          label: 'For',
          value: _levelId,
          options: [('', 'Every customer'), for (final l in widget.levels) (l.id, '${l.name} customers')],
          onChanged: (v) => setState(() {
            _levelId = v;
            _touched = true;
          }),
        ),
        KTextField(
          key: const Key('buy'),
          label: 'Buy',
          controller: _buy,
          keyboard: const TextInputType.numberWithOptions(decimal: true),
          onChanged: (_) => setState(() => _touched = true),
        ),
        KTextField(
          key: const Key('free'),
          label: 'Get free',
          controller: _free,
          keyboard: const TextInputType.numberWithOptions(decimal: true),
          onChanged: (_) => setState(() => _touched = true),
        ),
        OptionalDateField(label: 'From', value: _from, onChanged: (v) => setState(() { _from = v; _touched = true; })),
        OptionalDateField(label: 'To', value: _to, onChanged: (v) => setState(() { _to = v; _touched = true; })),
      ],
    );
  }
}

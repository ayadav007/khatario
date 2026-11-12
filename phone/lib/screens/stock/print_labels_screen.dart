import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../printing/thermal_printers.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';
import '../pages/website_page_screen.dart';
import '../settings/printers_screen.dart';

/// Sends the labels the server built to a printer. The default is [ThermalPrinting.printLabels].
typedef LabelSender = Future<void> Function(ThermalPrinter printer, Map<String, dynamic> labels);

const _maxCopies = 999;

bool _isWeighed(Map<String, dynamic> e) => e['is_weighed'] == true && docText(e['plu_code']).isNotEmpty;

/// `app/(app)/items/barcodes/page.tsx`: pick a label template, the items and how many labels of each, and
/// print on the saved label printer. Items come from `GET /api/items/labelable` (`entries`), templates
/// from `GET /api/label-templates` (`templates`); `POST /api/labels/print` (`format: json`) builds the
/// labels and [ThermalPrinting] sends them. Designing a template is a website page.
class PrintLabelsScreen extends StatefulWidget {
  const PrintLabelsScreen({super.key, required this.session, this.sendToPrinter, this.askForPrinter});

  final AppSession session;

  /// For tests: replaces the real send to the printer.
  final LabelSender? sendToPrinter;

  /// For tests: replaces the "Add printer" sheet shown when no label printer is saved.
  final Future<ThermalPrinter?> Function()? askForPrinter;

  @override
  State<PrintLabelsScreen> createState() => _PrintLabelsScreenState();
}

class _PrintLabelsScreenState extends State<PrintLabelsScreen> {
  final _search = TextEditingController();
  List<Map<String, dynamic>> _entries = const [];
  List<(String, String)> _templates = const [];
  final Map<String, int> _copies = {};
  final Map<String, String> _measure = {};
  String _templateId = '';
  bool _loading = true;
  bool _notInPlan = false;
  bool _printing = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
    _loadTemplates();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _notInPlan = false;
    });
    try {
      final body = await widget.session.api.getData('/api/items/labelable');
      if (!mounted) return;
      setState(() {
        _entries = docRows(body, 'entries');
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

  /// Templates are optional: when the list cannot load, the default layout is still there.
  Future<void> _loadTemplates() async {
    try {
      final body = await widget.session.api.getData('/api/label-templates');
      if (!mounted) return;
      setState(() {
        _templates = [
          for (final t in docRows(body, 'templates'))
            if (docText(t['id']).isNotEmpty) (docText(t['id']), '${docText(t['name'])}${t['is_system'] == true ? ' (system)' : ''}'),
        ];
      });
    } catch (_) {}
  }

  List<Map<String, dynamic>> get _shown {
    final q = _search.text.trim().toLowerCase();
    if (q.isEmpty) return _entries;
    return [
      for (final e in _entries)
        if (docText(e['name']).toLowerCase().contains(q) ||
            docText(e['code']).toLowerCase().contains(q) ||
            docText(e['barcode']).toLowerCase().contains(q))
          e,
    ];
  }

  int get _totalCopies => _copies.values.fold(0, (sum, n) => sum + n);

  void _toggle(String id) => setState(() {
        if (_copies.containsKey(id)) {
          _copies.remove(id);
        } else {
          _copies[id] = 1;
        }
      });

  void _setCopies(String id, int n) => setState(() {
        final c = n.clamp(0, _maxCopies);
        if (c <= 0) {
          _copies.remove(id);
        } else {
          _copies[id] = c;
        }
      });

  void _toggleAll(List<Map<String, dynamic>> shown) => setState(() {
        final ids = [for (final e in shown) docText(e['row_id'])];
        if (ids.every(_copies.containsKey)) {
          ids.forEach(_copies.remove);
        } else {
          for (final id in ids) {
            _copies.putIfAbsent(id, () => 1);
          }
        }
      });

  Future<ThermalPrinter?> _printer(ThermalPrinting printing) async {
    final saved = await printing.labelPrinter();
    if (saved != null) return saved;
    if (!mounted) return null;
    showKToast(context, 'Add your label printer first.', tone: KTone.negative);
    final added = await (widget.askForPrinter?.call() ?? showAddPrinterSheet(context));
    if (added == null) return null;
    await printing.save(added);
    return added;
  }

  Future<void> _print() async {
    if (_printing) return;
    final picked = [for (final e in _entries) if (_copies.containsKey(docText(e['row_id']))) e];
    if (picked.isEmpty) return showKToast(context, 'Pick at least one item to print', tone: KTone.negative);

    final lines = <Map<String, dynamic>>[];
    var missing = 0;
    for (final e in picked) {
      final id = docText(e['row_id']);
      final line = <String, dynamic>{'item_id': e['item_id'], 'variant_id': e['variant_id'], 'copies': _copies[id]};
      if (_isWeighed(e)) {
        final m = int.tryParse((_measure[id] ?? '').trim());
        if (m != null && m >= 0) line['weight_measure'] = m;
        if (m == null || m <= 0) missing++;
      }
      lines.add(line);
    }
    if (missing > 0) {
      showKToast(context, 'Enter the weight or price for $missing weighed item${missing == 1 ? '' : 's'}. Its label will use 00000.');
    }

    final printing = ThermalPrinting(widget.session.api, widget.session.businessId ?? '');
    setState(() => _printing = true);
    try {
      final printer = await _printer(printing);
      if (printer == null || !mounted) return;
      final labels = await widget.session.api.postJson('/api/labels/print', {
        'lines': lines,
        if (_templateId.isEmpty) 'layout': 'ROLL' else 'template_id': _templateId,
        'format': 'json',
        'purpose': 'standalone',
      });
      await (widget.sendToPrinter ?? printing.printLabels)(printer, labels);
      if (!mounted) return;
      final n = _totalCopies;
      showKToast(context, '$n label${n == 1 ? '' : 's'} sent to ${printer.name}', tone: KTone.positive);
    } on PrintFailure catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not print. Try again.', tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _printing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KBackBar(
              'Print labels',
              trailing: KTextButton(
                label: 'Design a template',
                icon: LucideIcons.globe,
                onTap: () => openWebsiteInApp(context, widget.session, '/settings/label-templates/new', 'Design a label template'),
              ),
            ),
            Expanded(child: _body()),
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
            title: 'Could not load printable items',
            body: _error,
            action: KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
          ),
      ]);
    }
    if (_entries.isEmpty) {
      return ListView(children: const [
        KEmptyState(
          icon: LucideIcons.barcode,
          title: 'No items with barcodes',
          body: 'Add or generate barcodes on items or variants to print labels.',
        ),
      ]);
    }
    final shown = _shown;
    final all = shown.isNotEmpty && shown.every((e) => _copies.containsKey(docText(e['row_id'])));
    final total = _totalCopies;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.sm),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_templates.isNotEmpty) ...[
                KPickField<String>(
                  label: 'Template',
                  value: _templateId,
                  options: [('', 'Default layout'), ..._templates],
                  onChanged: (v) => setState(() => _templateId = v),
                ),
                const SizedBox(height: AppSpace.md),
              ],
              KSearchField(controller: _search, hint: 'Search by name, code or barcode', onChanged: (_) => setState(() {})),
              Align(
                alignment: Alignment.centerRight,
                child: KTextButton(
                  label: all ? 'Clear all' : 'Select all (${shown.length})',
                  onTap: shown.isEmpty ? null : () => _toggleAll(shown),
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: shown.isEmpty
              ? ListView(children: const [KEmptyState(icon: LucideIcons.search, title: 'No items found', body: 'Try another word.')])
              : ListView(
                  padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.lg),
                  children: [
                    KCard(
                      child: KDivided(children: [
                        for (final e in shown)
                          _EntryRow(
                            key: ValueKey(docText(e['row_id'])),
                            entry: e,
                            copies: _copies[docText(e['row_id'])] ?? 0,
                            onToggle: () => _toggle(docText(e['row_id'])),
                            onCopies: (n) => _setCopies(docText(e['row_id']), n),
                            onMeasure: (v) => _measure[docText(e['row_id'])] = v,
                            measure: _measure[docText(e['row_id'])] ?? '',
                          ),
                      ]),
                    ),
                  ],
                ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, AppSpace.lg),
          child: KButton(
            label: 'Print $total label${total == 1 ? '' : 's'}',
            icon: LucideIcons.printer,
            loading: _printing,
            onPressed: _printing ? null : _print,
          ),
        ),
      ],
    );
  }
}

class _EntryRow extends StatelessWidget {
  const _EntryRow({super.key, required this.entry, required this.copies, required this.onToggle, required this.onCopies, required this.onMeasure, required this.measure});

  final Map<String, dynamic> entry;
  final int copies;
  final String measure;
  final VoidCallback onToggle;
  final ValueChanged<int> onCopies;
  final ValueChanged<String> onMeasure;

  String get _subtitle {
    final price = docNum(entry['selling_price']);
    final stock = entry['item_type'] == 'goods' && docNum(entry['current_stock']) != null
        ? 'Stock ${enIn(docNum(entry['current_stock'])!, maxFraction: 3)} ${docText(entry['unit'])}'.trim()
        : '';
    return [
      docText(entry['code']),
      _isWeighed(entry) ? 'PLU ${docText(entry['plu_code'])}' : docText(entry['barcode']),
      if (price != null) '$rupeeSign${enIn(price, maxFraction: 2)}',
      stock,
    ].where((p) => p.isNotEmpty).join(' · ');
  }

  @override
  Widget build(BuildContext context) {
    final on = copies > 0;
    final byPrice = entry['weight_barcode_mode'] == 'price';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        KListRow(
          title: docText(entry['name']),
          subtitle: _subtitle,
          leading: Icon(on ? LucideIcons.squareCheck : LucideIcons.square, size: 22, color: on ? AppColors.brand : AppColors.ink3),
          trailing: on
              ? Row(mainAxisSize: MainAxisSize.min, children: [
                  KIconButton(icon: LucideIcons.minus, tooltip: 'Fewer copies', onTap: () => onCopies(copies - 1)),
                  Text('$copies', style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
                  KIconButton(icon: LucideIcons.plus, tooltip: 'More copies', onTap: () => onCopies(copies + 1)),
                ])
              : null,
          onTap: onToggle,
        ),
        if (on && _isWeighed(entry))
          Padding(
            padding: const EdgeInsets.fromLTRB(AppSpace.lg, 0, AppSpace.lg, AppSpace.md),
            child: _MeasureField(label: byPrice ? 'Price in paise' : 'Weight in grams', initial: measure, onChanged: onMeasure),
          ),
      ],
    );
  }
}

/// The grams (or paise) typed for one weighed item. Keeps its own controller so typing is not reset.
class _MeasureField extends StatefulWidget {
  const _MeasureField({required this.label, required this.initial, required this.onChanged});

  final String label, initial;
  final ValueChanged<String> onChanged;

  @override
  State<_MeasureField> createState() => _MeasureFieldState();
}

class _MeasureFieldState extends State<_MeasureField> {
  late final _controller = TextEditingController(text: widget.initial);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) =>
      KTextField(label: widget.label, controller: _controller, keyboard: TextInputType.number, onChanged: widget.onChanged);
}

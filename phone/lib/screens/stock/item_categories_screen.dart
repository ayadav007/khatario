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

/// A size chart typed as text: [columns] separated by commas, [rows] one per line with values separated by commas.
({String columns, String rows}) sizeChartText(dynamic chart) {
  if (chart is! Map) return (columns: '', rows: '');
  final columns = chart['columns'] is List ? (chart['columns'] as List).map((c) => docText(c)).toList() : <String>[];
  final rows = chart['rows'] is List
      ? (chart['rows'] as List).map((r) => r is List ? r.map((c) => docText(c)).join(', ') : '').toList()
      : <String>[];
  return (columns: columns.join(', '), rows: rows.join('\n'));
}

/// The text back as `{ columns, rows }` for `PATCH /api/categories`, or an [error] to show. The server
/// checks the limits (8 columns, 20 rows, 40 characters a cell) and answers with its own message.
({Map<String, dynamic>? chart, String? error}) parseSizeChart(String columnsText, String rowsText) {
  List<String> cells(String line) => line.split(',').map((c) => c.trim()).toList();
  final columns = cells(columnsText).where((c) => c.isNotEmpty).toList();
  if (columns.isEmpty) return (chart: null, error: 'Add at least one column');
  final rows = <List<String>>[];
  for (final line in rowsText.split('\n')) {
    if (line.trim().isEmpty) continue;
    final row = cells(line);
    if (row.length != columns.length) return (chart: null, error: 'Every row needs one value per column');
    rows.add(row);
  }
  return (chart: {'columns': columns, 'rows': rows}, error: null);
}

String _itemCount(Map<String, dynamic> c) {
  final n = (docNum(c['item_count']) ?? 0).toInt();
  return '$n ${n == 1 ? 'item' : 'items'}';
}

/// `app/(app)/items/categories/page.tsx`: the item categories with how many items each holds.
/// `GET /api/categories` (`categories`), `POST` (name, description), `PATCH` (id and size chart; the
/// server cannot rename a category), `DELETE ?id=` (refused while items use it).
class ItemCategoriesScreen extends StatefulWidget {
  const ItemCategoriesScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<ItemCategoriesScreen> createState() => _ItemCategoriesScreenState();
}

class _ItemCategoriesScreenState extends State<ItemCategoriesScreen> {
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
      final body = await widget.session.api.getData('/api/categories');
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

  Future<void> _add() async {
    final saved = await showKSheet<bool>(
      context,
      title: 'Add category',
      scrollable: true,
      builder: (_) => _AddCategorySheet(session: widget.session),
    );
    if (saved == true && mounted) {
      showKToast(context, 'Category added', tone: KTone.positive);
      _load(spinner: false);
    }
  }

  void _actions(Map<String, dynamic> row) {
    showKSheet<void>(
      context,
      title: docText(row['name']),
      builder: (ctx) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          KSheetAction(
            icon: LucideIcons.ruler,
            label: 'Size chart',
            subtitle: row['size_chart'] == null ? 'Shoppers see it on items in this category' : 'Set',
            onTap: () {
              Navigator.pop(ctx);
              _sizeChart(row);
            },
          ),
          KSheetAction(
            icon: LucideIcons.trash2,
            label: 'Delete category',
            danger: true,
            onTap: () {
              Navigator.pop(ctx);
              _delete(row);
            },
          ),
        ],
      ),
    );
  }

  Future<void> _sizeChart(Map<String, dynamic> row) async {
    final done = await showKSheet<String>(
      context,
      title: 'Size chart',
      scrollable: true,
      builder: (_) => _SizeChartSheet(session: widget.session, category: row),
    );
    if (done != null && mounted) {
      showKToast(context, done, tone: KTone.positive);
      _load(spinner: false);
    }
  }

  Future<void> _delete(Map<String, dynamic> row) async {
    final name = docText(row['name']);
    final ok = await askSheet(
      context,
      title: 'Delete category',
      text: 'Delete "$name"? This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
    );
    if (!ok || !mounted) return;
    try {
      await widget.session.api.deleteJson('/api/categories?id=${Uri.encodeQueryComponent(docText(row['id']))}');
      if (!mounted) return;
      showKToast(context, 'Category deleted', tone: KTone.positive);
      _load(spinner: false);
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not delete. Try again.', tone: KTone.negative);
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
                const KBackBar('Item categories'),
                Expanded(child: _body()),
              ],
            ),
            if (!_loading && _error == null)
              Positioned(
                right: AppSpace.gutter,
                bottom: AppSpace.lg,
                child: KFab(label: 'Add category', onTap: _add),
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
            title: 'Could not load categories',
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
            const KEmptyState(icon: LucideIcons.tag, title: 'No categories yet', body: 'Add a category to organize your items.')
          else
            KCard(
              margin: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
              child: KDivided(indent: 66, children: [
                for (final r in _rows)
                  KListRow(
                    title: docText(r['name']),
                    subtitle: [
                      docText(r['description']),
                      _itemCount(r),
                      if (r['size_chart'] != null) 'Size chart set',
                    ].where((p) => p.isNotEmpty).join(' · '),
                    leading: const KAvatar(name: '', icon: LucideIcons.tag, muted: true),
                    trailing: Icon(LucideIcons.ellipsis, size: 18, color: AppColors.ink3),
                    onTap: () => _actions(r),
                  ),
              ]),
            ),
        ],
      ),
    );
  }
}

/// `POST /api/categories` takes `name` and `description`. The session names the business and the user.
class _AddCategorySheet extends StatefulWidget {
  const _AddCategorySheet({required this.session});

  final AppSession session;

  @override
  State<_AddCategorySheet> createState() => _AddCategorySheetState();
}

class _AddCategorySheetState extends State<_AddCategorySheet> {
  final _name = TextEditingController();
  final _description = TextEditingController();
  String? _nameError;
  bool _saving = false;

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_saving) return;
    final name = _name.text.trim();
    setState(() => _nameError = name.isEmpty ? 'Enter a category name' : null);
    if (name.isEmpty) return;
    final description = _description.text.trim();
    setState(() => _saving = true);
    try {
      await widget.session.api.postJson('/api/categories', {
        'name': name,
        if (description.isNotEmpty) 'description': description,
      });
      if (mounted) Navigator.of(context).pop(true);
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
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          KTextField(label: 'Category name', controller: _name, hint: 'e.g. Best Seller, Grocery, New Arrivals', error: _nameError),
          const SizedBox(height: AppSpace.md),
          KTextField(label: 'Description', controller: _description, hint: 'Optional', maxLines: 3, minLines: 2),
          const SizedBox(height: AppSpace.lg),
          KButton(label: 'Save category', loading: _saving, onPressed: _saving ? null : _save),
        ],
      ),
    );
  }
}

/// `PATCH /api/categories` with `{ id, size_chart }`; `null` clears the chart.
class _SizeChartSheet extends StatefulWidget {
  const _SizeChartSheet({required this.session, required this.category});

  final AppSession session;
  final Map<String, dynamic> category;

  @override
  State<_SizeChartSheet> createState() => _SizeChartSheetState();
}

class _SizeChartSheetState extends State<_SizeChartSheet> {
  late final _columns = TextEditingController(text: sizeChartText(widget.category['size_chart']).columns);
  late final _rows = TextEditingController(text: sizeChartText(widget.category['size_chart']).rows);
  String? _error;
  bool _saving = false;

  @override
  void dispose() {
    _columns.dispose();
    _rows.dispose();
    super.dispose();
  }

  Future<void> _send(Object? chart, String done) async {
    if (_saving) return;
    setState(() => _saving = true);
    try {
      await widget.session.api.patchJson('/api/categories', {'id': docText(widget.category['id']), 'size_chart': chart});
      if (mounted) Navigator.of(context).pop(done);
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not save. Try again.', tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _save() {
    final parsed = parseSizeChart(_columns.text, _rows.text);
    setState(() => _error = parsed.error);
    if (parsed.chart != null) _send(parsed.chart, 'Size chart saved');
  }

  @override
  Widget build(BuildContext context) {
    final has = widget.category['size_chart'] != null;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('For ${docText(widget.category['name'])}. Items in this category show it in the online store.', style: AppText.caption),
          const SizedBox(height: AppSpace.md),
          KTextField(label: 'Columns (separated by commas)', controller: _columns, hint: 'Size, Chest, Waist'),
          const SizedBox(height: AppSpace.md),
          KTextField(
            label: 'Rows (one per line, values separated by commas)',
            controller: _rows,
            hint: 'S, 38, 30\nM, 40, 32',
            maxLines: 8,
            minLines: 4,
            error: _error,
          ),
          const SizedBox(height: AppSpace.lg),
          KButton(label: 'Save size chart', loading: _saving, onPressed: _saving ? null : _save),
          if (has) ...[
            const SizedBox(height: AppSpace.sm),
            KButton.secondary(label: 'Remove size chart', onPressed: _saving ? null : () => _send(null, 'Size chart removed')),
          ],
        ],
      ),
    );
  }
}

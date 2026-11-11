import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../docs/doc_list_screen.dart';
import '../docs/doc_logic.dart';
import 'stock_count_logic.dart';
import 'stock_count_screen.dart';
import 'stock_misc_logic.dart';

/// `app/(app)/stock-counts/page.tsx`: counts of a godown, newest first, with status chips. `GET /api/stock-counts`
/// replies `{ counts }` in one piece, so the chips filter on the phone. A row opens the count; New count opens one.
class StockCountsScreen extends StatelessWidget {
  const StockCountsScreen({super.key, required this.session, this.scanBarcode});

  final AppSession session;

  /// Opens the camera for the count screen; tests pass their own.
  final Future<String?> Function(BuildContext context)? scanBarcode;

  Future<bool?> _open(BuildContext context, Map<String, dynamic> row) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => StockCountScreen(session: session, countId: docText(row['id']), scanBarcode: scanBarcode)),
    );
    return changed == true;
  }

  @override
  Widget build(BuildContext context) {
    return DocListScreen(
      session: session,
      spec: DocListSpec(
        title: 'Stock counts',
        href: '/stock-counts',
        path: '/api/stock-counts',
        listKey: 'counts',
        titleOf: countTitle,
        subtitleOf: countSubtitle,
        searchKeys: const ['count_number', 'warehouse_name', 'branch_name'],
        filters: kCountFilters,
        filterRow: countMatchesFilter,
        icon: LucideIcons.clipboardCheck,
        emptyTitle: 'No stock counts yet',
        emptyBody: 'Count a godown, explain the difference, and post it.',
        createLabel: 'New count',
        onCreate: (ctx) => Navigator.of(ctx).push<bool>(
          MaterialPageRoute(builder: (_) => StockCountOpenScreen(session: session, scanBarcode: scanBarcode)),
        ),
        onOpen: _open,
      ),
    );
  }
}

/// The website's "New count" box: godown, date, freeze and blind. One `POST /api/stock-counts`; the session names
/// the business and the user. Then the new count opens in place of this form.
class StockCountOpenScreen extends StatefulWidget {
  const StockCountOpenScreen({super.key, required this.session, this.scanBarcode});

  final AppSession session;
  final Future<String?> Function(BuildContext context)? scanBarcode;

  @override
  State<StockCountOpenScreen> createState() => _StockCountOpenScreenState();
}

class _StockCountOpenScreenState extends State<StockCountOpenScreen> {
  List<(String, String)> _godowns = const [];
  String _godown = '';
  DateTime _date = dateOnly(DateTime.now());
  bool _freeze = true;
  bool _blind = true;
  bool _loading = true;
  bool _notInPlan = false;
  String? _error;

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
      final body = await widget.session.api.getJson('/api/warehouses');
      if (!mounted) return;
      final list = godownOptions(body);
      setState(() {
        _godowns = list;
        if (list.length == 1) _godown = list.first.$1;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN' || e.code == 'FEATURE_NOT_AVAILABLE';
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

  Future<void> _save() async {
    if (_godowns.isNotEmpty && _godown.isEmpty) throw ApiException('Choose the godown to count');
    final reply = await widget.session.api.postJson(
      '/api/stock-counts',
      openCountBody(
        date: _date,
        warehouseId: _godown,
        branchId: _godowns.isEmpty ? (widget.session.defaultBranchId ?? '') : '',
        blind: _blind,
        freeze: _freeze,
      ),
    );
    if (!mounted) return;
    final id = docText(reply['id']);
    Navigator.of(context).pushReplacement<bool, bool>(
      MaterialPageRoute(builder: (_) => StockCountScreen(session: widget.session, countId: id, scanBarcode: widget.scanBarcode)),
      result: true,
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading || _error != null) {
      return Scaffold(
        backgroundColor: AppColors.bg,
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const KBackBar('New stock count'),
              Expanded(
                child: _loading
                    ? const KSpinner(padding: EdgeInsets.symmetric(vertical: 64))
                    : ListView(children: [
                        if (_notInPlan)
                          const KEmptyState(icon: LucideIcons.lock, title: 'Not included in your current plan')
                        else
                          KEmptyState(
                            icon: LucideIcons.cloudOff,
                            title: 'Could not load godowns',
                            body: _error,
                            action: KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
                          ),
                      ]),
              ),
            ],
          ),
        ),
      );
    }
    return KFormScaffold(
      title: 'New stock count',
      saveLabel: 'Open count',
      onSave: _save,
      children: [
        if (_godowns.isNotEmpty)
          KPickField<String>(label: 'Godown', value: _godown.isEmpty ? null : _godown, options: _godowns, onChanged: (v) => setState(() => _godown = v)),
        KDateField(label: 'Count date', value: _date, onChanged: (d) => setState(() => _date = dateOnly(d))),
        KToggleField(
          label: 'Freeze this godown while counting',
          help: 'No sales, purchases, transfers or adjustments touch it.',
          value: _freeze,
          onChanged: (v) => setState(() => _freeze = v),
        ),
        KToggleField(
          label: 'Blind count',
          help: 'Counters do not see the book quantity.',
          value: _blind,
          onChanged: (v) => setState(() => _blind = v),
        ),
      ],
    );
  }
}

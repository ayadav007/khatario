import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';
import '../invoices/invoice_detail_screen.dart';
import 'activity_logs_logic.dart';

/// `app/(app)/activity-logs/page.tsx`: who did what, newest first, from `GET /api/activity-logs`
/// (`logs`). It filters by date range, module, action and person (`user_id`, people from
/// `GET /api/settings/users`). The route pages only by `limit`, so Show more asks for a larger one.
/// Settings > Activity is a different list and is not this screen.
class ActivityLogsScreen extends StatefulWidget {
  const ActivityLogsScreen({super.key, required this.session, this.pageSize = activityPageSize});

  final AppSession session;

  /// How many rows each ask adds (100 on the website; a test sets it small).
  final int pageSize;

  @override
  State<ActivityLogsScreen> createState() => _ActivityLogsScreenState();
}

class _ActivityLogsScreenState extends State<ActivityLogsScreen> {
  late DateTime _from;
  late DateTime _to;
  String _module = '';
  String _action = '';
  String _person = '';
  late int _limit;
  List<Map<String, dynamic>> _rows = const [];
  final Map<String, String> _people = {};
  bool _loading = true;
  bool _more = false;
  bool _notInPlan = false;
  bool _noAccess = false;
  String? _error;
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    final today = dateOnly(DateTime.now());
    _from = activityDefaultFrom(today);
    _to = today;
    _limit = widget.pageSize;
    _load();
    _loadPeople();
  }

  /// The person filter's list. Without it the filter is simply left out.
  Future<void> _loadPeople() async {
    try {
      final body = await widget.session.api.getData(activityPeoplePath());
      if (!mounted) return;
      setState(() {
        for (final (id, name) in activityPeople(body)) {
          _people[id] = name;
        }
      });
    } catch (_) {}
  }

  Future<void> _load({bool spinner = true}) async {
    final seq = ++_seq;
    if (spinner) {
      setState(() {
        _loading = true;
        _error = null;
        _notInPlan = false;
        _noAccess = false;
      });
    }
    try {
      final body = await widget.session.api.getData(activityPath(from: _from, to: _to, module: _module, action: _action, userId: _person, limit: _limit));
      if (!mounted || seq != _seq) return;
      final rows = docRows(body, 'logs');
      setState(() {
        _rows = rows;
        _loading = false;
        _more = false;
        _error = null;
      });
    } on ApiException catch (e) {
      if (!mounted || seq != _seq) return;
      if (!spinner && _rows.isNotEmpty) {
        setState(() => _more = false);
        return showKToast(context, e.message, tone: KTone.negative);
      }
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _noAccess = !_notInPlan && e.status == 403;
        _error = e.message;
        _loading = false;
        _more = false;
      });
    } catch (_) {
      if (!mounted || seq != _seq) return;
      if (!spinner && _rows.isNotEmpty) {
        setState(() => _more = false);
        return showKToast(context, 'Could not reach the server.', tone: KTone.negative);
      }
      setState(() {
        _error = 'Could not reach the server.';
        _loading = false;
        _more = false;
      });
    }
  }

  /// A new filter starts again from one page.
  void _refilter(VoidCallback change) {
    setState(() {
      change();
      _limit = widget.pageSize;
    });
    _load();
  }

  Future<void> _showMore() async {
    if (_more) return;
    setState(() {
      _more = true;
      _limit = activityNextLimit(_limit, widget.pageSize);
    });
    await _load(spinner: false);
  }

  Future<void> _open(Map<String, dynamic> row) async {
    final invoiceId = await showKSheet<String>(
      context,
      title: 'Activity',
      builder: (ctx) => _DetailSheet(row: row),
    );
    if (invoiceId == null || !mounted) return;
    final s = widget.session;
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => InvoiceDetailScreen(api: s.api, invoiceId: invoiceId, businessName: s.businessName, session: s),
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const KBackBar('Activity logs'),
            Expanded(
              child: RefreshIndicator(
                color: AppColors.brand,
                onRefresh: () => _load(spinner: false),
                child: ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
                  children: [..._filters(), const SizedBox(height: AppSpace.lg), ..._content()],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _filters() {
    final users = _people.entries.toList();
    return [
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(
          child: KDateField(
            label: 'From',
            value: _from,
            last: _to,
            onChanged: (d) => _refilter(() => _from = dateOnly(d)),
          ),
        ),
        const SizedBox(width: AppSpace.sm),
        Expanded(
          child: KDateField(
            label: 'To',
            value: _to,
            first: _from,
            onChanged: (d) => _refilter(() => _to = dateOnly(d)),
          ),
        ),
      ]),
      const SizedBox(height: AppSpace.md),
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(
          child: KPickField<String>(label: 'Module', value: _module, options: activityModules, onChanged: (v) => _refilter(() => _module = v)),
        ),
        const SizedBox(width: AppSpace.sm),
        Expanded(
          child: KPickField<String>(label: 'Action', value: _action, options: activityActions, onChanged: (v) => _refilter(() => _action = v)),
        ),
      ]),
      if (users.isNotEmpty) ...[
        const SizedBox(height: AppSpace.md),
        KPickField<String>(
          label: 'Person',
          value: _person,
          options: [('', 'Everyone'), for (final u in users) (u.key, u.value)],
          onChanged: (v) => _refilter(() => _person = v),
        ),
      ],
    ];
  }

  List<Widget> _content() {
    if (_loading) return const [KSpinner(padding: EdgeInsets.symmetric(vertical: 48))];
    if (_error != null) {
      return [
        if (_notInPlan)
          const KEmptyState(icon: LucideIcons.lock, title: 'Not included in your current plan')
        else if (_noAccess)
          const KEmptyState(icon: LucideIcons.lock, title: 'You do not have access to this')
        else
          KEmptyState(
            icon: LucideIcons.cloudOff,
            title: 'Could not load activity logs',
            body: _error,
            action: KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
          ),
      ];
    }
    final shown = _rows;
    if (shown.isEmpty) {
      return [const KEmptyState(icon: LucideIcons.activity, title: 'No activity logs found', body: 'Try a wider date range or other filters.')];
    }
    return [
      for (final g in activityGroups(shown)) ...[
        KSectionHeader(activityDayLabel(g.day)),
        KCard(child: KDivided(indent: 14, children: [for (final r in g.rows) _row(r)])),
        const SizedBox(height: AppSpace.lg),
      ],
      if (activityHasMore(_rows.length, _limit)) KButton.secondary(label: 'Show more', loading: _more, onPressed: _showMore),
    ];
  }

  Widget _row(Map<String, dynamic> r) {
    final who = activityWho(r);
    final desc = activitySubtitle(r);
    return KListRow(
      title: activityTitle(r),
      subtitle: [who, desc].where((t) => t.isNotEmpty).join(' · '),
      trailing: Text(activityTimeText(r), style: AppText.caption),
      onTap: () => _open(r),
    );
  }
}

/// What, who and when for one entry. Pops the invoice id when the entry is about an invoice and
/// "Open invoice" is tapped.
class _DetailSheet extends StatefulWidget {
  const _DetailSheet({required this.row});

  final Map<String, dynamic> row;

  @override
  State<_DetailSheet> createState() => _DetailSheetState();
}

class _DetailSheetState extends State<_DetailSheet> {
  bool _tapped = false;

  @override
  Widget build(BuildContext context) {
    final invoiceId = activityInvoiceId(widget.row);
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          KInfoCard(title: 'Details', rows: activityDetailRows(widget.row)),
          if (invoiceId != null) ...[
            const SizedBox(height: AppSpace.md),
            KButton.secondary(
              label: 'Open invoice',
              onPressed: () {
                if (_tapped) return;
                _tapped = true;
                Navigator.of(context).pop(invoiceId);
              },
            ),
          ],
        ],
      ),
    );
  }
}

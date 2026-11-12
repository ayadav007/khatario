import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import 'lead_pickers.dart';
import 'lead_profile_screen.dart';
import 'leads_logic.dart';

const _statusOptions = <(String, String)>[('', 'Open and closed'), ('open', 'Open'), ('closed', 'Closed')];
const _typeOptions = <(String, String)>[('', 'New and existing'), ('new', 'New'), ('existing', 'Existing customers')];

/// Website `/whatsapp/leads`: every enquiry, filtered by open or closed, type, stage and source, with
/// "Add lead" and a profile for each lead. Date filters and the CSV export stay on the website.
class LeadsScreen extends StatefulWidget {
  const LeadsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<LeadsScreen> createState() => _LeadsScreenState();
}

class _LeadsScreenState extends State<LeadsScreen> {
  final _searchController = TextEditingController();
  Timer? _debounce;
  int _seq = 0;

  List<Lead> _rows = const [];
  int _total = 0;
  bool _isSupervisor = false;
  LeadPickers _pickers = const LeadPickers();
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  bool _notInPlan = false;

  String _status = '', _type = '', _stageId = '', _source = '', _ownerId = '', _search = '';

  bool get _filtered => _status.isNotEmpty || _type.isNotEmpty || _stageId.isNotEmpty || _source.isNotEmpty || _ownerId.isNotEmpty || _search.trim().isNotEmpty;

  @override
  void initState() {
    super.initState();
    _load();
    loadLeadPickers(widget.session).then((p) {
      if (mounted) setState(() => _pickers = p);
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  String _path({int offset = 0}) =>
      leadsPath(status: _status, type: _type, stageId: _stageId, source: _source, ownerId: _ownerId, search: _search, offset: offset);

  Future<void> _load() async {
    final seq = ++_seq;
    setState(() {
      _loading = true;
      _error = null;
      _notInPlan = false;
    });
    try {
      final page = leadsFrom(await widget.session.api.getJson(_path()));
      if (!mounted || seq != _seq) return;
      setState(() {
        _rows = page.rows;
        _total = page.total;
        _isSupervisor = page.isSupervisor;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted || seq != _seq) return;
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || seq != _seq) return;
      setState(() {
        _error = 'Could not reach the server.';
        _loading = false;
      });
    }
  }

  Future<void> _loadMore() async {
    if (_loadingMore) return;
    final seq = _seq;
    setState(() => _loadingMore = true);
    try {
      final page = leadsFrom(await widget.session.api.getJson(_path(offset: _rows.length)));
      // The filters changed while this page was on its way.
      if (!mounted || seq != _seq) return;
      setState(() {
        _rows = [..._rows, ...page.rows.where((r) => !_rows.any((x) => x.id == r.id))];
        _total = page.total;
      });
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not load more leads.', tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  void _setFilter(VoidCallback change) {
    setState(change);
    _load();
  }

  void _onSearch(String text) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      if (!mounted || text.trim() == _search.trim()) return;
      _setFilter(() => _search = text);
    });
  }

  void _clear() {
    _searchController.clear();
    _setFilter(() {
      _status = _type = _stageId = _source = _ownerId = _search = '';
    });
  }

  Future<void> _openLead(String id) =>
      Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => LeadProfileScreen(session: widget.session, leadId: id, isSupervisor: _isSupervisor))).then((_) {
        if (mounted) _load();
      });

  Future<void> _add() async {
    final id = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => AddLeadScreen(session: widget.session, pickers: _pickers)));
    if (id != null && mounted) await _openLead(id);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          KBackBar('Leads', trailing: _notInPlan ? null : KIconButton(icon: LucideIcons.plus, tooltip: 'Add lead', onTap: _add)),
          if (!_notInPlan) _filters(),
          Expanded(child: _body()),
        ]),
      ),
    );
  }

  Widget _filters() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.sm),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        KSearchField(controller: _searchController, hint: 'Search name or number', onChanged: _onSearch),
        const SizedBox(height: AppSpace.sm),
        KChipBar<String>(
          value: _status,
          padding: EdgeInsets.zero,
          options: _statusOptions,
          onChanged: (v) => _setFilter(() => _status = v),
        ),
        const SizedBox(height: AppSpace.sm),
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(
            child: KPickField<String>(
              label: 'Stage',
              value: _stageId,
              options: [('', 'All stages'), for (final s in _pickers.stages) (s.id, s.name)],
              onChanged: (v) => _setFilter(() => _stageId = v),
            ),
          ),
          const SizedBox(width: AppSpace.sm),
          Expanded(
            child: KPickField<String>(
              label: 'Source',
              value: _source,
              options: [('', 'All sources'), ...leadSourceFilters],
              onChanged: (v) => _setFilter(() => _source = v),
            ),
          ),
        ]),
        const SizedBox(height: AppSpace.sm),
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(
            child: KPickField<String>(label: 'Type', value: _type, options: _typeOptions, onChanged: (v) => _setFilter(() => _type = v)),
          ),
          if (_isSupervisor) ...[
            const SizedBox(width: AppSpace.sm),
            Expanded(
              child: KPickField<String>(
                label: 'Owner',
                value: _ownerId,
                options: [('', 'Everyone'), for (final p in _pickers.people) (p.id, p.name)],
                onChanged: (v) => _setFilter(() => _ownerId = v),
              ),
            ),
          ] else
            const Spacer(),
        ]),
        if (_filtered) Align(alignment: Alignment.centerLeft, child: KTextButton(label: 'Clear filters', onTap: _clear)),
      ]),
    );
  }

  Widget _body() {
    if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: AppSpace.xxl * 2));
    if (_error != null) {
      return ListView(children: [
        KEmptyState(
          icon: _notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
          title: _notInPlan ? 'Not included in your current plan' : 'Could not load leads',
          body: _error,
          action: _notInPlan ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
        ),
      ]);
    }
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xxl * 3),
        children: [
          if (_rows.isEmpty)
            KEmptyState(
              icon: LucideIcons.userSearch,
              title: _filtered ? 'No leads match these filters' : 'No leads yet',
              body: _filtered ? null : 'They appear here when someone messages you, or add one by hand.',
            )
          else ...[
            KCard(
              child: KDivided(children: [
                for (final l in _rows)
                  KListRow(
                    title: l.name,
                    subtitle: [l.summaryLine, [l.messagesText, if (l.isClosed) 'Closed'].join(' · ')].join('\n'),
                    leading: KAvatar(name: l.name),
                    trailing: Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink3),
                    onTap: () => _openLead(l.id),
                  ),
              ]),
            ),
            Padding(
              padding: const EdgeInsets.only(top: AppSpace.sm),
              child: Text('Showing ${_rows.length} of $_total', textAlign: TextAlign.center, style: AppText.caption),
            ),
            if (_rows.length < _total)
              Padding(
                padding: const EdgeInsets.only(top: AppSpace.sm),
                child: KButton.secondary(label: _loadingMore ? 'Loading…' : 'Load more', expand: false, onPressed: _loadingMore ? null : _loadMore),
              ),
          ],
        ],
      ),
    );
  }
}

/// Website "Add lead": an enquiry that came by phone or in person. A number that already has an open
/// lead returns that lead instead (`existing: true`), which then opens. Pops with the lead's id.
class AddLeadScreen extends StatefulWidget {
  const AddLeadScreen({super.key, required this.session, required this.pickers});

  final AppSession session;
  final LeadPickers pickers;

  @override
  State<AddLeadScreen> createState() => _AddLeadScreenState();
}

class _AddLeadScreenState extends State<AddLeadScreen> {
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _note = TextEditingController();
  String _source = 'call';
  String _stageId = '';
  String _ownerId = '';

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final problem = addLeadError(_name.text, _phone.text);
    if (problem != null) {
      showKToast(context, problem, tone: KTone.negative);
      return;
    }
    final body = await widget.session.api.postJson(
      addLeadPath,
      addLeadBody(name: _name.text, phone: _phone.text, source: _source, note: _note.text, stageId: _stageId, ownerId: _ownerId),
    );
    if (!mounted) return;
    final lead = body['lead'];
    final id = lead is Map ? lead['id']?.toString() : null;
    showKToast(context, body['existing'] == true ? 'This number already has an open lead' : 'Lead added', tone: body['existing'] == true ? KTone.neutral : KTone.positive);
    Navigator.of(context).pop(id);
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'Add lead',
      saveLabel: 'Save lead',
      onSave: _save,
      dirty: _name.text.isNotEmpty || _phone.text.isNotEmpty,
      children: [
        Text('For enquiries that came by phone or in person. WhatsApp leads are added on their own.', style: AppText.caption),
        KTextField(label: 'Name', controller: _name, maxLength: 120, onChanged: (_) => setState(() {})),
        KTextField(label: 'Phone', controller: _phone, hint: '98765 43210', keyboard: TextInputType.phone, onChanged: (_) => setState(() {})),
        KPickField<String>(label: 'Came by', value: _source, options: manualSources, onChanged: (v) => setState(() => _source = v)),
        KPickField<String>(
          label: 'Stage',
          value: _stageId,
          options: [('', 'First open stage'), for (final s in widget.pickers.stages) (s.id, s.name)],
          onChanged: (v) => setState(() => _stageId = v),
        ),
        KPickField<String>(
          label: 'Owner',
          value: _ownerId,
          options: [('', 'Nobody yet'), for (final p in widget.pickers.people) (p.id, p.name)],
          onChanged: (v) => setState(() => _ownerId = v),
        ),
        KTextField(label: 'Note (optional)', controller: _note, maxLines: 3, maxLength: 2000),
      ],
    );
  }
}

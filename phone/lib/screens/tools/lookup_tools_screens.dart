import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import 'calculator_logic.dart';
import 'tool_kit.dart';

const _serverTrouble = 'The server could not answer right now. Try again in a moment.';

/// Website `/tools/hsn-finder`: search HSN and SAC codes with their GST rate, from
/// `GET /api/hsn/lookup?q=&limit=`.
class HsnFinderScreen extends StatefulWidget {
  const HsnFinderScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<HsnFinderScreen> createState() => _HsnFinderScreenState();
}

class _HsnFinderScreenState extends State<HsnFinderScreen> {
  final _query = TextEditingController();
  Timer? _debounce;
  List<HsnHit>? _hits;
  bool _loading = false;
  String? _error;
  int _seq = 0;

  @override
  void dispose() {
    _debounce?.cancel();
    _query.dispose();
    super.dispose();
  }

  void _typed(String text) {
    _debounce?.cancel();
    if (text.trim().length < 2) {
      _seq++;
      setState(() {
        _hits = null;
        _error = null;
        _loading = false;
      });
      return;
    }
    setState(() {});
    _debounce = Timer(const Duration(milliseconds: 450), _search);
  }

  Future<void> _search() async {
    _debounce?.cancel();
    final q = _query.text.trim();
    if (q.length < 2) return;
    final mine = ++_seq;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final body = await widget.session.api.getData('/api/hsn/lookup?q=${Uri.encodeQueryComponent(q)}&limit=10');
      if (!mounted || mine != _seq) return;
      setState(() {
        _hits = parseHsnResults(body);
        _loading = false;
      });
    } on ApiException catch (e) {
      if (mounted && mine == _seq) setState(() { _error = e.message; _loading = false; });
    } catch (_) {
      if (mounted && mine == _seq) setState(() { _error = _serverTrouble; _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final hits = _hits;
    return ToolScaffold(
      title: 'HSN/SAC Finder',
      children: [
        KSearchField(controller: _query, hint: 'Item name or code, like T-shirt or 6109', onChanged: _typed),
        KButton(label: 'Search', icon: LucideIcons.search, loading: _loading, onPressed: _query.text.trim().length < 2 ? null : _search),
        if (_error != null)
          KEmptyState(
            icon: LucideIcons.cloudOff,
            title: 'Could not search',
            body: _error,
            action: KButton.secondary(label: 'Try again', expand: false, onPressed: _search),
          )
        else if (hits == null)
          const ToolHint('Type at least 2 letters or digits. Rates are a guide, so check the official notification.')
        else if (hits.isEmpty)
          const KEmptyState(icon: LucideIcons.tag, title: 'No HSN codes found', body: 'Try another word, or the first digits of the code.')
        else ...[
          Padding(padding: const EdgeInsets.symmetric(horizontal: 2), child: Text('${hits.length} ${hits.length == 1 ? 'result' : 'results'}', style: AppText.label)),
          KCard(child: KDivided(children: [for (final hit in hits) _HsnRow(hit: hit)])),
        ],
      ],
    );
  }
}

class _HsnRow extends StatelessWidget {
  const _HsnRow({required this.hit});

  final HsnHit hit;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Text(hit.isService ? 'SAC ${hit.code}' : 'HSN ${hit.code}', style: AppText.bodyStrong.copyWith(color: AppColors.brand, fontFeatures: AppText.tabular)),
                ]),
                const SizedBox(height: 4),
                Text(hit.description, style: AppText.body),
                if (hit.condition.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(hit.condition, style: AppText.caption),
                ],
              ],
            ),
          ),
          const SizedBox(width: AppSpace.md),
          if (hit.rateLabel != null)
            Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Text(hit.rateLabel!, style: AppText.amount.copyWith(color: AppColors.positive)),
              Text('GST rate', style: AppText.caption),
            ]),
        ],
      ),
    );
  }
}

/// Website `/tools/google-lead-extractor`: public business listings for a keyword and place, from
/// `POST /api/tools/google-leads/search`. The server limits how many searches a business can run.
class LeadExtractorScreen extends StatefulWidget {
  const LeadExtractorScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<LeadExtractorScreen> createState() => _LeadExtractorScreenState();
}

class _LeadExtractorScreenState extends State<LeadExtractorScreen> {
  final _keyword = TextEditingController();
  final _location = TextEditingController();
  final _radius = TextEditingController(text: '5');
  final _max = TextEditingController(text: '50');
  final _filter = TextEditingController();
  bool _free = true;
  bool _tried = false;
  bool _loading = false;
  String? _error;
  List<Lead>? _leads;

  @override
  void dispose() {
    _keyword.dispose();
    _location.dispose();
    _radius.dispose();
    _max.dispose();
    _filter.dispose();
    super.dispose();
  }

  int _seq = 0;

  Future<void> _search() async {
    setState(() => _tried = true);
    if (_keyword.text.trim().isEmpty || _location.text.trim().isEmpty) return;
    final km = (double.tryParse(_radius.text.trim()) ?? 5).clamp(1, 50);
    final max = (int.tryParse(_max.text.trim()) ?? 50).clamp(1, 100);
    final mine = ++_seq;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final body = await widget.session.api.postJson('/api/tools/google-leads/search', {
        'keyword': _keyword.text.trim(),
        'location': _location.text.trim(),
        'radius': (km * 1000).round(),
        'maxResults': max,
        'useFreeAPI': _free,
      });
      if (mounted && mine == _seq) setState(() { _leads = parseLeads(body); _loading = false; });
    } on ApiException catch (e) {
      if (mounted && mine == _seq) setState(() { _error = e.message; _loading = false; });
    } catch (_) {
      if (mounted && mine == _seq) setState(() { _error = _serverTrouble; _loading = false; });
    }
  }

  Future<void> _copyPhone(Lead lead) async {
    if (lead.phone.isEmpty) return;
    await Clipboard.setData(ClipboardData(text: lead.phone));
    if (mounted) showKToast(context, 'Phone number copied');
  }

  @override
  Widget build(BuildContext context) {
    final leads = _leads;
    final q = _filter.text.trim().toLowerCase();
    final shown = leads == null
        ? const <Lead>[]
        : [
            for (final l in leads)
              if (q.isEmpty || l.name.toLowerCase().contains(q) || l.address.toLowerCase().contains(q) || l.phone.contains(q) || l.website.toLowerCase().contains(q)) l,
          ];
    return ToolScaffold(
      title: 'Lead Extractor',
      children: [
        KTextField(
          label: 'Business keyword',
          controller: _keyword,
          hint: 'Interior designers, Restaurants, Plumbers',
          error: _tried && _keyword.text.trim().isEmpty ? 'Enter what to look for' : null,
        ),
        KTextField(
          label: 'Location',
          controller: _location,
          hint: 'Bangalore, Mumbai, 560001',
          error: _tried && _location.text.trim().isEmpty ? 'Enter a city or pincode' : null,
        ),
        KNumberField(label: 'Radius (km, 1 to 50)', controller: _radius, hint: '5'),
        KTextField(label: 'Most results (1 to 100)', controller: _max, keyboard: TextInputType.number, hint: '50'),
        KToggleField(label: 'Use free map data', help: 'OpenStreetMap listings. Turn off to use Google Places.', value: _free, onChanged: (v) => setState(() => _free = v)),
        KButton(label: 'Find leads', icon: LucideIcons.search, loading: _loading, onPressed: _search),
        if (_error != null)
          KEmptyState(icon: LucideIcons.cloudOff, title: 'Could not find leads', body: _error, action: KButton.secondary(label: 'Try again', expand: false, onPressed: _search))
        else if (leads != null && leads.isEmpty)
          const KEmptyState(icon: LucideIcons.target, title: 'No leads found', body: 'Try a wider radius or another keyword.')
        else if (leads != null) ...[
          KSearchField(controller: _filter, hint: 'Search within results', onChanged: (_) => setState(() {})),
          Padding(padding: const EdgeInsets.symmetric(horizontal: 2), child: Text('${shown.length} of ${leads.length} leads. Tap a lead to copy its phone number.', style: AppText.label)),
          KCard(
            child: KDivided(children: [
              for (final lead in shown)
                KListRow(
                  title: lead.name.isEmpty ? 'Unnamed' : lead.name,
                  subtitle: [lead.address, lead.phone, lead.website].where((p) => p.isNotEmpty).join(' · '),
                  trailing: lead.rating == null ? null : Text('${lead.rating!.toStringAsFixed(1)} (${enIn(lead.reviews, maxFraction: 0)})', style: AppText.small),
                  onTap: () => _copyPhone(lead),
                ),
            ]),
          ),
        ],
      ],
    );
  }
}

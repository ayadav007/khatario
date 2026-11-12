import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../hr/hr_manage_widgets.dart';
import '../sales/doc_action_sheets.dart';
import 'audience_logic.dart';

const _pageSize = 30;

/// Website `/whatsapp/unsubscribes`: numbers that opted out. Campaigns skip them. Add a number by
/// hand, search the list, and "Resubscribe" to remove one. Export to CSV stays on the website.
class UnsubscribesScreen extends StatefulWidget {
  const UnsubscribesScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<UnsubscribesScreen> createState() => _UnsubscribesScreenState();
}

class _UnsubscribesScreenState extends State<UnsubscribesScreen> with HrScreenState {
  final _search = TextEditingController();
  List<Unsubscribe> _all = const [];
  int _shown = _pageSize;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() => guardedLoad(() async {
        _all = unsubscribesFrom(await widget.session.api.getJson(unsubscribesPath));
      });

  Future<void> _add() async {
    final added = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => AddUnsubscribeScreen(session: widget.session)));
    if (added == true && mounted) _load();
  }

  Future<void> _resubscribe(Unsubscribe u) => act(
        'resub-${u.id}',
        confirm: () => askSheet(
          context,
          title: 'Resubscribe contact?',
          text: 'Remove ${u.phoneText} from the unsubscribe list? They will receive messages again.',
          confirmLabel: 'Resubscribe',
          cancelLabel: 'Keep opted out',
          danger: false,
        ),
        send: () async {
          await widget.session.api.deleteJson(unsubscribeRemovePath(u.phone));
        },
        done: '${u.phoneText} will receive messages again',
        reload: _load,
      );

  @override
  Widget build(BuildContext context) {
    final rows = filterUnsubscribes(_all, _search.text);
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          KBackBar('Unsubscribed', trailing: notInPlan ? null : KIconButton(icon: LucideIcons.plus, tooltip: 'Add number', onTap: _add)),
          Expanded(child: _body(rows)),
        ]),
      ),
    );
  }

  Widget _body(List<Unsubscribe> rows) {
    if (loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: AppSpace.xxl * 2));
    if (error != null) {
      return ListView(children: [
        KEmptyState(
          icon: notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
          title: notInPlan ? 'Not included in your current plan' : 'Could not load unsubscribed numbers',
          body: error,
          action: notInPlan ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
        ),
      ]);
    }
    final shown = rows.take(_shown).toList();
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xxl * 3),
        children: [
          Text('People who opted out of messages. Campaigns skip these numbers.', style: AppText.caption),
          const SizedBox(height: AppSpace.sm),
          KSearchField(controller: _search, hint: 'Search by phone number', onChanged: (_) => setState(() => _shown = _pageSize)),
          Padding(padding: const EdgeInsets.symmetric(vertical: AppSpace.sm), child: Text('${rows.length} total', style: AppText.caption)),
          if (rows.isEmpty)
            KEmptyState(
              icon: LucideIcons.userX,
              title: _search.text.trim().isEmpty ? 'No unsubscribed contacts' : 'No matches found',
              body: _search.text.trim().isEmpty ? null : 'Try a different search term',
            )
          else ...[
            KCard(
              child: KDivided(children: [
                for (final u in shown)
                  KListRow(
                    title: u.phoneText,
                    subtitle: u.at == null ? null : 'Unsubscribed on ${ddMMMyyyyHm(u.at!)}',
                    leading: KAvatar(name: '', icon: LucideIcons.userX, muted: true),
                    trailing: KTextButton(label: 'Resubscribe', onTap: busy.contains('resub-${u.id}') ? null : () => _resubscribe(u)),
                  ),
              ]),
            ),
            if (rows.length > shown.length)
              Padding(
                padding: const EdgeInsets.only(top: AppSpace.sm),
                child: KButton.secondary(label: 'Show more', expand: false, onPressed: () => setState(() => _shown += _pageSize)),
              ),
          ],
        ],
      ),
    );
  }
}

/// Website "Add to Unsubscribe List". Pops `true` after the number is added.
class AddUnsubscribeScreen extends StatefulWidget {
  const AddUnsubscribeScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<AddUnsubscribeScreen> createState() => _AddUnsubscribeScreenState();
}

class _AddUnsubscribeScreenState extends State<AddUnsubscribeScreen> {
  final _phone = TextEditingController();

  @override
  void dispose() {
    _phone.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final problem = unsubscribeError(_phone.text);
    if (problem != null) {
      showKToast(context, problem, tone: KTone.negative);
      return;
    }
    final reply = await widget.session.api.postJson(unsubscribesPath, unsubscribeBody(_phone.text));
    if (!mounted) return;
    showKToast(context, reply['message']?.toString() ?? 'Added to the unsubscribe list', tone: KTone.positive);
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'Add to unsubscribe list',
      saveLabel: 'Add to list',
      onSave: _save,
      dirty: _phone.text.isNotEmpty,
      children: [
        Text('Messages and campaigns will skip this number until you resubscribe it.', style: AppText.caption),
        KTextField(label: 'Phone number', controller: _phone, hint: 'e.g. 919876543210', keyboard: TextInputType.phone, onChanged: (_) => setState(() {})),
      ],
    );
  }
}

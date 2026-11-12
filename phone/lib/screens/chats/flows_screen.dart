import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../capability.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../hr/hr_manage_widgets.dart';
import '../pages/website_page_screen.dart';
import '../sales/doc_action_sheets.dart';
import 'flows_logic.dart';

/// Website `/whatsapp/flows`: guided WhatsApp journeys. The phone lists them, makes new ones (blank,
/// shop starter, or written by AI), publishes, unpublishes and deletes. The visual editor is a website
/// page; "Edit on website" opens it inside the app, signed in.
///
/// `/whatsapp/bot-rules` lands here too ([fromBotRules]), as the website redirects it: keyword rules
/// keep running until they are imported as flows and published.
class FlowsScreen extends StatefulWidget {
  const FlowsScreen({super.key, required this.session, this.capabilities, this.fromBotRules = false, this.openNew = false});

  final AppSession session;
  final Capabilities? capabilities;
  final bool fromBotRules;

  /// The website's `?new=1`: open the New flow choices straight away.
  final bool openNew;

  @override
  State<FlowsScreen> createState() => _FlowsScreenState();
}

enum _FlowAction { edit, publish, unpublish, delete }

class _FlowsScreenState extends State<FlowsScreen> with HrScreenState {
  List<FlowItem> _flows = const [];

  /// The website needs the Connect add-on (`whatsapp_bot`) for this page.
  bool get _locked {
    final caps = widget.capabilities;
    if (caps == null) return false;
    final r = caps.check('whatsapp_bot');
    return !r.allowed && r.denialReason == 'FEATURE_NOT_IN_PLAN';
  }

  @override
  void initState() {
    super.initState();
    if (_locked) {
      loading = false;
      return;
    }
    _load().then((_) {
      if (widget.openNew && mounted && error == null) _newFlow();
    });
  }

  Future<void> _load() => guardedLoad(() async {
    _flows = flowItems(await widget.session.api.getJson(flowsPath));
  });

  Future<void> _openEditor(String id, String name) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => WebsitePageScreen(session: widget.session, href: flowEditorHref(id), title: name),
      ),
    );
    if (mounted) _load();
  }

  Future<void> _actions(FlowItem f) async {
    if (busy.contains('sheet') || busy.contains('new')) return;
    busy.add('sheet');
    final _FlowAction? pick;
    try {
      pick = await showKSheet<_FlowAction>(
        context,
        title: f.name,
        builder: (ctx) => Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            KSheetAction(
              icon: LucideIcons.globe,
              label: 'Edit on website',
              subtitle: 'Open the visual flow editor',
              onTap: () => Navigator.of(ctx).pop(_FlowAction.edit),
            ),
            if (f.published)
              KSheetAction(
                icon: LucideIcons.circleX,
                label: 'Unpublish',
                subtitle: 'Stop customers starting it',
                onTap: () => Navigator.of(ctx).pop(_FlowAction.unpublish),
              )
            else
              KSheetAction(
                icon: LucideIcons.circleCheck,
                label: 'Publish',
                subtitle: 'Let customers start it',
                onTap: () => Navigator.of(ctx).pop(_FlowAction.publish),
              ),
            KSheetAction(icon: LucideIcons.trash2, label: 'Delete', danger: true, onTap: () => Navigator.of(ctx).pop(_FlowAction.delete)),
          ],
        ),
      );
    } finally {
      busy.remove('sheet');
    }
    if (pick == null || !mounted) return;
    switch (pick) {
      case _FlowAction.edit:
        await _openEditor(f.id, f.name);
      case _FlowAction.publish:
        await _publish(f);
      case _FlowAction.unpublish:
        await _unpublish(f);
      case _FlowAction.delete:
        await _delete(f);
    }
  }

  Future<void> _publish(FlowItem f) => act(
    'pub-${f.id}',
    confirm: () => askSheet(
      context,
      title: 'Publish flow?',
      text: 'Publish "${f.name}"? Customers can start it as soon as it is live.',
      confirmLabel: 'Publish flow',
      cancelLabel: 'Not now',
      danger: false,
    ),
    send: () async {
      await widget.session.api.postJson(flowPublishPath(f.id), const {});
    },
    done: '${f.name} is published',
    reload: _load,
  );

  Future<void> _unpublish(FlowItem f) => act(
    'unpub-${f.id}',
    confirm: () => askSheet(
      context,
      title: 'Unpublish flow?',
      text: 'Unpublish "${f.name}"? Customers will no longer start it. It goes back to a draft.',
      confirmLabel: 'Unpublish flow',
      cancelLabel: 'Keep it live',
      danger: false,
    ),
    send: () async {
      await widget.session.api.postJson(flowUnpublishPath(f.id), const {});
    },
    done: '${f.name} is a draft again',
    reload: _load,
  );

  Future<void> _delete(FlowItem f) => act(
    'del-${f.id}',
    confirm: () => askSheet(
      context,
      title: 'Delete flow?',
      text: 'Delete "${f.name}"? Its steps are removed and this cannot be undone.',
      confirmLabel: 'Delete flow',
      cancelLabel: 'Keep it',
    ),
    send: () async {
      await widget.session.api.deleteJson(flowPath(f.id));
    },
    done: '${f.name} deleted',
    reload: _load,
  );

  Future<void> _newFlow() async {
    // One New flow at a time: set before the choices open, kept while the flow is being made.
    if (busy.contains('new') || busy.contains('sheet')) return;
    busy.add('new');
    final String? pick;
    try {
      pick = await showKSheet<String>(
        context,
        title: 'New flow',
        builder: (ctx) => Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            KSheetAction(
              icon: LucideIcons.sparkles,
              label: 'Generate with AI',
              subtitle: 'Describe it; we save a draft',
              onTap: () => Navigator.of(ctx).pop('ai'),
            ),
            KSheetAction(
              icon: LucideIcons.store,
              label: 'Shop starter',
              subtitle: 'A ready shop order journey',
              onTap: () => Navigator.of(ctx).pop('shop'),
            ),
            KSheetAction(
              icon: LucideIcons.plus,
              label: 'Blank flow',
              subtitle: 'Start empty and build it on the website',
              onTap: () => Navigator.of(ctx).pop('blank'),
            ),
          ],
        ),
      );
    } catch (_) {
      busy.remove('new');
      rethrow;
    }
    if (pick == null || !mounted) {
      busy.remove('new');
      return;
    }
    if (pick == 'ai') {
      final made = await Navigator.of(context)
          .push<Map<String, String>>(MaterialPageRoute(builder: (_) => _GenerateFlowScreen(session: widget.session)));
      busy.remove('new');
      if (made == null || !mounted) return;
      await _load();
      if (mounted) await _openEditor(made['id']!, made['name']!);
      return;
    }
    Map<String, dynamic>? flow;
    try {
      final reply = await widget.session.api.postJson(flowsPath, newFlowBody(DateTime.now(), shopStarter: pick == 'shop'));
      flow = reply['flow'] is Map ? Map<String, dynamic>.from(reply['flow'] as Map) : null;
    } on ApiException catch (e) {
      toast(e.message);
    } catch (_) {
      toast('Could not create the flow. Try again.');
    }
    if (mounted) setState(() => busy.remove('new'));
    final id = flow?['id']?.toString();
    if (id == null || !mounted) return;
    await _load();
    if (mounted) await _openEditor(id, flow?['name']?.toString() ?? 'Flow');
  }

  Future<void> _import() async {
    if (busy.contains('import')) return;
    setState(() => busy.add('import'));
    try {
      final reply = await widget.session.api.postJson(flowsImportPath, const {});
      final n = reply['flows'] is List ? (reply['flows'] as List).length : 0;
      toast(n == 1 ? 'Imported 1 flow as a draft' : 'Imported $n flows as drafts', tone: KTone.positive);
    } on ApiException catch (e) {
      toast(e.message);
    } catch (_) {
      toast('Could not import the rules. Try again.');
    }
    if (mounted) setState(() => busy.remove('import'));
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final ready = !_locked && !loading && error == null;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KBackBar(
              'Flows',
              trailing: ready ? KIconButton(icon: LucideIcons.plus, tooltip: 'New flow', onTap: _newFlow) : null,
            ),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (_locked) {
      return ListView(
        children: const [
          KEmptyState(
            icon: LucideIcons.lock,
            title: 'Flows need Connect',
            body: 'Guided WhatsApp journeys and AI generate come with Khatario Connect. Ask the account owner to upgrade.',
          ),
        ],
      );
    }
    if (loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: AppSpace.xxl * 2));
    if (error != null) {
      return ListView(
        children: [
          KEmptyState(
            icon: notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
            title: notInPlan ? 'Not included in your current plan' : 'Could not load flows',
            body: error,
            action: notInPlan ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
          ),
        ],
      );
    }
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xxl * 3),
        children: [
          Text('Guided WhatsApp journeys. Exact keywords start a flow; anything else can go to the AI agent.', style: AppText.caption),
          if (widget.fromBotRules) ...[
            const SizedBox(height: AppSpace.md),
            KCard(
              padding: const EdgeInsets.all(AppSpace.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Keyword auto-replies still run until you import and publish them as Flows.', style: AppText.body),
                  const SizedBox(height: AppSpace.xs),
                  KTextButton(label: 'Import existing rules as drafts', onTap: busy.contains('import') ? null : _import),
                ],
              ),
            ),
          ],
          const SizedBox(height: AppSpace.md),
          if (_flows.isEmpty)
            KEmptyState(
              icon: LucideIcons.workflow,
              title: 'No flows yet',
              body: 'Generate one with AI or start from the shop template.',
              action: KButton(label: 'New flow', expand: false, onPressed: _newFlow),
            )
          else
            KCard(
              child: KDivided(
                children: [
                  for (final f in _flows)
                    KListRow(
                      title: f.name,
                      subtitle: [?f.triggers, if (f.updatedAt != null) 'Updated ${ddMMMyyyy(f.updatedAt!)}'].join(' · '),
                      leading: const KAvatar(name: '', icon: LucideIcons.workflow, muted: true),
                      trailing: KPill(label: flowStatusLabel(f.status), tone: _tone(f.status)),
                      onTap: () => _actions(f),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  KTone _tone(String status) => switch (status) {
    'published' => KTone.positive,
    'inactive' => KTone.due,
    _ => KTone.neutral,
  };
}

/// Website "Generate flow with AI". Pops `{id, name}` of the saved draft.
class _GenerateFlowScreen extends StatefulWidget {
  const _GenerateFlowScreen({required this.session});

  final AppSession session;

  @override
  State<_GenerateFlowScreen> createState() => _GenerateFlowScreenState();
}

class _GenerateFlowScreenState extends State<_GenerateFlowScreen> {
  final _prompt = TextEditingController();

  @override
  void dispose() {
    _prompt.dispose();
    super.dispose();
  }

  Future<void> _generate() async {
    final problem = generatePromptError(_prompt.text);
    if (problem != null) {
      showKToast(context, problem, tone: KTone.negative);
      return;
    }
    final reply = await widget.session.api.postJson(flowsGeneratePath, generateFlowBody(_prompt.text));
    final flow = reply['flow'];
    final id = flow is Map ? flow['id']?.toString() : null;
    if (!mounted) return;
    if (id == null) {
      showKToast(context, 'Could not generate a flow.', tone: KTone.negative);
      return;
    }
    Navigator.of(context).pop(<String, String>{'id': id, 'name': (flow as Map)['name']?.toString() ?? 'Flow'});
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'Generate flow with AI',
      saveLabel: 'Generate',
      onSave: _generate,
      dirty: _prompt.text.trim().isNotEmpty,
      children: [
        Text('Describe the shop or order journey. We save a draft; nothing goes live until you publish.', style: AppText.caption),
        KTextField(
          label: 'What should the flow do?',
          controller: _prompt,
          maxLines: 6,
          minLines: 4,
          hint: 'When a customer says order, show buttons for Browse shop, Order status and Talk to team.',
          onChanged: (_) => setState(() {}),
        ),
      ],
    );
  }
}

import 'package:dio/dio.dart' show DioException;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart' show ddMMMyyyyHm;
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../hr/hr_manage_widgets.dart';
import '../hr/pay_widgets.dart';
import '../pages/website_page_screen.dart';
import '../sales/doc_action_sheets.dart';
import 'lead_pickers.dart';
import 'lead_source_forms.dart';
import 'lead_sources_logic.dart';

/// Website `/whatsapp/lead-sources`: the new-numbers switch, tracked links, IndiaMART and lead webhooks.
/// QR-code download and the ad setup notes stay on the website (one row at the bottom).
class LeadSourcesScreen extends StatefulWidget {
  const LeadSourcesScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<LeadSourcesScreen> createState() => _LeadSourcesScreenState();
}

class _LeadSourcesScreenState extends State<LeadSourcesScreen> with HrScreenState<LeadSourcesScreen> {
  LeadSourcesPage _sources = const LeadSourcesPage(directEnabled: true, sources: []);
  EntryLinksPage _links = const EntryLinksPage(links: [], baseUrl: '');
  LeadPickers _pickers = const LeadPickers();

  @override
  void initState() {
    super.initState();
    _load();
    loadLeadPickers(widget.session, labels: true).then((p) {
      if (mounted) setState(() => _pickers = p);
    });
  }

  Future<void> _fetch() async {
    final api = widget.session.api;
    final r = await Future.wait([api.getJson(leadSourcesPath), api.getJson(entryLinksPath)]);
    if (!mounted) return;
    _sources = leadSourcesFrom(r[0]);
    _links = entryLinksFrom(r[1]);
  }

  Future<void> _load() => guardedLoad(_fetch);

  /// After an action, whether or not it worked: it may already have changed elsewhere.
  Future<void> _reload() async {
    try {
      await _fetch();
    } catch (_) {
      // Keep what is on screen; the action's own message is already shown.
    }
    if (mounted) setState(() {});
  }

  Future<void> _push(Widget screen) async {
    final result = await Navigator.of(context).push<Object>(MaterialPageRoute(builder: (_) => screen));
    if (!mounted) return;
    if (result is String) await _showWebhookUrl(result);
    await _reload();
  }

  Future<void> _copy(String text, String done) async {
    await Clipboard.setData(ClipboardData(text: text));
    toast(done, tone: KTone.positive);
  }

  Future<void> _showWebhookUrl(String url) async {
    await showKSheet<void>(
      context,
      title: 'Copy this URL now',
      builder: (ctx) => Padding(
        padding: const EdgeInsets.fromLTRB(AppSpace.lg, 0, AppSpace.lg, AppSpace.lg),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('It will not be shown again.', style: AppText.caption),
          const SizedBox(height: AppSpace.sm),
          SelectableText(url, style: AppText.small),
          const SizedBox(height: AppSpace.sm),
          Text('Send a POST with JSON: {"phone": "9876543210", "name": "Ravi", "message": "Need 20 cartons", "id": "lead-123"}. Only phone is required; id stops the same lead coming in twice.', style: AppText.caption),
          const SizedBox(height: AppSpace.md),
          KButton(label: 'Copy URL', onPressed: () => _copy(url, 'URL copied')),
        ]),
      ),
    );
  }

  Future<void> _toggleDirect(bool next) => act(
        'direct',
        confirm: () async => true,
        send: () => widget.session.api.postJson(leadSourcesPath, directBody(next)),
        done: next ? 'New numbers now go on the pipeline' : 'New numbers stay off the pipeline',
        reload: _reload,
      );

  Future<void> _setEnabled(LeadSource s, bool enabled) => act(
        'enabled-${s.id}',
        confirm: () => enabled
            ? Future.value(true)
            : askSheet(
                context,
                title: 'Pause ${s.name}?',
                text: 'No new leads come in from ${s.name} until you resume it. Leads already imported stay where they are.',
                confirmLabel: 'Pause ${s.name}',
                cancelLabel: 'Not now',
                danger: false,
              ),
        send: () => widget.session.api.patchJson(leadSourcePath(s.id), enabledBody(enabled)),
        done: enabled ? '${s.name} resumed' : '${s.name} paused',
        reload: _reload,
      );

  Future<void> _remove(LeadSource s, {required String title, required String text, required String confirmLabel, required String done}) => act(
        'remove-${s.id}',
        confirm: () => askSheet(context, title: title, text: text, confirmLabel: confirmLabel, cancelLabel: 'Not now'),
        send: () => widget.session.api.deleteJson(leadSourcePath(s.id)),
        done: done,
        reload: _reload,
      );

  Future<void> _archive(EntryLink l) => act(
        'link-${l.id}',
        confirm: () => askSheet(
          context,
          title: 'Archive ${l.name}?',
          text: 'The link and its QR code stop opening WhatsApp. Chats already credited keep their source.',
          confirmLabel: 'Archive link',
          cancelLabel: 'Not now',
        ),
        send: () => widget.session.api.patchJson(entryLinkPath(l.id), archiveBody),
        done: 'Link archived; it no longer opens WhatsApp',
        reload: _reload,
      );

  /// IndiaMART allows one pull every 5 minutes; a refusal shows IndiaMART's own words.
  Future<void> _sync() async {
    if (busy.contains('sync')) return;
    setState(() => busy.add('sync'));
    try {
      toast(syncDoneText(await widget.session.api.postJson(indiaMartSyncPath, const {})), tone: KTone.positive);
    } on ApiException catch (e) {
      toast(e.message);
    } on DioException catch (e) {
      final data = e.response?.data;
      toast(data is Map && data['error'] != null ? data['error'].toString() : 'Could not reach IndiaMART. Try again.');
    } catch (_) {
      toast('Could not sync. Try again.');
    }
    if (mounted) setState(() => busy.remove('sync'));
    await _reload();
  }

  @override
  Widget build(BuildContext context) {
    return PayListPage(
      title: 'Lead sources',
      loading: loading,
      error: error,
      notInPlan: notInPlan,
      onRetry: _load,
      emptyTitle: 'No lead sources',
      emptyBody: '',
      emptyIcon: LucideIcons.link,
      rows: [
        KToggleField(
          label: 'Add every new number to the pipeline',
          help: 'A number you do not know goes on the first stage as a "Direct" lead. Customers, suppliers and your staff stay off the board.',
          value: _sources.directEnabled,
          onChanged: busy.contains('direct') ? (_) {} : _toggleDirect,
        ),
        KCard(
          child: Padding(
            padding: const EdgeInsets.all(AppSpace.lg),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Click-to-WhatsApp ads', style: AppText.bodyStrong),
              const SizedBox(height: 4),
              Text(
                'Nothing to set up. When someone taps your Facebook or Instagram ad and messages you, the chat is marked "WhatsApp ad" and goes on the pipeline. Needs your number connected through the Meta Cloud API.',
                style: AppText.caption,
              ),
            ]),
          ),
        ),
        ..._linksSection(),
        ..._indiaMartSection(),
        ..._webhooksSection(),
        KCard(
          child: KListRow(
            title: 'More on the website',
            subtitle: 'Download a link\'s QR code and read how to connect a webhook.',
            leading: const Icon(LucideIcons.globe, size: 20, color: AppColors.ink2),
            trailing: Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink3),
            onTap: () => openWebsiteInApp(context, widget.session, '/whatsapp/lead-sources', 'Lead sources'),
          ),
        ),
      ],
    );
  }

  List<Widget> _linksSection() => [
        KSectionHeader(
          'Tracked links',
          action: 'Add link',
          onAction: () => _push(LinkFormScreen(session: widget.session, pickers: _pickers, suggestedPhone: _links.suggestedPhone)),
        ),
        if (_links.links.isEmpty)
          Text('No links yet.', style: AppText.caption)
        else
          for (final l in _links.links)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpace.sm),
              child: KCard(
                child: Padding(
                  padding: const EdgeInsets.all(AppSpace.lg),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(l.name, style: AppText.bodyStrong),
                    const SizedBox(height: 2),
                    Text(l.url(_links.baseUrl), style: AppText.small),
                    const SizedBox(height: 2),
                    Text(l.statsText, style: AppText.caption),
                    Wrap(spacing: AppSpace.xs, children: [
                      KTextButton(label: 'Copy link', onTap: () => _copy(l.url(_links.baseUrl), 'Link copied')),
                      KTextButton(label: 'Copy website button', onTap: () => _copy(l.websiteSnippet(_links.baseUrl), 'Website button copied')),
                      KTextButton(label: 'Archive', onTap: busy.contains('link-${l.id}') ? null : () => _archive(l)),
                    ]),
                  ]),
                ),
              ),
            ),
      ];

  List<Widget> _indiaMartSection() {
    final s = _sources.indiaMart;
    return [
      const KSectionHeader('IndiaMART'),
      if (s == null)
        KCard(
          child: Padding(
            padding: const EdgeInsets.all(AppSpace.lg),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text('New buy-leads become WhatsApp chats on your pipeline, with the enquiry attached.', style: AppText.caption),
              const SizedBox(height: AppSpace.md),
              KButton.secondary(
                label: 'Connect IndiaMART',
                onPressed: () => _push(IndiaMartFormScreen(session: widget.session, pickers: _pickers)),
              ),
            ]),
          ),
        )
      else
        KCard(
          child: Padding(
            padding: const EdgeInsets.all(AppSpace.lg),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                KPill(label: s.enabled ? 'Connected' : 'Paused', tone: s.enabled ? KTone.positive : KTone.neutral),
                const SizedBox(width: AppSpace.sm),
                Text('${s.leads} leads imported', style: AppText.small),
              ]),
              if (s.lastChecked.isNotEmpty) Padding(padding: const EdgeInsets.only(top: AppSpace.sm), child: Text(s.lastChecked, style: AppText.caption)),
              if (s.lastError != null)
                Padding(
                  padding: const EdgeInsets.only(top: AppSpace.sm),
                  child: Text('IndiaMART said: ${s.lastError}', style: AppText.caption.copyWith(color: AppColors.negative)),
                ),
              const SizedBox(height: AppSpace.sm),
              Wrap(spacing: AppSpace.sm, runSpacing: AppSpace.sm, children: [
                KButton.secondary(label: 'Sync now', expand: false, onPressed: !s.enabled || busy.contains('sync') ? null : _sync),
                KButton.secondary(
                  label: s.enabled ? 'Pause' : 'Resume',
                  expand: false,
                  onPressed: busy.contains('enabled-${s.id}') ? null : () => _setEnabled(s, !s.enabled),
                ),
                KButton.secondary(label: 'Settings', expand: false, onPressed: () => _push(IndiaMartFormScreen(session: widget.session, pickers: _pickers, source: s))),
                KButton.secondary(
                  label: 'Disconnect',
                  expand: false,
                  onPressed: busy.contains('remove-${s.id}')
                      ? null
                      : () => _remove(
                            s,
                            title: 'Disconnect IndiaMART?',
                            text: 'New IndiaMART leads stop coming in. Leads already imported stay where they are.',
                            confirmLabel: 'Disconnect IndiaMART',
                            done: 'IndiaMART disconnected',
                          ),
                ),
              ]),
            ]),
          ),
        ),
    ];
  }

  List<Widget> _webhooksSection() {
    final hooks = _sources.webhooks;
    return [
      KSectionHeader(
        'Lead webhooks',
        action: 'Add webhook',
        onAction: () => _push(WebhookFormScreen(session: widget.session, pickers: _pickers)),
      ),
      if (hooks.isEmpty)
        Text('No webhooks yet. A private URL turns any lead from JustDial, Facebook lead forms or your website form into a WhatsApp chat.', style: AppText.caption)
      else
        KCard(
          child: KDivided(children: [
            for (final s in hooks)
              KListRow(
                title: s.name,
                subtitle: ['…${s.tokenHint ?? ''}', '${s.leads} leads', if (s.lastRunAt != null) 'last ${ddMMMyyyyHm(s.lastRunAt!)}'].join(' · '),
                trailing: KIconButton(
                  icon: LucideIcons.trash2,
                  tooltip: 'Delete webhook',
                  onTap: () => _remove(
                    s,
                    title: 'Delete ${s.name}?',
                    text: 'Its URL stops working now.',
                    confirmLabel: 'Delete webhook',
                    done: 'Webhook deleted; its URL stops working now',
                  ),
                ),
              ),
          ]),
        ),
    ];
  }
}

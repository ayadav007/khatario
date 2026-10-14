import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../parties/party_logic.dart' show partyDay;
import '../pages/record_page.dart' show openWebsitePage;
import 'appearance_screen.dart';
import 'plan_billing_screen.dart';
import 'settings_kit.dart';

/// Loads a few JSON documents for a read-mostly settings page.
mixin _Loads<T extends StatefulWidget> on State<T> {
  bool loading = true;
  String? error;

  Future<void> fetch(Future<void> Function() body) async {
    try {
      await body();
      if (mounted) {
        setState(() {
          loading = false;
          error = null;
        });
      }
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          loading = false;
          error = e.message;
        });
      }
    }
  }
}

Future<Map<String, dynamic>> _maybe(KhatarioApi api, String path) => api.getJson(path).catchError((_) => <String, dynamic>{});

// ---------------------------------------------------------------- Accounting

class AccountingSettingsScreen extends StatefulWidget {
  const AccountingSettingsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<AccountingSettingsScreen> createState() => _AccountingSettingsScreenState();
}

class _AccountingSettingsScreenState extends State<AccountingSettingsScreen> with _Loads {
  List<Map<String, dynamic>> _years = const [];
  List<Map<String, dynamic>> _locks = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() => fetch(() async {
        final r = await Future.wait([_maybe(widget.session.api, '/api/financial-years'), _maybe(widget.session.api, '/api/period-locks')]);
        _years = jsonList(r[0]['years']);
        _locks = jsonList(r[1]['locks']).where((l) => l['is_locked'] != false).toList();
      });

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final latestLock = _locks.isEmpty
        ? null
        : _locks.map((l) => DateTime.tryParse(l['period_end']?.toString() ?? '')).whereType<DateTime>().fold<DateTime?>(null, (a, b) => a == null || b.isAfter(a) ? b : a);
    return SettingsPage(
      title: 'Accounting',
      blurb: 'Financial years, period locks and where entries post.',
      icon: LucideIcons.bookOpen,
      loading: loading,
      error: error,
      onRefresh: _load,
      children: [
        SettingsSection(title: 'Financial years', why: 'Reports, closing stock and GST use these periods.', children: [
          for (final y in _years.take(4))
            ItemSetting(
              title: y['year_code']?.toString() ?? 'Year',
              subtitle: '${partyDay(y['start_date'])} – ${partyDay(y['end_date'])}',
              trailing: Builder(builder: (_) {
                final s = DateTime.tryParse(y['start_date']?.toString() ?? '');
                final e = DateTime.tryParse(y['end_date']?.toString() ?? '');
                final current = s != null && e != null && !now.isBefore(s) && !now.isAfter(e);
                if (y['is_closed'] == true) return const KPill(label: 'Closed', tone: KTone.neutral);
                return current ? const KPill(label: 'Current', tone: KTone.positive) : const SizedBox.shrink();
              }),
            ),
          if (_years.isEmpty) const SettingRow(label: 'No financial year added', help: 'Add April–March so reports and GST know your periods.', todo: true),
          const WebSetting(label: 'Add or close a year', href: '/settings/financial-years'),
        ]),
        SettingsSection(title: 'Period locks', why: 'Stops back-dated changes after you file returns.', children: [
          WebSetting(
            label: 'Locked periods',
            value: latestLock == null ? 'Nothing locked' : 'Locked up to ${partyDay(latestLock.toIso8601String())}',
            href: '/settings/period-locks',
          ),
        ]),
        const AdvancedSection(
          title: 'Account mappings',
          why: 'Change only with your accountant. New entries post to the new account; old entries stay where they are.',
          children: [WebSetting(label: 'Sales, receivables, cash, bank and stock accounts', href: '/settings/account-mappings')],
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------- Team & access

class TeamSettingsScreen extends StatefulWidget {
  const TeamSettingsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<TeamSettingsScreen> createState() => _TeamSettingsScreenState();
}

class _TeamSettingsScreenState extends State<TeamSettingsScreen> with _Loads {
  List<Map<String, dynamic>> _users = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() => fetch(() async {
        _users = jsonList((await widget.session.api.getJson('/api/settings/users'))['users']);
      });

  @override
  Widget build(BuildContext context) {
    final active = _users.where((u) => u['is_active'] != false).toList();
    final agents = active.where((u) => u['seat_type'] == 'connect_agent' || u['seat_type'] == 'agent').length;
    return SettingsPage(
      title: 'Team & access',
      blurb: 'Who can sign in, what they can do, and which branches and warehouses they see.',
      icon: LucideIcons.users,
      loading: loading,
      error: error,
      onRefresh: _load,
      children: [
        SettingsSection(title: 'Users', why: 'Set each person’s role, branches and warehouses in one place.', children: [
          for (final u in _users)
            ItemSetting(
              leading: KAvatar(name: u['name']?.toString() ?? 'U', muted: u['is_active'] == false),
              title: u['name']?.toString() ?? 'User',
              subtitle: [u['role_name'] ?? u['role'], u['phone']].where((v) => v != null && '$v'.isNotEmpty).join(' · '),
              trailing: u['is_primary_admin'] == true
                  ? const KPill(label: 'Owner', tone: KTone.brand)
                  : u['is_active'] == false
                      ? const KPill(label: 'Inactive', tone: KTone.neutral)
                      : Icon(LucideIcons.externalLink, size: 16, color: AppColors.ink3),
              onTap: u['is_primary_admin'] == true ? null : () => openWebsitePage('/settings/users'),
            ),
          AddSetting(label: 'Invite a user', onTap: () => openWebsitePage('/employees')),
        ]),
        const SettingsSection(title: 'Roles', why: 'What each role can see and do.', children: [
          WebSetting(label: 'Roles & permissions', href: '/settings/roles'),
        ]),
        SettingsSection(title: 'WhatsApp agents', why: 'Separate logins that only answer chats.', children: [
          WebSetting(label: 'Agents', value: agents == 0 ? 'No agents yet' : '$agents agent${agents == 1 ? '' : 's'}', href: '/settings/whatsapp/team'),
        ]),
        const SettingsSection(title: 'Activity log', why: 'Who changed what, and when.', children: [
          WebSetting(label: 'Open activity log', href: '/settings/activity'),
        ]),
      ],
    );
  }
}

// ---------------------------------------------------------------- Messaging & AI

class MessagingSettingsScreen extends StatefulWidget {
  const MessagingSettingsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<MessagingSettingsScreen> createState() => _MessagingSettingsScreenState();
}

class _MessagingSettingsScreenState extends State<MessagingSettingsScreen> with _Loads {
  Map<String, dynamic> _wa = const {};
  Map<String, dynamic> _email = const {};
  final _f = DirtyFields();
  bool _saving = false;

  KhatarioApi get _api => widget.session.api;

  @override
  void initState() {
    super.initState();
    for (final k in ['from_name', 'from_email', 'reply_to_email']) {
      _f.field(k).addListener(() => setState(() {}));
    }
    _load();
  }

  @override
  void dispose() {
    _f.dispose();
    super.dispose();
  }

  Future<void> _load() => fetch(() async {
        final r = await Future.wait([_maybe(_api, '/api/whatsapp/status'), _maybe(_api, '/api/settings/email')]);
        _wa = r[0];
        _email = jsonMap(r[1]['config']);
        final defaults = jsonMap(r[1]['defaults']);
        _f.reset({
          'from_name': (_email['from_name'] ?? defaults['from_name'] ?? '').toString(),
          'from_email': (_email['from_email'] ?? defaults['from_email'] ?? '').toString(),
          'reply_to_email': (_email['reply_to_email'] ?? '').toString(),
        });
      });

  Future<void> _putEmail(Map<String, dynamic> change) =>
      _api.putJson('/api/settings/email', {
        for (final k in ['enabled', 'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'from_email', 'from_name', 'reply_to_email']) k: _email[k],
        ...change,
      });

  Future<void> _saveEmail() async {
    setState(() => _saving = true);
    try {
      await _putEmail(_f.changed);
      await _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Email settings saved')));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = _wa['status']?.toString() ?? '';
    final connected = status == 'connected';
    final phone = _wa['phoneNumber']?.toString();
    final emailOn = _email['enabled'] == true;
    final serverSet = (_email['smtp_host']?.toString() ?? '').isNotEmpty;
    return SettingsPage(
      title: 'Messaging & AI',
      blurb: 'Your WhatsApp number, templates, inbox, AI agent, email and SMS.',
      icon: LucideIcons.messageCircle,
      loading: loading,
      error: error,
      onRefresh: _load,
      dirtyCount: _f.count,
      saving: _saving,
      onSave: _saveEmail,
      onDiscard: () => setState(_f.discard),
      children: [
        SettingsSection(title: 'WhatsApp', why: 'Invoices, reminders and order updates go from this number.', children: [
          StatusSetting(
            label: phone == null || phone.isEmpty ? 'WhatsApp number' : '+$phone',
            status: connected
                ? (_wa['cloudReady'] == true ? 'Connected · Cloud API' : 'Connected')
                : status == 'qr' || status == 'connecting'
                    ? 'Waiting for scan'
                    : 'Not connected',
            tone: connected ? KTone.positive : KTone.due,
            action: connected ? 'Manage' : 'Link number',
            onAction: () => openWebsitePage('/settings/whatsapp'),
          ),
          const WebSetting(label: 'Message templates', value: 'Approved wording for invoices and updates', href: '/settings/whatsapp/templates'),
          const WebSetting(label: 'Inbox & team', value: 'Who sees which chats, saved replies', href: '/settings/whatsapp/inbox'),
          const WebSetting(label: 'AI agent', value: 'Answers questions and takes orders', href: '/settings/whatsapp/ai-agent'),
          const WebSetting(label: 'Updates for you', value: 'Evening summary on your phone', href: '/settings/whatsapp/notifications'),
        ]),
        SettingsSection(title: 'Email', why: 'Send invoices from your own address.', children: [
          ToggleSetting(
            label: 'Send email from my address',
            help: serverSet ? 'Through ${_email['smtp_host']}' : 'Add your mail server on the website first.',
            value: emailOn,
            enabled: serverSet,
            onChanged: (v) {
              final before = _email;
              setState(() => _email = {..._email, 'enabled': v});
              saveInstantly(context, message: v ? 'Email on' : 'Email off', save: () => _putEmail({'enabled': v}), revert: () => setState(() => _email = before));
            },
          ),
          TextSetting(label: 'From name', controller: _f.field('from_name')),
          TextSetting(label: 'From address', controller: _f.field('from_email'), keyboardType: TextInputType.emailAddress),
          TextSetting(label: 'Reply-to (optional)', controller: _f.field('reply_to_email'), keyboardType: TextInputType.emailAddress),
        ]),
        const AdvancedSection(title: 'Mail server', why: 'Host, port and password for your email account.', children: [
          WebSetting(label: 'SMTP settings and test email', href: '/settings/email'),
        ]),
        const SettingsSection(title: 'SMS', why: 'Text messages for buyers without WhatsApp.', children: [
          WebSetting(label: 'SMS provider', href: '/settings/integrations?category=sms'),
        ]),
      ],
    );
  }
}

// ---------------------------------------------------------------- People (HR)

class PeopleSettingsScreen extends StatelessWidget {
  const PeopleSettingsScreen({super.key, required this.session});

  final AppSession session;

  @override
  Widget build(BuildContext context) {
    return const SettingsPage(
      title: 'People',
      blurb: 'Attendance, leave, payroll and hiring for your staff.',
      icon: LucideIcons.idCard,
      loading: false,
      children: [
        SettingsSection(title: 'Time & attendance', why: 'Feeds payroll every month.', children: [
          WebSetting(label: 'Shifts', href: '/settings/shifts'),
          WebSetting(label: 'Weekly off', href: '/settings/weekly-off'),
          WebSetting(label: 'Holidays', href: '/settings/holiday-lists'),
          WebSetting(label: 'Late & absence rules', href: '/settings/attendance-policy'),
          WebSetting(label: 'Overtime', href: '/settings/ot-policy'),
          WebSetting(label: 'Attendance corrections', href: '/settings/attendance-regularization'),
        ]),
        SettingsSection(title: 'Leave', why: 'Your leave plan with its leave types inside.', children: [
          WebSetting(label: 'Leave plan and types', href: '/settings/leave-plan'),
          WebSetting(label: 'Who approves leave and expenses', href: '/settings/hr-approval'),
        ]),
        SettingsSection(title: 'Payroll', why: 'Pay day and statutory deductions.', children: [
          WebSetting(label: 'Pay day, PF, ESI & professional tax', href: '/settings/payroll'),
          WebSetting(label: 'Salary components', href: '/settings/salary-components'),
          WebSetting(label: 'Sales commission', href: '/settings/commission-rules'),
        ]),
        SettingsSection(title: 'Hiring & employee portal', why: 'Offer letters, onboarding and the staff app.', children: [
          WebSetting(label: 'Offer letter', href: '/settings/offer-letter'),
          WebSetting(label: 'Onboarding tasks', href: '/settings/onboarding-templates'),
          WebSetting(label: 'Employee portal & kiosk', href: '/settings/employee-portal'),
          WebSetting(label: 'Probation, IDs and exits', href: '/settings/hr-employee'),
        ]),
      ],
    );
  }
}

// ---------------------------------------------------------------- Plan & data

class PlanDataSettingsScreen extends StatefulWidget {
  const PlanDataSettingsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<PlanDataSettingsScreen> createState() => _PlanDataSettingsScreenState();
}

class _PlanDataSettingsScreenState extends State<PlanDataSettingsScreen> with _Loads {
  Map<String, dynamic> _sub = const {};
  Map<String, dynamic>? _backup;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() => fetch(() async {
        final r = await Future.wait([_maybe(widget.session.api, '/api/subscriptions/current'), _maybe(widget.session.api, '/api/backup/schedule')]);
        _sub = r[0];
        final s = r[1]['schedule'];
        _backup = s is Map ? Map<String, dynamic>.from(s) : null;
      });

  String get _plan {
    final sub = jsonMap(_sub['subscription']).isNotEmpty ? jsonMap(_sub['subscription']) : _sub;
    final id = sub['plan_id']?.toString() ?? '';
    if (id.isEmpty) return 'Free';
    final name = id.replaceAll('_', ' ');
    return name[0].toUpperCase() + name.substring(1);
  }

  @override
  Widget build(BuildContext context) {
    final b = _backup;
    final freq = b?['frequency']?.toString();
    return SettingsPage(
      title: 'Plan & data',
      blurb: 'Your plan, backups and how Khatario looks.',
      icon: LucideIcons.database,
      loading: loading,
      error: error,
      onRefresh: _load,
      children: [
        SettingsSection(title: 'Plan', why: 'Each product has its own plan; logins are shared.', children: [
          NavSetting(
            label: 'Plan & billing',
            value: '$_plan plan',
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => PlanBillingScreen(session: widget.session))),
          ),
          const WebSetting(label: 'Your products', value: 'Billing, HR and Connect', href: '/settings/products'),
        ]),
        SettingsSection(title: 'Backup', why: 'A full copy of your data on a schedule.', children: [
          StatusSetting(
            label: 'Automatic backup',
            status: b == null || b['is_enabled'] == false
                ? 'Off'
                : '${freq == null ? 'On' : freq[0].toUpperCase() + freq.substring(1)} · ${b['time_of_day'] ?? ''} · keep ${toNum(b['retention_days'] ?? 30).toInt()} days',
            tone: b == null || b['is_enabled'] == false ? KTone.due : KTone.positive,
            action: 'Set up',
            onAction: () => openWebsitePage('/settings/backup'),
            help: b?['last_run_at'] == null ? null : 'Last backup ${partyDay(b!['last_run_at'])}',
          ),
        ]),
        SettingsSection(title: 'Appearance', why: 'Colours and font used across Khatario for your team.', children: [
          NavSetting(
            label: 'Brand colour and font',
            value: 'Applies to the app and the website',
            onTap: () => Navigator.of(context).push(MaterialPageRoute(
              builder: (_) => Scaffold(
                backgroundColor: AppColors.bg,
                appBar: AppBar(title: const Text('Appearance')),
                body: AppearanceEditor(session: widget.session),
              ),
            )),
          ),
        ]),
        SettingsSection(title: 'Danger zone', danger: true, children: [
          SettingRow(
            label: 'Restore from a backup',
            help: 'Replaces today’s data with a backup. Done on the website, where you can preview it first.',
            trailing: KTextButton(label: 'Open', color: AppColors.negative, onTap: () => openWebsitePage('/settings/backup')),
          ),
        ]),
      ],
    );
  }
}

// ---------------------------------------------------------------- Help

class HelpSettingsScreen extends StatelessWidget {
  const HelpSettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const SettingsPage(
      title: 'Help',
      blurb: 'Guides, tours, and tools for when something is not working.',
      icon: LucideIcons.lifeBuoy,
      loading: false,
      children: [
        SettingsSection(title: 'Learn', children: [
          WebSetting(label: 'How-to guides', href: '/settings/help/how-to'),
          WebSetting(label: 'Help & support', href: '/settings/help'),
        ]),
        SettingsSection(title: 'Diagnostics', why: 'Share these with support when something does not work.', children: [
          WebSetting(label: 'Offline sync', href: '/settings/offline-sync'),
          WebSetting(label: 'Printer diagnostics', href: '/settings/bluetooth-printer/diagnostics'),
        ]),
      ],
    );
  }
}

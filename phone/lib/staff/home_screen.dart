import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../api.dart';
import '../theme.dart';
import '../ui/kit.dart';
import 'face/face_capture.dart';
import 'face/face_setup_screen.dart';
import 'location_sampler.dart';
import 'pair_screen.dart' show KInfoBanner;
import 'punch_flow.dart';
import 'staff_api.dart';

/// Today's status, the Check in / Check out button, and the last two weeks.
class StaffHomeScreen extends StatefulWidget {
  const StaffHomeScreen({super.key, required this.api, required this.flow, required this.onUnlinked});

  final StaffApi api;
  final PunchFlow flow;

  /// The server no longer knows this phone (unlinked, or linked again on another phone).
  final void Function(String message) onUnlinked;

  @override
  State<StaffHomeScreen> createState() => _StaffHomeScreenState();
}

class _StaffHomeScreenState extends State<StaffHomeScreen> {
  Map<String, dynamic>? _status;
  String? _loadError;
  bool _punching = false;
  String _progress = '';
  PunchResult? _result;
  String? _punchError;
  bool _locationSettings = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  bool _handleUnlinked(ApiException e) {
    if (e.code == 'DEVICE_REVOKED' || e.code == 'STAFF_UNSIGNED' || e.code == 'BAD_SIGNATURE') {
      widget.onUnlinked(e.message);
      return true;
    }
    return false;
  }

  Future<void> _load() async {
    try {
      final status = await widget.api.status();
      if (mounted) {
        setState(() {
          _status = status;
          _loadError = null;
        });
      }
    } on ApiException catch (e) {
      if (_handleUnlinked(e)) return;
      if (mounted) setState(() => _loadError = e.message);
    } catch (_) {
      if (mounted) setState(() => _loadError = 'Could not reach Khatario. Check the internet and pull to refresh.');
    }
  }

  String get _action {
    final today = _status?['today'] as Map?;
    return today?['check_in_time'] == null ? 'check_in' : 'check_out';
  }

  bool get _doneForToday {
    final today = _status?['today'] as Map?;
    return today?['check_in_time'] != null && today?['check_out_time'] != null;
  }

  Future<void> _punch() async {
    setState(() {
      _punching = true;
      _result = null;
      _punchError = null;
      _locationSettings = false;
      _progress = 'Starting…';
    });
    try {
      final result = await widget.flow.run(_action, onStep: (step, done, total) {
        if (!mounted) return;
        setState(() {
          _progress = switch (step) {
            PunchStep.starting => 'Starting…',
            PunchStep.face => 'Face check…',
            PunchStep.locating => 'Finding your location ($done of $total)…',
            PunchStep.wifi => 'Checking Wi-Fi…',
            PunchStep.sending => 'Sending…',
          };
        });
      });
      HapticFeedback.mediumImpact();
      if (mounted) setState(() => _result = result);
      await _load();
    } on FaceCheckCancelled catch (e) {
      if (mounted) setState(() => _punchError = e.message);
    } on LocationUnavailable catch (e) {
      if (mounted) {
        setState(() {
          _punchError = e.message;
          _locationSettings = true;
        });
      }
    } on ApiException catch (e) {
      if (_handleUnlinked(e)) return;
      if (mounted) setState(() => _punchError = e.message);
    } catch (_) {
      if (mounted) setState(() => _punchError = 'Could not reach Khatario. Check the internet and try again.');
    } finally {
      if (mounted) setState(() => _punching = false);
    }
  }

  Future<void> _setUpFace(Map face) async {
    final capturer = widget.flow.face;
    final enrollment = face['enrollment'] as Map;
    if (capturer == null) return;
    final sent = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => FaceSetupScreen(
          api: widget.api,
          capturer: capturer,
          enrollmentId: '${enrollment['id']}',
          angles: [for (final a in (enrollment['angles'] as List? ?? const ['front', 'left', 'right'])) '$a'],
          employer: (_status?['business'] as Map?)?['name']?.toString() ?? widget.api.link?.businessName ?? 'Your employer',
        ),
      ),
    );
    if (sent == true) await _load();
  }

  Widget? _faceSection(Map? face) {
    if (face == null) return null;
    final enrollment = face['enrollment'] as Map?;
    if (enrollment != null) {
      if (enrollment['consent_version'] != faceConsentVersion) {
        return const KInfoBanner(text: 'Update Khatario Staff to set up the face check.', tone: KTone.due);
      }
      return KCard(
        padding: const EdgeInsets.all(AppSpace.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Face check', style: AppText.overline),
            const SizedBox(height: AppSpace.xs),
            Text('Your manager asked you to set up the face check for check-in.', style: AppText.body),
            const SizedBox(height: AppSpace.md),
            KButton(
              key: const Key('face-setup-button'),
              label: 'Set up face check',
              icon: LucideIcons.scanFace,
              kind: KButtonKind.secondary,
              onPressed: () => _setUpFace(face),
            ),
          ],
        ),
      );
    }
    if (face['waiting_for_manager'] == true) {
      return const KInfoBanner(text: 'Face photos sent. Your manager will check and approve them.', tone: KTone.due);
    }
    if (face['enrolled'] == true) {
      return Text('Face check is on for your check-ins.', key: const Key('face-enrolled'), style: AppText.caption);
    }
    return null;
  }

  static String _time(Object? iso) {
    if (iso == null) return '';
    final t = DateTime.tryParse('$iso');
    return t == null ? '' : DateFormat('h:mm a').format(t.toLocal());
  }

  static String _day(Object? iso) {
    final t = DateTime.tryParse('$iso');
    return t == null ? '$iso' : DateFormat('EEE d MMM').format(t);
  }

  @override
  Widget build(BuildContext context) {
    final link = widget.api.link;
    final status = _status;
    final today = status?['today'] as Map?;
    final history = (status?['history'] as List? ?? const []).whereType<Map>().toList();
    final pending = (status?['pending_reviews'] as num?)?.toInt() ?? 0;
    final faceSection = _faceSection(status?['face'] as Map?);

    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _load,
          child: ListView(
            padding: const EdgeInsets.all(AppSpace.gutter),
            children: [
              Text((status?['business'] as Map?)?['name']?.toString() ?? link?.businessName ?? '', style: AppText.label),
              Text((status?['employee'] as Map?)?['name']?.toString() ?? link?.employeeName ?? '', style: AppText.title),
              const SizedBox(height: AppSpace.lg),
              if (_loadError != null) ...[
                KInfoBanner(text: _loadError!, tone: KTone.negative),
                const SizedBox(height: AppSpace.md),
              ],
              KCard(
                padding: const EdgeInsets.all(AppSpace.lg),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('Today', style: AppText.overline),
                    const SizedBox(height: AppSpace.xs),
                    Text(
                      today?['check_in_time'] == null
                          ? 'Not checked in'
                          : _doneForToday
                              ? 'In ${_time(today?['check_in_time'])} · Out ${_time(today?['check_out_time'])}'
                              : 'Checked in at ${_time(today?['check_in_time'])}',
                      style: AppText.heading,
                    ),
                    if (today?['is_late'] == true) ...[
                      const SizedBox(height: AppSpace.xs),
                      Text('Late by ${today?['late_minutes']} min', style: AppText.label.copyWith(color: AppColors.due)),
                    ],
                    const SizedBox(height: AppSpace.lg),
                    if (_doneForToday)
                      const KInfoBanner(text: 'Done for today.', tone: KTone.positive)
                    else
                      KButton(
                        key: const Key('punch-button'),
                        label: _punching ? _progress : (_action == 'check_in' ? 'Check in' : 'Check out'),
                        icon: _action == 'check_in' ? LucideIcons.logIn : LucideIcons.logOut,
                        loading: _punching,
                        onPressed: status == null || _punching ? null : _punch,
                      ),
                    if (_result != null) ...[
                      const SizedBox(height: AppSpace.md),
                      _ResultBanner(result: _result!),
                    ],
                    if (_punchError != null) ...[
                      const SizedBox(height: AppSpace.md),
                      KInfoBanner(text: _punchError!, tone: KTone.negative),
                      if (_locationSettings)
                        KTextButton(label: 'Open settings', onTap: () => widget.flow.location.openSettings()),
                    ],
                  ],
                ),
              ),
              if (faceSection != null) ...[
                const SizedBox(height: AppSpace.md),
                faceSection,
              ],
              if (pending > 0) ...[
                const SizedBox(height: AppSpace.md),
                KInfoBanner(
                  text: pending == 1
                      ? 'One check-in is waiting for your manager to review.'
                      : '$pending check-ins are waiting for your manager to review.',
                  tone: KTone.due,
                ),
              ],
              const SizedBox(height: AppSpace.xl),
              const KSectionHeader('Last two weeks'),
              if (history.isEmpty)
                Text('No attendance yet.', style: AppText.caption)
              else
                KCard(
                  child: Column(
                    children: [
                      for (final (i, h) in history.indexed) ...[
                        if (i > 0) const Divider(height: 1, color: AppColors.hairline),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: AppSpace.lg, vertical: AppSpace.md),
                          child: Row(
                            children: [
                              Expanded(child: Text(_day(h['date']), style: AppText.bodyStrong)),
                              Text(
                                h['check_in_time'] == null
                                    ? '${h['status'] ?? ''}'.replaceAll('_', ' ')
                                    : '${_time(h['check_in_time'])} – ${h['check_out_time'] == null ? '…' : _time(h['check_out_time'])}',
                                style: AppText.label,
                              ),
                            ],
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ResultBanner extends StatelessWidget {
  const _ResultBanner({required this.result});

  final PunchResult result;

  @override
  Widget build(BuildContext context) {
    final (tone, title) = switch (result.decision) {
      'accepted' => (KTone.positive, 'Done${result.siteName != null ? ' at ${result.siteName}' : ''}.'),
      'review' => (KTone.due, 'Recorded. Your manager will review it.'),
      _ => (KTone.negative, 'Not recorded.'),
    };
    final details = result.decision == 'accepted' ? const <PunchReason>[] : result.reasons;
    return Container(
      padding: const EdgeInsets.all(AppSpace.md),
      decoration: BoxDecoration(color: tone.bg, borderRadius: BorderRadius.circular(AppRadius.sm)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: AppText.bodyStrong.copyWith(color: tone.fg)),
          for (final r in details) Text('• ${r.message}', style: AppText.body.copyWith(color: tone.fg)),
        ],
      ),
    );
  }
}

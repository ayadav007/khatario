import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../session.dart';
import '../../ui/kit.dart';
import '../../theme.dart';

class AppNotification {
  const AppNotification({
    required this.id,
    required this.type,
    required this.title,
    required this.message,
    required this.isRead,
    this.referenceType,
    this.referenceId,
    this.createdAt,
  });

  final String id;
  final String type;
  final String title;
  final String message;
  final bool isRead;
  final String? referenceType;
  final String? referenceId;
  final DateTime? createdAt;

  static AppNotification fromJson(Map<String, dynamic> row) {
    final created = DateTime.tryParse(row['created_at']?.toString() ?? '');
    return AppNotification(
      id: row['id']?.toString() ?? '',
      type: row['type']?.toString() ?? '',
      title: row['title']?.toString() ?? '',
      message: row['message']?.toString() ?? '',
      isRead: row['is_read'] == true,
      referenceType: row['reference_type']?.toString(),
      referenceId: row['reference_id']?.toString(),
      createdAt: created?.toLocal(),
    );
  }

  AppNotification copyRead() => AppNotification(
        id: id,
        type: type,
        title: title,
        message: message,
        isRead: true,
        referenceType: referenceType,
        referenceId: referenceId,
        createdAt: createdAt,
      );
}

List<AppNotification> filterNotifications(List<AppNotification> all, String filter) {
  if (filter == 'unread') return all.where((n) => !n.isRead).toList();
  if (filter == 'read') return all.where((n) => n.isRead).toList();
  return all;
}

/// Rough `formatDistanceToNow(..., { addSuffix: true })`.
String timeAgo(DateTime created, DateTime now) {
  if (!created.isBefore(now)) return 'less than a minute ago';
  final seconds = now.difference(created).inSeconds;
  if (seconds < 30) return 'less than a minute ago';
  if (seconds < 90) return '1 minute ago';
  final minutes = seconds ~/ 60;
  if (minutes < 45) return '$minutes minutes ago';
  final hours = minutes ~/ 60;
  if (hours < 22) return hours == 1 ? 'about 1 hour ago' : 'about $hours hours ago';
  final days = hours ~/ 24;
  if (days < 26) return days == 1 ? '1 day ago' : '$days days ago';
  final months = days ~/ 30;
  if (months < 12) return months <= 1 ? 'about 1 month ago' : '$months months ago';
  final years = days ~/ 365;
  return years <= 1 ? 'about 1 year ago' : '$years years ago';
}

/// Where a notification tap goes. Null means the phone has no screen for it yet.
({String kind, String? id, String label})? notificationTarget(AppNotification n) {
  if (n.type == 'supplier_request') return (kind: 'route', id: null, label: 'Supplier requests');
  if (n.type == 'low_stock_alert') return (kind: 'route', id: null, label: 'Supplier dashboard');
  if (n.referenceType == 'supplier' && n.referenceId != null) return (kind: 'supplier', id: n.referenceId, label: 'Supplier');
  if (n.type == 'invoice_nearing_due' || n.type == 'invoice_overdue') {
    if (n.referenceId != null) return (kind: 'invoice', id: n.referenceId, label: 'Invoice');
    return (kind: 'invoices', id: null, label: 'Invoices');
  }
  if (n.type == 'todo_reminder') return (kind: 'route', id: null, label: 'Todo');
  if (n.type == 'store_enquiry') return (kind: 'route', id: null, label: 'Store enquiries');
  if (n.type == 'gst_compliance') return (kind: 'route', id: null, label: 'GST compliance');
  if (n.referenceType == 'whatsapp_conversation' && n.referenceId != null) {
    return (kind: 'route', id: n.referenceId, label: 'WhatsApp conversation');
  }
  return null;
}

/// `app/(app)/notifications/page.tsx`.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key, required this.session, required this.onOpen, this.onUnread});

  final AppSession session;
  final void Function(AppNotification notification) onOpen;
  final ValueChanged<int>? onUnread;

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  List<AppNotification> _all = const [];
  String _filter = 'all';
  bool _loading = true;
  String? _error;

  int get _unread => _all.where((n) => !n.isRead).length;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final body = await widget.session.api.getJson('/api/notifications?limit=20');
      final list = (body['notifications'] as List?) ?? const [];
      if (!mounted) return;
      setState(() {
        _all = list.whereType<Map>().map((e) => AppNotification.fromJson(Map<String, dynamic>.from(e))).toList();
        _loading = false;
      });
      widget.onUnread?.call(_unread);
    } catch (e) {
      if (mounted) setState(() { _error = 'Could not load notifications'; _loading = false; });
    }
  }

  Future<void> _markOne(AppNotification n) async {
    if (!n.isRead) {
      setState(() => _all = [for (final row in _all) row.id == n.id ? row.copyRead() : row]);
      widget.onUnread?.call(_unread);
      try {
        await widget.session.api.patchJson('/api/notifications/${n.id}/read', const {});
      } catch (_) {
        await _load();
      }
    }
  }

  Future<void> _markAll() async {
    setState(() => _all = [for (final row in _all) row.copyRead()]);
    widget.onUnread?.call(0);
    try {
      await widget.session.api.postJson('/api/notifications/read-all', const {});
    } catch (_) {
      await _load();
    }
  }

  (IconData, (Color, Color)) _look(AppNotification n) => switch (n.type) {
        'invoice_overdue' => (LucideIcons.circleAlert, AppTints.rose),
        'invoice_nearing_due' => (LucideIcons.clock, AppTints.amber),
        'todo_reminder' => (LucideIcons.listTodo, AppTints.indigo),
        'store_enquiry' => (LucideIcons.store, AppTints.teal),
        'gst_compliance' => (LucideIcons.badgeIndianRupee, AppTints.violet),
        _ when n.referenceType == 'whatsapp_conversation' => (LucideIcons.messageCircle, AppTints.green),
        _ => (LucideIcons.bell, AppTints.sky),
      };

  @override
  Widget build(BuildContext context) {
    final shown = filterNotifications(_all, _filter);
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              height: 64,
              child: Row(
                children: [
                  const SizedBox(width: 4),
                  KIconButton(icon: LucideIcons.arrowLeft, tooltip: 'Back', onTap: () => Navigator.of(context).pop()),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Notifications', style: AppText.heading.copyWith(fontSize: 18)),
                        Text(
                          _unread > 0 ? '$_unread unread notification${_unread == 1 ? '' : 's'}' : 'All caught up!',
                          style: AppText.caption.copyWith(fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                  if (_unread > 0) KTextButton(label: 'Mark all as read', onTap: _markAll),
                  const SizedBox(width: AppSpace.gutter),
                ],
              ),
            ),
            KChipBar<String>(
              value: _filter,
              options: [
                ('all', 'All (${_all.length})'),
                ('unread', 'Unread ($_unread)'),
                ('read', 'Read (${_all.length - _unread})'),
              ],
              onChanged: (id) => setState(() => _filter = id),
            ),
            const SizedBox(height: AppSpace.md),
            Expanded(
              child: RefreshIndicator(
                color: AppColors.brand,
                onRefresh: _load,
                child: _loading
                    ? ListView(children: const [KSpinner(padding: EdgeInsets.symmetric(vertical: 64))])
                    : _error != null
                        ? ListView(
                            children: [
                              KEmptyState(
                                icon: LucideIcons.cloudOff,
                                title: _error!,
                                action: KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
                              ),
                            ],
                          )
                        : shown.isEmpty
                            ? ListView(
                                children: [
                                  KEmptyState(
                                    icon: LucideIcons.bellOff,
                                    title: _filter == 'unread' ? 'No unread notifications' : 'No notifications',
                                    body: _filter == 'unread' ? "You're all caught up!" : "You don't have any notifications yet.",
                                  ),
                                ],
                              )
                            : ListView(
                                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.xl),
                                children: [
                                  KCard(
                                    child: KDivided(
                                      indent: 66,
                                      children: [
                                        for (final n in shown) _row(n),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _row(AppNotification n) {
    final (icon, tint) = _look(n);
    return InkWell(
      onTap: () async {
        await _markOne(n);
        if (mounted) widget.onOpen(n);
      },
      highlightColor: AppColors.sunken,
      child: Container(
        color: n.isRead ? null : AppColors.brandSoft.withValues(alpha: 0.35),
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(color: tint.$1, borderRadius: BorderRadius.circular(12)),
              child: Icon(icon, size: 18, color: tint.$2),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    n.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.bodyStrong.copyWith(fontWeight: n.isRead ? FontWeight.w500 : FontWeight.w700),
                  ),
                  if (n.message.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(n.message, maxLines: 3, overflow: TextOverflow.ellipsis, style: AppText.caption.copyWith(color: AppColors.ink2)),
                  ],
                  const SizedBox(height: 4),
                  Text(
                    n.createdAt == null ? 'Just now' : timeAgo(n.createdAt!, DateTime.now()),
                    style: AppText.caption.copyWith(fontSize: 12),
                  ),
                ],
              ),
            ),
            if (!n.isRead)
              Padding(
                padding: const EdgeInsets.only(left: 8, top: 6),
                child: Container(width: 9, height: 9, decoration: BoxDecoration(color: AppColors.brand, shape: BoxShape.circle)),
              ),
          ],
        ),
      ),
    );
  }
}

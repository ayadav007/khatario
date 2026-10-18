import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../capability.dart';
import '../../session.dart';
import '../../shell/shell_banners.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'more_navigation.dart';

/// Copy of `app/(app)/more/page.tsx` at the mobile breakpoint.
class MoreScreen extends StatefulWidget {
  const MoreScreen({
    super.key,
    required this.session,
    required this.banners,
    required this.capabilities,
    required this.warehousesEnabled,
    required this.onNavigate,
    required this.onOpen,
    required this.onSignOut,
  });

  final AppSession session;
  final ShellBannersController banners;

  /// Null until the capability snapshot is loaded (`snapshotLoaded`).
  final Capabilities? capabilities;
  final bool warehousesEnabled;

  /// A menu row: website href and label.
  final void Function(String href, String label) onNavigate;
  final ValueChanged<String> onOpen;
  final Future<void> Function() onSignOut;

  @override
  State<MoreScreen> createState() => _MoreScreenState();
}

/// Fixed colour per section so the long menu is easy to scan.
const _sectionTints = {
  'Supplier': AppTints.teal,
  'Sales': AppTints.green,
  'Purchases': AppTints.sky,
  'Inventory': AppTints.amber,
  'Accounting': AppTints.indigo,
  'Reports': AppTints.violet,
  'HR & Employees': AppTints.rose,
  'Staff': AppTints.rose,
  'Connect': AppTints.green,
  'WhatsApp': AppTints.green,
  'Tools': AppTints.orange,
  'Settings & data': AppTints.indigo,
  'Support': AppTints.sky,
};

const _sectionIcons = {
  'Supplier': LucideIcons.store,
  'Sales': LucideIcons.fileText,
  'Purchases': LucideIcons.shoppingCart,
  'Inventory': LucideIcons.package,
  'Accounting': LucideIcons.dollarSign,
  'Reports': LucideIcons.chartColumn,
  'HR & Employees': LucideIcons.userCheck,
  'Staff': LucideIcons.userCheck,
  'Connect': LucideIcons.messageSquare,
  'WhatsApp': LucideIcons.messageSquare,
  'Tools': LucideIcons.wrench,
  'Settings & data': LucideIcons.settings,
  'Support': LucideIcons.circleHelp,
};

class _MoreScreenState extends State<MoreScreen> {
  bool _isSupplier = false;
  MoreNavSection? _hrSection;
  Map<String, bool> _openSections = const {};

  @override
  void initState() {
    super.initState();
    _probeSupplier();
    _loadHrSection();
  }

  /// The server decides which HR items this user sees, so the phone matches the website.
  Future<void> _loadHrSection() async {
    try {
      final data = await widget.session.api.getJson('/api/navigation/hr').timeout(const Duration(seconds: 8));
      if (mounted) setState(() => _hrSection = parseHrNavSection(data));
    } catch (_) {
      if (mounted) setState(() => _hrSection = null);
    }
  }

  Future<void> _probeSupplier() async {
    final businessId = widget.session.businessId;
    if (businessId == null) return;
    try {
      final data = await widget.session.api
          .getJson('/api/suppliers/dashboard?supplier_business_id=$businessId')
          .timeout(const Duration(seconds: 4));
      final stats = data['stats'];
      final active = stats is Map ? stats['active_customers'] : null;
      if (mounted) setState(() => _isSupplier = (active is num ? active : 0) > 0);
    } catch (_) {
      if (mounted) setState(() => _isSupplier = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final caps = widget.capabilities;
    final sections = caps == null
        ? const <MoreNavSection>[]
        : buildMoreMenuSections(
            caps: caps,
            isSupplier: _isSupplier,
            warehousesEnabled: widget.warehousesEnabled,
            enabledModules: widget.session.raw['platform'] is Map ? widget.session.enabledModules : const ['billing'],
            hrSection: _hrSection,
          );
    return ListView(
      key: const PageStorageKey('more'),
      padding: const EdgeInsets.only(bottom: 40),
      children: [
        ShellBanners(
          controller: widget.banners,
          placement: BannerPlacement.compact,
          onOpen: widget.onOpen,
          usageStrip: true,
        ),
        Padding(
          padding: const EdgeInsets.only(top: 12),
          child: caps == null
              ? const _MenuLoading()
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
                      child: MobileAccountCard(session: widget.session, onOpen: widget.onOpen, onNavigate: widget.onNavigate),
                    ),
                    const SizedBox(height: 8),
                    for (final s in sections)
                      _MoreSection(
                        title: s.title,
                        open: _openSections[s.title] != false,
                        onToggle: () => setState(() => _openSections = toggleMoreSection(_openSections, s.title)),
                        children: [
                          for (final item in s.items)
                            MobileListRow(
                              label: item.label,
                              icon: _sectionIcons[s.title] ?? LucideIcons.fileText,
                              tint: _sectionTints[s.title],
                              locked: item.isLocked,
                              onTap: () => widget.onNavigate(item.href, item.label),
                            ),
                        ],
                      ),
                    const SizedBox(height: 24),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
                      child: _LogOutButton(onTap: widget.onSignOut),
                    ),
                    const SizedBox(height: 16),
                    Text('KHATARIO', textAlign: TextAlign.center, style: AppText.overline.copyWith(fontSize: 10, letterSpacing: 1.5)),
                  ],
                ),
        ),
      ],
    );
  }
}

class _MenuLoading extends StatelessWidget {
  const _MenuLoading();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        const KSpinner(padding: EdgeInsets.only(top: 48, bottom: 8)),
        Text('Loading menu…', style: AppText.caption),
      ],
    );
  }
}

/// `MobileAccountCard`, on the brand gradient so the More tab opens with the shop's identity.
class MobileAccountCard extends StatefulWidget {
  const MobileAccountCard({super.key, required this.session, required this.onOpen, required this.onNavigate});

  final AppSession session;
  final ValueChanged<String> onOpen;
  final void Function(String href, String label) onNavigate;

  @override
  State<MobileAccountCard> createState() => _MobileAccountCardState();
}

class _MobileAccountCardState extends State<MobileAccountCard> {
  bool _hasEmployeeProfile = false;

  @override
  void initState() {
    super.initState();
    _probeEmployee();
  }

  Future<void> _probeEmployee() async {
    final userId = widget.session.user['id']?.toString();
    final businessId = widget.session.businessId;
    if (userId == null || businessId == null) return;
    try {
      await widget.session.api.getJson('/api/employees/$userId?business_id=$businessId');
      if (mounted) setState(() => _hasEmployeeProfile = true);
    } catch (_) {
      if (mounted) setState(() => _hasEmployeeProfile = false);
    }
  }

  /// `resolveRoleLabel`.
  String get _roleLabel {
    final user = widget.session.user;
    if (widget.session.isPrimaryAdmin) return 'Primary Admin';
    final roleName = user['role_name']?.toString() ?? '';
    if (roleName.isNotEmpty) return roleName;
    if (user['role'] == 'admin') return 'Admin';
    return 'User';
  }

  @override
  Widget build(BuildContext context) {
    final user = widget.session.user;
    final name = user['name']?.toString() ?? '';
    final trimmed = name.trim();
    final initial = trimmed.isEmpty ? '?' : trimmed[0].toUpperCase();
    final email = user['email']?.toString() ?? '';
    final phone = user['phone']?.toString() ?? '';
    final contact = email.isNotEmpty ? email : phone;
    final businessName = widget.session.businessName;
    final on = AppGradients.on;

    Widget line(String text, TextStyle style) => Text(text, maxLines: 1, overflow: TextOverflow.ellipsis, softWrap: false, style: style);

    Widget link(String label, IconData icon, VoidCallback onTap) => Expanded(
          child: Material(
            color: on.withValues(alpha: 0.14),
            borderRadius: BorderRadius.circular(AppRadius.sm),
            child: InkWell(
              onTap: onTap,
              borderRadius: BorderRadius.circular(AppRadius.sm),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(icon, size: 16, color: on),
                    const SizedBox(width: 6),
                    Flexible(child: line(label, AppText.label.copyWith(color: on, fontWeight: FontWeight.w600))),
                  ],
                ),
              ),
            ),
          ),
        );

    return Semantics(
      container: true,
      label: 'Your account',
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(gradient: AppGradients.hero, borderRadius: BorderRadius.circular(20), boxShadow: AppShadow.raised),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Container(
                  width: 52,
                  height: 52,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: on.withValues(alpha: 0.16),
                    shape: BoxShape.circle,
                    border: Border.all(color: on.withValues(alpha: 0.3), width: 2),
                  ),
                  child: Text(initial, style: AppText.heading.copyWith(color: on, fontWeight: FontWeight.w700)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      line(name, AppText.bodyStrong.copyWith(color: on, fontSize: 16)),
                      if (contact.isNotEmpty) line(contact, AppText.caption.copyWith(color: on.withValues(alpha: 0.8))),
                      if (businessName.isNotEmpty) line(businessName, AppText.caption.copyWith(color: on.withValues(alpha: 0.65), fontSize: 12)),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(color: on.withValues(alpha: 0.16), borderRadius: BorderRadius.circular(999)),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(LucideIcons.shieldCheck, size: 13, color: on),
                      const SizedBox(width: 4),
                      Text(_roleLabel, style: AppText.small.copyWith(color: on)),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                if (_hasEmployeeProfile) ...[
                  link('My employee profile', LucideIcons.user, () => widget.onOpen('My employee profile')),
                  const SizedBox(width: 8),
                ],
                link('Settings', LucideIcons.settings, () => widget.onNavigate('/settings', 'Settings')),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// `MobileListSection` with a collapsible heading.
class _MoreSection extends StatelessWidget {
  const _MoreSection({required this.title, required this.open, required this.onToggle, required this.children});

  final String title;
  final bool open;
  final VoidCallback onToggle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            container: true,
            button: true,
            expanded: open,
            child: InkWell(
              onTap: onToggle,
              borderRadius: BorderRadius.circular(AppRadius.sm),
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 44),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(2, 14, 2, 8),
                  child: Row(
                    children: [
                      Expanded(child: Text(title, style: AppText.heading.copyWith(fontSize: 15))),
                      AnimatedRotation(
                        turns: open ? 0 : -0.25,
                        duration: const Duration(milliseconds: 150),
                        child: const Icon(LucideIcons.chevronDown, size: 18, color: AppColors.ink3),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          if (open) KCard(child: KDivided(indent: 62, children: children)),
        ],
      ),
    );
  }
}

/// `MobileListRow` with an icon and no extra actions.
class MobileListRow extends StatelessWidget {
  const MobileListRow({super.key, required this.label, required this.icon, required this.onTap, this.locked = false, this.tint});

  final String label;
  final IconData icon;
  final bool locked;
  final VoidCallback onTap;
  final (Color, Color)? tint;

  @override
  Widget build(BuildContext context) {
    final t = tint ?? (AppColors.brandSoft, AppColors.brand);
    return InkWell(
      onTap: onTap,
      highlightColor: AppColors.sunken,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 56),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(color: locked ? AppColors.sunken : t.$1, borderRadius: BorderRadius.circular(11)),
                child: Icon(icon, size: 18, color: locked ? AppColors.ink3 : t.$2),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Row(
                  children: [
                    Flexible(
                      child: Text(
                        label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.body.copyWith(fontWeight: FontWeight.w500, color: locked ? AppColors.ink2 : AppColors.ink),
                      ),
                    ),
                    if (locked) ...[
                      const SizedBox(width: 8),
                      Semantics(
                        label: 'Locked',
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                          decoration: BoxDecoration(color: AppColors.dueSoft, borderRadius: BorderRadius.circular(999)),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(LucideIcons.lock, size: 11, color: AppColors.due),
                              const SizedBox(width: 3),
                              Text('Upgrade', style: AppText.small.copyWith(fontSize: 10, color: AppColors.due)),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              const Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink3),
            ],
          ),
        ),
      ),
    );
  }
}

class _LogOutButton extends StatelessWidget {
  const _LogOutButton({required this.onTap});

  final Future<void> Function() onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.negativeSoft,
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: SizedBox(
          height: 52,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(LucideIcons.logOut, size: 18, color: AppColors.negative),
              const SizedBox(width: 8),
              Text('Log out', style: AppText.bodyStrong.copyWith(color: AppColors.negative)),
            ],
          ),
        ),
      ),
    );
  }
}

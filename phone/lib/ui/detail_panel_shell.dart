import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../theme.dart';
import 'kit.dart';

typedef DetailPanelTab<T> = (T id, String label, IconData icon);

class DetailMoreAction {
  const DetailMoreAction({required this.label, required this.icon, required this.onTap, this.danger = false, this.whatsApp = false});

  final String label;
  final IconData icon;
  final bool whatsApp;
  final VoidCallback onTap;
  final bool danger;
}

/// Kept for screens that still draw a bordered panel.
const detailPanelDecoration = BoxDecoration(color: AppColors.bg);

/// Full-screen detail page: back, avatar, title and subtitle, a More menu, segmented tabs,
/// a scrolling body and an optional bar pinned to the bottom.
class DetailPanelShell<T> extends StatelessWidget {
  const DetailPanelShell({
    super.key,
    required this.title,
    required this.avatar,
    required this.tabs,
    required this.activeTab,
    required this.onTabChange,
    required this.onClose,
    required this.body,
    this.subtitle = const [],
    this.moreActions = const [],
    this.header,
    this.bottomBar,
    this.actions = const [],
  });

  /// Icon buttons in the header before More (e.g. Edit).
  final List<Widget> actions;

  final String title;

  /// Pieces of the line under the title, joined with spacing.
  final List<Widget> subtitle;
  final Widget avatar;
  final List<DetailPanelTab<T>> tabs;
  final T activeTab;
  final ValueChanged<T> onTabChange;
  final VoidCallback onClose;
  final List<DetailMoreAction> moreActions;
  final Widget body;

  /// Summary card above the tabs (amount, status).
  final Widget? header;

  /// Primary actions pinned to the bottom (see `KBottomBar`).
  final Widget? bottomBar;

  void _openMore(BuildContext context) {
    showKSheet<void>(
      context,
      title: title,
      builder: (ctx) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final a in moreActions)
            KSheetAction(
              icon: a.icon,
              whatsApp: a.whatsApp,
              label: a.label,
              danger: a.danger,
              onTap: () {
                Navigator.of(ctx).pop();
                a.onTap();
              },
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: AppColors.bg,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _header(context),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.only(bottom: AppSpace.xl),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (header != null)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, 0),
                      child: header,
                    ),
                  if (tabs.length > 1)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.lg, AppSpace.gutter, 0),
                      child: KSegmented<T>(
                        value: activeTab,
                        options: [for (final (t, label, _) in tabs) (t, label)],
                        onChanged: onTabChange,
                      ),
                    ),
                  body,
                ],
              ),
            ),
          ),
          ?bottomBar,
        ],
      ),
    );
  }

  Widget _header(BuildContext context) {
    return SizedBox(
      height: 64,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpace.xs),
        child: Row(
          children: [
            KIconButton(icon: LucideIcons.arrowLeft, tooltip: 'Back', onTap: onClose),
            const SizedBox(width: 4),
            avatar,
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.heading),
                  if (subtitle.isNotEmpty)
                    DefaultTextStyle.merge(
                      style: detailSubtitleStyle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      child: Wrap(spacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: subtitle),
                    ),
                ],
              ),
            ),
            ...actions,
            if (moreActions.isNotEmpty)
              Tooltip(
                message: 'More',
                child: KIconButton(icon: LucideIcons.ellipsisVertical, tooltip: 'More', onTap: () => _openMore(context)),
              ),
          ],
        ),
      ),
    );
  }
}

const detailSubtitleStyle = TextStyle(fontSize: 13, height: 18 / 13, color: AppColors.ink3);

/// Detail panel body states that sit outside the shell: spinner and "not found".
class DetailPanelPlaceholder extends StatelessWidget {
  const DetailPanelPlaceholder({super.key, required this.loading, required this.notFoundText, required this.onClose});

  final bool loading;
  final String notFoundText;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: AppColors.bg,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.all(AppSpace.xs),
            child: KIconButton(icon: LucideIcons.arrowLeft, tooltip: 'Back', onTap: onClose),
          ),
          Expanded(
            child: Center(
              child: loading
                  ? const KSpinner()
                  : KEmptyState(
                      icon: LucideIcons.fileQuestion,
                      title: notFoundText,
                      action: KButton.secondary(label: 'Close', expand: false, onPressed: onClose),
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Empty tab state.
class DetailEmptyState extends StatelessWidget {
  const DetailEmptyState({super.key, required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => KEmptyState(icon: icon, title: text);
}

/// History timeline (`ol border-l-2 ml-2 space-y-4`, dot `-left-[7px] top-1.5`).
class DetailHistoryTimeline extends StatelessWidget {
  const DetailHistoryTimeline({super.key, required this.entries, this.dotColor});

  final List<({String description, String meta, String action})> entries;

  /// `actionDotColor`; defaults to primary-500 for every entry.
  final Color Function(String action)? dotColor;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(28, 20, 16, 16),
      child: Container(
        decoration: const BoxDecoration(border: Border(left: BorderSide(color: AppColors.hairline, width: 2))),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final (i, h) in entries.indexed)
              Padding(
                padding: EdgeInsets.only(top: i == 0 ? 0 : 16),
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    Positioned(
                      left: -7,
                      top: 6,
                      child: Container(
                        width: 12,
                        height: 12,
                        decoration: BoxDecoration(
                          color: dotColor?.call(h.action) ?? KhatarioColors.primary500,
                          shape: BoxShape.circle,
                          border: Border.all(color: AppColors.bg, width: 2),
                        ),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.only(left: 16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(h.description, style: AppText.body.copyWith(fontWeight: FontWeight.w500)),
                          const SizedBox(height: 2),
                          Text(h.meta, style: AppText.caption),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

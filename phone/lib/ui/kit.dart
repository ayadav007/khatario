import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../format.dart';
import '../theme.dart';

/// Phone component kit built on the tokens in `theme.dart`.
///
/// Cards have no border, only [AppShadow.card]. Rows inside a card are split by a hairline.
/// Pickers and menus open as bottom sheets ([showKSheet]).

/// Borderless white card.
class KCard extends StatelessWidget {
  const KCard({super.key, required this.child, this.padding = EdgeInsets.zero, this.onTap, this.margin, this.raised = false});

  final Widget child;

  /// Stronger shadow for cards that sit on the brand band.
  final bool raised;
  final EdgeInsetsGeometry padding;
  final EdgeInsetsGeometry? margin;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppRadius.lg);
    return Container(
      margin: margin,
      decoration: BoxDecoration(color: AppColors.surface, borderRadius: radius, boxShadow: raised ? AppShadow.raised : AppShadow.card),
      child: Material(
        type: MaterialType.transparency,
        borderRadius: radius,
        clipBehavior: Clip.antiAlias,
        child: onTap == null
            ? Padding(padding: padding, child: child)
            : InkWell(onTap: onTap, highlightColor: AppColors.sunken, child: Padding(padding: padding, child: child)),
      ),
    );
  }
}

/// Children separated by hairlines, for rows inside a [KCard].
class KDivided extends StatelessWidget {
  const KDivided({super.key, required this.children, this.indent = 0});

  final List<Widget> children;
  final double indent;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final (i, c) in children.indexed) ...[
          if (i > 0) Divider(height: 1, thickness: 1, indent: indent, color: AppColors.hairline),
          c,
        ],
      ],
    );
  }
}

/// `₹` set smaller and lighter than the digits, like the hero amount in the mockup.
class KAmount extends StatelessWidget {
  const KAmount(this.value, {super.key, this.style, this.maxFraction = 0, this.color});

  final num value;
  final TextStyle? style;
  final int maxFraction;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final base = (style ?? AppText.display).copyWith(color: color);
    final size = base.fontSize ?? 40;
    final negative = value < 0;
    var digits = enIn(value.abs(), maxFraction: maxFraction);
    final dot = digits.indexOf('.');
    // Paise always show two places: 277.2 -> 277.20.
    if (maxFraction == 2 && dot != -1 && digits.length - dot == 2) digits = '${digits}0';
    return Text.rich(
      TextSpan(children: [
        if (negative) TextSpan(text: '-', style: base),
        TextSpan(
          text: rupeeSign,
          style: base.copyWith(fontSize: size * 0.65, fontWeight: FontWeight.w600, color: color ?? AppColors.ink2, letterSpacing: 0),
        ),
        TextSpan(text: digits, style: base),
      ]),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      semanticsLabel: '${negative ? '-' : ''}$rupeeSign$digits',
    );
  }
}

/// Section title with an optional text action on the right ("See all").
class KSectionHeader extends StatelessWidget {
  const KSectionHeader(this.title, {super.key, this.action, this.onAction, this.trailing});

  final String title;
  final String? action;
  final VoidCallback? onAction;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(2, 0, 2, 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(child: Text(title, style: AppText.heading)),
          ?trailing,
          if (action != null)
            KTextButton(label: action!, onTap: onAction),
        ],
      ),
    );
  }
}

class KTextButton extends StatelessWidget {
  const KTextButton({super.key, required this.label, required this.onTap, this.color});

  final String label;
  final VoidCallback? onTap;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 32),
        child: Align(
          widthFactor: 1,
          child: Text(label, style: AppText.label.copyWith(fontWeight: FontWeight.w600, color: color ?? AppColors.brand)),
        ),
      ),
    );
  }
}

/// Large page title at the top of a tab's content.
class KPageTitle extends StatelessWidget {
  const KPageTitle(this.title, {super.key, this.eyebrow, this.trailing});

  final String title;
  final String? eyebrow;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, 0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (eyebrow != null) Text(eyebrow!, style: AppText.label),
                Text(title, style: AppText.title),
              ],
            ),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

/// Horizontal single-select chips. The selected chip is filled with ink.
class KChipBar<T> extends StatelessWidget {
  const KChipBar({super.key, required this.value, required this.options, required this.onChanged, this.padding, this.onDark = false});

  final T? value;
  final List<(T, String)> options;
  final ValueChanged<T> onChanged;
  final EdgeInsetsGeometry? padding;

  /// Glass chips for the brand gradient.
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: padding ?? const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
      child: Row(
        children: [
          for (final (i, (v, label)) in options.indexed) ...[
            if (i > 0) const SizedBox(width: AppSpace.sm),
            KChip(label: label, selected: v == value, onDark: onDark, onTap: () => onChanged(v)),
          ],
        ],
      ),
    );
  }
}

class KChip extends StatelessWidget {
  const KChip({super.key, required this.label, required this.selected, required this.onTap, this.icon, this.onDark = false});

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final IconData? icon;
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    final on = AppGradients.on;
    final fg = onDark ? (selected ? KhatarioColors.primary700 : on) : (selected ? Colors.white : AppColors.ink2);
    final bg = onDark ? (selected ? Colors.white : on.withValues(alpha: 0.14)) : (selected ? AppColors.ink : AppColors.sunken);
    return Semantics(
      container: true,
      button: true,
      selected: selected,
      child: Material(
        color: bg,
        borderRadius: BorderRadius.circular(999),
        child: InkWell(
          borderRadius: BorderRadius.circular(999),
          onTap: onTap,
          child: SizedBox(
            height: 36,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (icon != null) ...[Icon(icon, size: 15, color: fg), const SizedBox(width: 6)],
                  Text(label, style: AppText.label.copyWith(fontWeight: FontWeight.w600, color: fg)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Segmented control (Details / Payments / History).
class KSegmented<T> extends StatelessWidget {
  const KSegmented({super.key, required this.value, required this.options, required this.onChanged});

  final T value;
  final List<(T, String)> options;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(color: AppColors.sunken, borderRadius: BorderRadius.circular(AppRadius.md)),
      child: Row(
        children: [
          for (final (v, label) in options)
            Expanded(
              child: Semantics(
                container: true,
                button: true,
                selected: v == value,
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () => onChanged(v),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 160),
                    height: 36,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: v == value ? AppColors.surface : Colors.transparent,
                      borderRadius: BorderRadius.circular(AppRadius.sm),
                      boxShadow: v == value ? const [BoxShadow(color: Color(0x1413221E), blurRadius: 3, offset: Offset(0, 1))] : null,
                    ),
                    padding: const EdgeInsets.symmetric(horizontal: 6),
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      child: Text(
                        label,
                        maxLines: 1,
                        style: AppText.label.copyWith(fontWeight: FontWeight.w600, color: v == value ? AppColors.ink : AppColors.ink2),
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Filled search field on the sunken colour, with an optional trailing button (filters).
class KSearchField extends StatelessWidget {
  const KSearchField({
    super.key,
    required this.controller,
    required this.hint,
    this.onChanged,
    this.trailing,
    this.autofocus = false,
  });

  final TextEditingController controller;
  final String hint;
  final ValueChanged<String>? onChanged;
  final Widget? trailing;
  final bool autofocus;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 48,
      padding: const EdgeInsets.only(left: 14, right: 6),
      decoration: BoxDecoration(color: AppColors.sunken, borderRadius: BorderRadius.circular(AppRadius.md)),
      child: Row(
        children: [
          const Icon(LucideIcons.search, size: 18, color: AppColors.ink3),
          const SizedBox(width: 10),
          Expanded(
            child: TextField(
              controller: controller,
              onChanged: onChanged,
              autofocus: autofocus,
              textInputAction: TextInputAction.search,
              style: AppText.body,
              cursorColor: AppColors.ink,
              decoration: InputDecoration(
                hintText: hint,
                hintStyle: AppText.body.copyWith(color: AppColors.ink3),
                filled: false,
                isDense: true,
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                contentPadding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

/// Small square button that sits inside [KSearchField] or next to a title.
class KSquareButton extends StatelessWidget {
  const KSquareButton({super.key, required this.icon, required this.onTap, required this.label, this.active = false});

  final IconData icon;
  final VoidCallback onTap;
  final String label;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      button: true,
      label: label,
      child: Material(
        color: active ? AppColors.ink : AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        child: InkWell(
          borderRadius: BorderRadius.circular(AppRadius.sm),
          onTap: onTap,
          child: SizedBox(width: 36, height: 36, child: Icon(icon, size: 18, color: active ? Colors.white : AppColors.ink)),
        ),
      ),
    );
  }
}

/// Round 40px icon button for app bars, with an optional count badge.
class KIconButton extends StatelessWidget {
  const KIconButton({super.key, required this.icon, required this.onTap, required this.tooltip, this.badge = 0, this.color, this.dot = false});

  final IconData icon;
  final VoidCallback onTap;
  final String tooltip;
  final int badge;
  final bool dot;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      button: true,
      label: badge > 0 ? '$tooltip, $badge unread' : tooltip,
      excludeSemantics: true,
      child: SizedBox(
        width: 44,
        height: 44,
        child: Material(
          type: MaterialType.transparency,
          shape: const CircleBorder(),
          child: InkWell(
            customBorder: const CircleBorder(),
            highlightColor: AppColors.sunken,
            onTap: onTap,
            child: Stack(
              clipBehavior: Clip.none,
              alignment: Alignment.center,
              children: [
                Icon(icon, size: 22, color: color ?? AppColors.ink),
                if (badge > 0)
                  Positioned(top: 6, right: 4, child: KBadge(count: badge))
                else if (dot)
                  Positioned(
                    top: 11,
                    right: 12,
                    child: Container(
                      width: 9,
                      height: 9,
                      decoration: BoxDecoration(
                        color: AppColors.negative,
                        shape: BoxShape.circle,
                        border: Border.all(color: AppColors.bg, width: 2),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class KBadge extends StatelessWidget {
  const KBadge({super.key, required this.count, this.border = AppColors.surface});

  final int count;
  final Color border;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 18,
      constraints: const BoxConstraints(minWidth: 18),
      padding: const EdgeInsets.symmetric(horizontal: 4),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: AppColors.negative,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: border, width: 2),
      ),
      child: Text(
        count > 99 ? '99+' : '$count',
        style: const TextStyle(color: Colors.white, fontSize: 10, height: 1, fontWeight: FontWeight.w700),
      ),
    );
  }
}

/// Circle with initials. [seed] picks a stable tint so the same party keeps its colour.
class KAvatar extends StatelessWidget {
  const KAvatar({super.key, required this.name, this.size = 40, this.muted = false, this.icon});

  final String name;
  final double size;
  final bool muted;
  final IconData? icon;

  static String initials(String name) {
    final words = name.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty && RegExp(r'[A-Za-z0-9]').hasMatch(w[0])).toList();
    if (words.isEmpty) return '';
    if (words.length == 1) return words.first.substring(0, words.first.length.clamp(0, 2)).toUpperCase();
    return (words.first[0] + words.last[0]).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final bg = muted ? AppColors.sunken : AppColors.brandSoft;
    final fg = muted ? AppColors.ink2 : AppColors.brandStrong;
    final text = initials(name);
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
      child: icon != null || text.isEmpty
          ? Icon(icon ?? LucideIcons.user, size: size * 0.45, color: fg)
          : Text(text, style: TextStyle(fontSize: size * 0.35, fontWeight: FontWeight.w600, color: fg, height: 1)),
    );
  }
}

/// List row: leading, title over subtitle, trailing. At least 64px tall.
class KListRow extends StatelessWidget {
  const KListRow({
    super.key,
    required this.title,
    this.subtitle,
    this.leading,
    this.trailing,
    this.onTap,
    this.onLongPress,
    this.padding = const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
  });

  final String title;
  final String? subtitle;
  final Widget? leading;
  final Widget? trailing;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final content = ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 64),
      child: Padding(
        padding: padding,
        child: Row(
          children: [
            if (leading != null) ...[leading!, const SizedBox(width: AppSpace.md)],
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.bodyStrong),
                  if (subtitle != null && subtitle!.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(subtitle!, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.caption),
                  ],
                ],
              ),
            ),
            if (trailing != null) ...[const SizedBox(width: AppSpace.md), trailing!],
          ],
        ),
      ),
    );
    if (onTap == null && onLongPress == null) return content;
    return InkWell(onTap: onTap, onLongPress: onLongPress, highlightColor: AppColors.sunken, child: content);
  }
}

enum KTone { positive, due, negative, neutral, brand }

extension KToneColors on KTone {
  Color get fg => switch (this) {
        KTone.positive => AppColors.positive,
        KTone.due => AppColors.due,
        KTone.negative => AppColors.negative,
        KTone.neutral => AppColors.ink3,
        KTone.brand => AppColors.brand,
      };

  Color get bg => switch (this) {
        KTone.positive => AppColors.positiveSoft,
        KTone.due => AppColors.dueSoft,
        KTone.negative => AppColors.negativeSoft,
        KTone.neutral => AppColors.sunken,
        KTone.brand => AppColors.brandSoft,
      };
}

/// Document and payment statuses mapped to a tone and a short label.
(KTone, String) statusTone(String status) {
  final s = status.toLowerCase();
  return switch (s) {
    'paid' => (KTone.positive, 'Paid'),
    'final' => (KTone.brand, 'Final'),
    'unpaid' => (KTone.due, 'Unpaid'),
    'partial' || 'partial_paid' || 'partially_paid' => (KTone.due, 'Part paid'),
    'overdue' => (KTone.negative, 'Overdue'),
    'cancelled' => (KTone.negative, 'Cancelled'),
    'requires_review' => (KTone.due, 'Review'),
    'pending' => (KTone.due, 'Pending'),
    'draft' => (KTone.neutral, 'Draft'),
    _ => (KTone.neutral, s.isEmpty ? s : s[0].toUpperCase() + s.substring(1).replaceAll('_', ' ')),
  };
}

/// Coloured dot plus a word. Used under amounts in lists.
class KStatusDot extends StatelessWidget {
  const KStatusDot({super.key, required this.label, required this.tone});

  KStatusDot.status(String status, {super.key})
      : label = statusTone(status).$2,
        tone = statusTone(status).$1;

  final String label;
  final KTone tone;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(width: 6, height: 6, decoration: BoxDecoration(color: tone.fg, shape: BoxShape.circle)),
        const SizedBox(width: 5),
        Text(label, style: AppText.small.copyWith(color: tone.fg)),
      ],
    );
  }
}

/// Filled pill (detail hero: "Unpaid · ₹74 due").
class KPill extends StatelessWidget {
  const KPill({super.key, required this.label, required this.tone, this.icon});

  final String label;
  final KTone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 28,
      padding: const EdgeInsets.symmetric(horizontal: 10),
      decoration: BoxDecoration(color: tone.bg, borderRadius: BorderRadius.circular(999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[Icon(icon, size: 14, color: tone.fg), const SizedBox(width: 6)],
          Text(label, style: AppText.small.copyWith(color: tone.fg)),
        ],
      ),
    );
  }
}

enum KButtonKind { primary, secondary, ghost, danger }

/// 50px button. [expand] fills the width.
class KButton extends StatelessWidget {
  const KButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.kind = KButtonKind.primary,
    this.icon,
    this.loading = false,
    this.expand = true,
    this.height = 50,
  });

  const KButton.secondary({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.loading = false,
    this.expand = true,
    this.height = 50,
  }) : kind = KButtonKind.secondary;

  final String label;
  final VoidCallback? onPressed;
  final KButtonKind kind;
  final IconData? icon;
  final bool loading;
  final bool expand;
  final double height;

  @override
  Widget build(BuildContext context) {
    final disabled = loading || onPressed == null;
    final (bg, fg) = switch (kind) {
      KButtonKind.primary => (AppColors.brand, AppColors.onBrand),
      KButtonKind.secondary => (AppColors.sunken, AppColors.ink),
      KButtonKind.ghost => (Colors.transparent, AppColors.brand),
      KButtonKind.danger => (AppColors.negative, Colors.white),
    };
    return Opacity(
      opacity: disabled && !loading ? 0.45 : 1,
      child: SizedBox(
        height: height,
        width: expand ? double.infinity : null,
        child: Material(
          color: bg,
          borderRadius: BorderRadius.circular(AppRadius.md),
          child: InkWell(
            borderRadius: BorderRadius.circular(AppRadius.md),
            onTap: disabled ? null : onPressed,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 18),
              child: Row(
                mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (loading)
                    SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: fg))
                  else if (icon != null)
                    Icon(icon, size: 19, color: fg),
                  if ((loading || icon != null) && label.isNotEmpty) const SizedBox(width: 8),
                  if (label.isNotEmpty)
                    Flexible(
                      child: Text(label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppText.bodyStrong.copyWith(color: fg)),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Square 50px secondary icon button for bottom bars.
class KIconTile extends StatelessWidget {
  const KIconTile({super.key, required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: label,
      child: Semantics(
        container: true,
        button: true,
        label: label,
        excludeSemantics: true,
        child: Material(
          color: AppColors.sunken,
          borderRadius: BorderRadius.circular(AppRadius.md),
          child: InkWell(
            borderRadius: BorderRadius.circular(AppRadius.md),
            onTap: onTap,
            child: SizedBox(width: 50, height: 50, child: Icon(icon, size: 20, color: AppColors.ink)),
          ),
        ),
      ),
    );
  }
}

/// Floating primary action ("New bill").
class KFab extends StatelessWidget {
  const KFab({super.key, required this.label, required this.onTap, this.icon = LucideIcons.plus});

  final String label;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      button: true,
      label: label,
      excludeSemantics: true,
      child: Container(
        decoration: BoxDecoration(borderRadius: BorderRadius.circular(18), boxShadow: AppShadow.fab),
        child: Material(
          color: AppColors.brand,
          borderRadius: BorderRadius.circular(18),
          child: InkWell(
            borderRadius: BorderRadius.circular(18),
            onTap: onTap,
            child: Container(
              height: 54,
              padding: const EdgeInsets.only(left: 16, right: 20),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(icon, size: 22, color: AppColors.onBrand),
                  const SizedBox(width: 8),
                  Text(label, style: AppText.bodyStrong.copyWith(color: AppColors.onBrand)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// White bar pinned to the bottom of a detail or form screen.
class KBottomBar extends StatelessWidget {
  const KBottomBar({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.hairline)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.md, AppSpace.gutter, AppSpace.md),
          child: Row(
            children: [
              for (final (i, c) in children.indexed) ...[
                if (i > 0) const SizedBox(width: 10),
                c,
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Icon in a soft circle, a title and an optional line of help.
class KEmptyState extends StatelessWidget {
  const KEmptyState({super.key, required this.icon, required this.title, this.body, this.action});

  final IconData icon;
  final String title;
  final String? body;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpace.xl, vertical: 40),
      child: Column(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: const BoxDecoration(color: AppColors.sunken, shape: BoxShape.circle),
            child: Icon(icon, size: 24, color: AppColors.ink2),
          ),
          const SizedBox(height: AppSpace.md),
          Text(title, textAlign: TextAlign.center, style: AppText.bodyStrong),
          if (body != null) ...[
            const SizedBox(height: 4),
            Text(body!, textAlign: TextAlign.center, style: AppText.caption),
          ],
          if (action != null) ...[const SizedBox(height: AppSpace.lg), action!],
        ],
      ),
    );
  }
}

class KSpinner extends StatelessWidget {
  const KSpinner({super.key, this.size = 24, this.padding = const EdgeInsets.symmetric(vertical: 40)});

  final double size;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding,
      child: Center(
        child: SizedBox(width: size, height: size, child: CircularProgressIndicator(strokeWidth: 2.5, color: AppColors.brand)),
      ),
    );
  }
}

/// Bottom sheet with a grabber, optional title and close button.
Future<T?> showKSheet<T>(
  BuildContext context, {
  String? title,
  required WidgetBuilder builder,
  bool scrollable = false,
}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: AppColors.surface,
    barrierColor: AppColors.scrim,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet))),
    builder: (ctx) => SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                margin: const EdgeInsets.only(top: 8, bottom: 4),
                width: 36,
                height: 4,
                decoration: BoxDecoration(color: AppColors.hairline, borderRadius: BorderRadius.circular(4)),
              ),
            ),
            if (title != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 4, 8, 4),
                child: Row(
                  children: [
                    Expanded(child: Text(title, style: AppText.heading)),
                    KIconButton(icon: LucideIcons.x, tooltip: 'Close', onTap: () => Navigator.of(ctx).pop()),
                  ],
                ),
              ),
            Flexible(child: scrollable ? SingleChildScrollView(child: builder(ctx)) : builder(ctx)),
            const SizedBox(height: AppSpace.sm),
          ],
        ),
      ),
    ),
  );
}

/// One tappable row in an action sheet.
class KSheetAction extends StatelessWidget {
  const KSheetAction({super.key, required this.icon, required this.label, required this.onTap, this.danger = false, this.selected = false, this.subtitle});

  final IconData icon;
  final String label;
  final String? subtitle;
  final VoidCallback onTap;
  final bool danger;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final fg = danger ? AppColors.negative : AppColors.ink;
    return InkWell(
      onTap: onTap,
      highlightColor: AppColors.sunken,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 56),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: danger ? AppColors.negativeSoft : (selected ? AppColors.brandSoft : AppColors.sunken),
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                ),
                child: Icon(icon, size: 18, color: danger ? AppColors.negative : (selected ? AppColors.brand : AppColors.ink)),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(label, style: AppText.bodyStrong.copyWith(color: fg, fontWeight: FontWeight.w500)),
                    if (subtitle != null) Text(subtitle!, style: AppText.caption),
                  ],
                ),
              ),
              if (selected) Icon(LucideIcons.check, size: 20, color: AppColors.brand),
            ],
          ),
        ),
      ),
    );
  }
}

/// Single-choice picker as a bottom sheet (replaces the Chrome `<select>` dialog).
Future<void> showKPicker<T>(
  BuildContext context, {
  required String title,
  required T value,
  required List<(T, String)> options,
  required ValueChanged<T> onChanged,
}) async {
  final picked = await showKSheet<T>(
    context,
    title: title,
    scrollable: true,
    builder: (ctx) => Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final (v, label) in options)
          InkWell(
            onTap: () => Navigator.of(ctx).pop(v),
            highlightColor: AppColors.sunken,
            child: Container(
              constraints: const BoxConstraints(minHeight: 52),
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Row(
                children: [
                  Expanded(child: Text(label, style: AppText.body.copyWith(fontWeight: v == value ? FontWeight.w600 : FontWeight.w400))),
                  if (v == value) Icon(LucideIcons.check, size: 20, color: AppColors.brand),
                ],
              ),
            ),
          ),
      ],
    ),
  );
  if (picked != null && picked != value) onChanged(picked);
}

/// Section title plus a card of label / value rows.
class KInfoCard extends StatelessWidget {
  const KInfoCard({super.key, required this.title, required this.rows, this.child});

  final String title;
  final List<(String, String)> rows;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        KSectionHeader(title),
        KCard(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final (i, (label, value)) in rows.indexed) ...[
                if (i > 0) const Divider(height: 1, color: AppColors.hairline),
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SizedBox(width: 120, child: Text(label, style: AppText.caption.copyWith(color: AppColors.ink2))),
                      Expanded(child: Text(value, style: AppText.body.copyWith(fontWeight: FontWeight.w500))),
                    ],
                  ),
                ),
              ],
              ?child,
            ],
          ),
        ),
      ],
    );
  }
}

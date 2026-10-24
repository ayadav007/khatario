import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../theme.dart';
import 'kit.dart';

/// Shared form widgets named after the website's `components/ui/*`, drawn with the phone
/// tokens in `theme.dart`. New screens should use `kit.dart` directly.
class WebCard extends StatelessWidget {
  const WebCard({super.key, required this.child, this.padding = 16});

  final Widget child;
  final double padding;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(padding),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        boxShadow: AppShadow.card,
      ),
      child: child,
    );
  }
}

class WebInput extends StatefulWidget {
  const WebInput({
    super.key,
    required this.label,
    required this.controller,
    this.placeholder,
    this.keyboardType,
    this.obscureText = false,
    this.autofocus = false,
    this.maxLength,
    this.digitsOnly = false,
    this.onSubmitted,
  });

  final String label;
  final TextEditingController controller;
  final String? placeholder;
  final TextInputType? keyboardType;
  final bool obscureText;
  final bool autofocus;
  final int? maxLength;
  final bool digitsOnly;
  final ValueChanged<String>? onSubmitted;

  @override
  State<WebInput> createState() => _WebInputState();
}

class _WebInputState extends State<WebInput> {
  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          widget.label,
          style: AppText.label,
        ),
        const SizedBox(height: 6),
        TextField(
          controller: widget.controller,
          keyboardType: widget.keyboardType,
          obscureText: widget.obscureText,
          autofocus: widget.autofocus,
          maxLength: widget.maxLength,
          onSubmitted: widget.onSubmitted,
          onChanged: widget.digitsOnly
              ? (value) {
                  final digits = value.replaceAll(RegExp(r'\D'), '');
                  final limited = widget.maxLength != null && digits.length > widget.maxLength!
                      ? digits.substring(0, widget.maxLength)
                      : digits;
                  if (limited != value) {
                    widget.controller.value = TextEditingValue(
                      text: limited,
                      selection: TextSelection.collapsed(offset: limited.length),
                    );
                  }
                }
              : null,
          style: AppText.body.copyWith(fontSize: 16, height: 24 / 16),
          cursorColor: AppColors.ink,
          decoration: InputDecoration(
            hintText: widget.placeholder,
            counterText: '',
            isDense: true,
            filled: true,
            fillColor: AppColors.surface,
            hintStyle: AppText.body.copyWith(fontSize: 16, height: 24 / 16, color: AppColors.ink3),
            contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
            constraints: const BoxConstraints(minHeight: 50),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(AppRadius.md),
              borderSide: const BorderSide(color: AppColors.hairline, width: 1.5),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(AppRadius.md),
              borderSide: BorderSide(color: AppColors.brand, width: 2),
            ),
          ),
        ),
      ],
    );
  }
}

class WebButton extends StatelessWidget {
  const WebButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.loading = false,
    this.height = 50,
    this.radius = AppRadius.md,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool loading;
  final double height;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final disabled = loading || onPressed == null;
    return Opacity(
      opacity: disabled ? 0.5 : 1,
      child: SizedBox(
        width: double.infinity,
        height: height,
        child: Material(
          color: AppColors.brand,
          borderRadius: BorderRadius.circular(radius),
          child: InkWell(
            borderRadius: BorderRadius.circular(radius),
            onTap: disabled ? null : onPressed,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (loading) ...[
                  SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.onBrand),
                  ),
                  const SizedBox(width: 8),
                ],
                Flexible(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.bodyStrong.copyWith(color: AppColors.onBrand),
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

enum WebAlertTone { error, info, warning }

/// `p-3 text-sm rounded-md` banners used on the website forms.
class WebAlert extends StatelessWidget {
  const WebAlert({super.key, required this.message, required this.tone});

  final String message;
  final WebAlertTone tone;

  @override
  Widget build(BuildContext context) {
    final (bg, fg, border) = switch (tone) {
      WebAlertTone.error => (const Color(0xFFFEF2F2), const Color(0xFFDC2626), null),
      WebAlertTone.info => (const Color(0xFFF0FDF4), const Color(0xFF166534), const Color(0xFFBBF7D0)),
      WebAlertTone.warning => (const Color(0xFFFFFBEB), const Color(0xFF78350F), const Color(0xFFFDE68A)),
    };
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: border == null ? null : Border.all(color: border),
      ),
      child: Text(message, style: TextStyle(color: fg, fontSize: 14, height: 20 / 14)),
    );
  }
}

/// Single-choice picker for the `<select>` copies. Opens as a bottom sheet on the phone.
Future<void> pickWebSelectOption<T>(
  BuildContext context, {
  required T value,
  required List<(T, String)> options,
  required ValueChanged<T> onChanged,
  String title = 'Choose',
}) =>
    showKPicker<T>(context, title: title, value: value, options: options, onChanged: onChanged);

/// Full-width native `<select className="input ...">` with the Chrome arrow.
class WebFieldSelect<T> extends StatelessWidget {
  const WebFieldSelect({
    super.key,
    required this.value,
    required this.options,
    required this.onChanged,
    this.height = 50,
    this.radius = AppRadius.md,
    this.enabled = true,
  });

  final T value;
  final List<(T, String)> options;
  final ValueChanged<T> onChanged;
  final double height;
  final double radius;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final label = options.firstWhere((o) => o.$1 == value, orElse: () => options.first).$2;
    return Opacity(
      opacity: enabled ? 1 : 0.5,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: enabled ? () => pickWebSelectOption(context, value: value, options: options, onChanged: onChanged) : null,
        child: Container(
          height: height,
          padding: const EdgeInsets.only(left: 14, right: 12),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(radius),
            border: Border.all(color: AppColors.hairline, width: 1.5),
          ),
          child: Row(
            children: [
              Expanded(
                child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.body),
              ),
              const Icon(LucideIcons.chevronDown, size: 18, color: AppColors.ink2),
            ],
          ),
        ),
      ),
    );
  }
}

/// `components/ui/StatusBadge.tsx`, drawn as a soft pill.
class WebStatusBadge extends StatelessWidget {
  const WebStatusBadge({super.key, required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final (tone, label) = statusTone(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
      decoration: BoxDecoration(color: tone.bg, borderRadius: BorderRadius.circular(999)),
      child: Text(label, style: AppText.small.copyWith(color: tone.fg)),
    );
  }
}

/// `Button variant="secondary"` (`.button-secondary`).
class WebSecondaryButton extends StatelessWidget {
  const WebSecondaryButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.height = 44,
    this.expand = false,
    this.fontSize = 14,
    this.radius = AppRadius.sm,
    this.loading = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final double height;
  final bool expand;
  final double fontSize;
  final double radius;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    final disabled = loading || onPressed == null;
    return Opacity(
      opacity: disabled ? 0.5 : 1,
      child: SizedBox(
        height: height,
        width: expand ? double.infinity : null,
        child: Material(
          color: AppColors.sunken,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radius)),
          child: InkWell(
            borderRadius: BorderRadius.circular(radius),
            highlightColor: AppColors.hairline,
            onTap: disabled ? null : onPressed,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Center(
                widthFactor: 1,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (loading) ...[
                      const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2, color: KhatarioColors.ink),
                      ),
                      const SizedBox(width: 8),
                    ],
                    Text(label,
                        style: AppText.label.copyWith(fontSize: fontSize, fontWeight: FontWeight.w600, color: AppColors.ink)),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Small native `<select>` (`h-8 rounded-md border px-2 py-1 text-caption`). Tapping opens
/// the same option list Chrome shows on Android.
class WebSelect<T> extends StatelessWidget {
  const WebSelect({super.key, required this.value, required this.options, required this.onChanged});

  final T value;
  final List<(T, String)> options;
  final ValueChanged<T> onChanged;

  String get _label => options.firstWhere((o) => o.$1 == value, orElse: () => options.first).$2;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => pickWebSelectOption(context, value: value, options: options, onChanged: onChanged),
      child: Container(
        height: 32,
        padding: const EdgeInsets.only(left: 12, right: 8),
        decoration: BoxDecoration(color: AppColors.sunken, borderRadius: BorderRadius.circular(999)),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(_label, style: AppText.small.copyWith(color: AppColors.ink)),
            const SizedBox(width: 6),
            const Icon(LucideIcons.chevronDown, size: 14, color: AppColors.ink2),
          ],
        ),
      ),
    );
  }
}

/// Plain text button, no background (website `<button>` text links).
class WebTextLink extends StatelessWidget {
  const WebTextLink({
    super.key,
    required this.label,
    required this.onTap,
    this.color = KhatarioColors.inkSecondary,
    this.bold = false,
  });

  final String label;
  final VoidCallback onTap;
  final Color color;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 14,
          height: 20 / 14,
          fontWeight: bold ? FontWeight.w500 : FontWeight.w400,
        ),
      ),
    );
  }
}

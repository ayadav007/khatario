import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';

/// A tool page: back bar, then scrolling content.
class ToolScaffold extends StatelessWidget {
  const ToolScaffold({super.key, required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KBackBar(title),
            Expanded(
              child: ListView(
                keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xxl),
                children: [
                  for (final (i, child) in children.indexed) ...[
                    if (i > 0) const SizedBox(height: AppSpace.md),
                    child,
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Screen state whose text fields rebuild the page on every keystroke, so a result follows the
/// typing. Controllers made with [field] are disposed with the screen.
abstract class CalcState<T extends StatefulWidget> extends State<T> {
  final _made = <TextEditingController>[];

  TextEditingController field([String text = '']) {
    final controller = TextEditingController(text: text);
    controller.addListener(_changed);
    _made.add(controller);
    return controller;
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    for (final c in _made) {
      c.dispose();
    }
    super.dispose();
  }
}

/// A decimal number field (rates, years, percentages).
class KNumberField extends StatelessWidget {
  const KNumberField({super.key, required this.label, required this.controller, this.hint, this.error, this.onChanged});

  final String label;
  final TextEditingController controller;
  final String? hint;
  final String? error;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    return KTextField(
      label: label,
      controller: controller,
      hint: hint,
      error: error,
      onChanged: onChanged,
      keyboard: const TextInputType.numberWithOptions(decimal: true),
    );
  }
}

/// The answer of a tool: one main figure, then labelled lines.
class ToolResult extends StatelessWidget {
  const ToolResult({super.key, required this.label, required this.value, this.rows = const [], this.note, this.tone = KTone.brand});

  final String label;
  final String value;
  final List<(String, String)> rows;
  final String? note;
  final KTone tone;

  @override
  Widget build(BuildContext context) {
    return KCard(
      padding: const EdgeInsets.all(AppSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(label, style: AppText.label),
          const SizedBox(height: 4),
          Text(value, style: AppText.amount.copyWith(fontSize: 30, height: 36 / 30, color: tone.fg)),
          if (rows.isNotEmpty) ...[
            const SizedBox(height: AppSpace.md),
            const Divider(height: 1, color: AppColors.hairline),
            for (final (i, (name, text)) in rows.indexed) ...[
              if (i > 0) const Divider(height: 1, color: AppColors.hairline),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: Text(name, style: AppText.body.copyWith(color: AppColors.ink2))),
                    const SizedBox(width: AppSpace.md),
                    Flexible(child: Text(text, textAlign: TextAlign.right, style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular))),
                  ],
                ),
              ),
            ],
          ],
          if (note != null) ...[
            const SizedBox(height: AppSpace.sm),
            Text(note!, style: AppText.caption),
          ],
        ],
      ),
    );
  }
}

/// A short line saying what to type before the result shows.
class ToolHint extends StatelessWidget {
  const ToolHint(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2, vertical: AppSpace.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(padding: EdgeInsets.only(top: 2), child: Icon(LucideIcons.info, size: 16, color: AppColors.ink3)),
          const SizedBox(width: AppSpace.sm),
          Expanded(child: Text(text, style: AppText.caption)),
        ],
      ),
    );
  }
}

/// Valid / invalid answer of a validator, with the reason and what was read from the number.
class VerdictCard extends StatelessWidget {
  const VerdictCard({super.key, required this.valid, required this.title, required this.message, this.details = const []});

  final bool valid;
  final String title;
  final String message;
  final List<(String, String)> details;

  @override
  Widget build(BuildContext context) {
    final tone = valid ? KTone.positive : KTone.negative;
    return Container(
      padding: const EdgeInsets.all(AppSpace.lg),
      decoration: BoxDecoration(color: tone.bg, borderRadius: BorderRadius.circular(AppRadius.lg)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(children: [
            Icon(valid ? LucideIcons.circleCheck : LucideIcons.circleX, size: 24, color: tone.fg),
            const SizedBox(width: AppSpace.sm),
            Expanded(child: Text(title, style: AppText.heading.copyWith(color: tone.fg))),
          ]),
          const SizedBox(height: AppSpace.sm),
          Text(message, style: AppText.body),
          for (final (name, text) in details) ...[
            const SizedBox(height: AppSpace.sm),
            Text(name, style: AppText.caption),
            Text(text, style: AppText.bodyStrong),
          ],
        ],
      ),
    );
  }
}

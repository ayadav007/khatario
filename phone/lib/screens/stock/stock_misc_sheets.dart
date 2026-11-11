import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import 'stock_misc_logic.dart';

/// What the value sheet hands back: the text typed and, when the sheet had a choice, the option picked.
typedef ValueAnswer = ({String value, String pick});

/// A small sheet with one text box (a quantity or an amount) and, optionally, one choice. A double tap answers once.
/// Null when closed.
Future<ValueAnswer?> askValueSheet(
  BuildContext context, {
  required String title,
  required String label,
  String initial = '',
  String? help,
  required String confirmLabel,
  String? pickLabel,
  List<(String, String)> pickOptions = const [],
  String pickInitial = '',
}) {
  return showKSheet<ValueAnswer>(
    context,
    title: title,
    builder: (ctx) => _ValueSheet(
      label: label,
      initial: initial,
      help: help,
      confirmLabel: confirmLabel,
      pickLabel: pickLabel,
      pickOptions: pickOptions,
      pickInitial: pickInitial,
    ),
  );
}

class _ValueSheet extends StatefulWidget {
  const _ValueSheet({
    required this.label,
    required this.initial,
    required this.help,
    required this.confirmLabel,
    required this.pickLabel,
    required this.pickOptions,
    required this.pickInitial,
  });

  final String label, initial, confirmLabel, pickInitial;
  final String? help, pickLabel;
  final List<(String, String)> pickOptions;

  @override
  State<_ValueSheet> createState() => _ValueSheetState();
}

class _ValueSheetState extends State<_ValueSheet> {
  late final _controller = TextEditingController(text: widget.initial);
  late String _pick = widget.pickInitial;
  bool _tapped = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _done() {
    if (_tapped) return;
    _tapped = true;
    Navigator.of(context).pop((value: _controller.text.trim(), pick: _pick));
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.lg + MediaQuery.of(context).viewInsets.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (widget.help != null) ...[Text(widget.help!, style: AppText.caption), const SizedBox(height: AppSpace.md)],
          KTextField(
            label: widget.label,
            controller: _controller,
            keyboard: const TextInputType.numberWithOptions(decimal: true),
            autofocus: true,
          ),
          if (widget.pickLabel != null) ...[
            const SizedBox(height: AppSpace.md),
            KPickField<String>(label: widget.pickLabel!, value: _pick, options: widget.pickOptions, onChanged: (v) => setState(() => _pick = v)),
          ],
          const SizedBox(height: AppSpace.lg),
          KButton(label: widget.confirmLabel, onPressed: _done),
        ],
      ),
    );
  }
}

final _inFlight = <String>{};

/// Runs one stock-changing write once at a time per [key] (a second tap is ignored). True when it went through, or
/// when [alreadyChanged] says the server had already done it (then [alreadyText] is a neutral toast and the caller
/// reloads); null on a refusal, whose words are a toast and nothing has changed.
Future<bool?> guardedWrite(
  BuildContext context,
  String key,
  Future<void> Function() write, {
  String? success,
  bool Function(ApiException e)? alreadyChanged,
  String alreadyText = 'This has already changed. Showing the latest.',
}) async {
  if (!_inFlight.add(key)) return null;
  try {
    await write();
    if (success != null && context.mounted) showKToast(context, success, tone: KTone.positive);
    return true;
  } on ApiException catch (e) {
    if (alreadyChanged != null && alreadyChanged(e)) {
      if (context.mounted) showKToast(context, alreadyText);
      return true;
    }
    if (context.mounted) showKToast(context, e.message, tone: KTone.negative);
    return null;
  } catch (_) {
    if (context.mounted) showKToast(context, 'Could not reach the server. Try again.', tone: KTone.negative);
    return null;
  } finally {
    _inFlight.remove(key);
  }
}

/// Loads the godowns (`GET /api/warehouses`) before a stock form opens, with the loading, error and plan states.
/// [builder] gets the active godowns; an empty list means the business works by branch.
class GodownGate extends StatefulWidget {
  const GodownGate({super.key, required this.session, required this.title, required this.builder});

  final AppSession session;
  final String title;
  final Widget Function(BuildContext context, List<(String, String)> godowns) builder;

  @override
  State<GodownGate> createState() => _GodownGateState();
}

class _GodownGateState extends State<GodownGate> {
  List<(String, String)>? _godowns;
  bool _notInPlan = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _godowns = null;
      _error = null;
      _notInPlan = false;
    });
    try {
      final body = await widget.session.api.getJson('/api/warehouses');
      if (mounted) setState(() => _godowns = godownOptions(body));
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN' || e.code == 'FEATURE_NOT_AVAILABLE';
          _error = e.message;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not reach the server.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final g = _godowns;
    if (g != null) return widget.builder(context, g);
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KBackBar(widget.title),
            Expanded(
              child: _error == null
                  ? const KSpinner(padding: EdgeInsets.symmetric(vertical: 64))
                  : ListView(children: [
                      if (_notInPlan)
                        const KEmptyState(icon: LucideIcons.lock, title: 'Not included in your current plan')
                      else
                        KEmptyState(
                          icon: LucideIcons.cloudOff,
                          title: 'Could not load godowns',
                          body: _error,
                          action: KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
                        ),
                    ]),
            ),
          ],
        ),
      ),
    );
  }
}

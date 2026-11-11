import 'package:flutter/material.dart';

import '../../api.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';

/// What every screen of the HR dashboard, manager, recruitment and exits group needs: the loading,
/// server-error and "not in your plan" states, a busy set that guards double taps, and [act], which
/// asks first, posts once, shows the server's refusal and reloads either way.
mixin HrScreenState<T extends StatefulWidget> on State<T> {
  bool loading = true;
  String? error;
  bool notInPlan = false;
  final Set<String> busy = {};

  /// Runs a load; a failure becomes the screen's error state.
  Future<void> guardedLoad(Future<void> Function() fn) async {
    setState(() {
      loading = true;
      error = null;
      notInPlan = false;
    });
    try {
      await fn();
      if (mounted) setState(() => loading = false);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        error = e.message;
        loading = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          error = 'Could not reach the server.';
          loading = false;
        });
      }
    }
  }

  void toast(String message, {KTone tone = KTone.negative}) {
    if (mounted) showKToast(context, message, tone: tone);
  }

  /// [key] names the thing being decided; while it is busy a second tap does nothing. [confirm]
  /// is the question (or reason sheet); [send] posts once. The list reloads after a refusal too,
  /// because the request may already have been decided elsewhere.
  Future<void> act(
    String key, {
    required Future<bool> Function() confirm,
    required Future<void> Function() send,
    required String done,
    required Future<void> Function() reload,
  }) async {
    if (busy.contains(key)) return;
    if (!await confirm() || !mounted || busy.contains(key)) return;
    setState(() => busy.add(key));
    try {
      await send();
      toast(done, tone: KTone.positive);
    } on ApiException catch (e) {
      toast(e.message);
    } catch (_) {
      toast('Could not save. Try again.');
    }
    if (mounted) setState(() => busy.remove(key));
    await reload();
  }
}

/// A number tile of the HR dashboard and the manager view. Tapping it (when [onTap] is set) opens its screen.
class HrCountTile extends StatelessWidget {
  const HrCountTile({super.key, required this.title, required this.value, this.description, this.warn = false, this.onTap});

  final String title;
  final int value;
  final String? description;
  final bool warn;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return KCard(
      onTap: onTap,
      padding: const EdgeInsets.all(14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Text(title, style: AppText.caption),
        const SizedBox(height: 4),
        Text('$value', style: AppText.title.copyWith(color: warn && value > 0 ? AppColors.due : AppColors.ink)),
        if (description != null) ...[
          const SizedBox(height: 4),
          Text(description!, style: AppText.small),
        ],
      ]),
    );
  }
}

/// Two tiles per row.
class HrTileGrid extends StatelessWidget {
  const HrTileGrid({super.key, required this.tiles});

  final List<Widget> tiles;

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];
    for (var i = 0; i < tiles.length; i += 2) {
      rows.add(Padding(
        padding: const EdgeInsets.only(bottom: AppSpace.sm),
        child: IntrinsicHeight(
          child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Expanded(child: tiles[i]),
            const SizedBox(width: AppSpace.sm),
            Expanded(child: i + 1 < tiles.length ? tiles[i + 1] : const SizedBox()),
          ]),
        ),
      ));
    }
    return Column(children: rows);
  }
}

import 'package:flutter/widgets.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../ui/kit.dart';

/// Why a screen could not load: the plan message (no retry) or the server text with "Try again".
class LoadFailedView extends StatelessWidget {
  const LoadFailedView({super.key, required this.title, required this.message, required this.notInPlan, required this.onRetry});

  /// "Could not load X".
  final String title;
  final String? message;
  final bool notInPlan;
  final VoidCallback onRetry;

  /// True for the reply that means the plan, not the user, stopped the request.
  static bool isPlanBlock(Object e) => e is ApiException && e.code == 'FEATURE_NOT_IN_PLAN';

  @override
  Widget build(BuildContext context) {
    return KEmptyState(
      icon: notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
      title: notInPlan ? 'Not included in your current plan' : (message?.isNotEmpty == true ? message! : title),
      body: notInPlan ? message : title,
      action: notInPlan ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: onRetry),
    );
  }
}

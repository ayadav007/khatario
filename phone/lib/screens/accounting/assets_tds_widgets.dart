import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../theme.dart';
import '../../ui/kit.dart';

/// Why a load failed, as the screens of fixed assets, provisions and TDS tell it.
class LoadProblem {
  const LoadProblem(this.message, {this.notInPlan = false, this.noAccess = false});

  final String message;

  /// `FEATURE_NOT_IN_PLAN`: the plan does not include the module.
  final bool notInPlan;
  final bool noAccess;
}

LoadProblem loadProblemOf(Object error) {
  if (error is ApiException) {
    final plan = error.code == 'FEATURE_NOT_IN_PLAN';
    return LoadProblem(error.message, notInPlan: plan, noAccess: !plan && error.status == 403);
  }
  return const LoadProblem('Could not reach the server.');
}

/// The message a failed action shows: the server's own words, or a plain one.
String actionProblemOf(Object error) => error is ApiException ? error.message : 'Could not reach the server.';

/// The empty-state rows for a failed load: plan, access, or the error with "Try again". [what] is
/// "fixed assets", "provisions" and so on.
class LoadProblemView extends StatelessWidget {
  const LoadProblemView({super.key, required this.problem, required this.what, required this.onRetry});

  final LoadProblem problem;
  final String what;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        if (problem.notInPlan)
          const KEmptyState(icon: LucideIcons.lock, title: 'Not included in your current plan')
        else if (problem.noAccess)
          const KEmptyState(icon: LucideIcons.lock, title: 'You do not have access to this')
        else
          KEmptyState(
            icon: LucideIcons.cloudOff,
            title: 'Could not load $what',
            body: problem.message,
            action: KButton.secondary(label: 'Try again', expand: false, onPressed: onRetry),
          ),
      ],
    );
  }
}

/// Fields that show or hide together, as one child of a form. A form lists its fields without keys, so a
/// field that appears between two others would shift the ones after it and a typed value could land in the
/// wrong box; inside a group the following fields keep their place.
class FieldGroup extends StatelessWidget {
  const FieldGroup({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final (i, c) in children.indexed) ...[
          if (i > 0) const SizedBox(height: AppSpace.md),
          c,
        ],
      ],
    );
  }
}

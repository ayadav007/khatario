import '../../session.dart';
import 'leads_logic.dart';

/// The stages, team members and labels the lead and lead-source screens offer in their pickers.
/// Each list is optional, as on the website: a failed load leaves it empty and the screen still works.
class LeadPickers {
  const LeadPickers({this.stages = const [], this.people = const [], this.labels = const []});

  final List<StageOption> stages;
  final List<PickOption> people;
  final List<PickOption> labels;

  StageOption? stage(String? id) => stages.where((s) => s.id == id).firstOrNull;
}

Future<Map<String, dynamic>?> _get(AppSession session, String path) async {
  try {
    return await session.api.getJson(path);
  } catch (_) {
    return null;
  }
}

Future<LeadPickers> loadLeadPickers(AppSession session, {bool labels = false}) async {
  final r = await Future.wait([
    _get(session, stagesPath),
    _get(session, whatsappUsersPath),
    if (labels) _get(session, whatsappLabelsPath),
  ]);
  return LeadPickers(
    stages: r[0] == null ? const [] : stageOptions(r[0]!),
    people: r[1] == null ? const [] : personOptions(r[1]!),
    labels: labels && r[2] != null ? labelOptions(r[2]!) : const [],
  );
}

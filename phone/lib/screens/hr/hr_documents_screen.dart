import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../reports/statement_pdf.dart';
import 'attendance_leave_logic.dart';
import 'hr_manage_widgets.dart';
import 'hr_more_logic.dart';
import 'pay_widgets.dart';

/// Website `/hr/documents`: the letter templates, a new template (name only), a rename, and
/// "Generate for an employee" as a PDF opened in the shared viewer. The template text, margins and
/// attributes are edited on the website.
class HrDocumentsScreen extends StatefulWidget {
  const HrDocumentsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<HrDocumentsScreen> createState() => _HrDocumentsScreenState();
}

class _HrDocumentsScreenState extends State<HrDocumentsScreen> with HrScreenState<HrDocumentsScreen> {
  List<TemplateRow> _rows = const [];
  HrAccess _access = HrAccess.open;

  @override
  void initState() {
    super.initState();
    _load();
    loadHrAccess(widget.session).then((a) {
      if (mounted) setState(() => _access = a);
    });
  }

  Future<void> _load() => guardedLoad(() async {
        final body = await widget.session.api.getJson(documentTemplatesPath);
        if (!mounted) return;
        _rows = templateRows(body['templates']);
      });

  void _push(Widget screen) => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen)).then((_) {
        if (mounted) _load();
      });

  @override
  Widget build(BuildContext context) {
    return PayListPage(
      title: 'HR documents',
      loading: loading,
      error: error,
      notInPlan: notInPlan,
      onRetry: _load,
      emptyTitle: 'No templates',
      emptyBody: 'Appointment letters and other templates you create show up here.',
      emptyIcon: LucideIcons.fileText,
      trailing: _access.has('settings', 'update') ? KIconButton(icon: LucideIcons.plus, tooltip: 'New template', onTap: () => _push(NewTemplateScreen(session: widget.session))) : null,
      header: [
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpace.sm),
          child: Text('Pick a template to make a letter for an employee. Template text and layout are edited on the website.', style: AppText.caption),
        ),
      ],
      rows: [
        if (_rows.isNotEmpty)
          KCard(
            child: KDivided(indent: 0, children: [
              for (final t in _rows)
                KListRow(
                  title: t.name,
                  subtitle: typeWords(t.documentType),
                  trailing: const Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink2),
                  onTap: () => _push(TemplateScreen(session: widget.session, template: t)),
                ),
            ]),
          ),
      ],
    );
  }
}

/// Website "New template": only the name; the server starts it with the standard appointment letter.
class NewTemplateScreen extends StatefulWidget {
  const NewTemplateScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<NewTemplateScreen> createState() => _NewTemplateScreenState();
}

class _NewTemplateScreenState extends State<NewTemplateScreen> {
  final _name = TextEditingController();

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    await widget.session.api.postJson(documentTemplatesPath, createTemplateBody(_name.text));
    if (!mounted) return;
    showKToast(context, 'Template created', tone: KTone.positive);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'New template',
      saveLabel: 'Create',
      dirty: _name.text.isNotEmpty,
      canSave: _name.text.trim().isNotEmpty,
      onSave: _save,
      children: [
        KTextField(label: 'Template name', controller: _name, onChanged: (_) => setState(() {})),
        Text('It starts as the standard appointment letter. Edit its wording on the website.', style: AppText.caption),
      ],
    );
  }
}

Future<void> _openGeneratedPdf(BuildContext context, List<int> bytes, String title) =>
    openPdfViewer(context, bytes, title: title, fileName: templatePdfName(title));

/// One template: rename it, or make its PDF for an employee.
class TemplateScreen extends StatefulWidget {
  const TemplateScreen({super.key, required this.session, required this.template, this.openPdf = _openGeneratedPdf});

  final AppSession session;
  final TemplateRow template;

  /// Where the generated PDF goes (the shared viewer); tests replace it.
  final PdfOpener openPdf;

  @override
  State<TemplateScreen> createState() => _TemplateScreenState();
}

class _TemplateScreenState extends State<TemplateScreen> {
  late final TextEditingController _name = TextEditingController(text: widget.template.name);
  late String _title = widget.template.name;
  String _employeeId = '';
  String? _employeeName;
  bool _saving = false;
  bool _generating = false;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _rename() async {
    if (_saving || _name.text.trim().isEmpty) return;
    setState(() => _saving = true);
    try {
      await widget.session.api.patchJson(documentTemplatesPath, renameTemplateBody(widget.template.id, _name.text));
      if (!mounted) return;
      setState(() => _title = _name.text.trim());
      showKToast(context, 'Saved', tone: KTone.positive);
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not save. Try again.', tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _generate() async {
    if (_generating) return;
    if (_employeeId.isEmpty) {
      showKToast(context, 'Choose an employee first.', tone: KTone.negative);
      return;
    }
    setState(() => _generating = true);
    try {
      final bytes = await widget.session.api.postForBytes(generateDocumentPath(widget.template.id), generateDocumentBody(_employeeId));
      if (!mounted) return;
      await widget.openPdf(context, bytes, _title);
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not make the document. Try again.', tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _generating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          KBackBar(_title),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, 96),
              children: [
                const KSectionHeader('Generate for an employee'),
                KAsyncPickField(
                  label: 'Employee',
                  valueLabel: _employeeName,
                  search: (q) => searchEmployees(widget.session.api, q),
                  onPicked: (id, label) => setState(() {
                    _employeeId = id;
                    _employeeName = label;
                  }),
                ),
                const SizedBox(height: AppSpace.sm),
                KButton(label: 'Generate PDF', icon: LucideIcons.fileText, loading: _generating, onPressed: _generating ? null : _generate),
                const SizedBox(height: AppSpace.lg),
                const KSectionHeader('Template'),
                KTextField(label: 'Template name', controller: _name),
                const SizedBox(height: AppSpace.sm),
                KButton.secondary(label: 'Save name', loading: _saving, onPressed: _saving ? null : _rename),
                const SizedBox(height: AppSpace.sm),
                Text('The template text, margins and attributes are edited on the website.', style: AppText.caption),
              ],
            ),
          ),
        ]),
      ),
    );
  }
}

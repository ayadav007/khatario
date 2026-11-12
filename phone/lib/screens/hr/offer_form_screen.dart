import 'package:flutter/material.dart';

import '../../format.dart';
import '../../session.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import 'hr_manage_logic.dart';

/// The offer letter form of the candidate page: a new draft (`POST`) or an edit of a draft or rejected
/// offer (`PATCH`). The same fields as the website, with the same fallbacks (bonus 0, notice 30 days,
/// probation 0). The server checks the required ones and the onboarding tasks.
class OfferFormScreen extends StatefulWidget {
  const OfferFormScreen({super.key, required this.session, required this.candidateId, this.offer});

  final AppSession session;
  final String candidateId;
  final Map<String, dynamic>? offer;

  @override
  State<OfferFormScreen> createState() => _OfferFormScreenState();
}

class _OfferFormScreenState extends State<OfferFormScreen> {
  late final _designation = _c('designation');
  late final _department = _c('department');
  late final _basic = _c('basic_salary');
  late final _location = _c('work_location');
  late final _bonus = _c('annual_bonus');
  late final _notice = _c('notice_period_days', fallback: '30');
  late final _probation = _c('probation_months', fallback: '3');
  late final _signName = _c('signatory_name');
  late final _signTitle = _c('signatory_title');
  late final _terms = _c('terms_text');
  late DateTime? _joining = _initialJoining();

  TextEditingController _c(String key, {String fallback = ''}) {
    final v = widget.offer?[key];
    final text = v == null ? fallback : (v is num ? jsNumberString(v) : v.toString());
    return TextEditingController(text: text == 'null' ? fallback : text);
  }

  DateTime? _initialJoining() {
    final s = widget.offer?['joining_date']?.toString() ?? '';
    return s.length < 10 ? null : DateTime.tryParse(s.substring(0, 10));
  }

  @override
  void dispose() {
    for (final c in [_designation, _department, _basic, _location, _bonus, _notice, _probation, _signName, _signTitle, _terms]) {
      c.dispose();
    }
    super.dispose();
  }

  bool get _ready => _designation.text.trim().isNotEmpty && _joining != null && (num.tryParse(_basic.text.trim()) ?? 0) > 0;

  Future<void> _save() async {
    final body = offerBody(
      designation: _designation.text,
      department: _department.text,
      joiningDate: _joining!,
      basicSalary: _basic.text,
      workLocation: _location.text,
      annualBonus: _bonus.text,
      noticePeriodDays: _notice.text,
      probationMonths: _probation.text,
      signatoryName: _signName.text,
      signatoryTitle: _signTitle.text,
      terms: _terms.text,
    );
    final api = widget.session.api;
    if (widget.offer == null) {
      await api.postJson(recruitOfferPath(widget.candidateId), body);
    } else {
      await api.patchJson(recruitOfferPath(widget.candidateId), body);
    }
    if (!mounted) return;
    showKToast(context, 'Offer draft saved', tone: KTone.positive);
    Navigator.of(context).pop();
  }

  void _dirty(String _) => setState(() {});

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: widget.offer == null ? 'Create offer' : 'Edit offer',
      saveLabel: 'Save draft',
      dirty: _designation.text.isNotEmpty,
      canSave: _ready,
      onSave: _save,
      children: [
        KTextField(label: 'Designation', controller: _designation, onChanged: _dirty),
        KTextField(label: 'Department', controller: _department),
        KDateField(label: 'Joining date', value: _joining, onChanged: (d) => setState(() => _joining = dateOnly(d))),
        KTextField(label: 'Basic salary (monthly)', controller: _basic, keyboard: TextInputType.number, onChanged: _dirty),
        KTextField(label: 'Work location', controller: _location),
        KTextField(label: 'Annual bonus', controller: _bonus, keyboard: TextInputType.number),
        KTextField(label: 'Notice period (days)', controller: _notice, keyboard: TextInputType.number),
        KTextField(label: 'Probation (months)', controller: _probation, keyboard: TextInputType.number),
        KTextField(label: 'Signatory name', controller: _signName),
        KTextField(label: 'Signatory title', controller: _signTitle),
        KTextField(label: 'Terms', controller: _terms, maxLines: 5, minLines: 3),
      ],
    );
  }
}

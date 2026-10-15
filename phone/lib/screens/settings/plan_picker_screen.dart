import 'package:flutter/material.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/kit.dart';
import 'plan_picker_logic.dart';

/// Plan picker laid out as selectable cards, a monthly/yearly switch, and what the chosen plan includes.
class PlanPickerScreen extends StatefulWidget {
  const PlanPickerScreen({super.key, required this.session, required this.plans, required this.currentPlanId});

  final AppSession session;
  final List<Map<String, dynamic>> plans;
  final String? currentPlanId;

  @override
  State<PlanPickerScreen> createState() => _PlanPickerScreenState();
}

class _PlanPickerScreenState extends State<PlanPickerScreen> {
  late String? _selectedId;
  bool _yearly = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final current = widget.currentPlanId;
    final ids = widget.plans.map((plan) => plan['id']?.toString()).whereType<String>().toList();
    _selectedId = ids.contains(current) ? current : (ids.isEmpty ? null : ids.first);
  }

  Map<String, dynamic>? get _selected {
    for (final plan in widget.plans) {
      if (plan['id']?.toString() == _selectedId) return plan;
    }
    return null;
  }

  Future<void> _continue() async {
    final plan = _selected;
    if (plan == null || _saving) return;
    if (plan['id']?.toString() == widget.currentPlanId) return;
    final monthly = toNum(plan['price_monthly']);
    final yearly = toNum(plan['price_yearly']);
    final priced = _yearly ? (yearly > 0 ? yearly : monthly) : monthly;
    if (priced > 0 || monthly > 0 || yearly > 0) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Paid plans are billed through the payment partner. That checkout is not in the phone yet. Write to support@khatario.com to change this plan.'),
      ));
      return;
    }
    setState(() => _saving = true);
    try {
      await widget.session.api.postJson('/api/subscriptions/upgrade', {'plan_id': plan['id']});
      if (!mounted) return;
      Navigator.pop(context, true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final plan = _selected;
    final name = plan?['display_name']?.toString() ?? 'plan';
    final current = plan?['id']?.toString() == widget.currentPlanId;
    final save = bestYearlySave(widget.plans);
    final included = plan == null ? const <String>[] : planIncludedLines(plan);
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 4, 8, 0),
              child: Row(
                children: [
                  IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close)),
                  const Spacer(),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
                children: [
                  Text('Choose your plan', style: AppText.heading.copyWith(fontSize: 28, height: 1.15)),
                  const SizedBox(height: 6),
                  Text('Unlock everything. Switch or cancel anytime.', style: AppText.body.copyWith(color: AppColors.ink2)),
                  const SizedBox(height: 18),
                  _cycle(save),
                  const SizedBox(height: 16),
                  for (final item in widget.plans) ...[
                    _card(item),
                    const SizedBox(height: 10),
                  ],
                  if (included.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    _included(name, included),
                  ],
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
              child: Column(
                children: [
                  KButton(
                    label: current ? 'Current plan' : 'Continue with $name',
                    loading: _saving,
                    onPressed: current || plan == null ? null : _continue,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _caption(plan),
                    textAlign: TextAlign.center,
                    style: AppText.caption,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _cycle(int? save) {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(color: AppColors.sunken, borderRadius: BorderRadius.circular(14)),
      child: Row(
        children: [
          _cycleChip('Monthly', !_yearly, () => setState(() => _yearly = false)),
          _cycleChip('Yearly', _yearly, () => setState(() => _yearly = true), badge: save == null ? null : 'Save $save%'),
        ],
      ),
    );
  }

  Widget _cycleChip(String label, bool selected, VoidCallback onTap, {String? badge}) {
    return Expanded(
      child: Material(
        color: selected ? AppColors.surface : Colors.transparent,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(label, style: AppText.bodyStrong.copyWith(color: selected ? AppColors.ink : AppColors.ink2)),
                if (badge != null) ...[
                  const SizedBox(width: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(color: AppColors.positiveSoft, borderRadius: BorderRadius.circular(8)),
                    child: Text(badge, style: AppText.small.copyWith(color: AppColors.positive, fontSize: 11)),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _card(Map<String, dynamic> plan) {
    final selected = plan['id']?.toString() == _selectedId;
    final struck = planStruckMonthly(plan, yearly: _yearly);
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: () => setState(() => _selectedId = plan['id']?.toString()),
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: selected ? AppColors.brand : AppColors.hairline, width: selected ? 2 : 1),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Icon(selected ? Icons.radio_button_checked : Icons.radio_button_off, color: selected ? AppColors.brand : AppColors.ink3, size: 22),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: 8,
                      children: [
                        Text(plan['display_name']?.toString() ?? 'Plan', style: AppText.bodyStrong.copyWith(fontSize: 16)),
                        if (planIsPopular(plan))
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(color: AppColors.brand, borderRadius: BorderRadius.circular(8)),
                            child: Text('POPULAR', style: AppText.small.copyWith(color: AppColors.onBrand, fontSize: 10, letterSpacing: 0.4)),
                          ),
                      ],
                    ),
                    if ((plan['description']?.toString() ?? '').isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(plan['description'].toString(), style: AppText.caption),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  if (struck.isNotEmpty)
                    Text(struck, style: AppText.caption.copyWith(decoration: TextDecoration.lineThrough)),
                  Text(planCardPrice(plan, yearly: _yearly), style: AppText.heading.copyWith(fontSize: 18)),
                  if (planBilledYearly(plan, yearly: _yearly).isNotEmpty)
                    Text(planBilledYearly(plan, yearly: _yearly), style: AppText.caption.copyWith(fontSize: 11)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _included(String name, List<String> lines) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.hairline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Included in $name', style: AppText.bodyStrong),
          const SizedBox(height: 10),
          for (final line in lines)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.check, size: 18, color: AppColors.positive),
                  const SizedBox(width: 8),
                  Expanded(child: Text(line, style: AppText.body)),
                ],
              ),
            ),
        ],
      ),
    );
  }

  String _caption(Map<String, dynamic>? plan) {
    if (plan == null) return '';
    final monthly = toNum(plan['price_monthly']);
    final yearly = toNum(plan['price_yearly']);
    if (monthly <= 0 && yearly <= 0) return 'Free. You can switch again anytime.';
    if (_yearly && yearly > 0) return '${inr(yearly)} a year. Paid checkout is not in the phone yet.';
    return '${inr(monthly)} a month. Paid checkout is not in the phone yet.';
  }
}

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:share_plus/share_plus.dart';

import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'invoice_form_screen.dart';
import 'invoice_pdf_screen.dart';
import 'invoice_share.dart';

/// Shown right after a final bill is saved: the next things a shopkeeper does are share,
/// print, or start the next bill (the website's post-save modal does the same).
class BillSavedScreen extends StatefulWidget {
  const BillSavedScreen({
    super.key,
    required this.session,
    required this.invoiceId,
    required this.invoiceNumber,
    required this.total,
    required this.received,
    this.customerName,
  });

  final AppSession session;
  final String invoiceId;
  final String invoiceNumber;
  final num total;
  final num received;
  final String? customerName;

  @override
  State<BillSavedScreen> createState() => _BillSavedScreenState();
}

class _BillSavedScreenState extends State<BillSavedScreen> with SingleTickerProviderStateMixin {
  late final _pop = AnimationController(vsync: this, duration: const Duration(milliseconds: 520))..forward();
  bool _sharing = false;

  @override
  void dispose() {
    _pop.dispose();
    super.dispose();
  }

  Future<void> _share() async {
    setState(() => _sharing = true);
    try {
      final url = await fetchInvoiceShareUrl(widget.session.api, widget.invoiceId);
      if (!mounted) return;
      await SharePlus.instance.share(ShareParams(
        text: 'Invoice ${widget.invoiceNumber} for ${formatAmount(widget.total)}\n$url',
        subject: 'Invoice ${widget.invoiceNumber}',
        title: 'Share invoice',
      ));
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not get the share link. Try again.')));
    } finally {
      if (mounted) setState(() => _sharing = false);
    }
  }

  void _view() {
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => InvoicePdfScreen(api: widget.session.api, invoiceId: widget.invoiceId, invoiceNumber: widget.invoiceNumber),
    ));
  }

  void _newBill() {
    Navigator.of(context).pushReplacement(MaterialPageRoute<bool>(builder: (_) => InvoiceFormScreen(session: widget.session)));
  }

  @override
  Widget build(BuildContext context) {
    final due = widget.total - widget.received;
    final paid = due <= 0.005;
    final name = widget.customerName?.trim() ?? '';
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Align(
              alignment: Alignment.centerRight,
              child: Padding(
                padding: const EdgeInsets.all(AppSpace.xs),
                child: KIconButton(icon: LucideIcons.x, tooltip: 'Done', onTap: () => Navigator.of(context).pop()),
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const SizedBox(height: 12),
                    Center(
                      child: ScaleTransition(
                        scale: CurvedAnimation(parent: _pop, curve: Curves.elasticOut),
                        child: Container(
                          width: 88,
                          height: 88,
                          decoration: BoxDecoration(
                            color: AppColors.positiveSoft,
                            shape: BoxShape.circle,
                            border: Border.all(color: AppColors.positive.withValues(alpha: 0.18), width: 10),
                          ),
                          child: const Icon(LucideIcons.check, size: 40, color: AppColors.positive),
                        ),
                      ),
                    ),
                    const SizedBox(height: 20),
                    Text('Bill saved', textAlign: TextAlign.center, style: AppText.title),
                    const SizedBox(height: 4),
                    Text(
                      [widget.invoiceNumber, if (name.isNotEmpty) name else 'Cash sale'].join(' · '),
                      textAlign: TextAlign.center,
                      style: AppText.body.copyWith(color: AppColors.ink2),
                    ),
                    const SizedBox(height: 24),
                    KCard(
                      raised: true,
                      padding: const EdgeInsets.all(20),
                      child: Column(
                        children: [
                          Text('Bill total', style: AppText.label),
                          const SizedBox(height: 4),
                          KAmount(widget.total, maxFraction: 2),
                          const SizedBox(height: 10),
                          KPill(
                            label: paid ? 'Paid in full' : (widget.received > 0 ? '${formatAmount(due)} due' : 'Unpaid · on credit'),
                            tone: paid ? KTone.positive : KTone.due,
                            icon: paid ? LucideIcons.circleCheck : LucideIcons.clock,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Expanded(
                          child: _ActionTile(
                            icon: LucideIcons.share2,
                            label: _sharing ? 'Getting link…' : 'Share',
                            caption: 'WhatsApp, SMS…',
                            tint: AppTints.green,
                            onTap: _sharing ? null : _share,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: _ActionTile(
                            icon: LucideIcons.printer,
                            label: 'View / Print',
                            caption: 'Open the PDF',
                            tint: AppTints.sky,
                            onTap: _view,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            KBottomBar(children: [
              Expanded(child: KButton.secondary(label: 'Done', onPressed: () => Navigator.of(context).pop())),
              Expanded(flex: 2, child: KButton(label: 'New bill', icon: LucideIcons.plus, onPressed: _newBill)),
            ]),
          ],
        ),
      ),
    );
  }
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({required this.icon, required this.label, required this.caption, required this.tint, required this.onTap});

  final IconData icon;
  final String label;
  final String caption;
  final (Color, Color) tint;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return KCard(
      onTap: onTap,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(color: tint.$1, borderRadius: BorderRadius.circular(14)),
            child: Icon(icon, size: 20, color: tint.$2),
          ),
          const SizedBox(height: 12),
          Text(label, style: AppText.bodyStrong),
          Text(caption, style: AppText.caption.copyWith(fontSize: 12)),
        ],
      ),
    );
  }
}

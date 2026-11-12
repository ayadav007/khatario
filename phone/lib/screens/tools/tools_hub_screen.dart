import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../pages/native_routes.dart';
import '../pages/page_catalog.dart';
import '../pages/website_page_screen.dart';
import 'tool_kit.dart';

class _Tool {
  const _Tool(this.href, this.title, this.description, this.icon);

  final String href;
  final String title;
  final String description;
  final IconData icon;
}

/// Same names, descriptions and order as the website's Tools page (`app/(app)/tools/page.tsx`),
/// for the tools that run on the phone. The image tools and the WhatsApp group extractor stay on
/// the website: their cards say so and open the website inside the app.
const _tools = <_Tool>[
  _Tool('/tools/hsn-finder', 'HSN/SAC Finder', 'Find HSN and SAC codes for GST with tax rates.', LucideIcons.search),
  _Tool('/tools/gst-calculator', 'GST Calculator', 'Calculate inclusive and exclusive GST amounts quickly.', LucideIcons.calculator),
  _Tool('/tools/gstin-validator', 'GSTIN Validator', 'Verify and validate GSTIN numbers for any business.', LucideIcons.userCheck),
  _Tool('/tools/pan-validator', 'PAN Validator', 'Validate Permanent Account Number (PAN) format and type.', LucideIcons.creditCard),
  _Tool('/tools/tds-calculator', 'TDS Calculator', 'Calculate TDS amounts for various payment sections.', LucideIcons.banknote),
  _Tool('/tools/discount-calculator', 'Discount Calculator', 'Calculate discounts and final prices for your items.', LucideIcons.tag),
  _Tool('/tools/price-margin-calculator', 'Price & Margin', 'Calculate selling price, markup, and profit margins.', LucideIcons.trendingUp),
  _Tool('/tools/invoice-number-generator', 'Invoice Generator', 'Generate professional sequential invoice numbers.', LucideIcons.hash),
  _Tool('/tools/interest-calculator', 'Interest Calculator', 'Calculate simple and compound interest for any period.', LucideIcons.percent),
  _Tool('/tools/emi-calculator', 'EMI Calculator', 'Calculate monthly loan installments and interest.', LucideIcons.chartColumn),
  _Tool('/tools/currency-converter', 'Currency Converter', 'Convert amounts between INR and global currencies.', LucideIcons.refreshCw),
  _Tool('/tools/image-size-reducer', 'Image Reducer', 'Compress and reduce image file sizes without loss.', LucideIcons.fileImage),
  _Tool('/tools/image-background-remover', 'BG Remover', 'Cut a product or person out of a photo. Click the subject, then tidy the edge.', LucideIcons.wandSparkles),
  _Tool('/tools/todo', 'To Do List', 'Manage your tasks and set reminders for your business.', LucideIcons.clipboardList),
  _Tool('/tools/google-lead-extractor', 'Lead Extractor', 'Find business leads directly from Google Maps.', LucideIcons.target),
  _Tool('/tools/whatsapp-group-extractor', 'WhatsApp Group Extractor', 'Extract phone numbers from WhatsApp groups, communities, and announcements.', LucideIcons.users),
];

/// Website `/tools`: a grid of the business tools.
class ToolsHubScreen extends StatelessWidget {
  const ToolsHubScreen({super.key, required this.session});

  final AppSession session;

  void _open(BuildContext context, _Tool tool) {
    if (opensWebsiteByDesign(tool.href)) return openWebsiteInApp(context, session, tool.href, tool.title);
    final next = nativeScreenFor(session, tool.href);
    if (next == null) return openWebsiteInApp(context, session, tool.href, tool.title);
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => next));
  }

  @override
  Widget build(BuildContext context) {
    return ToolScaffold(
      title: 'Tools',
      children: [
        Text('Calculators and checkers for running your business.', style: AppText.caption),
        for (var i = 0; i < _tools.length; i += 2)
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: _ToolCard(tool: _tools[i], onOpen: () => _open(context, _tools[i]))),
                const SizedBox(width: AppSpace.md),
                Expanded(
                  child: i + 1 < _tools.length
                      ? _ToolCard(tool: _tools[i + 1], onOpen: () => _open(context, _tools[i + 1]))
                      : const SizedBox.shrink(),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _ToolCard extends StatelessWidget {
  const _ToolCard({required this.tool, required this.onOpen});

  final _Tool tool;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    return KCard(
      onTap: onOpen,
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          KIconTile(icon: tool.icon, label: tool.title, onTap: onOpen),
          const SizedBox(height: AppSpace.md),
          Text(tool.title, style: AppText.bodyStrong),
          const SizedBox(height: 4),
          Text(tool.description, style: AppText.caption),
          if (opensWebsiteByDesign(tool.href)) ...[const SizedBox(height: 4), const KWebsiteHint()],
        ],
      ),
    );
  }
}

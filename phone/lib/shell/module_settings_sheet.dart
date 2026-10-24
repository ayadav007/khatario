import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../theme.dart';

typedef ModuleSettingsEntry = ({String href, String label, String description});

/// `getModuleSettingsMenu` in `lib/module-settings.ts`.
class ModuleSettingsMenu {
  const ModuleSettingsMenu({required this.title, required this.entries, this.featureKeys = const {}});

  final String title;
  final List<ModuleSettingsEntry> entries;

  /// `featureKey` per entry href; the entry is hidden unless the feature is enabled.
  final Map<String, String> featureKeys;

  List<ModuleSettingsEntry> visibleEntries(List<String> enabledFeatures) => [
        for (final e in entries)
          if (featureKeys[e.href] == null || enabledFeatures.contains(featureKeys[e.href])) e,
      ];

  static const items = ModuleSettingsMenu(
    title: 'Item settings',
    entries: [
      (href: '/settings/business#bp-features', label: 'Item defaults', description: 'Variants, stock rules, warehouses'),
      (href: '/settings/custom-fields?entity=item', label: 'Custom fields', description: 'Extra fields on items'),
      (href: '/items/categories', label: 'Categories', description: 'Organize your catalog'),
      (href: '/settings/label-templates', label: 'Label templates', description: 'Barcode label layouts'),
      (href: '/items/barcodes', label: 'Print barcodes', description: 'Bulk barcode printing'),
      (href: '/settings/bluetooth-printer', label: 'Print & devices', description: 'Pair label or receipt printer'),
    ],
    featureKeys: {
      '/settings/label-templates': 'barcode_label_templates',
      '/settings/bluetooth-printer': 'barcode_thermal_printer',
    },
  );

  static const invoicing = ModuleSettingsMenu(
    title: 'Invoice & print settings',
    entries: [
      (href: '/settings/templates', label: 'Templates & printing', description: 'Layout, 58mm / 80mm / A4, active template'),
      (href: '/settings/bluetooth-printer', label: 'Print & devices', description: 'PDF vs Bluetooth, pair thermal printer'),
      (href: '/settings/custom-fields?entity=invoice', label: 'Custom fields', description: 'Extra fields on invoices'),
      (href: '/settings/number-series', label: 'Number series', description: 'Invoice and document numbering'),
      (href: '/settings/business#bp-signature', label: 'Logo & signature', description: 'Upload once in business profile'),
    ],
  );
}

/// `components/settings/ModuleSettingsSheet.tsx` (mobile bottom sheet).
Future<void> showModuleSettingsSheet(
  BuildContext context, {
  required ModuleSettingsMenu menu,
  required ValueChanged<String> onOpen,
  List<String> enabledFeatures = const [],
}) {
  final entries = menu.visibleEntries(enabledFeatures);
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    barrierColor: AppColors.scrim,
    backgroundColor: Colors.transparent,
    elevation: 0,
    builder: (context) {
      void open(String label) {
        Navigator.of(context).pop();
        onOpen(label);
      }

      return ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.8),
        child: Container(
          decoration: const BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
          ),
          child: SafeArea(
            top: false,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    margin: const EdgeInsets.only(top: 8),
                    width: 36,
                    height: 4,
                    decoration: BoxDecoration(color: AppColors.hairline, borderRadius: BorderRadius.circular(4)),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 6, 8, 4),
                  child: Row(
                    children: [
                      Expanded(child: Text(menu.title, style: AppText.heading)),
                      _RoundIconButton(icon: LucideIcons.x, onTap: () => Navigator.of(context).pop()),
                    ],
                  ),
                ),
                Flexible(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        for (final e in entries)
                          _SheetLink(
                            onTap: () => open(e.href),
                            child: Row(
                              children: [
                                Container(
                                  width: 36,
                                  height: 36,
                                  decoration: BoxDecoration(color: AppColors.brandSoft, borderRadius: BorderRadius.circular(11)),
                                  child: Icon(LucideIcons.slidersHorizontal, size: 17, color: AppColors.brand),
                                ),
                                const SizedBox(width: 14),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(e.label, style: AppText.bodyStrong.copyWith(fontWeight: FontWeight.w500)),
                                      const SizedBox(height: 2),
                                      Text(e.description, style: AppText.caption.copyWith(fontSize: 12)),
                                    ],
                                  ),
                                ),
                                const SizedBox(width: 12),
                                const Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink3),
                              ],
                            ),
                          ),
                        const Padding(padding: EdgeInsets.symmetric(horizontal: 20), child: Divider(color: AppColors.hairline)),
                        _SheetLink(
                          onTap: () => open('/settings'),
                          child: Row(
                            children: [
                              Container(
                                width: 36,
                                height: 36,
                                decoration: BoxDecoration(color: AppColors.sunken, borderRadius: BorderRadius.circular(11)),
                                child: const Icon(LucideIcons.settings, size: 17, color: AppColors.ink2),
                              ),
                              const SizedBox(width: 14),
                              Text('All settings', style: AppText.bodyStrong.copyWith(fontWeight: FontWeight.w500, color: AppColors.ink2)),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    },
  );
}

class _SheetLink extends StatelessWidget {
  const _SheetLink({required this.child, required this.onTap});

  final Widget child;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      highlightColor: AppColors.sunken,
      onTap: onTap,
      child: Padding(padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12), child: child),
    );
  }
}

class _RoundIconButton extends StatelessWidget {
  const _RoundIconButton({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        highlightColor: AppColors.sunken,
        onTap: onTap,
        child: Padding(padding: const EdgeInsets.all(10), child: Icon(icon, size: 22, color: AppColors.ink)),
      ),
    );
  }
}

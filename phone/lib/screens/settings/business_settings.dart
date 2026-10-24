import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../parties/customer_form_logic.dart' show indianStates;
import 'settings_kit.dart';
import 'settings_router.dart';

/// Settings › Business: identity, address, GST, logo & signature, locations, exporter details.
/// Saves to PATCH /api/business/:id (the same route the website's Business profile uses).
class BusinessSettingsScreen extends StatefulWidget {
  const BusinessSettingsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<BusinessSettingsScreen> createState() => _BusinessSettingsScreenState();
}

class _BusinessSettingsScreenState extends State<BusinessSettingsScreen> {
  static const _textKeys = [
    'name', 'phone', 'email', 'address_line1', 'address_line2', 'city', 'pincode', 'gstin', 'pan', 'iec_code', 'swift_code',
  ];

  final _f = DirtyFields();
  Map<String, dynamic> _b = const {};
  List<Map<String, dynamic>> _branches = const [];
  List<Map<String, dynamic>> _warehouses = const [];
  bool _loading = true;
  bool _saving = false;
  String? _error;
  String? _uploading;

  String get _id => widget.session.businessId ?? '';

  @override
  void initState() {
    super.initState();
    for (final k in _textKeys) {
      _f.field(k).addListener(_onEdit);
    }
    _load();
  }

  @override
  void dispose() {
    _f.dispose();
    super.dispose();
  }

  void _onEdit() => setState(() {});

  Future<void> _load() async {
    try {
      final res = await widget.session.api.getJson('/api/businesses/$_id');
      final b = jsonMap(res['business']);
      final branches = await widget.session.api.getJson('/api/branches').then((r) => jsonList(r['branches'])).catchError((_) => <Map<String, dynamic>>[]);
      final wh = await widget.session.api.getJson('/api/warehouses').then((r) => jsonList(r['warehouses'])).catchError((_) => <Map<String, dynamic>>[]);
      if (!mounted) return;
      _f.reset({for (final k in _textKeys) k: b[k]?.toString() ?? ''});
      setState(() {
        _b = b;
        _branches = branches.where((x) => x['is_active'] != false).toList();
        _warehouses = wh;
        _loading = false;
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _loading = false;
        });
      }
    }
  }

  Future<void> _patch(Map<String, dynamic> body) async {
    await widget.session.api.patchJson('/api/business/$_id', body);
  }

  Future<void> _save() async {
    final changed = _f.changed;
    if (changed.isEmpty) return;
    setState(() => _saving = true);
    try {
      await _patch(changed);
      await _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${changed.length} change${changed.length == 1 ? '' : 's'} saved')));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _setInstant(String key, dynamic value, String message) {
    final before = _b[key];
    setState(() => _b = {..._b, key: value});
    saveInstantly(
      context,
      message: message,
      save: () => _patch({key: value}),
      revert: () => setState(() => _b = {..._b, key: before}),
      undo: () => _patch({key: before}),
    );
  }

  Future<void> _upload(String kind) async {
    final file = await FilePicker.pickFile(type: FileType.image);
    if (file == null) return;
    setState(() => _uploading = kind);
    try {
      final res = await widget.session.api.uploadImage('/api/upload/image', bytes: await file.readAsBytes(), fileName: file.name, fields: {'type': kind});
      final url = res['url']?.toString();
      if (url == null) throw ApiException('Upload failed');
      await _patch({kind == 'logo' ? 'logo_url' : 'signature_url': url});
      await _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(kind == 'logo' ? 'Logo updated' : 'Signature updated')));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _uploading = null);
    }
  }

  Widget _image(String kind, String label, String help) {
    final url = _b[kind == 'logo' ? 'logo_url' : 'signature_url']?.toString();
    final has = url != null && url.isNotEmpty;
    return SettingRow(
      label: label,
      help: help,
      todo: !has,
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: AppColors.sunken,
              borderRadius: BorderRadius.circular(10),
              image: has ? DecorationImage(image: NetworkImage(Uri.parse(apiBaseUrl).resolve(url).toString()), fit: BoxFit.contain) : null,
            ),
            child: has ? null : Icon(LucideIcons.image, color: AppColors.ink3, size: 20),
          ),
          const SizedBox(width: 8),
          _uploading == kind
              ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
              : KTextButton(label: has ? 'Replace' : 'Upload', onTap: () => _upload(kind)),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final reg = _b['gst_registration_type']?.toString() ?? 'unregistered';
    final state = _b['state']?.toString() ?? '';
    return SettingsPage(
      title: 'Business',
      blurb: 'Who you are on every invoice: name, address, GST, branding and locations.',
      icon: LucideIcons.building2,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      dirtyCount: _f.count,
      saving: _saving,
      onSave: _save,
      onDiscard: () => setState(_f.discard),
      children: [
        SettingsSection(title: 'Profile', why: 'Shown on every invoice, quote and WhatsApp message.', children: [
          TextSetting(label: 'Business name', controller: _f.field('name'), textCapitalization: TextCapitalization.words),
          TextSetting(label: 'Phone', controller: _f.field('phone'), keyboardType: TextInputType.phone),
          TextSetting(label: 'Email', controller: _f.field('email'), keyboardType: TextInputType.emailAddress),
        ]),
        SettingsSection(title: 'Registered address', why: 'Printed in the invoice header. Your state decides CGST + SGST or IGST.', children: [
          TextSetting(label: 'Address line 1', controller: _f.field('address_line1'), todo: _f.text('address_line1').isEmpty),
          TextSetting(label: 'Address line 2', controller: _f.field('address_line2')),
          TextSetting(label: 'City', controller: _f.field('city')),
          ChoiceSetting<String>(
            label: 'State',
            value: state,
            options: [for (final s in indianStates) (s, s)],
            onChanged: (v) => _setInstant('state', v, 'State: $v'),
          ),
          TextSetting(label: 'PIN code', controller: _f.field('pincode'), keyboardType: TextInputType.number, short: true),
        ]),
        SettingsSection(title: 'GST & tax', why: 'Decides whether you issue tax invoices or bills of supply.', children: [
          SegmentSetting<String>(
            label: 'Registration',
            value: reg,
            options: const [('regular', 'Regular'), ('composition', 'Composition'), ('unregistered', 'Not registered')],
            onChanged: (v) => _setInstant('gst_registration_type', v, 'Registration updated'),
          ),
          if (reg != 'unregistered')
            TextSetting(
              label: 'GSTIN',
              help: 'The state code at the start must match your address.',
              controller: _f.field('gstin'),
              mono: true,
              textCapitalization: TextCapitalization.characters,
              todo: _f.text('gstin').isEmpty,
            ),
          TextSetting(label: 'PAN', controller: _f.field('pan'), mono: true, textCapitalization: TextCapitalization.characters),
          if (reg != 'unregistered')
            ToggleSetting(
              label: 'Turnover above ₹5 crore last year',
              help: 'Invoices then need 6-digit HSN codes instead of 4.',
              value: _b['aggregate_turnover_above_5cr'] == true,
              onChanged: (v) => _setInstant('aggregate_turnover_above_5cr', v, v ? '6-digit HSN codes on' : '6-digit HSN codes off'),
            ),
        ]),
        SettingsSection(title: 'Logo & signature', why: 'Printed on invoices, quotes and receipts.', children: [
          _image('logo', 'Logo', 'Square PNG works best, up to 2 MB.'),
          _image('signature', 'Signature', 'Printed above “Authorised signatory”.'),
        ]),
        SettingsSection(title: 'Locations', why: 'Each branch can have its own GSTIN and invoice series.', children: [
          NavSetting(
            label: 'Branches',
            value: _branches.isEmpty ? 'One location' : _branches.map((b) => b['name']).whereType<Object>().join(', '),
            onTap: () => openPhoneSetting(context, widget.session, '/settings/branches'),
          ),
          NavSetting(
            label: 'Warehouses',
            value: _warehouses.isEmpty ? 'Not used' : _warehouses.map((w) => w['name']).whereType<Object>().join(', '),
            onTap: () => openPhoneSetting(context, widget.session, '/settings/warehouses'),
          ),
        ]),
        AdvancedSection(title: 'Exporter details', why: 'Only if you sell outside India.', children: [
          TextSetting(label: 'IEC (Import Export Code)', controller: _f.field('iec_code'), mono: true, textCapitalization: TextCapitalization.characters),
          TextSetting(label: 'SWIFT / BIC', controller: _f.field('swift_code'), mono: true, textCapitalization: TextCapitalization.characters),
        ]),
      ],
    );
  }
}

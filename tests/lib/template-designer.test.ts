import {
  DESIGNER_SECTIONS,
  PALETTES,
  colourSettings,
  densityOf,
  editableGroups,
  marginPresetOf,
  marginSettings,
  paletteOf,
  sectionSummary,
  sectionsFor,
} from '@/lib/template-designer';
import { getDefaultTemplateSettings } from '@/lib/template-defaults';
import { lockedSettingKeys } from '@/lib/invoice-statutory';

describe('designer sections', () => {
  it('gives every show_* setting exactly one home', () => {
    const keys = Object.keys(getDefaultTemplateSettings('gst_standard')).filter((k) => k.startsWith('show_'));
    const placed = DESIGNER_SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.fields.map((f) => f.key)));
    expect(new Set(placed).size).toBe(placed.length);
    expect(keys.filter((k) => !placed.includes(k))).toEqual([]);
    expect(placed.filter((k) => !keys.includes(k))).toEqual([]);
  });

  it('shows export details only on the export template', () => {
    expect(sectionsFor('gst_standard').map((s) => s.id)).not.toContain('export');
    expect(sectionsFor('export_invoice').map((s) => s.id)).toContain('export');
  });

  it('hides GST-locked switches on tax invoices and shows them on orders', () => {
    const header = DESIGNER_SECTIONS.find((s) => s.id === 'header')!;
    const taxKeys = editableGroups(header, lockedSettingKeys('tax_invoice', 'gst_standard')).flatMap((g) => g.fields.map((f) => f.key));
    expect(taxKeys).not.toContain('show_business_gstin');
    expect(taxKeys).toContain('show_logo');
    const orderKeys = editableGroups(header, lockedSettingKeys('sales_order', 'gst_standard')).flatMap((g) => g.fields.map((f) => f.key));
    expect(orderKeys).toContain('show_business_gstin');
  });

  it('summarises how many editable switches are on', () => {
    const header = DESIGNER_SECTIONS.find((s) => s.id === 'header')!;
    const settings = { show_logo: true, show_business_phone: false, show_business_email: false };
    // 11 header fields, 3 locked on a tax invoice (name, address, GSTIN) = 8 editable; 2 switched off.
    expect(sectionSummary(header, settings, lockedSettingKeys('tax_invoice', 'gst_standard'))).toBe('6 of 8 shown');
  });
});

describe('presets', () => {
  it('recognises a palette and clears the header text colour when applying one', () => {
    const navy = PALETTES[0];
    const s = colourSettings(navy.primary, navy.header);
    expect(s).toEqual({ primary_color: navy.primary, table_header_color: navy.header, table_header_text_color: undefined });
    expect(paletteOf({ primary_color: navy.primary.toUpperCase(), table_header_color: navy.header })).toBe('navy');
    expect(paletteOf({ primary_color: '#123456', table_header_color: '#123456' })).toBeNull();
  });

  it('maps font size to density', () => {
    expect(densityOf({ font_size: 10 })).toBe('compact');
    expect(densityOf({ font_size: 12 })).toBe('regular');
    expect(densityOf({ font_size: 11 })).toBe('regular');
    expect(densityOf({ font_size: 14 })).toBe('roomy');
    expect(densityOf({})).toBe('regular');
  });

  it('writes and reads margin presets', () => {
    expect(marginSettings('wide')).toEqual({ margin_top: 16, margin_right: 16, margin_bottom: 16, margin_left: 16 });
    expect(marginPresetOf(marginSettings('narrow'))).toBe('narrow');
    expect(marginPresetOf({})).toBe('normal');
    expect(marginPresetOf({ margin_top: 10, margin_right: 12, margin_bottom: 10, margin_left: 10 })).toBe('custom');
    expect(marginPresetOf({ margin_top: 8, margin_right: 8, margin_bottom: 8, margin_left: 8 })).toBe('custom');
  });
});

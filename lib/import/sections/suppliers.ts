import { checkSupplierInput, createSupplier, NAME_REQUIRED, SupplierAccessRefused } from '@/lib/suppliers/create-supplier';
import { removeUnused } from '@/lib/import/record-usage';
import { findParty, fromService, partyKeys, text, undoOne, withAccessRefusal } from '@/lib/import/sections/shared';
import type { SectionDefinition } from '@/lib/import/types';

const undoRecords: SectionDefinition['undoRecords'] = (ctx, ids) => removeUnused('suppliers', ctx, ids);

export const suppliersSection: SectionDefinition = {
  key: 'suppliers',
  label: 'Suppliers',
  module: 'suppliers',
  limitType: 'suppliers',
  fields: [
    { key: 'name', label: 'Supplier name', type: 'text', required: true, aliases: ['Name', 'Supplier name', 'Supplier', 'Vendor name', 'Vendor', 'Party name', 'Party'], maxLength: 255 },
    { key: 'phone', label: 'Phone', type: 'phone', aliases: ['Phone', 'Mobile', 'Mobile number', 'Phone number', 'Contact number', 'Contact'], maxLength: 20 },
    { key: 'email', label: 'Email', type: 'email', aliases: ['Email', 'E-mail', 'Email address', 'Email ID'], maxLength: 255 },
    { key: 'gstin', label: 'GSTIN', type: 'gstin', aliases: ['GSTIN', 'GST number', 'GST no', 'GSTIN/UIN', 'GST'], maxLength: 15 },
    { key: 'pan', label: 'PAN', type: 'text', aliases: ['PAN', 'PAN number', 'PAN no'], maxLength: 10 },
    { key: 'address', label: 'Address', type: 'text', aliases: ['Address', 'Billing address'] },
    { key: 'city', label: 'City', type: 'text', aliases: ['City', 'Town'], maxLength: 100 },
    { key: 'state', label: 'State', type: 'state', aliases: ['State', 'State name'], maxLength: 100 },
    { key: 'pincode', label: 'PIN code', type: 'pincode', aliases: ['PIN code', 'Pincode', 'PIN', 'Postal code', 'ZIP', 'ZIP code'], maxLength: 10 },
  ],

  duplicateKeys: partyKeys,

  // The service's own check; an empty name is left to buildRow's required check.
  checkRow(values) {
    const r = checkSupplierInput({
      name: text(values, 'name') ?? '',
      gstin: text(values, 'gstin') ?? null,
      state: text(values, 'state') ?? null,
      pan: text(values, 'pan') ?? null,
    });
    if (r.ok || r.code === NAME_REQUIRED) return [];
    return [{ field: /PAN/.test(r.code) ? 'pan' : 'gstin', level: 'error', message: r.error }];
  },

  findExisting: (ctx, values) => findParty('suppliers', values, ctx.businessId),

  // No audit argument: the import writes one activity-log entry per run.
  saveRow: (ctx, values) =>
    withAccessRefusal(SupplierAccessRefused, 'suppliers', async () =>
      fromService(
        'suppliers',
        await createSupplier(ctx, {
          name: text(values, 'name') ?? '',
          phone: text(values, 'phone') ?? null,
          email: text(values, 'email') ?? null,
          gstin: text(values, 'gstin') ?? null,
          pan: text(values, 'pan') ?? null,
          address: text(values, 'address') ?? null,
          city: text(values, 'city') ?? null,
          state: text(values, 'state') ?? null,
          pincode: text(values, 'pincode') ?? null,
        })
      )
    ),

  undoRecords,
  undoRecord: undoOne(undoRecords),
};

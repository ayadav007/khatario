import { createSupplier, SupplierAccessRefused } from '@/lib/suppliers/create-supplier';
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
    { key: 'name', label: 'Supplier name', type: 'text', required: true, aliases: ['Name', 'Supplier name', 'Supplier', 'Vendor name', 'Vendor', 'Party name', 'Party'] },
    { key: 'phone', label: 'Phone', type: 'phone', aliases: ['Phone', 'Mobile', 'Mobile number', 'Phone number', 'Contact number', 'Contact'] },
    { key: 'email', label: 'Email', type: 'email', aliases: ['Email', 'E-mail', 'Email address', 'Email ID'] },
    { key: 'gstin', label: 'GSTIN', type: 'gstin', aliases: ['GSTIN', 'GST number', 'GST no', 'GSTIN/UIN', 'GST'] },
    { key: 'pan', label: 'PAN', type: 'text', aliases: ['PAN', 'PAN number', 'PAN no'] },
    { key: 'address', label: 'Address', type: 'text', aliases: ['Address', 'Billing address'] },
    { key: 'city', label: 'City', type: 'text', aliases: ['City', 'Town'] },
    { key: 'state', label: 'State', type: 'state', aliases: ['State', 'State name'] },
    { key: 'pincode', label: 'PIN code', type: 'pincode', aliases: ['PIN code', 'Pincode', 'PIN', 'Postal code', 'ZIP', 'ZIP code'] },
  ],

  duplicateKeys: partyKeys,

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

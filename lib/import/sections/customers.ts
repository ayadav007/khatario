import { createCustomer, CustomerAccessRefused } from '@/lib/customers/create-customer';
import { removeUnused } from '@/lib/import/record-usage';
import { findParty, fromService, num, partyKeys, text, undoOne, withAccessRefusal } from '@/lib/import/sections/shared';
import type { SectionDefinition } from '@/lib/import/types';

const undoRecords: SectionDefinition['undoRecords'] = (ctx, ids) => removeUnused('customers', ctx, ids);

export const customersSection: SectionDefinition = {
  key: 'customers',
  label: 'Customers',
  module: 'customers',
  limitType: 'customers',
  fields: [
    { key: 'name', label: 'Customer name', type: 'text', required: true, aliases: ['Name', 'Customer name', 'Customer', 'Party name', 'Party', 'Client name'] },
    { key: 'company_name', label: 'Company name', type: 'text', aliases: ['Company name', 'Company', 'Business name', 'Firm name'] },
    { key: 'phone', label: 'Phone', type: 'phone', aliases: ['Phone', 'Mobile', 'Mobile number', 'Phone number', 'Contact number', 'Contact'] },
    { key: 'email', label: 'Email', type: 'email', aliases: ['Email', 'E-mail', 'Email address', 'Email ID'] },
    { key: 'gstin', label: 'GSTIN', type: 'gstin', aliases: ['GSTIN', 'GST number', 'GST no', 'GSTIN/UIN', 'GST'] },
    { key: 'address', label: 'Address', type: 'text', aliases: ['Address', 'Billing address'] },
    { key: 'city', label: 'City', type: 'text', aliases: ['City', 'Town', 'Billing city'] },
    { key: 'state', label: 'State', type: 'state', aliases: ['State', 'State name', 'Billing state'] },
    { key: 'pincode', label: 'PIN code', type: 'pincode', aliases: ['PIN code', 'Pincode', 'PIN', 'Postal code', 'ZIP', 'ZIP code'] },
    { key: 'shipping_address', label: 'Shipping address', type: 'text', aliases: ['Shipping address', 'Delivery address'] },
    { key: 'credit_limit', label: 'Credit limit', type: 'amount', aliases: ['Credit limit'] },
    { key: 'credit_days', label: 'Credit days', type: 'number', aliases: ['Credit days', 'Credit period', 'Payment terms'] },
  ],

  duplicateKeys: partyKeys,

  findExisting: (ctx, values) => findParty('customers', values, ctx.businessId),

  saveRow: (ctx, values) =>
    withAccessRefusal(CustomerAccessRefused, 'customers', async () =>
      fromService(
        'customers',
        await createCustomer(ctx, {
          name: text(values, 'name') ?? '',
          company_name: text(values, 'company_name'),
          phone: text(values, 'phone'),
          email: text(values, 'email'),
          gstin: text(values, 'gstin'),
          address: text(values, 'address'),
          city: text(values, 'city'),
          state: text(values, 'state'),
          pincode: text(values, 'pincode'),
          shipping_address: text(values, 'shipping_address'),
          credit_limit: num(values, 'credit_limit'),
          credit_days: num(values, 'credit_days'),
        })
      )
    ),

  undoRecords,
  undoRecord: undoOne(undoRecords),
};

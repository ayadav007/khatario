import { describe, expect, it } from '@jest/globals';
import { notificationHref } from '@/lib/notifications/notification-href';

const id = '5620687e-e3d1-464c-afdc-5cf3c29f9c2d';

describe('notificationHref', () => {
  it('opens Supplier Hub records', () => {
    expect(notificationHref({ type: 'general', reference_type: 'supply_order', reference_id: id })).toBe(`/supply-orders/${id}`);
    expect(notificationHref({ type: 'general', reference_type: 'supplier_collection', reference_id: id })).toBe('/purchases/new-arrivals');
    expect(notificationHref({ type: 'low_stock_alert', reference_type: 'item', reference_id: id })).toBe('/supply-orders?role=vendor');
    expect(notificationHref({ type: 'hub_connection_request', reference_type: 'supplier_connection_request', reference_id: id })).toBe('/suppliers/hub');
    expect(notificationHref({ type: 'general', reference_type: 'invoice', reference_id: id })).toBe(`/invoices/${id}`);
  });

  it('opens the record behind every notification kind that has a page', () => {
    expect(notificationHref({ type: 'invoice_viewed', reference_type: 'invoices', reference_id: id })).toBe(`/invoices/${id}`);
    expect(notificationHref({ type: 'general', reference_type: 'supplier_hub_money', reference_id: id })).toBe('/suppliers/hub');
    expect(notificationHref({ type: 'general', reference_type: 'supply_standing_order' })).toBe('/supply-orders');
    expect(notificationHref({ type: 'quantity_request', reference_type: 'purchase_order', reference_id: id })).toBe(`/purchase-orders/${id}`);
    expect(notificationHref({ type: 'general', reference_type: 'subscription' })).toBe('/settings/subscription');
    expect(notificationHref({ type: 'general', reference_type: 'ai_agent' })).toBe('/settings/ai-agent');
    expect(notificationHref({ type: 'general', reference_type: 'whatsapp_session' })).toBe('/settings/whatsapp');
    expect(notificationHref({ type: 'general', reference_type: 'khata_customer', reference_id: id })).toBe(`/customers/${id}`);
    expect(notificationHref({ type: 'general', reference_type: 'whatsapp_conversation', reference_id: id })).toBe(`/whatsapp/conversations?c=${id}`);
    expect(notificationHref({ type: 'general', reference_type: 'whatsapp_lead', reference_id: id })).toBe(`/whatsapp/leads?lead=${id}`);
  });

  it('prefers an explicit action URL', () => {
    expect(notificationHref({ actionUrl: '/somewhere', reference_type: 'supply_order', reference_id: id })).toBe('/somewhere');
  });

  it('returns null when there is nothing to open', () => {
    expect(notificationHref({ type: 'general' })).toBeNull();
  });
});

export type DeliveryProviderId = 'self' | 'shiprocket';

export interface DeliveryQuoteRequest {
  pickupPincode?: string | null;
  deliveryPincode?: string | null;
  weightKg?: number;
  isCod?: boolean;
}

export interface DeliveryQuoteResult {
  serviceable: boolean;
  charge: number;
  etaText: string;
  error?: string;
}

export interface CreateShipmentInput {
  orderId: string;
  orderNumber: string;
  grandTotal: number;
  paymentStatus: 'unpaid' | 'paid' | 'cod';
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  customerAddress: string;
  customerPincode: string;
  pickupAddress?: string | null;
  pickupPincode?: string | null;
  weightKg?: number;
}

export interface CreateShipmentResult {
  ok: boolean;
  shipmentId?: string;
  awb?: string;
  trackingUrl?: string;
  billedFee?: number;
  error?: string;
}

export interface DeliveryProvider {
  id: DeliveryProviderId;
  quoteSelfFallback: boolean;
  checkServiceability(input: DeliveryQuoteRequest): Promise<{ serviceable: boolean; error?: string }>;
  quote(input: DeliveryQuoteRequest): Promise<DeliveryQuoteResult>;
  createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult>;
  cancelShipment?(shipmentId: string): Promise<void>;
  parseWebhook?(body: Record<string, unknown>): {
    awb: string;
    orderRef: string;
    status: string | null;
  };
}

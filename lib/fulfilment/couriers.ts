export interface CourierInfo {
  key: string;
  name: string;
  /** Tracking page for an AWB. `deepLink` false means the page opens empty and the buyer types the number. */
  trackingUrl: (awb: string) => string;
  deepLink: boolean;
}

export const COURIERS: readonly CourierInfo[] = [
  { key: 'delhivery', name: 'Delhivery', trackingUrl: (a) => `https://www.delhivery.com/track/package/${encodeURIComponent(a)}`, deepLink: true },
  { key: 'ekart', name: 'Ekart', trackingUrl: (a) => `https://ekartlogistics.com/shipmenttrack/${encodeURIComponent(a)}`, deepLink: true },
  { key: 'shiprocket', name: 'Shiprocket', trackingUrl: (a) => `https://shiprocket.co/tracking/${encodeURIComponent(a)}`, deepLink: true },
  { key: 'dtdc', name: 'DTDC', trackingUrl: () => 'https://www.dtdc.com/track-your-shipment/', deepLink: false },
  { key: 'bluedart', name: 'Blue Dart', trackingUrl: () => 'https://www.bluedart.com/tracking', deepLink: false },
  { key: 'xpressbees', name: 'Xpressbees', trackingUrl: () => 'https://www.xpressbees.com/track', deepLink: false },
  {
    key: 'indiapost',
    name: 'India Post',
    trackingUrl: () => 'https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx',
    deepLink: false,
  },
];

export function findCourier(nameOrKey: string | null | undefined): CourierInfo | null {
  const n = (nameOrKey ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (!n) return null;
  return COURIERS.find((c) => c.key === n || c.name.toLowerCase().replace(/[^a-z]/g, '') === n) ?? null;
}

/** Only http(s) links are kept; anything else (javascript:, data:) is dropped. */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** A pasted link wins (Porter, Rapido live links); otherwise build one from the courier and AWB. */
export function resolveTrackingUrl(input: {
  partnerName?: string | null;
  awb?: string | null;
  pastedUrl?: string | null;
}): string | null {
  const pasted = safeHttpUrl(input.pastedUrl);
  if (pasted) return pasted;
  const awb = (input.awb ?? '').trim();
  if (!awb) return null;
  const courier = findCourier(input.partnerName);
  return courier ? courier.trackingUrl(awb) : null;
}

import {
  CANCEL_REASONS,
  RECHECK_STILL_ACTIVE,
  cancelReasonText,
  einvoiceErrorDisplay,
  einvoiceEwbRequest,
  einvoiceGenerateRequest,
  einvoiceGoodsFacts,
  einvoicePanelState,
  formatIndianDate,
  problemFixHref,
  type PanelFacts,
} from '@/lib/gst/einvoice-panel';
import type { EinvoiceView } from '@/lib/gst/einvoice';
import type { EwayForm } from '@/lib/gst/eway-generate-form';

const view = (over: Partial<EinvoiceView> = {}): EinvoiceView => ({
  applies: true,
  status: 'none',
  irn: null,
  ack_no: null,
  ack_date: null,
  signed_qr: null,
  can_cancel: false,
  can_recheck: false,
  last_error: null,
  problems: [],
  eway_warning: null,
  cancelled_at: null,
  cancel_reason: null,
  ship_to_needed: false,
  ...over,
});

const facts = (over: Partial<PanelFacts> = {}): PanelFacts => ({
  documentType: 'tax_invoice',
  ewayAllowed: true,
  ewayBillsKnown: true,
  hasActiveEwayBill: false,
  goodsLineCount: 2,
  goodsValue: 10000,
  ...over,
});

const shown = (s: ReturnType<typeof einvoicePanelState>) => {
  if (!s.visible) throw new Error('panel hidden');
  return s;
};

describe('formatIndianDate', () => {
  it('formats in Indian time as DD/MM/YYYY whatever the machine timezone', () => {
    expect(formatIndianDate('2026-11-27T08:00:00Z')).toBe('27/11/2026');
    expect(formatIndianDate('2026-11-27T18:29:59Z')).toBe('27/11/2026');
    expect(formatIndianDate('2026-11-27T18:30:00Z')).toBe('28/11/2026');
    expect(formatIndianDate(new Date('2026-01-05T00:00:00Z'))).toBe('05/01/2026');
    expect(formatIndianDate(null)).toBeNull();
    expect(formatIndianDate('not a date')).toBeNull();
  });
});

describe('einvoicePanelState', () => {
  it('is hidden when e-invoicing does not apply and there is no e-invoice', () => {
    expect(einvoicePanelState(view({ applies: false }), facts()).visible).toBe(false);
    expect(einvoicePanelState(null, facts()).visible).toBe(false);
  });

  it('still shows a cancelled e-invoice when e-invoicing no longer applies', () => {
    const s = shown(einvoicePanelState(view({ applies: false, status: 'cancelled', irn: 'x'.repeat(64) }), facts()));
    expect(s.badge).toEqual({ text: 'E-invoice cancelled', tone: 'grey' });
  });

  it('pending: red badge, the tax credit line and Generate', () => {
    const s = shown(einvoicePanelState(view({ last_error: 'E-invoice portal: Invalid buyer GSTIN' }), facts()));
    expect(s.badge).toEqual({ text: 'E-invoice pending', tone: 'red' });
    expect(s.pendingNote).toBe("This invoice is not valid for your customer's tax credit until its e-invoice is generated.");
    expect(s.showGenerate).toBe(true);
    expect(s.generateDisabled).toBe(false);
    expect(s.lastError).toBe('E-invoice portal: Invalid buyer GSTIN');
    expect(s.showCancel).toBe(false);
    expect(s.showRecheck).toBe(false);
  });

  it('pending with problems: Generate disabled, each problem with its Fix link or none', () => {
    const s = shown(
      einvoicePanelState(
        view({
          problems: [
            { field: 'hsn', message: 'Use the 6-digit HSN code for Toor Dal. E-invoices do not accept shorter codes.', fix: { kind: 'item', id: 'item-1' } },
            { field: 'hsn', message: 'Add the HSN code for Loose item', fix: { kind: 'item', id: null } },
            { field: 'buyer_gstin', message: 'Add the GSTIN', fix: { kind: 'customer', id: 'cust-1' } },
            { field: 'seller_gstin', message: 'Add your GSTIN in Business settings', fix: { kind: 'business', id: null } },
            { field: 'doc_number', message: 'Use a shorter number', fix: { kind: 'invoice', id: 'inv-1' } },
            { field: 'other', message: 'No fix' },
            { field: 'seller_pincode', message: "Add the PIN code of this branch's address in Branch settings", fix: { kind: 'branch', id: 'br 1' } },
          ],
        }),
        facts({ documentType: 'tax_invoice' }),
      ),
    );
    expect(s.generateDisabled).toBe(true);
    expect(s.problems.map((p) => p.href)).toEqual([
      '/items/new?edit=item-1',
      null,
      '/customers/cust-1/edit',
      '/settings/business',
      // A final invoice cannot be edited: its own problems say what to do and have no link.
      null,
      null,
      '/settings/branches/br%201/edit',
    ]);
    expect(s.problems[0].message).toBe('Use the 6-digit HSN code for Toor Dal. E-invoices do not accept shorter codes.');
  });

  it('offers the e-way bill checkbox only for goods without an e-way bill, pre-ticked over 50,000', () => {
    expect(shown(einvoicePanelState(view(), facts({ goodsValue: 50001 })))).toMatchObject({ showEwbOption: true, ewbPreTicked: true });
    expect(shown(einvoicePanelState(view(), facts({ goodsValue: 50000 })))).toMatchObject({ showEwbOption: true, ewbPreTicked: false });
    expect(shown(einvoicePanelState(view(), facts({ hasActiveEwayBill: true }))).showEwbOption).toBe(false);
    expect(shown(einvoicePanelState(view(), facts({ goodsLineCount: 0 }))).showEwbOption).toBe(false);
    expect(shown(einvoicePanelState(view(), facts({ ewayAllowed: false }))).showEwbOption).toBe(false);
    expect(shown(einvoicePanelState(view(), facts({ ewayBillsKnown: false }))).showEwbOption).toBe(false);
  });

  it('active: details, QR value unchanged, Cancel while allowed, no Generate', () => {
    const qr = 'eyJhbGciOiJSUzI1NiJ9.eyJkYXRhIjoiMSJ9.sig+/=';
    const s = shown(
      einvoicePanelState(
        view({ status: 'active', irn: 'a'.repeat(64), ack_no: '112410', ack_date: '2026-11-27T08:00:00Z', signed_qr: qr, can_cancel: true }),
        facts(),
      ),
    );
    expect(s.badge).toEqual({ text: 'E-invoice generated', tone: 'green' });
    expect([s.irn, s.ackNo, s.ackDate, s.qrValue]).toEqual(['a'.repeat(64), '112410', '27/11/2026', qr]);
    expect(s.showGenerate).toBe(false);
    expect(s.showEwbOption).toBe(false);
    expect(s.showCancel).toBe(true);
    expect(s.showRecheck).toBe(false);
    expect(s.pendingNote).toBeNull();
  });

  it('active past 24 hours: no Cancel, offers the portal status check', () => {
    const s = shown(einvoicePanelState(view({ status: 'active', irn: 'a'.repeat(64), can_cancel: false, can_recheck: true }), facts()));
    expect(s.showCancel).toBe(false);
    expect(s.showRecheck).toBe(true);
  });

  it('cancelled: grey badge with date and reason, nothing to press', () => {
    const s = shown(
      einvoicePanelState(
        view({ status: 'cancelled', irn: 'a'.repeat(64), cancelled_at: '2026-11-27T19:00:00Z', cancel_reason: 'data_entry: Wrong rate' }),
        facts(),
      ),
    );
    expect(s.badge).toEqual({ text: 'E-invoice cancelled', tone: 'grey' });
    expect(s.cancelledNote).toBe('Cancelled on 28/11/2026. Reason: Data entry mistake: Wrong rate');
    expect([s.showGenerate, s.showCancel, s.showRecheck, s.showEwbOption]).toEqual([false, false, false, false]);
  });

  it('cancelled without a reason says only the date', () => {
    const s = shown(einvoicePanelState(view({ status: 'cancelled', cancelled_at: '2026-11-27T08:00:00Z' }), facts()));
    expect(s.cancelledNote).toBe('Cancelled on 27/11/2026.');
  });
});

describe('cancel reasons', () => {
  it('sends the four values the server accepts', () => {
    expect(CANCEL_REASONS.map((r) => r.value)).toEqual(['duplicate', 'data_entry', 'order_cancelled', 'others']);
  });
  it('turns the stored reason into words', () => {
    expect(cancelReasonText('duplicate: Billed twice')).toBe('Duplicate: Billed twice');
    expect(cancelReasonText('others')).toBe('Other');
    expect(cancelReasonText(null)).toBeNull();
    expect(cancelReasonText('something else')).toBe('something else');
  });
});

describe('problemFixHref', () => {
  it('encodes ids and has no link without an id', () => {
    expect(problemFixHref({ field: 'x', message: 'm', fix: { kind: 'customer', id: 'a b' } }, 'tax_invoice')).toBe('/customers/a%20b/edit');
    expect(problemFixHref({ field: 'x', message: 'm', fix: { kind: 'customer', id: null } }, 'tax_invoice')).toBeNull();
    expect(problemFixHref({ field: 'x', message: 'm', fix: { kind: 'invoice', id: null } }, 'tax_invoice')).toBeNull();
  });
});

describe('ship-to on the e-invoice', () => {
  const form = (over: Partial<EwayForm> = {}): EwayForm => ({
    distance: '120', mode: 'road', vehicle: 'ka01ab1234', transporterGstin: '', transporterName: '', docNumber: '', docDate: '',
    isOdc: false, shipToGstin: '', shipToPlace: '', shipToPincode: '', shipToStateCode: '', ...over,
  });
  const nashik = { shipToPlace: ' Nashik ', shipToPincode: '422001', shipToStateCode: '27' };

  it('shows the ship-to fields only while the e-invoice is pending and the server says they are needed', () => {
    expect(shown(einvoicePanelState(view({ ship_to_needed: true }), facts())).showShipTo).toBe(true);
    expect(shown(einvoicePanelState(view(), facts())).showShipTo).toBe(false);
    expect(shown(einvoicePanelState(view({ ship_to_needed: true, status: 'active', irn: 'X' }), facts())).showShipTo).toBe(false);
    // The ship-to need is not a problem: Generate stays enabled so the typed place can be sent.
    expect(shown(einvoicePanelState(view({ ship_to_needed: true }), facts())).generateDisabled).toBe(false);
  });

  it('requires the city, a 6-digit PIN code and the state when ship-to is needed', () => {
    const r = einvoiceGenerateRequest(form(), { withEwb: false, needShipTo: true });
    expect(r).toEqual({ ok: false, errors: { shipToPlace: 'Enter the ship-to city, PIN code and state together' } });
    const r2 = einvoiceGenerateRequest(form({ ...nashik, shipToPincode: '4220' }), { withEwb: false, needShipTo: true });
    expect(r2).toEqual({ ok: false, errors: { shipToPincode: 'Enter a 6-digit PIN code' } });
    const r3 = einvoiceGenerateRequest(form({ ...nashik, shipToGstin: '27AB' }), { withEwb: false, needShipTo: true });
    expect(r3).toEqual({ ok: false, errors: { shipToGstin: 'Enter a 15-character GSTIN' } });
  });

  it('sends the ship-to fields next to ewb, with the names the e-way bill generator uses', () => {
    expect(einvoiceGenerateRequest(form({ ...nashik, shipToGstin: '27aaact1234a1z5' }), { withEwb: false, needShipTo: true })).toEqual({
      ok: true,
      body: { ship_to_place: 'Nashik', ship_to_pincode: '422001', ship_to_state_code: '27', ship_to_gstin: '27AAACT1234A1Z5' },
    });
    expect(einvoiceGenerateRequest(form(nashik), { withEwb: true, needShipTo: true })).toEqual({
      ok: true,
      body: {
        ewb: { distance_km: 120, transport_mode: 'road', is_odc: false, vehicle_number: 'KA01AB1234' },
        ship_to_place: 'Nashik', ship_to_pincode: '422001', ship_to_state_code: '27',
      },
    });
    // Not needed: nothing about ship-to is sent, even if typed earlier.
    expect(einvoiceGenerateRequest(form(nashik), { withEwb: false, needShipTo: false })).toEqual({ ok: true, body: {} });
  });

  it('reports e-way bill and ship-to mistakes together', () => {
    const r = einvoiceGenerateRequest(form({ distance: '' }), { withEwb: true, needShipTo: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['distance', 'shipToPlace']);
  });
});

describe('einvoiceEwbRequest', () => {
  const form = (over: Partial<EwayForm> = {}): EwayForm => ({
    distance: '120', mode: 'road', vehicle: 'ka01ab1234', transporterGstin: '', transporterName: '', docNumber: '', docDate: '',
    isOdc: false, shipToGstin: '', shipToPlace: '', shipToPincode: '', shipToStateCode: '', ...over,
  });

  it('validates with the e-way bill form rules before sending', () => {
    const r = einvoiceEwbRequest(form({ distance: '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.distance).toBeTruthy();
    const r2 = einvoiceEwbRequest(form({ vehicle: '' }));
    expect(r2.ok).toBe(false);
  });

  it('sends only the field names the server reads', () => {
    const r = einvoiceEwbRequest(
      form({ mode: 'rail', vehicle: '', transporterGstin: '29ABCDE1234F1Z5', transporterName: 'Blue Dart', docNumber: 'RR1', docDate: '2026-11-27', isOdc: true }),
    );
    expect(r).toEqual({
      ok: true,
      body: {
        ewb: {
          distance_km: 120,
          transport_mode: 'rail',
          is_odc: true,
          transporter_gstin: '29ABCDE1234F1Z5',
          transporter_name: 'Blue Dart',
          transport_doc_number: 'RR1',
          transport_doc_date: '2026-11-27',
        },
      },
    });
    const road = einvoiceEwbRequest(form());
    expect(road).toEqual({ ok: true, body: { ewb: { distance_km: 120, transport_mode: 'road', is_odc: false, vehicle_number: 'KA01AB1234' } } });
  });
});

describe('einvoiceGoodsFacts', () => {
  it('counts goods lines and their value, leaving out services and charges', () => {
    expect(
      einvoiceGoodsFacts([
        { hsn_sac: '07136000', taxable_value: 40000, cgst_amount: 1000, sgst_amount: 1000 },
        { hsn_sac: '998314', taxable_value: 90000, igst_amount: 16200 },
        { hsn_sac: '', taxable_value: 9000, charge_line: true },
        { hsn_sac: '15121910', taxable_value: '8000', igst_amount: '400', cess_amount: '0' },
      ]),
    ).toEqual({ count: 2, value: 50400 });
    expect(einvoiceGoodsFacts(undefined)).toEqual({ count: 0, value: 0 });
  });
});

describe('einvoiceErrorDisplay', () => {
  const err = (status: number, body: Record<string, unknown> | null, action: Parameters<typeof einvoiceErrorDisplay>[0]['action'] = 'generate') =>
    einvoiceErrorDisplay({ status, body, action });

  it('offers Connect Masters India for a missing or refused login', () => {
    expect(err(409, { error: 'Connect your Masters India account in Settings, Integrations first.', code: 'GSP_NOT_CONNECTED' })).toMatchObject({ connect: true });
    expect(err(409, { error: 'Masters India no longer accepts the saved login.', code: 'GSP_AUTH' }, 'cancel')).toMatchObject({ connect: true });
  });

  it('opens the upgrade prompt for the monthly limit', () => {
    const d = err(403, { error: "You have reached this month's e-invoice limit for your plan.", code: 'LIMIT_EXCEEDED' });
    expect(d).toMatchObject({ upgrade: 'limit', message: "You have reached this month's e-invoice limit for your plan." });
  });

  it('lists the problems of a failed check', () => {
    const problems = [{ field: 'ewaybill', message: 'Add the vehicle number' }];
    expect(err(422, { error: 'Fix these before generating the e-invoice', code: 'PRECHECK_FAILED', problems })).toMatchObject({ problems });
  });

  it('says the recheck answer in plain words', () => {
    expect(err(409, { error: 'An e-invoice can be cancelled only within 24 hours.', code: 'CANCEL_WINDOW_CLOSED' }, 'recheck').message).toBe(RECHECK_STILL_ACTIVE);
    expect(RECHECK_STILL_ACTIVE).toBe('The portal still shows this e-invoice as active, or it could not be checked.');
    expect(err(409, { error: 'An e-invoice can be cancelled only within 24 hours. Issue a credit note instead.', code: 'CANCEL_WINDOW_CLOSED' }, 'cancel')).toMatchObject({
      message: 'An e-invoice can be cancelled only within 24 hours. Issue a credit note instead.',
      refresh: true,
    });
  });

  it('reloads the state when it may have changed', () => {
    for (const code of ['GSP_REJECTED', 'IRN_EXISTS', 'IRN_CANCELLED', 'IRN_NOT_SAVED', 'GSP_NO_ANSWER', 'NO_IRN', 'NOT_APPLICABLE']) {
      expect(err(409, { error: 'x', code }).refresh).toBe(true);
    }
    expect(err(400, { error: 'Enter the distance in km (0 to 4000)', code: 'INVALID_EWB' }).refresh).toBe(false);
  });

  it('shows the server message for every other e-invoice code', () => {
    for (const code of ['IRN_MISMATCH', 'GSP_NOT_CONFIGURED', 'GSP_REJECTED', 'INVALID_EWB', 'EWAY_EXISTS', 'BAD_REQUEST', 'EWAY_ACTIVE', 'REMARKS_REQUIRED', 'REASON_REQUIRED', 'NOT_FOUND', 'EWB_NOT_ALLOWED', 'NO_GSTIN']) {
      expect(err(409, { error: `Message for ${code}`, code }).message).toBe(`Message for ${code}`);
    }
  });

  it('turns plan, permission and session refusals into plain words', () => {
    expect(err(403, { error: 'Feature not available in your plan', code: 'FEATURE_NOT_IN_PLAN', feature: 'e_invoice' }).message).toBe(
      'E-invoices are not part of your plan. Upgrade your plan to use them.',
    );
    expect(err(403, { error: 'Feature not available in your plan', code: 'FEATURE_NOT_IN_PLAN', feature: 'eway_bill' }).message).toBe(
      'E-way bills are not part of your plan. Untick "Also create the e-way bill", or upgrade your plan.',
    );
    expect(err(403, { error: 'Permission denied: invoices.update', code: 'FORBIDDEN' }).message).toBe(
      'You do not have permission to do this. Ask the business owner for access.',
    );
    expect(err(401, { error: 'Authentication required', code: 'UNAUTHENTICATED' }).message).toBe('Your session has ended. Sign in again.');
  });

  it('never leaves an empty message: no answer, or an unreadable one', () => {
    for (const action of ['generate', 'cancel', 'recheck', 'load'] as const) {
      const d = err(504, null, action);
      expect(d.message.length).toBeGreaterThan(10);
      expect(d.refresh).toBe(action !== 'load');
      expect(err(0, null, action).message.length).toBeGreaterThan(10);
      expect(err(500, { error: 'Failed to generate the e-invoice' }, action).message.length).toBeGreaterThan(10);
    }
  });

  it('has no em dashes or developer words in any message', () => {
    const codes = ['GSP_NOT_CONNECTED', 'LIMIT_EXCEEDED', 'FEATURE_NOT_IN_PLAN', 'FORBIDDEN', 'UNAUTHENTICATED', 'CANCEL_WINDOW_CLOSED'];
    for (const code of codes) {
      for (const action of ['generate', 'cancel', 'recheck', 'load'] as const) {
        const m = err(code === 'UNAUTHENTICATED' ? 401 : 403, { error: 'x', code }, action).message;
        expect(m).not.toMatch(/—|GSP|API|null|undefined|\bcode\b/);
      }
    }
    for (const action of ['generate', 'cancel', 'recheck', 'load'] as const) {
      expect(err(502, null, action).message).not.toMatch(/—|GSP|API/);
    }
  });
});

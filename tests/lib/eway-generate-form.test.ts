import { hasEwayBillOnRecord, validateEwayForm, type EwayForm } from '@/lib/gst/eway-generate-form';

const base: EwayForm = {
  distance: '120', mode: 'road', vehicle: 'ka01 ab 1234', transporterGstin: '', transporterName: '',
  docNumber: '', docDate: '', isOdc: false, shipToGstin: '', shipToPlace: '', shipToPincode: '', shipToStateCode: '',
};
const errorsOf = (over: Partial<EwayForm>) => {
  const r = validateEwayForm({ ...base, ...over });
  if (r.ok) throw new Error('expected errors');
  return r.errors;
};

describe('validateEwayForm', () => {
  it('accepts a valid road form and builds the exact body', () => {
    const r = validateEwayForm(base);
    expect(r).toEqual({
      ok: true,
      body: { distance_km: 120, transport_mode: 'road', vehicle_number: 'KA01AB1234', is_odc: false },
    });
  });

  it('keeps transporter, ship-to and document details when given', () => {
    const r = validateEwayForm({
      ...base, mode: 'rail', vehicle: '', transporterGstin: '29abcde1234f1z5', transporterName: ' Fast Cargo ',
      docNumber: 'RR123', docDate: '2026-11-20', isOdc: true, shipToGstin: 'URP',
      shipToPlace: 'Mysuru', shipToPincode: '570001', shipToStateCode: '29',
    });
    expect(r).toEqual({
      ok: true,
      body: {
        distance_km: 120, transport_mode: 'rail', is_odc: true, transporter_gstin: '29ABCDE1234F1Z5',
        transporter_name: 'Fast Cargo', transport_doc_number: 'RR123', transport_doc_date: '2026-11-20',
        ship_to_gstin: 'URP', ship_to_place: 'Mysuru', ship_to_pincode: '570001', ship_to_state_code: '29',
      },
    });
  });

  it.each(['', 'abc', '12.5', '-1', '4001', '1e3'])('rejects distance %p', (d) => {
    expect(errorsOf({ distance: d }).distance).toBe("Enter the distance in km, 0 to 4000. Enter 0 to use the portal's distance.");
  });

  it.each(['0', '4000'])('accepts distance %p', (d) => {
    expect(validateEwayForm({ ...base, distance: d }).ok).toBe(true);
  });

  it('rejects a bad vehicle number and accepts a temporary one', () => {
    expect(errorsOf({ vehicle: 'KA1234' }).vehicle).toBe('Enter a valid vehicle number, like KA01AB1234');
    const r = validateEwayForm({ ...base, vehicle: 'tm 12ab34' });
    expect(r.ok && r.body.vehicle_number).toBe('TM12AB34');
  });

  it('rejects GSTINs that are not 15 characters or URP', () => {
    expect(errorsOf({ transporterGstin: '29ABC' }).transporterGstin).toBe('Enter a 15-character GSTIN');
    expect(errorsOf({ shipToGstin: '123' }).shipToGstin).toBe('Enter a 15-character GSTIN');
    expect(validateEwayForm({ ...base, transporterGstin: 'urp' }).ok).toBe(true);
  });

  it('needs a vehicle or transporter GSTIN by road', () => {
    expect(errorsOf({ vehicle: '' }).vehicle).toBe("Enter the vehicle number, or the transporter's GSTIN to generate Part A only");
    expect(validateEwayForm({ ...base, vehicle: '', transporterGstin: '29ABCDE1234F1Z5' }).ok).toBe(true);
  });

  it('needs the transport document number and date for rail, air and ship', () => {
    for (const mode of ['rail', 'air', 'ship'] as const) {
      const e = errorsOf({ mode, vehicle: '' });
      expect(e.docNumber).toBe('Enter the transport document number and date');
      expect(e.docDate).toBe('Enter the transport document number and date');
      expect(errorsOf({ mode, vehicle: '', docNumber: 'X1' }).docDate).toBe('Enter the transport document number and date');
    }
    expect(validateEwayForm({ ...base, mode: 'air', vehicle: '', docNumber: 'X1', docDate: '2026-11-20' }).ok).toBe(true);
  });

  it('needs all three ship-to fields once one is filled', () => {
    const msg = 'Enter the ship-to city, PIN code and state together';
    expect(errorsOf({ shipToPlace: 'Mysuru' }).shipToPincode).toBe(msg);
    expect(errorsOf({ shipToPincode: '570001' }).shipToPlace).toBe(msg);
    expect(errorsOf({ shipToStateCode: '29', shipToPlace: 'Mysuru' }).shipToPincode).toBe(msg);
  });

  it('needs a 6-digit ship-to PIN code', () => {
    const e = errorsOf({ shipToPlace: 'Mysuru', shipToPincode: '5700', shipToStateCode: '29' });
    expect(e.shipToPincode).toBe('Enter a 6-digit PIN code');
  });
});

describe('hasEwayBillOnRecord', () => {
  const b = (stored_status: string, status = stored_status) => ({ stored_status, status });
  it('is false for no bills, or only cancelled, closed or rejected ones', () => {
    expect(hasEwayBillOnRecord([])).toBe(false);
    expect(hasEwayBillOnRecord([b('cancelled')])).toBe(false);
    expect(hasEwayBillOnRecord([b('closed')])).toBe(false);
    expect(hasEwayBillOnRecord([b('rejected')])).toBe(false);
  });
  it('is true for a stored-active bill, whether it is still valid or has expired', () => {
    expect(hasEwayBillOnRecord([b('active')])).toBe(true);
    expect(hasEwayBillOnRecord([b('active', 'expired')])).toBe(true);
  });
  it('is true when a cancelled bill sits beside an active one', () => {
    expect(hasEwayBillOnRecord([b('cancelled'), b('active')])).toBe(true);
  });
});

export type Gstr2bDocType = 'invoice' | 'credit_note' | 'debit_note' | 'import_goods' | 'isd';

export interface Gstr2bRow {
  supplier_gstin: string;
  supplier_name: string | null;
  invoice_number: string;
  invoice_date: string; // YYYY-MM-DD
  document_type: Gstr2bDocType;
  taxable_value: number;
  igst_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  cess_amount: number;
  itc_eligibility: 'eligible' | 'ineligible';
  itc_reversal_type: string | null;
  place_of_supply: string | null;
  reverse_charge: 'Y' | 'N';
  original_invoice_number: string | null;
  original_invoice_date: string | null;
}

const num = (v: unknown) => {
  const n = parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

/** Portal dates are DD-MM-YYYY; also accepts YYYY-MM-DD. */
export function normalizePortalDate(v: unknown): string | null {
  const s = String(v ?? '').trim();
  let m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

type Amounts = { txval: number; igst: number; cgst: number; sgst: number; cess: number };

/** Document-level totals; falls back to the sum of `items` when the header omits them. */
function docAmounts(doc: any): Amounts {
  const items: any[] = Array.isArray(doc?.items) ? doc.items : [];
  const fromItems = items.reduce<Amounts>(
    (a, it) => ({
      txval: a.txval + num(it.txval),
      igst: a.igst + num(it.igst),
      cgst: a.cgst + num(it.cgst),
      sgst: a.sgst + num(it.sgst),
      cess: a.cess + num(it.cess),
    }),
    { txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 }
  );
  const pick = (k: keyof Amounts) => (doc?.[k] !== undefined && doc?.[k] !== null ? num(doc[k]) : num(fromItems[k]));
  return { txval: pick('txval'), igst: pick('igst'), cgst: pick('cgst'), sgst: pick('sgst'), cess: pick('cess') };
}

function eligible(flag: unknown): 'eligible' | 'ineligible' {
  return String(flag ?? 'Y').toUpperCase() === 'N' ? 'ineligible' : 'eligible';
}

function pushRow(out: Gstr2bRow[], row: Omit<Gstr2bRow, 'invoice_date'> & { invoice_date: unknown }) {
  const date = normalizePortalDate(row.invoice_date);
  if (!row.invoice_number || !date) return;
  out.push({ ...row, invoice_date: date });
}

/** Real GST portal GSTR-2B JSON: `data.docdata.{b2b,b2ba,cdnr,cdnra,isd,impg,impgsez}`. */
function parsePortal(docdata: any): Gstr2bRow[] {
  const out: Gstr2bRow[] = [];

  const b2b = (section: any[], amended: boolean) => {
    for (const sup of section || []) {
      for (const inv of sup?.inv || []) {
        const a = docAmounts(inv);
        pushRow(out, {
          supplier_gstin: String(sup.ctin || '').toUpperCase(),
          supplier_name: sup.trdnm || null,
          invoice_number: String(inv.inum || '').trim(),
          invoice_date: inv.dt,
          document_type: 'invoice',
          taxable_value: a.txval,
          igst_amount: a.igst,
          cgst_amount: a.cgst,
          sgst_amount: a.sgst,
          cess_amount: a.cess,
          itc_eligibility: eligible(inv.itcavl),
          itc_reversal_type: inv.rsn || null,
          place_of_supply: inv.pos || null,
          reverse_charge: String(inv.rev || 'N').toUpperCase() === 'Y' ? 'Y' : 'N',
          original_invoice_number: amended ? inv.oinum || null : null,
          original_invoice_date: amended ? normalizePortalDate(inv.oidt) : null,
        });
      }
    }
  };

  const cdnr = (section: any[], amended: boolean) => {
    for (const sup of section || []) {
      for (const nt of sup?.nt || []) {
        const a = docAmounts(nt);
        pushRow(out, {
          supplier_gstin: String(sup.ctin || '').toUpperCase(),
          supplier_name: sup.trdnm || null,
          invoice_number: String(nt.ntnum || '').trim(),
          invoice_date: nt.dt,
          document_type: String(nt.typ || '').toUpperCase() === 'D' ? 'debit_note' : 'credit_note',
          taxable_value: a.txval,
          igst_amount: a.igst,
          cgst_amount: a.cgst,
          sgst_amount: a.sgst,
          cess_amount: a.cess,
          itc_eligibility: eligible(nt.itcavl),
          itc_reversal_type: nt.rsn || null,
          place_of_supply: nt.pos || null,
          reverse_charge: String(nt.rev || 'N').toUpperCase() === 'Y' ? 'Y' : 'N',
          original_invoice_number: amended ? nt.ontnum || null : null,
          original_invoice_date: amended ? normalizePortalDate(nt.ontdt) : null,
        });
      }
    }
  };

  b2b(docdata.b2b, false);
  b2b(docdata.b2ba, true);
  cdnr(docdata.cdnr, false);
  cdnr(docdata.cdnra, true);

  for (const sup of docdata.isd || []) {
    for (const d of sup?.doclist || []) {
      const a = docAmounts(d);
      pushRow(out, {
        supplier_gstin: String(sup.ctin || '').toUpperCase(),
        supplier_name: sup.trdnm || null,
        invoice_number: String(d.docnum || '').trim(),
        invoice_date: d.docdt,
        document_type: 'isd',
        taxable_value: 0,
        igst_amount: a.igst,
        cgst_amount: a.cgst,
        sgst_amount: a.sgst,
        cess_amount: a.cess,
        itc_eligibility: eligible(d.itcelg),
        itc_reversal_type: null,
        place_of_supply: null,
        reverse_charge: 'N',
        original_invoice_number: null,
        original_invoice_date: null,
      });
    }
  }

  const boe = (d: any, ctin: string, name: string | null) => {
    const a = docAmounts(d);
    pushRow(out, {
      supplier_gstin: ctin,
      supplier_name: name,
      invoice_number: [d.portcode, d.boenum].filter(Boolean).join('/'),
      invoice_date: d.boedt,
      document_type: 'import_goods',
      taxable_value: a.txval,
      igst_amount: a.igst,
      cgst_amount: 0,
      sgst_amount: 0,
      cess_amount: a.cess,
      itc_eligibility: 'eligible',
      itc_reversal_type: null,
      place_of_supply: null,
      reverse_charge: 'N',
      original_invoice_number: null,
      original_invoice_date: null,
    });
  };
  for (const d of docdata.impg || []) boe(d, '', 'Import of goods');
  for (const sup of docdata.impgsez || []) {
    for (const d of sup?.boe || []) boe(d, String(sup.ctin || '').toUpperCase(), sup.trdnm || null);
  }

  return out;
}

/** Older offline-tool layout: top-level `b2b[].inv[].itms[].itm_det` and `cdn[].nt[]`. */
function parseLegacy(json: any): Gstr2bRow[] {
  const out: Gstr2bRow[] = [];
  const sumItems = (itms: any[]): Amounts =>
    (itms || []).reduce<Amounts>(
      (a, it) => {
        const d = it?.itm_det || {};
        return {
          txval: a.txval + num(d.txval),
          igst: a.igst + num(d.iamt),
          cgst: a.cgst + num(d.camt),
          sgst: a.sgst + num(d.samt),
          cess: a.cess + num(d.csamt),
        };
      },
      { txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 }
    );
  const anyIneligible = (itms: any[]) => (itms || []).some((it) => it?.itm_det?.elig === 'N');

  for (const sup of json.b2b || []) {
    for (const inv of sup?.inv || []) {
      const a = sumItems(inv.itms);
      pushRow(out, {
        supplier_gstin: String(sup.ctin || sup.gstin || '').toUpperCase(),
        supplier_name: sup.name || null,
        invoice_number: String(inv.inum || inv.inv_num || '').trim(),
        invoice_date: inv.idt || inv.inv_dt,
        document_type: 'invoice',
        taxable_value: a.txval,
        igst_amount: a.igst,
        cgst_amount: a.cgst,
        sgst_amount: a.sgst,
        cess_amount: a.cess,
        itc_eligibility: anyIneligible(inv.itms) ? 'ineligible' : 'eligible',
        itc_reversal_type: null,
        place_of_supply: inv.pos || null,
        reverse_charge: inv.rchrg === 'Y' ? 'Y' : 'N',
        original_invoice_number: null,
        original_invoice_date: null,
      });
    }
  }
  for (const sup of json.cdn || []) {
    for (const nt of sup?.nt || []) {
      const a = sumItems(nt.itms);
      pushRow(out, {
        supplier_gstin: String(sup.ctin || sup.gstin || '').toUpperCase(),
        supplier_name: sup.name || null,
        invoice_number: String(nt.nt_num || '').trim(),
        invoice_date: nt.nt_dt,
        document_type: nt.ntty === 'D' ? 'debit_note' : 'credit_note',
        taxable_value: a.txval,
        igst_amount: a.igst,
        cgst_amount: a.cgst,
        sgst_amount: a.sgst,
        cess_amount: a.cess,
        itc_eligibility: anyIneligible(nt.itms) ? 'ineligible' : 'eligible',
        itc_reversal_type: null,
        place_of_supply: null,
        reverse_charge: 'N',
        original_invoice_number: nt.inum || null,
        original_invoice_date: normalizePortalDate(nt.idt),
      });
    }
  }
  return out;
}

export function parseGstr2bJson(json: any): { rows: Gstr2bRow[]; returnPeriod: string | null; recipientGstin: string | null } {
  const data = json?.data ?? json;
  const docdata = data?.docdata;
  const rtnprd = String(data?.rtnprd || '');
  const returnPeriod = /^\d{6}$/.test(rtnprd) ? `${rtnprd.slice(2)}-${rtnprd.slice(0, 2)}` : null;
  const rows = docdata ? parsePortal(docdata) : parseLegacy(data);
  return { rows, returnPeriod, recipientGstin: data?.gstin ? String(data.gstin).toUpperCase() : null };
}

/** Credit notes reduce ITC; everything else adds to it. */
export function totalEligibleItc(rows: Gstr2bRow[]): number {
  let t = 0;
  for (const r of rows) {
    if (r.itc_eligibility !== 'eligible') continue;
    const tax = r.igst_amount + r.cgst_amount + r.sgst_amount + r.cess_amount;
    t += r.document_type === 'credit_note' ? -tax : tax;
  }
  return Math.round(t * 100) / 100;
}

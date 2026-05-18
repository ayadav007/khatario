import { GSTR1Filters } from '@/lib/gst/gstr1';

/**
 * Format date string to DD/MM/YYYY as required by GSTN JSON spec
 */
function formatDateForGSTN(dateStr: string): string {
  if (!dateStr) return '';

  // Already DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) return dateStr;

  // YYYY-MM-DD
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;

  // Fallback: parse via Date
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      return `${day}/${month}/${d.getFullYear()}`;
    }
  } catch (_) { /* ignore */ }

  return dateStr;
}

/** Map free-text invoice type to GSTN code */
function mapInvoiceType(type: string): string {
  const map: Record<string, string> = {
    'Regular': 'R',
    'Deemed Exp': 'DE',
    'SEZ supplies with payment': 'SEWP',
    'SEZ supplies without payment': 'SEWOP',
  };
  return map[type] || 'R';
}

/** Extract 2-digit state code from place_of_supply (handles "29-State" and bare "29") */
function posCode(placeOfSupply: string, fallback: string): string {
  if (!placeOfSupply) return fallback;
  const raw = placeOfSupply.includes('-')
    ? placeOfSupply.split('-')[0].trim()
    : placeOfSupply.trim().substring(0, 2);
  return raw || fallback;
}

/** Valid 15-char e-commerce operator / TCS GSTIN only — omit field when not applicable */
function validEtin(gstin: string | null | undefined): string | null {
  const s = (gstin || '').trim().toUpperCase();
  return s.length === 15 ? s : null;
}

/**
 * Generate GSTN-compliant GSTR-1 JSON for direct portal upload.
 *
 * Multi-rate invoices produce ONE invoice object with multiple itms entries.
 * Tax amounts come from stored DB values — no recalculation.
 * CDN tax amounts come from stored credit/debit note totals.
 */
export async function generateGSTR1JSON(
  report: any,
  filters: GSTR1Filters,
  businessGstin: string
): Promise<string> {
  if (!businessGstin || businessGstin.length !== 15) {
    throw new Error('Business GSTIN is required and must be 15 characters');
  }

  const month = filters.month || new Date().getMonth() + 1;
  const year = filters.year || new Date().getFullYear();
  const fp = `${month.toString().padStart(2, '0')}${year}`;
  // Period gross outward supplies (taxable + tax) — closer to return turnover than taxable alone
  const gt =
    Math.round(
      ((report.summary.total_outward_taxable_supplies || 0) +
        (report.summary.total_tax_amount || 0)) *
        100
    ) / 100;
  const bizStateCode = businessGstin.substring(0, 2);

  const b2csTyp = (item: any): 'E' | 'OE' =>
    item.type === 'E-Commerce' || item.type === 'E' ? 'E' : 'OE';

  // ─── B2B ────────────────────────────────────────────────────────────────────
  // Group: ctin → invoice_number → invoice object (with itms array)
  const b2bCtinMap = new Map<string, Map<string, any>>();

  for (const inv of report.b2b) {
    const ctin: string = inv.gstin;
    if (!b2bCtinMap.has(ctin)) b2bCtinMap.set(ctin, new Map());
    const invMap = b2bCtinMap.get(ctin)!;

    if (!invMap.has(inv.invoice_number)) {
      const invHead: Record<string, unknown> = {
        inum: inv.invoice_number,
        idt:  formatDateForGSTN(inv.invoice_date),
        val:  Math.round(inv.invoice_value * 100) / 100,
        pos:  posCode(inv.place_of_supply, bizStateCode),
        rchrg: inv.reverse_charge || 'N',
        inv_typ: mapInvoiceType(inv.invoice_type),
        itms: [] as any[],
      };
      const et = validEtin(inv.ecommerce_gstin);
      if (et) invHead.etin = et;
      invMap.set(inv.invoice_number, invHead);
    }

    const invObj = invMap.get(inv.invoice_number)!;
    invObj.itms.push({
      num: invObj.itms.length + 1,
      itm_det: {
        rt:    inv.rate,
        txval: Math.round(inv.taxable_value * 100) / 100,
        iamt:  Math.round((inv.igst_amount || 0) * 100) / 100,
        camt:  Math.round((inv.cgst_amount || 0) * 100) / 100,
        samt:  Math.round((inv.sgst_amount || 0) * 100) / 100,
        csamt: Math.round((inv.cess_amount  || 0) * 100) / 100,
      },
    });
  }

  const b2b: any[] = [];
  for (const [ctin, invMap] of b2bCtinMap) {
    b2b.push({ ctin, inv: Array.from(invMap.values()) });
  }

  // ─── B2CL ───────────────────────────────────────────────────────────────────
  // Group: invoice_number → invoice object (with itms array); B2CL is always IGST
  const b2clInvMap = new Map<string, any>();

  for (const inv of report.b2cl) {
    if (!b2clInvMap.has(inv.invoice_number)) {
      const clHead: Record<string, unknown> = {
        inum: inv.invoice_number,
        idt:  formatDateForGSTN(inv.invoice_date),
        val:  Math.round(inv.invoice_value * 100) / 100,
        pos:  posCode(inv.place_of_supply, bizStateCode),
        itms: [] as any[],
      };
      const et = validEtin(inv.ecommerce_gstin);
      if (et) clHead.etin = et;
      b2clInvMap.set(inv.invoice_number, clHead);
    }

    const invObj = b2clInvMap.get(inv.invoice_number)!;
    invObj.itms.push({
      num: invObj.itms.length + 1,
      itm_det: {
        rt:    inv.rate,
        txval: Math.round(inv.taxable_value * 100) / 100,
        iamt:  Math.round((inv.igst_amount || 0) * 100) / 100,
        camt:  0,
        samt:  0,
        csamt: Math.round((inv.cess_amount || 0) * 100) / 100,
      },
    });
  }

  const b2cl = Array.from(b2clInvMap.values());

  // ─── B2CS ───────────────────────────────────────────────────────────────────
  // `ty` = E (e-com) / OE. `sply_ty` = INTRA | INTER (GSTN / offline tool / GST2.x validators).
  // Some third-party tools use INTRAB2C/INTRB2C instead — those conflict with the official B2CS enum.
  // Do not send `etin` for OE — validators reject blank/invalid TCS GSTIN.
  const b2cs = report.b2cs.map((item: any) => {
    const pos = posCode(item.place_of_supply, bizStateCode);
    const isIntra = pos === bizStateCode;
    const ty = b2csTyp(item);
    const row: Record<string, unknown> = {
      ty,
      sply_ty: isIntra ? 'INTRA' : 'INTER',
      pos,
      rt:    item.rate,
      txval: Math.round(item.taxable_value * 100) / 100,
      iamt:  Math.round((item.igst_amount  || 0) * 100) / 100,
      camt:  Math.round((item.cgst_amount  || 0) * 100) / 100,
      samt:  Math.round((item.sgst_amount  || 0) * 100) / 100,
      csamt: Math.round((item.cess_amount  || 0) * 100) / 100,
    };
    if (ty === 'E') {
      const et = validEtin(item.ecommerce_gstin);
      if (et) row.etin = et;
    }
    return row;
  });

  // ─── EXP (Table 6A) ─────────────────────────────────────────────────────────
  // Group: invoice_number → invoice object; exports carry IGST from stored values
  const expInvMap = new Map<string, any>();

  for (const exp of report.exports) {
    if (!expInvMap.has(exp.invoice_number)) {
      expInvMap.set(exp.invoice_number, {
        exp_typ: exp.export_type === 'WPAY' ? 'WPA' : 'WOPA',
        inum:  exp.invoice_number,
        idt:   formatDateForGSTN(exp.invoice_date),
        val:   Math.round(exp.invoice_value * 100) / 100,
        sbnum: exp.shipping_bill_number || null,
        sbdt:  exp.shipping_bill_date ? formatDateForGSTN(exp.shipping_bill_date) : null,
        port:  exp.port_code || null,
        itms:  [] as any[],
      });
    }

    const invObj = expInvMap.get(exp.invoice_number)!;
    invObj.itms.push({
      num: invObj.itms.length + 1,
      itm_det: {
        rt:    exp.rate,
        txval: Math.round(exp.taxable_value * 100) / 100,
        iamt:  Math.round((exp.igst_amount || 0) * 100) / 100,
        csamt: 0,
      },
    });
  }

  const exp = Array.from(expInvMap.values());

  // ─── SEZ (Table 6B) ─────────────────────────────────────────────────────────
  // Group: ctin → invoice_number → invoice object
  const sezCtinMap = new Map<string, Map<string, any>>();

  if (report.sez) {
    for (const entry of report.sez) {
      const ctin: string = entry.sez_unit_gstin;
      if (!ctin) continue;
      if (!sezCtinMap.has(ctin)) sezCtinMap.set(ctin, new Map());
      const invMap = sezCtinMap.get(ctin)!;
      const pos = posCode(entry.place_of_supply, bizStateCode);

      if (!invMap.has(entry.invoice_number)) {
        invMap.set(entry.invoice_number, {
          exp_typ: entry.sez_type === 'WPAY' ? 'WPA' : 'WOPA',
          inum: entry.invoice_number,
          idt:  formatDateForGSTN(entry.invoice_date),
          val:  Math.round(entry.invoice_value * 100) / 100,
          pos,
          itms: [] as any[],
        });
      }

      const invObj = invMap.get(entry.invoice_number)!;
      invObj.itms.push({
        num: invObj.itms.length + 1,
        itm_det: {
          rt:    entry.rate,
          txval: Math.round(entry.taxable_value * 100) / 100,
          iamt:  Math.round((entry.igst_amount || 0) * 100) / 100,
          csamt: Math.round((entry.cess_amount  || 0) * 100) / 100,
        },
      });
    }
  }

  const sezArray: any[] = [];
  for (const [ctin, invMap] of sezCtinMap) {
    sezArray.push({ ctin, exp: Array.from(invMap.values()) });
  }

  // ─── CDN (Credit / Debit Notes) ─────────────────────────────────────────────
  // CDNEntry now carries stored igst/cgst/sgst amounts from DB (Phase 3).
  const cdnrMap = new Map<string, any[]>();
  const cdnurArr: any[] = [];

  for (const note of report.cdn) {
    const ctin: string = (note.gstin_uin_recipient || '').trim();
    const isReg = ctin.length === 15;
    let pos = posCode(note.place_of_supply, bizStateCode);
    const cdnurTyp = note.cdnur_typ as string | null | undefined;

    if (!isReg && cdnurTyp && (cdnurTyp === 'EXPWP' || cdnurTyp === 'EXPWOP') && !note.place_of_supply) {
      pos = '96';
    }

    const noteBase = {
      ntty:  note.note_type,
      ntnum: note.note_number,
      ntdt:  formatDateForGSTN(note.note_date),
      p_gst: 'N',
      inum:  note.original_invoice_number || null,
      idt:   note.original_invoice_date ? formatDateForGSTN(note.original_invoice_date) : null,
      val:   Math.round(note.invoice_value * 100) / 100,
      pos,
      itms: [{
        num: 1,
        itm_det: {
          rt:    note.tax_rate,
          txval: Math.round(note.taxable_value * 100) / 100,
          iamt:  Math.round((note.igst_amount || 0) * 100) / 100,
          camt:  Math.round((note.cgst_amount || 0) * 100) / 100,
          samt:  Math.round((note.sgst_amount || 0) * 100) / 100,
          csamt: Math.round((note.cess_amount || 0) * 100) / 100,
        },
      }],
    };

    if (isReg) {
      const noteObj = {
        ...noteBase,
        rchrg: note.reverse_charge || 'N',
        inv_typ: mapInvoiceType(note.note_supply_type || 'Regular'),
      };
      if (!cdnrMap.has(ctin)) cdnrMap.set(ctin, []);
      cdnrMap.get(ctin)!.push(noteObj);
    } else {
      const noteObj = {
        ...noteBase,
        ...(cdnurTyp ? { typ: cdnurTyp } : { typ: 'B2CL' }),
      };
      cdnurArr.push(noteObj);
    }
  }

  const cdnr: any[] = [];
  for (const [ctin, notes] of cdnrMap) {
    cdnr.push({ ctin, nt: notes });
  }

  // ─── HSN ────────────────────────────────────────────────────────────────────
  const hsnData = report.hsn.map((entry: any) => ({
    hsn_sc: entry.hsn_sac || 'NA',
    desc:   entry.description || '',
    uqc:    entry.uqc || 'NOS',
    qty:    Math.round((entry.total_quantity || 0) * 100) / 100,
    val:    Math.round((entry.total_value    || 0) * 100) / 100,
    txval:  Math.round((entry.taxable_value  || 0) * 100) / 100,
    iamt:   Math.round((entry.integrated_tax || 0) * 100) / 100,
    camt:   Math.round((entry.central_tax    || 0) * 100) / 100,
    samt:   Math.round((entry.state_ut_tax   || 0) * 100) / 100,
    csamt:  Math.round((entry.cess_amount    || 0) * 100) / 100,
    rt:     entry.rate != null ? entry.rate : 0,
  }));

  // ─── NIL / EXEMPT / NON-GST ─────────────────────────────────────────────────
  // Schema GSTR1-3.x expects sply_ty ∈ { INTRB2B, INTRAB2B, INTRB2C, INTRAB2C } (not EXMT/NIL/NGSUP).
  // Until we split by inter/intra and B2B/B2C in the generator, report combined 8–value lines as INTRAB2C.
  const nilInv: any[] = [];
  let nilCombined = 0;
  for (const entry of report.nil) {
    nilCombined +=
      (Number(entry.nil_supply) || 0) +
      (Number(entry.exempt_supply) || 0) +
      (Number(entry.non_gst_supply) || 0);
  }
  if (nilCombined > 0) {
    nilInv.push({
      sply_ty: 'INTRAB2C',
      rt: 0,
      txval: Math.round(nilCombined * 100) / 100,
    });
  }

  const docIssue =
    report.doc_issue_summary &&
    report.doc_issue_summary.totnum > 0 &&
    report.doc_issue_summary.from &&
    report.doc_issue_summary.to
      ? [
          {
            doc_num: 1,
            doc_det: [
              {
                num: 1,
                from: String(report.doc_issue_summary.from),
                to: String(report.doc_issue_summary.to),
                totnum: report.doc_issue_summary.totnum,
                cancel: report.doc_issue_summary.cancel ?? 0,
              },
            ],
          },
        ]
      : [];

  // ─── Final JSON ──────────────────────────────────────────────────────────────
  const gstr1Json = {
    gstin:   businessGstin,
    fp,
    gt:      Math.round(gt * 100) / 100,
    cur_gt:  Math.round(gt * 100) / 100,
    version: 'GSTR1-3.5',
    hash:    'hash_value', // Replaced by GSTN portal on upload
    b2b,
    b2ba:    [],
    b2cl,
    b2cs,
    b2csa:   [],
    exp,
    sez:     sezArray,
    cdnr,
    cdnur:   cdnurArr,
    nil:     { inv: nilInv },
    hsn:     { data: hsnData },
    doc_issue: docIssue,
  };

  return JSON.stringify(gstr1Json, null, 2);
}

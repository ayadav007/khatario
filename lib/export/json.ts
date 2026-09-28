import { GSTR1Filters } from '@/lib/gst/gstr1';

/**
 * GSTN GSTR-1 JSON dates are dd-mm-yyyy. Accepts dd-mm-yyyy, d/m/yyyy, yyyy-mm-dd or a Date-parsable string.
 */
export function formatDateForGSTN(dateStr: string): string {
  if (!dateStr) return '';
  const pad = (n: string | number) => String(n).padStart(2, '0');

  const dmy = dateStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) return `${pad(dmy[1])}-${pad(dmy[2])}-${dmy[3]}`;

  const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;

  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
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
        pos:  posCode(inv.place_of_supply, /^\d{2}/.test(ctin || '') ? ctin.slice(0, 2) : bizStateCode),
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
    let pos = posCode(note.place_of_supply, isReg && /^\d{2}/.test(ctin) ? ctin.slice(0, 2) : bizStateCode);
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

  // ─── HSN (Table 12, split B2B / B2C) ────────────────────────────────────────
  const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
  const hsnRows = (list: any[]) =>
    (list || []).map((entry: any, idx: number) => ({
      num:    idx + 1,
      hsn_sc: entry.hsn_sac || 'NA',
      desc:   entry.description || '',
      uqc:    entry.uqc || 'OTH',
      qty:    r2(entry.total_quantity),
      txval:  r2(entry.taxable_value),
      iamt:   r2(entry.integrated_tax),
      camt:   r2(entry.central_tax),
      samt:   r2(entry.state_ut_tax),
      csamt:  r2(entry.cess_amount),
      rt:     entry.rate != null ? entry.rate : 0,
    }));
  const hsnSection = {
    hsn_b2b: hsnRows(report.hsn_b2b ?? []),
    hsn_b2c: hsnRows(report.hsn_b2c ?? report.hsn ?? []),
  };

  // ─── NIL / EXEMPT / NON-GST (Table 8) ───────────────────────────────────────
  const nilInv = (report.nil || [])
    .filter((entry: any) => entry.sply_ty)
    .map((entry: any) => ({
      sply_ty:   entry.sply_ty,
      nil_amt:   r2(entry.nil_supply),
      expt_amt:  r2(entry.exempt_supply),
      ngsup_amt: r2(entry.non_gst_supply),
    }))
    .filter((row: any) => row.nil_amt !== 0 || row.expt_amt !== 0 || row.ngsup_amt !== 0);

  // ─── Advances (Table 11A `at`, 11B `txpd`), grouped by POS ───────────────────
  const advanceSection = (rows: any[]) => {
    const byPos = new Map<string, any[]>();
    for (const r of rows || []) {
      const pos = posCode(r.place_of_supply, bizStateCode);
      if (!byPos.has(pos)) byPos.set(pos, []);
      byPos.get(pos)!.push({
        rt: r.rate,
        ad_amt: r2(r.taxable_value),
        iamt: r2(r.igst),
        camt: r2(r.cgst),
        samt: r2(r.sgst),
        csamt: r2(r.cess),
      });
    }
    return [...byPos.entries()].map(([pos, itms]) => ({
      pos,
      sply_ty: pos === bizStateCode ? 'INTRA' : 'INTER',
      itms,
    }));
  };
  const at = advanceSection(report.at ?? []);
  const txpd = advanceSection(report.atadj ?? []);

  // ─── Documents issued (Table 13) ────────────────────────────────────────────
  const docRows: any[] = report.doc_issues ?? [];
  const docIssue = ([1, 4, 5, 6, 8] as const)
    .map((docNum) => {
      const rows = docRows.filter((d) => d.doc_num === docNum);
      return rows.length === 0
        ? null
        : {
            doc_num: docNum,
            doc_det: rows.map((d, idx) => ({
              num: idx + 1,
              from: String(d.from),
              to: String(d.to),
              totnum: d.totnum,
              cancel: d.cancel ?? 0,
              net_issue: d.net_issue ?? d.totnum - (d.cancel ?? 0),
            })),
          };
    })
    .filter(Boolean);

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
    ...(at.length ? { at } : {}),
    ...(txpd.length ? { txpd } : {}),
    hsn:     hsnSection,
    doc_issue: docIssue,
  };

  return JSON.stringify(gstr1Json, null, 2);
}

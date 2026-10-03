/** Shipping labels for parcels (4×6 inch thermal, or two per A4 sheet). Browser-only printing. */

export type LabelSize = '4x6' | 'a4';

export interface ShippingLabelData {
  orderNumber: string;
  invoiceNumber?: string | null;
  orderDate: string;
  to: { name: string; phone: string | null; address: string | null; pincode: string | null };
  from: { name: string; address: string | null; pincode: string | null; phone: string | null; gstin: string | null } | null;
  carrier: string | null;
  awb: string | null;
  paid: boolean;
  codAmount: number;
  itemCount: number;
  boxes: number;
}

export type BarcodeFn = (text: string) => string | null;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const inr = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function paymentBanner(d: Pick<ShippingLabelData, 'paid' | 'codAmount'>): { text: string; tone: 'cod' | 'prepaid' | 'unpaid' } {
  if (d.codAmount > 0) return { text: `CASH ON DELIVERY · COLLECT ${inr(d.codAmount)}`, tone: 'cod' };
  if (d.paid) return { text: 'PREPAID · DO NOT COLLECT CASH', tone: 'prepaid' };
  return { text: 'PAYMENT PENDING · CHECK WITH SHOP', tone: 'unpaid' };
}

function addressBlock(address: string | null, pincode: string | null): string {
  const a = address ? escapeHtml(address) : '<em>No address on file</em>';
  return `<div class="addr">${a}</div>${pincode ? `<div class="pin">PIN ${escapeHtml(pincode)}</div>` : ''}`;
}

function oneLabel(d: ShippingLabelData, box: number, barcode: BarcodeFn): string {
  const banner = paymentBanner(d);
  const awbBar = d.awb ? barcode(d.awb) : null;
  const orderBar = barcode(d.orderNumber);
  const from = d.from;
  return `<section class="label">
  <div class="banner ${banner.tone}">${escapeHtml(banner.text)}</div>
  <div class="row carrier">
    <div><span class="muted">Courier</span><br/><strong>${escapeHtml(d.carrier || 'Own delivery')}</strong></div>
    ${d.awb ? `<div class="right"><span class="muted">AWB</span><br/><strong class="mono">${escapeHtml(d.awb)}</strong></div>` : ''}
  </div>
  ${awbBar ? `<div class="bar">${awbBar}</div>` : ''}
  <div class="to">
    <div class="muted">DELIVER TO</div>
    <div class="name">${escapeHtml(d.to.name || 'Customer')}</div>
    ${addressBlock(d.to.address, d.to.pincode)}
    ${d.to.phone ? `<div class="phone">Ph ${escapeHtml(d.to.phone)}</div>` : ''}
  </div>
  <div class="row order">
    <div>
      <span class="muted">Order</span> <strong class="mono">${escapeHtml(d.orderNumber)}</strong>
      ${d.invoiceNumber && d.invoiceNumber !== d.orderNumber ? `<br/><span class="muted">Bill</span> ${escapeHtml(d.invoiceNumber)}` : ''}
      <br/><span class="muted">${escapeHtml(d.orderDate)} · ${d.itemCount} item${d.itemCount === 1 ? '' : 's'}</span>
    </div>
    <div class="right box">BOX ${box} / ${d.boxes}</div>
  </div>
  ${orderBar ? `<div class="bar small">${orderBar}</div>` : ''}
  ${
    from
      ? `<div class="from">
    <div class="muted">FROM / RETURN TO</div>
    <strong>${escapeHtml(from.name)}</strong>
    ${from.address ? `<div>${escapeHtml(from.address)}${from.pincode ? ` - ${escapeHtml(from.pincode)}` : ''}</div>` : ''}
    <div>${[from.phone ? `Ph ${escapeHtml(from.phone)}` : '', from.gstin ? `GSTIN ${escapeHtml(from.gstin)}` : ''].filter(Boolean).join(' · ')}</div>
  </div>`
      : ''
  }
</section>`;
}

export function buildShippingLabelHtml(d: ShippingLabelData, size: LabelSize, barcode: BarcodeFn): string {
  const boxes = Math.min(50, Math.max(1, Math.round(d.boxes) || 1));
  const data = { ...d, boxes };
  const labels = Array.from({ length: boxes }, (_, i) => oneLabel(data, i + 1, barcode)).join('\n');
  const page =
    size === '4x6'
      ? `@page{size:4in 6in;margin:0} .label{width:4in;height:6in;page-break-after:always}`
      : `@page{size:A4;margin:10mm} .label{width:180mm;height:130mm;margin:0 auto 7mm} .label:nth-of-type(2n){page-break-after:always}`;
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Label ${escapeHtml(d.orderNumber)}</title>
<style>
  ${page}
  *{box-sizing:border-box}
  body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#000}
  .label{border:2px solid #000;padding:3mm;display:flex;flex-direction:column;gap:2mm;overflow:hidden}
  .banner{font-weight:800;font-size:15px;text-align:center;padding:2mm;border:2px solid #000}
  .banner.cod{background:#000;color:#fff;font-size:17px}
  .banner.unpaid{border-style:dashed}
  .row{display:flex;justify-content:space-between;gap:3mm;font-size:12px}
  .right{text-align:right}
  .muted{color:#444;font-size:10px;text-transform:uppercase;letter-spacing:.04em}
  .mono{font-family:'Courier New',monospace}
  .bar{display:flex;justify-content:center}
  .bar svg{max-width:100%;height:16mm}
  .bar.small svg{height:11mm}
  .to{border-top:1px solid #000;border-bottom:1px solid #000;padding:2mm 0;flex:1}
  .to .name{font-size:18px;font-weight:800;margin:1mm 0}
  .addr{font-size:14px;line-height:1.3;white-space:pre-line}
  .pin{font-size:20px;font-weight:800;margin-top:1mm}
  .phone{font-size:14px;margin-top:1mm}
  .box{font-size:16px;font-weight:800;align-self:center}
  .from{font-size:10.5px;line-height:1.35;border-top:1px dashed #000;padding-top:1.5mm}
</style></head><body>
${labels}
<script>window.onload=function(){window.print();}</script>
</body></html>`;
}

/** Opens the print dialog with one label per box. Barcodes are Code 128 SVGs. */
export async function printShippingLabel(d: ShippingLabelData, size: LabelSize = '4x6'): Promise<void> {
  const { toSVG } = await import('bwip-js/browser');
  const barcode: BarcodeFn = (text) => {
    try {
      return toSVG({ bcid: 'code128', text, scale: 2, height: 12, includetext: false, paddingwidth: 2 });
    } catch {
      return null;
    }
  };
  const w = window.open('', '_blank', 'width=480,height=760');
  if (!w) return;
  w.document.write(buildShippingLabelHtml(d, size, barcode));
  w.document.close();
}

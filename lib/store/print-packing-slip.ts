import QRCode from 'qrcode';

export type SlipLine = {
  item_name: string;
  variant_name?: string | null;
  quantity: number;
  packed_qty: number;
  unit: string;
};

export type SlipOrder = {
  order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_address?: string | null;
  customer_pincode?: string | null;
  delivery_mode: string;
  grand_total: number;
  payment_status?: string;
  awb?: string | null;
};

export async function printStorePackingSlip(order: SlipOrder, items: SlipLine[]): Promise<void> {
  await printPackingSlips([{ order, items }]);
}

async function slipHtml(order: SlipOrder, items: SlipLine[]): Promise<string> {
  const qr = await QRCode.toDataURL(order.order_number, { margin: 1, width: 160 });
  const lines = items
    .map(
      (l) =>
        `<tr><td>${escapeHtml(l.item_name)}${l.variant_name ? ` (${escapeHtml(l.variant_name)})` : ''}</td><td>${l.quantity} ${escapeHtml(l.unit)}</td></tr>`,
    )
    .join('');
  return `<section class="slip">
  <p class="muted">Packing slip</p>
  <div class="num">${escapeHtml(order.order_number)}</div>
  <img src="${qr}" alt="order barcode" />
  <p><strong>${escapeHtml(order.customer_name)}</strong><br/>${escapeHtml(order.customer_phone)}</p>
  <p class="muted">${order.delivery_mode === 'pickup' ? 'Self pickup' : escapeHtml(order.customer_address || '')}
  ${order.customer_pincode ? `<br/>PIN ${escapeHtml(order.customer_pincode)}` : ''}</p>
  <table>${lines}</table>
  <p><strong>Total ₹${order.grand_total.toLocaleString('en-IN')}</strong>
  ${order.payment_status ? ` · ${escapeHtml(order.payment_status)}` : ''}</p>
  ${order.awb ? `<p>AWB ${escapeHtml(order.awb)}</p>` : '<p class="muted">Scan courier barcode after handover</p>'}
</section>`;
}

/** One print job, one slip per page. Pass `win` when it was opened before an await (pop-up blockers). */
export async function printPackingSlips(
  slips: Array<{ order: SlipOrder; items: SlipLine[] }>,
  win?: Window | null,
): Promise<void> {
  if (slips.length === 0) return;
  const body = (await Promise.all(slips.map((s) => slipHtml(s.order, s.items)))).join('');
  const title = slips.length === 1 ? slips[0].order.order_number : `${slips.length} packing slips`;
  const html = `<!doctype html><html><head><title>${escapeHtml(title)}</title>
<style>
  body{font-family:ui-sans-serif,system-ui,sans-serif;padding:16px;max-width:360px;margin:0 auto;color:#111}
  .slip{page-break-after:always;break-after:page;padding-bottom:16px}
  .slip:last-child{page-break-after:auto;break-after:auto}
  h1{font-size:18px;margin:0 0 4px}
  .num{font-size:22px;font-weight:800;letter-spacing:.04em}
  table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
  td{padding:6px 0;border-bottom:1px solid #eee}
  .muted{color:#666;font-size:12px}
  img{display:block;margin:8px 0}
</style></head><body>${body}
  <script>window.onload=function(){window.print();}</script>
</body></html>`;
  const w = win ?? window.open('', '_blank', 'width=420,height=720');
  if (!w) return;
  w.document.write(html);
  w.document.close();
}

export type PickListPrint = {
  items: Array<{ name: string; quantity: number; sku: string | null; orders: Array<{ order_number: string; quantity: number }> }>;
  orders: Array<{ order_number: string; customer_name: string | null }>;
};

/** A4 pick list: tick off each item, with the orders it is split into. */
export function printPickList(list: PickListPrint, win?: Window | null): void {
  const rows = list.items
    .map(
      (it) => `<tr><td class="box"></td><td><strong>${escapeHtml(it.name)}</strong>${it.sku ? `<div class="muted">${escapeHtml(it.sku)}</div>` : ''}
      <div class="muted">${it.orders.map((o) => `${escapeHtml(o.order_number)} × ${o.quantity}`).join(' · ')}</div></td>
      <td class="qty">${it.quantity}</td></tr>`,
    )
    .join('');
  const when = new Date().toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const html = `<!doctype html><html><head><title>Pick list</title>
<style>
  body{font-family:ui-sans-serif,system-ui,sans-serif;padding:24px;color:#111}
  h1{font-size:20px;margin:0}
  .muted{color:#666;font-size:12px}
  table{width:100%;border-collapse:collapse;margin-top:16px;font-size:14px}
  th{text-align:left;font-size:11px;text-transform:uppercase;color:#666;border-bottom:2px solid #111;padding:6px 4px}
  td{padding:8px 4px;border-bottom:1px solid #ddd;vertical-align:top}
  td.box{width:22px}td.box:before{content:"";display:inline-block;width:14px;height:14px;border:1.5px solid #111;border-radius:3px}
  td.qty{text-align:right;font-size:18px;font-weight:800;width:60px}
</style></head><body>
  <h1>Pick list</h1>
  <p class="muted">${list.orders.length} order(s) · ${list.items.length} item(s) · printed ${escapeHtml(when)}</p>
  <table><thead><tr><th></th><th>Item</th><th style="text-align:right">Qty</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="muted" style="margin-top:16px">Orders: ${list.orders.map((o) => escapeHtml(o.order_number)).join(', ')}</p>
  <script>window.onload=function(){window.print();}</script>
</body></html>`;
  const w = win ?? window.open('', '_blank', 'width=800,height=900');
  if (!w) return;
  w.document.write(html);
  w.document.close();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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
  const qr = await QRCode.toDataURL(order.order_number, { margin: 1, width: 160 });
  const lines = items
    .map(
      (l) =>
        `<tr><td>${escapeHtml(l.item_name)}${l.variant_name ? ` (${escapeHtml(l.variant_name)})` : ''}</td><td>${l.quantity} ${escapeHtml(l.unit)}</td></tr>`,
    )
    .join('');
  const html = `<!doctype html><html><head><title>${escapeHtml(order.order_number)}</title>
<style>
  body{font-family:ui-sans-serif,system-ui,sans-serif;padding:16px;max-width:360px;margin:0 auto;color:#111}
  h1{font-size:18px;margin:0 0 4px}
  .num{font-size:22px;font-weight:800;letter-spacing:.04em}
  table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
  td{padding:6px 0;border-bottom:1px solid #eee}
  .muted{color:#666;font-size:12px}
  img{display:block;margin:8px 0}
</style></head><body>
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
  <script>window.onload=function(){window.print();}</script>
</body></html>`;
  const w = window.open('', '_blank', 'width=420,height=720');
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

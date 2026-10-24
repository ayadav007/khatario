import {
  amountInWords,
  calcLine,
  fx,
  inr,
  type Address,
  type Customer,
  type ExportConfig,
  type LineItem,
  type Seller,
} from '../_lib/mock-data';
import type { Totals } from './TotalsPanel';

type Props = {
  seller: Seller;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  customer: Customer | null;
  shipAddress: Address | null;
  lines: LineItem[];
  totals: Totals;
  isInterState: boolean;
  exportCfg: ExportConfig;
  zeroRated: boolean;
  prefix: string;
};

export function InvoicePreview({
  seller,
  invoiceNo,
  invoiceDate,
  dueDate,
  customer,
  shipAddress,
  lines,
  totals,
  isInterState,
  exportCfg,
  zeroRated,
  prefix,
}: Props) {
  const isExport = exportCfg.enabled;
  const foreign = isExport && exportCfg.currency !== 'INR' && exportCfg.rate > 0;
  const money = (n: number) => (foreign ? fx(n / exportCfg.rate, exportCfg.currency) : inr(n));
  const shippingFacts = isExport
    ? [
        ['Port code', exportCfg.portCode],
        ['Shipping bill', [exportCfg.shippingBillNo, exportCfg.shippingBillDate].filter(Boolean).join(' · ')],
        ['Port of loading', exportCfg.portOfLoading],
        ['Port of discharge', exportCfg.portOfDischarge],
        ['Incoterms', exportCfg.incoterms],
        ['Transport', exportCfg.transportMode],
        ['AWB no.', exportCfg.transportMode === 'Air' ? exportCfg.awbNo : ''],
        ['BL no.', exportCfg.transportMode === 'Sea' ? exportCfg.blNo : ''],
        ['Country of origin', exportCfg.countryOfOrigin],
      ].filter(([, v]) => v)
    : [];

  return (
    <div className="mx-auto w-full max-w-[820px] rounded-sm bg-white p-10 text-slate-800 shadow-xl ring-1 ring-slate-200">
      <div className="flex items-start justify-between border-b-2 border-primary-600 pb-5">
        <div>
          <p className="text-xl font-extrabold text-slate-900">{seller.name}</p>
          <p className="mt-1 text-xs text-slate-500">{seller.address}</p>
          <p className="text-xs text-slate-500">
            GSTIN <span className="font-mono">{seller.gstin}</span> · {seller.phone}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold tracking-wide text-primary-700">{isExport ? 'EXPORT INVOICE' : 'TAX INVOICE'}</p>
          <p className="mt-1 text-xs text-slate-500">
            No.{' '}
            <span className="font-semibold text-slate-800">
              {prefix}
              {invoiceNo}
            </span>
          </p>
          <p className="text-xs text-slate-500">Date {invoiceDate}</p>
          <p className="text-xs text-slate-500">Due {dueDate}</p>
        </div>
      </div>

      {isExport && (
        <p className="mt-4 rounded border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-700">
          {zeroRated
            ? 'Supply meant for export under LUT without payment of integrated tax'
            : 'Supply meant for export on payment of integrated tax'}
        </p>
      )}

      <div className="grid grid-cols-2 gap-6 py-5 text-xs">
        <div>
          <p className="mb-1 font-semibold uppercase tracking-wider text-slate-400">Bill to</p>
          {customer ? (
            <>
              <p className="text-sm font-bold text-slate-900">{customer.name}</p>
              <p>{customer.billing.line1}</p>
              <p>
                {customer.billing.city} – {customer.billing.pincode}, {customer.billing.state}
              </p>
              {customer.gstin && <p className="font-mono">GSTIN {customer.gstin}</p>}
              {customer.taxId && <p className="font-mono">{customer.taxId}</p>}
            </>
          ) : (
            <p className="text-sm font-bold text-slate-900">Cash sale</p>
          )}
        </div>
        {customer && shipAddress && (
          <div>
            <p className="mb-1 font-semibold uppercase tracking-wider text-slate-400">Ship to</p>
            <p className="text-sm font-bold text-slate-900">{customer.name}</p>
            <p>{shipAddress.line1}</p>
            <p>
              {shipAddress.city} – {shipAddress.pincode}, {shipAddress.state}
              {shipAddress.stateCode !== '96' && ` (${shipAddress.stateCode})`}
            </p>
          </div>
        )}
      </div>

      {shippingFacts.length > 0 && (
        <div className="mb-5 grid grid-cols-3 gap-x-6 gap-y-1.5 rounded bg-slate-50 px-3 py-2.5 text-[11px]">
          {shippingFacts.map(([k, v]) => (
            <div key={k}>
              <span className="text-slate-400">{k}</span> <span className="font-semibold text-slate-800">{v}</span>
            </div>
          ))}
        </div>
      )}

      <table className="w-full text-xs">
        <thead>
          <tr className="bg-slate-100 text-left text-[10px] uppercase tracking-wider text-slate-500">
            <th className="px-2 py-2">#</th>
            <th className="px-2 py-2">Item</th>
            <th className="px-2 py-2">HSN</th>
            <th className="px-2 py-2 text-right">Qty</th>
            <th className="px-2 py-2 text-right">Rate</th>
            <th className="px-2 py-2 text-right">Tax</th>
            <th className="px-2 py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const c = calcLine(l, zeroRated);
            return (
              <tr key={l.lineId} className="border-b border-slate-100">
                <td className="px-2 py-2 text-slate-400">{i + 1}</td>
                <td className="px-2 py-2 font-medium text-slate-900">{l.name}</td>
                <td className="px-2 py-2 font-mono">{l.hsn}</td>
                <td className="px-2 py-2 text-right">
                  {l.qty} {l.unit}
                </td>
                <td className="px-2 py-2 text-right">{money(l.rate)}</td>
                <td className="px-2 py-2 text-right">{zeroRated ? '0%' : `${l.gstPct}%`}</td>
                <td className="px-2 py-2 text-right font-semibold">{money(c.amount)}</td>
              </tr>
            );
          })}
          {lines.length === 0 && (
            <tr>
              <td colSpan={7} className="px-2 py-8 text-center text-slate-400">
                No items added yet
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="mt-5 flex justify-between gap-8">
        <div className="max-w-xs text-xs text-slate-500">
          <p className="font-semibold text-slate-700">Amount in words (INR)</p>
          <p>{amountInWords(totals.total)}</p>
          {foreign && (
            <p className="mt-2">
              Exchange rate ₹{exportCfg.rate} per {exportCfg.currency}. Rupee value {inr(totals.total)}.
            </p>
          )}
          {seller.bank.account && (
            <>
              <p className="mt-3 font-semibold text-slate-700">Bank details</p>
              <p>
                {seller.bank.name} · A/c {seller.bank.account} · IFSC {seller.bank.ifsc}
              </p>
            </>
          )}
        </div>
        <dl className="w-64 space-y-1 text-xs">
          <PreviewRow label="Taxable amount" value={money(totals.taxable)} />
          {isExport ? (
            <PreviewRow label={zeroRated ? 'IGST @ 0% (LUT)' : 'IGST'} value={money(totals.tax)} />
          ) : isInterState ? (
            <PreviewRow label="IGST" value={inr(totals.tax)} />
          ) : (
            <>
              <PreviewRow label="CGST" value={inr(totals.tax / 2)} />
              <PreviewRow label="SGST" value={inr(totals.tax / 2)} />
            </>
          )}
          {totals.charges > 0 && <PreviewRow label="Additional charges" value={money(totals.charges)} />}
          {totals.extraDiscount > 0 && <PreviewRow label="Discount" value={`−${money(totals.extraDiscount)}`} />}
          <PreviewRow label="Round off" value={money(totals.roundOff)} />
          <div className="flex justify-between border-t-2 border-slate-900 pt-2 text-sm font-bold text-slate-900">
            <dt>Total{foreign ? ` (${exportCfg.currency})` : ''}</dt>
            <dd>{money(totals.total)}</dd>
          </div>
          {foreign && <PreviewRow label="Total (INR)" value={inr(totals.total)} />}
        </dl>
      </div>

      <div className="mt-12 flex justify-end">
        <div className="text-center text-xs text-slate-500">
          <p className="font-semibold text-slate-700">For {seller.name}</p>
          <div className="mt-8 border-t border-slate-300 pt-1">Authorised signatory</div>
        </div>
      </div>
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-800">{value}</dd>
    </div>
  );
}

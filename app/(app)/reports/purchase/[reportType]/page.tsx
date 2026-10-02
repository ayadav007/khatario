'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Calendar, Download, FileText } from 'lucide-react';
import { format } from 'date-fns';
import {
  inr,
  qty,
  periodLabel,
  SummaryCards,
  ReportTable,
  StatusBadge,
  exportCsv,
} from '@/components/reports/RegisterReportUi';

const REPORT_TITLES: Record<string, string> = {
  'summary': 'Purchase Summary',
  'invoice-wise': 'Bill Details',
  'supplier-wise': 'Purchases by Supplier',
  'item-wise': 'Purchases by Item',
  'returns': 'Purchase Return Report',
  'credit': 'Credit Purchases Report',
  'tax-wise': 'Tax-wise Purchase Report',
};

const REPORT_SUBTITLES: Record<string, string> = {
  'summary': 'Bills less purchase returns, by period. Purchases exclude GST.',
  'invoice-wise': 'Every bill in the period with its status. Totals cover posted bills only.',
  'supplier-wise': 'Purchases per supplier, net of purchase returns. Purchases exclude GST.',
  'item-wise': 'Quantity and value billed less returns. Amounts exclude GST.',
  'returns': 'Active purchase returns (debit notes) by return date.',
  'credit': 'Posted bills in the period that still have a balance to pay.',
  'tax-wise': 'Taxable value and input GST by rate and HSN, net of purchase returns.',
};

const ROW_KEYS = ['summary', 'purchases', 'suppliers', 'items', 'returns', 'creditPurchases', 'taxWise'];

const dateLabel = (d: string | null | undefined) => (d ? periodLabel(String(d).slice(0, 10)) : '-');

export default function PurchaseReportPage() {
  const params = useParams();
  const { business, user } = useAuth();
  const reportType = params?.reportType as string;
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [dateRange, setDateRange] = useState(() => {
    const now = new Date();
    return {
      from: format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd'),
      to: format(now, 'yyyy-MM-dd'),
    };
  });
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [billStatus, setBillStatus] = useState('all');

  useEffect(() => {
    if (business?.id && user?.id && reportType) {
      fetchReport();
    }
  }, [business, user, reportType, dateRange, period, billStatus]);

  async function fetchReport() {
    if (!business?.id || !user?.id || !reportType) return;
    setLoading(true);

    try {
      let url = `/api/reports/purchase/${reportType}?business_id=${business.id}&user_id=${user.id}&from_date=${dateRange.from}&to_date=${dateRange.to}`;
      if (reportType === 'summary') url += `&period=${period}`;
      if (reportType === 'invoice-wise') url += `&status=${billStatus}`;

      const response = await fetch(url);
      const result = await response.json();

      if (response.ok) {
        setData(result);
      } else {
        setData(null);
        console.error('Error fetching report:', result.error);
      }
    } catch (error) {
      console.error('Error fetching report:', error);
    } finally {
      setLoading(false);
    }
  }

  const renderReportContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      );
    }

    if (!data) {
      return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-900 mb-2">No Data Available</h3>
          <p className="text-gray-600">No data found for the selected date range.</p>
        </div>
      );
    }

    switch (reportType) {
      case 'summary':
        return renderSummaryReport();
      case 'invoice-wise':
        return renderBillDetailsReport();
      case 'supplier-wise':
        return renderSupplierWiseReport();
      case 'item-wise':
        return renderItemWiseReport();
      case 'returns':
        return renderReturnsReport();
      case 'credit':
        return renderCreditReport();
      case 'tax-wise':
        return renderTaxWiseReport();
      default:
        return <div>Unknown report type</div>;
    }
  };

  const renderSummaryReport = () => {
    if (!data.summary || data.summary.length === 0) return <div>No data available</div>;
    const t = data.totals;
    return (
      <div className="space-y-4">
        <SummaryCards
          cards={[
            { label: 'Net Purchases (excl. tax)', value: inr(t.purchases), sub: `${t.bill_count} bills, ${t.return_count} returns` },
            { label: 'Purchase Returns', value: inr(t.return_purchases) },
            { label: 'Input Tax', value: inr(t.tax) },
            { label: 'Balance Due', value: inr(t.balance_due) },
          ]}
        />
        <ReportTable
          testId="purchase-summary-table"
          columns={[
            { label: 'Period' },
            { label: 'Bills', right: true },
            { label: 'Bill Purchases', right: true },
            { label: 'Returns', right: true },
            { label: 'Net Purchases', right: true },
            { label: 'Tax', right: true },
            { label: 'Net with Tax', right: true },
          ]}
          rows={data.summary.map((row: any) => [
            periodLabel(row.period),
            row.bill_count,
            inr(row.bill_purchases),
            inr(row.return_purchases),
            inr(row.purchases),
            inr(row.tax),
            inr(row.purchases_with_tax),
          ])}
          total={['Total', t.bill_count, inr(t.bill_purchases), inr(t.return_purchases), inr(t.purchases), inr(t.tax), inr(t.purchases_with_tax)]}
        />
      </div>
    );
  };

  const renderBillDetailsReport = () => {
    const t = data.totals;
    return (
      <div className="space-y-4">
        {t && (
          <SummaryCards
            cards={[
              { label: 'Posted Bills', value: String(t.total_bills), sub: `${t.draft_count} draft, ${t.cancelled_count} cancelled (not in totals)` },
              { label: 'Purchases (excl. tax)', value: inr(t.total_purchases) },
              { label: 'Purchases with Tax', value: inr(t.total_purchases_with_tax) },
              { label: 'Balance Due', value: inr(t.total_pending) },
            ]}
          />
        )}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-600">Status:</span>
          <select
            value={billStatus}
            onChange={(e) => setBillStatus(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
            data-testid="bill-status-filter"
          >
            <option value="all">All</option>
            <option value="final">Final</option>
            <option value="draft">Draft</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        {!data.purchases || data.purchases.length === 0 ? (
          <div>No data available</div>
        ) : (
          <ReportTable
            testId="purchase-bill-table"
            columns={[
              { label: 'Bill #' },
              { label: 'Date' },
              { label: 'Due Date' },
              { label: 'Supplier' },
              { label: 'Status' },
              { label: 'Purchases', right: true },
              { label: 'Tax', right: true },
              { label: 'Total', right: true },
              { label: 'Balance', right: true },
            ]}
            rows={data.purchases.map((p: any) => [
              p.bill_number || '-',
              dateLabel(p.bill_date),
              dateLabel(p.due_date),
              p.supplier_name,
              <StatusBadge key="s" status={p.status} paymentStatus={p.payment_status} />,
              inr(p.subtotal),
              inr(p.tax_total),
              inr(p.grand_total),
              inr(p.balance_amount),
            ])}
            rowClass={(i) => (data.purchases[i].status === 'final' ? '' : 'text-gray-400')}
            total={t ? ['Total (posted)', '', '', '', '', inr(t.total_purchases), inr(t.total_tax), inr(t.total_purchases_with_tax), inr(t.total_pending)] : undefined}
          />
        )}
      </div>
    );
  };

  const renderSupplierWiseReport = () => {
    if (!data.suppliers || data.suppliers.length === 0) return <div>No data available</div>;
    const t = data.totals;
    return (
      <div className="space-y-4">
        <SummaryCards
          cards={[
            { label: 'Suppliers', value: String(data.suppliers.length), sub: `${t.bill_count} bills` },
            { label: 'Net Purchases (excl. tax)', value: inr(t.purchases) },
            { label: 'Net Purchases with Tax', value: inr(t.purchases_with_tax) },
            { label: 'Balance Due', value: inr(t.balance_due) },
          ]}
        />
        <ReportTable
          testId="purchase-supplier-table"
          columns={[
            { label: 'Supplier' },
            { label: 'GSTIN' },
            { label: 'Bills', right: true },
            { label: 'Bill Purchases', right: true },
            { label: 'Returns', right: true },
            { label: 'Net Purchases', right: true },
            { label: 'Net with Tax', right: true },
            { label: 'Balance Due', right: true },
          ]}
          rows={data.suppliers.map((s: any) => [
            s.supplier_name,
            s.gstin || '-',
            s.bill_count,
            inr(s.bill_purchases),
            inr(s.return_purchases),
            inr(s.purchases),
            inr(s.purchases_with_tax),
            inr(s.balance_due),
          ])}
          total={['Total', '', t.bill_count, inr(t.bill_purchases), inr(t.return_purchases), inr(t.purchases), inr(t.purchases_with_tax), inr(t.balance_due)]}
        />
      </div>
    );
  };

  const renderItemWiseReport = () => {
    if (!data.items || data.items.length === 0) return <div>No data available</div>;
    const t = data.totals;
    return (
      <div className="space-y-4">
        <SummaryCards
          cards={[
            { label: 'Quantity Purchased (net)', value: qty(t.quantity), sub: t.quantity_returned ? `${qty(t.quantity_returned)} returned` : undefined },
            { label: 'Amount (excl. tax)', value: inr(t.amount) },
            { label: 'Input Tax', value: inr(t.tax) },
            { label: 'Discount Received', value: inr(t.discount) },
          ]}
        />
        <ReportTable
          testId="purchase-item-table"
          columns={[
            { label: 'Item' },
            { label: 'HSN/SAC' },
            { label: 'Qty Billed', right: true },
            { label: 'Returned', right: true },
            { label: 'Net Qty', right: true },
            { label: 'Amount', right: true },
            { label: 'Avg Cost', right: true },
            { label: 'Tax', right: true },
            { label: 'Amount with Tax', right: true },
          ]}
          rows={data.items.map((item: any) => [
            item.item_name,
            item.hsn_sac || '-',
            qty(item.quantity_purchased),
            qty(item.quantity_returned),
            `${qty(item.quantity)} ${item.unit || ''}`.trim(),
            inr(item.amount),
            inr(item.average_cost),
            inr(item.tax),
            inr(item.amount_with_tax),
          ])}
          total={['Total', '', qty(t.quantity_purchased), qty(t.quantity_returned), qty(t.quantity), inr(t.amount), '', inr(t.tax), inr(t.amount_with_tax)]}
        />
      </div>
    );
  };

  const renderReturnsReport = () => {
    if (!data.returns || data.returns.length === 0) return <div>No data available</div>;
    const t = data.totals;
    return (
      <div className="space-y-4">
        <SummaryCards
          cards={[
            { label: 'Returns', value: String(t.total_returns), sub: `${t.pending_count} refund pending` },
            { label: 'Returned (excl. tax)', value: inr(t.total_purchases) },
            { label: 'Returned with Tax', value: inr(t.total_amount) },
            { label: 'Refunded', value: inr(t.total_refunded) },
          ]}
        />
        <ReportTable
          testId="purchase-return-table"
          columns={[
            { label: 'Return #' },
            { label: 'Date' },
            { label: 'Bill #' },
            { label: 'Supplier' },
            { label: 'Amount', right: true },
            { label: 'Tax', right: true },
            { label: 'Total', right: true },
            { label: 'Reason' },
            { label: 'Refund' },
          ]}
          rows={data.returns.map((r: any) => [
            r.return_number,
            dateLabel(r.return_date),
            r.purchase_bill_number,
            r.supplier_name,
            inr(r.subtotal),
            inr(r.tax_total),
            inr(r.grand_total),
            r.reason || '-',
            <span key="r" className="capitalize">{r.refund_status || '-'}</span>,
          ])}
          total={['Total', '', '', '', inr(t.total_purchases), inr(t.total_tax), inr(t.total_amount), '', '']}
        />
      </div>
    );
  };

  const renderCreditReport = () => {
    if (!data.creditPurchases || data.creditPurchases.length === 0) return <div>No data available</div>;
    const t = data.totals;
    const badge = (c: string) =>
      c === 'overdue' ? 'bg-red-100 text-red-800' : c === 'partially_paid' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-700';
    return (
      <div className="space-y-4">
        <SummaryCards
          cards={[
            { label: 'Unpaid Bills', value: String(t.total_purchases) },
            { label: 'Bill Total', value: inr(t.total_amount) },
            { label: 'Outstanding', value: inr(t.total_outstanding) },
            { label: 'Overdue', value: inr(t.total_overdue) },
          ]}
        />
        <ReportTable
          testId="purchase-credit-table"
          columns={[
            { label: 'Bill #' },
            { label: 'Date' },
            { label: 'Due Date' },
            { label: 'Supplier' },
            { label: 'Total', right: true },
            { label: 'Paid', right: true },
            { label: 'Outstanding', right: true },
            { label: 'Status' },
          ]}
          rows={data.creditPurchases.map((p: any) => [
            p.bill_number || '-',
            dateLabel(p.bill_date),
            dateLabel(p.due_date),
            p.supplier_name,
            inr(p.grand_total),
            inr(p.paid_amount),
            inr(p.balance_amount),
            <span key="s" className={`px-2 py-1 text-xs font-medium rounded-full ${badge(p.status_category)}`}>
              {p.status_category === 'overdue' ? `Overdue ${p.days_overdue}d` : p.status_category.replace('_', ' ')}
            </span>,
          ])}
          total={['Total', '', '', '', inr(t.total_amount), '', inr(t.total_outstanding), '']}
        />
      </div>
    );
  };

  const renderTaxWiseReport = () => {
    if (!data.taxWise || data.taxWise.length === 0) return <div>No data available</div>;
    const t = data.totals;
    return (
      <div className="space-y-4">
        <SummaryCards
          cards={[
            { label: 'Taxable Value', value: inr(t.total_taxable_value) },
            { label: 'Input Tax', value: inr(t.total_tax) },
            { label: 'CGST + SGST', value: inr(t.total_cgst + t.total_sgst) },
            { label: 'IGST', value: inr(t.total_igst) },
          ]}
        />
        <ReportTable
          testId="purchase-tax-table"
          columns={[
            { label: 'Tax Rate' },
            { label: 'HSN/SAC' },
            { label: 'Quantity', right: true },
            { label: 'Taxable Value', right: true },
            { label: 'CGST', right: true },
            { label: 'SGST', right: true },
            { label: 'IGST', right: true },
            { label: 'Cess', right: true },
            { label: 'Total Tax', right: true },
          ]}
          rows={data.taxWise.map((r: any) => [
            `${Number(r.tax_rate).toFixed(2)}%`,
            r.hsn_sac,
            qty(r.total_quantity),
            inr(r.total_taxable_value),
            inr(r.total_cgst),
            inr(r.total_sgst),
            inr(r.total_igst),
            inr(r.total_cess),
            inr(r.total_tax),
          ])}
          total={['Total', '', qty(t.total_quantity), inr(t.total_taxable_value), inr(t.total_cgst), inr(t.total_sgst), inr(t.total_igst), inr(t.total_cess), inr(t.total_tax)]}
        />
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{REPORT_TITLES[reportType] || 'Purchase Report'}</h1>
          <p className="text-gray-600 text-sm mt-1">{REPORT_SUBTITLES[reportType] || 'Detailed purchase analysis and insights'}</p>
        </div>
        <button
          onClick={() => exportCsv(`purchase-${reportType}-${dateRange.from}-to-${dateRange.to}.csv`, data, ROW_KEYS)}
          disabled={loading || !data}
          data-testid="purchase-report-export"
          className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50"
        >
          <Download className="w-5 h-5" />
          <span>Export</span>
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex items-center space-x-4 flex-wrap">
          <div className="flex items-center space-x-2">
            <Calendar className="w-5 h-5 text-gray-400" />
            <span className="text-sm font-medium text-gray-700">Date Range:</span>
          </div>
          <input
            type="date"
            value={dateRange.from}
            onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
          />
          <span className="text-gray-500">to</span>
          <input
            type="date"
            value={dateRange.to}
            onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
          />
          {reportType === 'summary' && (
            <>
              <span className="text-gray-500">Period:</span>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value as 'day' | 'week' | 'month')}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
              >
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </>
          )}
        </div>
      </div>

      {renderReportContent()}
    </div>
  );
}

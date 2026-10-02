'use client';

import { useEffect, useState, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
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
  'summary': 'Sales Summary',
  'invoice-wise': 'Invoice-wise Sales Report',
  'item-wise': 'Item-wise Sales Report',
  'party-wise': 'Party-wise Sales Report',
  'payment-mode': 'Sales by Payment Mode',
  'discount': 'Discount Given Report',
  'credit': 'Credit Sales Report',
  'cancelled': 'Cancelled/Deleted Bills Report',
  'returns': 'Sales Return Report',
  'tax-wise': 'Tax-wise Sales Report',
  'b2b-b2c': 'B2B vs B2C Sales Report',
};

const REPORT_SUBTITLES: Record<string, string> = {
  summary: 'Invoices less credit notes, by period. Sales exclude GST.',
  'invoice-wise': 'Every invoice in the period with its status. Totals cover posted invoices only.',
  'item-wise': 'Quantity and value invoiced less returns on credit notes. Amounts exclude GST.',
  'party-wise': 'Sales per customer, net of credit notes. Sales exclude GST.',
};

const ROW_KEYS = [
  'summary', 'invoices', 'items', 'parties', 'byPaymentMode', 'discounts', 'creditSales',
  'cancelledInvoices', 'returns', 'taxWise', 'salesByType',
];

function SalesReportContent() {
  const params = useParams();
  const searchParams = useSearchParams();
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
  const [invoiceStatus, setInvoiceStatus] = useState('all');

  useEffect(() => {
    if (business?.id && user?.id && reportType) {
      fetchReport();
    }
  }, [business, user, reportType, dateRange, period, invoiceStatus]);

  async function fetchReport() {
    if (!business?.id || !user?.id || !reportType) return;
    setLoading(true);

    try {
      let url = `/api/reports/sales/${reportType}?business_id=${business.id}&user_id=${user.id}&from_date=${dateRange.from}&to_date=${dateRange.to}`;
      if (reportType === 'summary') {
        url += `&period=${period}`;
      }
      if (reportType === 'invoice-wise') {
        url += `&status=${invoiceStatus}`;
      }

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
        return renderInvoiceWiseReport();
      case 'item-wise':
        return renderItemWiseReport();
      case 'party-wise':
        return renderPartyWiseReport();
      case 'payment-mode':
        return renderPaymentModeReport();
      case 'discount':
        return renderDiscountReport();
      case 'credit':
        return renderCreditReport();
      case 'cancelled':
        return renderCancelledReport();
      case 'returns':
        return renderReturnsReport();
      case 'tax-wise':
        return renderTaxWiseReport();
      case 'b2b-b2c':
        return renderB2BB2CReport();
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
            { label: 'Net Sales (excl. tax)', value: inr(t.sales), sub: `${t.invoice_count} invoices, ${t.credit_note_count} credit notes` },
            { label: 'Credit Notes', value: inr(t.credit_note_sales) },
            { label: 'Tax', value: inr(t.tax) },
            { label: 'Net Sales with Tax', value: inr(t.sales_with_tax) },
          ]}
        />
        <ReportTable
          testId="sales-summary-table"
          columns={[
            { label: 'Period' },
            { label: 'Invoices', right: true },
            { label: 'Invoice Sales', right: true },
            { label: 'Credit Notes', right: true },
            { label: 'Net Sales', right: true },
            { label: 'Tax', right: true },
            { label: 'Net with Tax', right: true },
          ]}
          rows={data.summary.map((row: any) => [
            periodLabel(row.period),
            row.invoice_count,
            inr(row.invoice_sales),
            inr(row.credit_note_sales),
            inr(row.sales),
            inr(row.tax),
            inr(row.sales_with_tax),
          ])}
          total={['Total', t.invoice_count, inr(t.invoice_sales), inr(t.credit_note_sales), inr(t.sales), inr(t.tax), inr(t.sales_with_tax)]}
        />
      </div>
    );
  };

  const renderInvoiceWiseReport = () => {
    const t = data.totals;
    return (
      <div className="space-y-4">
        {t && (
          <SummaryCards
            cards={[
              { label: 'Posted Invoices', value: String(t.total_invoices), sub: `${t.draft_count} draft, ${t.cancelled_count} cancelled (not in totals)` },
              { label: 'Sales (excl. tax)', value: inr(t.total_sales) },
              { label: 'Sales with Tax', value: inr(t.total_sales_with_tax) },
              { label: 'Balance Due', value: inr(t.total_pending) },
            ]}
          />
        )}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-600">Status:</span>
          <select
            value={invoiceStatus}
            onChange={(e) => setInvoiceStatus(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
            data-testid="invoice-status-filter"
          >
            <option value="all">All</option>
            <option value="final">Final</option>
            <option value="draft">Draft</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        {!data.invoices || data.invoices.length === 0 ? (
          <div>No data available</div>
        ) : (
          <ReportTable
            testId="sales-invoice-table"
            columns={[
              { label: 'Invoice #' },
              { label: 'Date' },
              { label: 'Customer' },
              { label: 'Status' },
              { label: 'Sales', right: true },
              { label: 'Tax', right: true },
              { label: 'Total', right: true },
              { label: 'Balance', right: true },
            ]}
            rows={data.invoices.map((inv: any) => [
              inv.invoice_number,
              format(new Date(inv.invoice_date), 'dd MMM yyyy'),
              inv.customer_name,
              <StatusBadge key="s" status={inv.status} paymentStatus={inv.payment_status} />,
              inr(inv.sales),
              inr(inv.tax_total),
              inr(inv.grand_total),
              inr(inv.balance_amount),
            ])}
            rowClass={(i) => (data.invoices[i].status === 'final' ? '' : 'text-gray-400')}
            total={t ? ['Total (posted)', '', '', '', inr(t.total_sales), inr(t.total_tax), inr(t.total_sales_with_tax), inr(t.total_pending)] : undefined}
          />
        )}
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
            { label: 'Quantity Sold (net)', value: qty(t.quantity_sold), sub: t.quantity_returned ? `${qty(t.quantity_returned)} returned` : undefined },
            { label: 'Amount (excl. tax)', value: inr(t.amount) },
            { label: 'Tax', value: inr(t.tax) },
            { label: 'Discount Given', value: inr(t.discount) },
          ]}
        />
        <ReportTable
          testId="sales-item-table"
          columns={[
            { label: 'Item' },
            { label: 'HSN/SAC' },
            { label: 'Qty Invoiced', right: true },
            { label: 'Returned', right: true },
            { label: 'Qty Sold', right: true },
            { label: 'Amount', right: true },
            { label: 'Avg Price', right: true },
            { label: 'Tax', right: true },
            { label: 'Amount with Tax', right: true },
          ]}
          rows={data.items.map((item: any) => [
            item.item_name,
            item.hsn_sac || '-',
            qty(item.quantity_invoiced),
            qty(item.quantity_returned),
            `${qty(item.quantity_sold)} ${item.unit || ''}`.trim(),
            inr(item.amount),
            inr(item.average_price),
            inr(item.tax),
            inr(item.amount_with_tax),
          ])}
          total={['Total', '', qty(t.quantity_invoiced), qty(t.quantity_returned), qty(t.quantity_sold), inr(t.amount), '', inr(t.tax), inr(t.amount_with_tax)]}
        />
      </div>
    );
  };

  const renderPartyWiseReport = () => {
    if (!data.parties || data.parties.length === 0) return <div>No data available</div>;
    const t = data.totals;
    return (
      <div className="space-y-4">
        <SummaryCards
          cards={[
            { label: 'Customers', value: String(data.parties.length), sub: `${t.invoice_count} invoices` },
            { label: 'Net Sales (excl. tax)', value: inr(t.sales) },
            { label: 'Net Sales with Tax', value: inr(t.sales_with_tax) },
            { label: 'Balance Due', value: inr(t.balance_due) },
          ]}
        />
        <ReportTable
          testId="sales-customer-table"
          columns={[
            { label: 'Customer' },
            { label: 'GSTIN' },
            { label: 'Invoices', right: true },
            { label: 'Invoice Sales', right: true },
            { label: 'Credit Notes', right: true },
            { label: 'Net Sales', right: true },
            { label: 'Net with Tax', right: true },
            { label: 'Balance Due', right: true },
          ]}
          rows={data.parties.map((p: any) => [
            p.customer_name,
            p.gstin || '-',
            p.invoice_count,
            inr(p.invoice_sales),
            inr(p.credit_note_sales),
            inr(p.sales),
            inr(p.sales_with_tax),
            inr(p.balance_due),
          ])}
          total={['Total', '', t.invoice_count, inr(t.invoice_sales), inr(t.credit_note_sales), inr(t.sales), inr(t.sales_with_tax), inr(t.balance_due)]}
        />
      </div>
    );
  };

  const renderPaymentModeReport = () => {
    if (!data.byPaymentMode || data.byPaymentMode.length === 0) return <div>No data available</div>;

    return (
      <div className="space-y-4">
        {data.totals && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-6 border border-primary-200">
              <p className="text-sm text-primary-600 mb-2">Total Invoices</p>
              <p className="text-3xl font-bold text-gray-900">{data.totals.total_invoices}</p>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-6 border border-green-200">
              <p className="text-sm text-green-600 mb-2">Total Amount</p>
              <p className="text-3xl font-bold text-gray-900">₹{data.totals.total_amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Payment Mode</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Invoices</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Amount</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data.byPaymentMode.map((row: any, idx: number) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 capitalize">{row.payment_mode || 'Unpaid'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{row.invoice_count}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900 font-medium">₹{parseFloat(row.total_amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const renderDiscountReport = () => {
    if (!data.discounts || data.discounts.length === 0) return <div>No data available</div>;

    return (
      <div className="space-y-4">
        {data.totals && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-6 border border-primary-200">
              <p className="text-sm text-primary-600 mb-2">Total Invoices</p>
              <p className="text-3xl font-bold text-gray-900">{data.totals.total_invoices}</p>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-6 border border-green-200">
              <p className="text-sm text-green-600 mb-2">Total Subtotal</p>
              <p className="text-3xl font-bold text-gray-900">₹{data.totals.total_subtotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-6 border border-orange-200">
              <p className="text-sm text-orange-600 mb-2">Total Discount</p>
              <p className="text-3xl font-bold text-gray-900">₹{data.totals.total_discount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-6 border border-purple-200">
              <p className="text-sm text-purple-600 mb-2">Avg Discount %</p>
              <p className="text-3xl font-bold text-gray-900">{data.totals.avg_discount_percent.toFixed(2)}%</p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice #</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Subtotal</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Discount</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Discount %</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Grand Total</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data.discounts.map((disc: any, idx: number) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{disc.invoice_number}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{format(new Date(disc.invoice_date), 'dd MMM yyyy')}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{disc.customer_name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">₹{parseFloat(disc.subtotal || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-orange-600 font-medium">₹{parseFloat(disc.discount_total || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-500">{parseFloat(disc.discount_percent || 0).toFixed(2)}%</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900 font-medium">₹{parseFloat(disc.grand_total || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const renderCreditReport = () => {
    if (!data.creditSales || data.creditSales.length === 0) return <div>No data available</div>;

    return (
      <div className="space-y-4">
        {data.totals && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-6 border border-primary-200">
              <p className="text-sm text-primary-600 mb-2">Total Invoices</p>
              <p className="text-3xl font-bold text-gray-900">{data.totals.total_invoices}</p>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-6 border border-green-200">
              <p className="text-sm text-green-600 mb-2">Total Sales</p>
              <p className="text-3xl font-bold text-gray-900">₹{data.totals.total_sales.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-6 border border-orange-200">
              <p className="text-sm text-orange-600 mb-2">Outstanding</p>
              <p className="text-3xl font-bold text-gray-900">₹{data.totals.total_outstanding.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-xl p-6 border border-red-200">
              <p className="text-sm text-red-600 mb-2">Overdue</p>
              <p className="text-3xl font-bold text-gray-900">₹{data.totals.total_overdue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice #</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Due Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Paid</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Outstanding</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data.creditSales.map((sale: any, idx: number) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{sale.invoice_number}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{format(new Date(sale.invoice_date), 'dd MMM yyyy')}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{sale.due_date ? format(new Date(sale.due_date), 'dd MMM yyyy') : '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{sale.customer_name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">₹{parseFloat(sale.grand_total || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-green-600">₹{parseFloat(sale.paid_amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-orange-600 font-medium">₹{parseFloat(sale.balance_amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        sale.status_category === 'overdue' ? 'bg-red-100 text-red-800' :
                        sale.status_category === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-green-100 text-green-800'
                      }`}>
                        {sale.status_category}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const renderCancelledReport = () => {
    if (!data.cancelledInvoices || data.cancelledInvoices.length === 0) return <div>No data available</div>;

    return (
      <div className="space-y-4">
        {data.totals && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-6 border border-primary-200">
              <p className="text-sm text-primary-600 mb-2">Total Cancelled</p>
              <p className="text-3xl font-bold text-gray-900">{data.totals.total_invoices}</p>
            </div>
            <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-xl p-6 border border-red-200">
              <p className="text-sm text-red-600 mb-2">Total Amount</p>
              <p className="text-3xl font-bold text-gray-900">₹{data.totals.total_amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-6 border border-purple-200">
              <p className="text-sm text-purple-600 mb-2">Total Tax</p>
              <p className="text-3xl font-bold text-gray-900">₹{data.totals.total_tax.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice #</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cancellation Reason</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cancelled At</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data.cancelledInvoices.map((inv: any, idx: number) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{inv.invoice_number}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{format(new Date(inv.invoice_date), 'dd MMM yyyy')}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{inv.customer_name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">₹{parseFloat(inv.grand_total || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{inv.cancellation_reason || '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{inv.cancelled_at ? format(new Date(inv.cancelled_at), 'dd MMM yyyy HH:mm') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const renderReturnsReport = () => {
    if (!data.returns || data.returns.length === 0) return <div>No data available</div>;

    return (
      <div className="space-y-4">
        {data.totals && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-6 border border-primary-200">
              <p className="text-sm text-primary-600 mb-2">Total Returns</p>
              <p className="text-3xl font-bold text-gray-900">{data.totals.total_returns}</p>
            </div>
            <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-xl p-6 border border-red-200">
              <p className="text-sm text-red-600 mb-2">Total Amount</p>
              <p className="text-3xl font-bold text-gray-900">₹{data.totals.total_amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-6 border border-green-200">
              <p className="text-sm text-green-600 mb-2">Total Refunded</p>
              <p className="text-3xl font-bold text-gray-900">₹{data.totals.total_refunded.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-6 border border-orange-200">
              <p className="text-sm text-orange-600 mb-2">Pending</p>
              <p className="text-3xl font-bold text-gray-900">{data.totals.pending_count}</p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Credit Note #</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice #</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reason</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Refund Status</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data.returns.map((ret: any, idx: number) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{ret.credit_note_number}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{format(new Date(ret.credit_note_date), 'dd MMM yyyy')}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{ret.invoice_number || '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{ret.customer_name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">₹{parseFloat(ret.grand_total || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{ret.reason || '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        ret.refund_status === 'refunded' ? 'bg-green-100 text-green-800' :
                        ret.refund_status === 'adjusted' ? 'bg-slate-100 text-primary-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {ret.refund_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const renderTaxWiseReport = () => {
    if (!data.taxWise || data.taxWise.length === 0) return <div>No data available</div>;

    return (
      <div className="space-y-4">
        {data.totals && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-6 border border-primary-200">
              <p className="text-sm text-primary-600 mb-2">Total Taxable Value</p>
              <p className="text-3xl font-bold text-gray-900">₹{data.totals.total_taxable_value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-6 border border-green-200">
              <p className="text-sm text-green-600 mb-2">Total Tax</p>
              <p className="text-3xl font-bold text-gray-900">₹{data.totals.total_tax.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-6 border border-purple-200">
              <p className="text-sm text-purple-600 mb-2">CGST</p>
              <p className="text-3xl font-bold text-gray-900">₹{data.totals.total_cgst.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-xl p-6 border border-indigo-200">
              <p className="text-sm text-indigo-600 mb-2">SGST</p>
              <p className="text-3xl font-bold text-gray-900">₹{data.totals.total_sgst.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tax Rate %</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">HSN/SAC</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Quantity</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Taxable Value</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">CGST</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">SGST</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">IGST</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Tax</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data.taxWise.map((row: any, idx: number) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{parseFloat(row.tax_rate || 0).toFixed(2)}%</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{row.hsn_sac || '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{parseFloat(row.total_quantity || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">₹{parseFloat(row.total_taxable_value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">₹{parseFloat(row.total_cgst || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">₹{parseFloat(row.total_sgst || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">₹{parseFloat(row.total_igst || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900 font-medium">₹{parseFloat(row.total_tax || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const renderB2BB2CReport = () => {
    if (!data.salesByType || data.salesByType.length === 0) return <div>No data available</div>;

    return (
      <div className="space-y-4">
        {data.totals && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-6 border border-primary-200">
              <p className="text-sm text-primary-600 mb-2">Total Invoices</p>
              <p className="text-3xl font-bold text-gray-900">{data.totals.total_invoices}</p>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-6 border border-green-200">
              <p className="text-sm text-green-600 mb-2">Total Sales</p>
              <p className="text-3xl font-bold text-gray-900">₹{data.totals.total_sales.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-6 border border-purple-200">
              <p className="text-sm text-purple-600 mb-2">Total Tax</p>
              <p className="text-3xl font-bold text-gray-900">₹{data.totals.total_tax.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-6 border border-orange-200">
              <p className="text-sm text-orange-600 mb-2">Total Pending</p>
              <p className="text-3xl font-bold text-gray-900">₹{data.totals.total_pending.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sale Type</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Invoices</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Sales</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Taxable Value</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">CGST</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">SGST</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">IGST</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Tax</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data.salesByType.map((row: any, idx: number) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{row.sale_type}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{row.invoice_count}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900 font-medium">₹{parseFloat(row.total_sales || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">₹{parseFloat(row.total_taxable_value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">₹{parseFloat(row.total_cgst || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">₹{parseFloat(row.total_sgst || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">₹{parseFloat(row.total_igst || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900 font-medium">₹{parseFloat(row.total_tax || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{REPORT_TITLES[reportType] || 'Sales Report'}</h1>
            <p className="text-gray-600 text-sm mt-1">{REPORT_SUBTITLES[reportType] || 'Detailed sales analysis and insights'}</p>
          </div>
          <button
            onClick={() => exportCsv(`sales-${reportType}-${dateRange.from}-to-${dateRange.to}.csv`, data, ROW_KEYS)}
            disabled={loading || !data}
            data-testid="sales-report-export"
            className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50"
          >
            <Download className="w-5 h-5" />
            <span>Export</span>
          </button>
        </div>

        {/* Date Range Filter */}
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

        {/* Report Content */}
        {renderReportContent()}
      </div>
  );
}

export default function SalesReportPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <SalesReportContent />
    </Suspense>
  );
}


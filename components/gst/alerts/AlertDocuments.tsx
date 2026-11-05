'use client';

import React from 'react';
import Link from 'next/link';
import { dateLabel, inr, type GstAlert, type RcmDocument } from './alert-meta';

function rcmDocumentHref(id: string, document?: RcmDocument) {
  return document === 'expense' ? `/expenses/new?edit=${id}` : `/purchases/${id}`;
}

function Table({ title, head, rows, more }: { title: string; head: Array<{ label: string; right?: boolean }>; rows: React.ReactNode; more: number }) {
  return (
    <div className="overflow-x-auto">
      <p className="text-xs font-semibold text-gray-700 mb-1">{title}</p>
      <table className="min-w-full text-xs">
        <thead>
          <tr className="text-left text-gray-500">
            {head.map((h) => (
              <th key={h.label} className={`py-1 pr-3 last:pr-0 font-medium ${h.right ? 'text-right' : ''}`}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
      {more > 0 && <p className="text-xs text-gray-500 mt-1">and {more} more</p>}
    </div>
  );
}

const LIMIT = 10;
const td = 'py-1.5 pr-3 last:pr-0 text-gray-700 align-top';

/** The bills or invoices behind an alert, each linked to its document. */
export function AlertDocuments({ alert }: { alert: GstAlert }) {
  const { bills = [], invoices = [], sales = [], rcm_bills: rcmBills = [], unverified = [] } = alert.details;
  const reversal = alert.alert_key === 'rule37:reversal_pending';
  const moreBills = (alert.details.bill_count ?? bills.length) - Math.min(bills.length, LIMIT);

  return (
    <div className="space-y-4">
      {bills.length > 0 && (
        <Table
          title="Supplier bills"
          head={[{ label: 'Bill' }, { label: 'Days unpaid' }, { label: 'Unpaid', right: true }, { label: reversal ? 'To reverse' : 'ITC at stake', right: true }]}
          more={moreBills}
          rows={bills.slice(0, LIMIT).map((b) => (
            <tr key={b.purchase_id} className="border-t border-gray-100">
              <td className={td}>
                <Link href={`/purchases/${b.purchase_id}`} className="text-primary-700 hover:underline">
                  {b.bill_number || 'Bill'}
                </Link>
                <div className="text-gray-500">
                  {b.supplier_name || '—'} · {dateLabel(b.bill_date)}
                </div>
              </td>
              <td className={td}>
                <span className={b.days_outstanding > 180 ? 'text-red-700 font-medium' : ''}>{b.days_outstanding}</span>
              </td>
              <td className={`${td} text-right`}>{inr(b.unpaid)}</td>
              <td className={`${td} text-right text-gray-900 font-medium`}>{inr(b.to_reverse ?? b.itc_at_stake)}</td>
            </tr>
          ))}
        />
      )}

      {invoices.length > 0 && (
        <Table
          title="In GSTR-2B, not in your books"
          head={[{ label: 'Supplier' }, { label: 'Invoice' }, { label: 'ITC', right: true }]}
          more={invoices.length - LIMIT}
          rows={invoices.slice(0, LIMIT).map((d) => (
            <tr key={`${d.supplier_gstin}-${d.invoice_number}`} className="border-t border-gray-100">
              <td className={td}>{d.supplier_name || d.supplier_gstin}</td>
              <td className={td}>
                {d.invoice_number} <span className="text-gray-500">{dateLabel(d.invoice_date)}</span>
              </td>
              <td className={`${td} text-right text-gray-900`}>{inr(d.itc)}</td>
            </tr>
          ))}
        />
      )}

      {sales.length > 0 && (
        <Table
          title="Invoices"
          head={[{ label: 'Invoice' }, { label: 'Customer' }, { label: 'Value', right: true }]}
          more={sales.length - LIMIT}
          rows={sales.slice(0, LIMIT).map((d) => (
            <tr key={d.invoice_id} className="border-t border-gray-100">
              <td className={td}>
                <Link href={`/invoices/${d.invoice_id}`} className="text-primary-700 hover:underline">
                  {d.invoice_number}
                </Link>{' '}
                <span className="text-gray-500">{dateLabel(d.invoice_date)}</span>
              </td>
              <td className={td}>{d.customer_name || '—'}</td>
              <td className={`${td} text-right text-gray-900`}>{inr(d.grand_total)}</td>
            </tr>
          ))}
        />
      )}

      {rcmBills.length > 0 && (
        <Table
          title="Self-invoice needed"
          head={[{ label: 'Bill' }, { label: 'Self-invoice by' }, { label: 'Tax', right: true }]}
          more={rcmBills.length - LIMIT}
          rows={rcmBills.slice(0, LIMIT).map((b) => (
            <tr key={b.purchase_id} className="border-t border-gray-100">
              <td className={td}>
                <Link href={rcmDocumentHref(b.purchase_id, b.document)} className="text-primary-700 hover:underline">
                  {b.bill_number || (b.document === 'expense' ? 'Expense' : 'Bill')}
                </Link>
                <div className="text-gray-500">
                  {b.supplier_name || '—'} · {dateLabel(b.bill_date)}
                </div>
              </td>
              <td className={td}>{dateLabel(b.self_invoice_by)}</td>
              <td className={`${td} text-right text-gray-900`}>{inr(b.tax)}</td>
            </tr>
          ))}
        />
      )}

      {unverified.length > 0 && (
        <Table
          title="Needs details"
          head={[{ label: 'Bill' }, { label: 'What is missing' }, { label: 'Tax', right: true }]}
          more={unverified.length - LIMIT}
          rows={unverified.slice(0, LIMIT).map((b) => (
            <tr key={b.purchase_id} className="border-t border-gray-100">
              <td className={td}>
                <Link href={rcmDocumentHref(b.purchase_id, b.document)} className="text-primary-700 hover:underline">
                  {b.bill_number || (b.document === 'expense' ? 'Expense' : 'Bill')}
                </Link>
                <div className="text-gray-500">
                  {b.supplier_name || '—'}
                  {b.bill_date ? ` · ${dateLabel(b.bill_date)}` : ''}
                </div>
              </td>
              <td className={td}>{b.message}</td>
              <td className={`${td} text-right text-gray-900`}>{b.tax != null ? inr(b.tax) : '—'}</td>
            </tr>
          ))}
        />
      )}
    </div>
  );
}

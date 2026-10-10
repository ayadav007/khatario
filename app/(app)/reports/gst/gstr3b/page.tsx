'use client';

export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/PageHeader';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { Download, FileText, RefreshCw, TrendingUp, TrendingDown, MinusCircle } from 'lucide-react';
import { useToastContext } from '@/contexts/ToastContext';
import { ProfileRequiredPanel } from '@/components/profile/ProfileRequiredPanel';
import { getProfileGaps, isProfileReady } from '@/lib/business-profile-requirements';
import { useProfileRequiredGate } from '@/hooks/useProfileRequiredGate';
import { Gstr3bFilingStatusBar } from '@/components/gst/MarkGstr3bFiled';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export default function GSTR3BPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const { ensureProfile } = useProfileRequiredGate();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [cashBalances, setCashBalances] = useState<{ igst: number; cgst: number; sgst: number; cess: number } | null>(null);
  
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());

  useEffect(() => {
    const m = /^(\d{4})-(\d{2})$/.exec(new URLSearchParams(window.location.search).get('period') ?? '');
    if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
      setYear(Number(m[1]));
      setMonth(Number(m[2]));
    }
  }, []);

  const profileContext = 'gst_compliance' as const;
  const profileGaps = getProfileGaps(business, profileContext);
  const profileReady = isProfileReady(business, profileContext);

  const fetchReport = async () => {
    if (!business) return;
    setLoading(true);
    try {
      const query = new URLSearchParams({
        business_id: business.id,
        user_id: user?.id || '', // Required for authorization
        month: month.toString(),
        year: year.toString()
      });
      
      const end = new Date(year, month, 0);
      const asOn = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
      const cashQuery = new URLSearchParams({
        business_id: business.id,
        as_on_date: asOn,
      });
      const [res, cashRes] = await Promise.all([
        fetch(`/api/reports/gst/gstr3b?${query}`),
        fetch(`/api/gst/cash-ledger?${cashQuery}`),
      ]);
      const json = await res.json();
      if (res.ok) {
        setData(json);
      } else {
        console.error(json.error);
        toast.error('Failed to fetch GSTR-3B data');
      }
      if (cashRes.ok) {
        const cash = await cashRes.json();
        setCashBalances({
          igst: Number(cash.igst?.cash_balance || 0),
          cgst: Number(cash.cgst?.cash_balance || 0),
          sgst: Number(cash.sgst?.cash_balance || 0),
          cess: Number(cash.cess?.cash_balance || 0),
        });
      } else {
        setCashBalances(null);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (business && profileReady) {
      fetchReport();
    }
  }, [business, profileReady, month, year]);

  // Show message if GSTIN is missing
  if (!business) {
    return (
      
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            <p className="mt-4 text-text-secondary">Loading...</p>
          </div>
        </div>
      
    );
  }

  if (!profileReady) {
    return <ProfileRequiredPanel context={profileContext} gaps={profileGaps} />;
  }

  const handleExport = async (format: 'json') => {
    if (!business) return;
    if (!ensureProfile(profileContext)) return;
    const query = new URLSearchParams({
      business_id: business.id,
      month: month.toString(),
      year: year.toString(),
      export: format
    });
    
    window.open(`/api/reports/gst/gstr3b?${query}`, '_blank');
  };

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <PageHeader
  title="GSTR-3B Return"
/>
              {data?.reconciliation?.status === 'mismatch' && (
                <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900 border border-amber-200">
                  Mismatch detected
                </span>
              )}
              {data?.rcm_mode === 'pooled' && (data?.rcm?.total || 0) > 0 && (
                <span className="inline-flex items-center rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-900 border border-violet-200">
                  RCM not classified
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500">Monthly summary return of outward supplies and ITC</p>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={() => handleExport('json')}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              <FileText className="w-4 h-4" />
              Export JSON
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Month</label>
            <select 
              value={month} 
              onChange={(e) => setMonth(parseInt(e.target.value))}
              className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none min-w-[140px]"
            >
              {MONTHS.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Year</label>
            <select 
              value={year} 
              onChange={(e) => setYear(parseInt(e.target.value))}
              className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none min-w-[100px]"
            >
              {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <button 
            onClick={fetchReport}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 ml-auto flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <Gstr3bFilingStatusBar businessId={business.id} month={`${year}-${String(month).padStart(2, '0')}`} />

        {/* Summary Cards */}
        {data?.summary && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gradient-to-br from-red-50 to-orange-50 p-6 rounded-xl border border-red-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-red-700">Total Tax Liability</p>
                <TrendingUp className="w-5 h-5 text-red-500" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{data.summary.total_tax_liability.toLocaleString('en-IN')}</p>
              <p className="text-xs text-gray-600 mt-1">Outward supplies</p>
            </div>
            
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 p-6 rounded-xl border border-green-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-green-700">Total ITC Available</p>
                <TrendingDown className="w-5 h-5 text-green-500" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{data.summary.total_itc.toLocaleString('en-IN')}</p>
              <p className="text-xs text-gray-600 mt-1">Input tax credit</p>
            </div>
            
            <div className="bg-gradient-to-br from-slate-50 to-cyan-50 p-6 rounded-xl border border-primary-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-primary-700">Net Tax Payable</p>
                <MinusCircle className="w-5 h-5 text-primary-500" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{data.summary.net_tax_payable.toLocaleString('en-IN')}</p>
              <p className="text-xs text-gray-600 mt-1">After ITC set-off (IGST→IGST/CGST/SGST, then CGST/SGST rules)</p>
            </div>
          </div>
        )}

        {cashBalances && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-900">Electronic cash ledger</p>
              <Link href="/reports/gst/cash-ledger" className="text-xs text-primary-700 hover:underline">Open ledger</Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><p className="text-gray-500">IGST</p><p className="font-semibold">₹{cashBalances.igst.toLocaleString('en-IN')}</p></div>
              <div><p className="text-gray-500">CGST</p><p className="font-semibold">₹{cashBalances.cgst.toLocaleString('en-IN')}</p></div>
              <div><p className="text-gray-500">SGST</p><p className="font-semibold">₹{cashBalances.sgst.toLocaleString('en-IN')}</p></div>
              <div><p className="text-gray-500">Cess</p><p className="font-semibold">₹{cashBalances.cess.toLocaleString('en-IN')}</p></div>
            </div>
          </div>
        )}

        {/* Reconciliation + RCM vs ITC (audit) */}
        {data?.reconciliation && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h4 className="text-sm font-semibold text-gray-900 mb-2">Ledger vs GSTR-1 (output tax 2150–2152)</h4>
              <dl className="text-xs text-gray-700 space-y-1">
                <div className="flex justify-between gap-4">
                  <dt>Status</dt>
                  <dd className="font-medium">{data.reconciliation.status}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Ledger total</dt>
                  <dd>₹{Number(data.reconciliation.ledger_total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>GSTR-1 total</dt>
                  <dd>₹{Number(data.reconciliation.gstr1_total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Difference</dt>
                  <dd>₹{Number(data.reconciliation.difference).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Difference % of ledger</dt>
                  <dd>{Number(data.reconciliation.difference_percent).toFixed(2)}%</dd>
                </div>
              </dl>
            </div>
            {data.ledger_basis?.rcm_itc_analysis && (
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <h4 className="text-sm font-semibold text-gray-900 mb-2">RCM output vs ITC claimed (ledger)</h4>
                <dl className="text-xs text-gray-700 space-y-1">
                  <div className="flex justify-between gap-4">
                    <dt>RCM output total</dt>
                    <dd>₹{Number(data.ledger_basis.rcm_itc_analysis.rcm_output_total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>ITC claimed total</dt>
                    <dd>₹{Number(data.ledger_basis.rcm_itc_analysis.itc_claimed_total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</dd>
                  </div>
                  {data.ledger_basis.rcm_itc_analysis.possible_rcm_itc_mismatch && (
                    <p className="text-amber-800 mt-2 font-medium">Possible mismatch: RCM with no ITC in period — review purchases / 1110–1112.</p>
                  )}
                </dl>
              </div>
            )}
          </div>
        )}

        {data?.warnings?.length ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4">
            <p className="text-xs font-semibold text-amber-900 mb-2">Warnings</p>
            <ul className="list-disc list-inside text-xs text-amber-900 space-y-1">
              {data.warnings.map((w: string, i: number) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Tables */}
        <div className="space-y-6">
          {/* Table 3.1 - Outward Supplies */}
          {data && (
            <Section title="3.1 - Details of Outward Supplies and inward supplies liable to reverse charge">
              <p className="text-xs text-gray-600 mb-3">
                Values and tax heads come from the invoices, credit/debit notes and reverse-charge bills of the
                period (same documents as GSTR-1). Row (a) is split by place of supply against your GSTIN state.
                The ledger comparison is shown above under reconciliation.
              </p>
              <TaxTable
                rows={[
                  ...(data.outward_taxable_supplies_nature
                    ? [
                        {
                          label:
                            '(a)(i) Inter-state outward taxable supplies (other than zero rated, nil rated and exempted)',
                          data: data.outward_taxable_supplies_nature.inter_state,
                        },
                        {
                          label:
                            '(a)(ii) Intra-state outward taxable supplies (other than zero rated, nil rated and exempted)',
                          data: data.outward_taxable_supplies_nature.intra_state,
                        },
                      ]
                    : [
                        {
                          label:
                            '(a) Outward taxable supplies (other than zero rated, nil rated and exempted)',
                          data: data.outward_taxable_supplies,
                        },
                      ]),
                  { label: '(b) Outward taxable supplies (zero rated)', data: data.outward_zero_rated },
                  { label: '(c) Other outward supplies (Nil rated, exempted)', data: data.other_outward_supplies },
                  { label: '(d) Inward supplies (liable to reverse charge)', data: data.inward_reverse_charge },
                  ...(data.non_gst_outward_supplies
                    ? [{ label: '(e) Non-GST outward supplies', data: data.non_gst_outward_supplies }]
                    : []),
                ]}
              />
            </Section>
          )}

          {/* Table 3.2 - Inter-state supplies to unregistered persons */}
          {data?.inter_state_supplies_unregistered && (
            <Section title="3.2 - Inter-state supplies to unregistered persons (out of 3.1(a))">
              {data.inter_state_supplies_unregistered.length === 0 ? (
                <p className="px-6 py-4 text-sm text-gray-500">No inter-state supplies to unregistered persons in this period.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="px-6 py-2 text-left font-medium">Place of supply</th>
                      <th className="px-6 py-2 text-right font-medium">Taxable value</th>
                      <th className="px-6 py-2 text-right font-medium">IGST</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.inter_state_supplies_unregistered.map((r: { place_of_supply: string; taxable_value: number; igst: number }) => (
                      <tr key={r.place_of_supply} className="border-t border-gray-100">
                        <td className="px-6 py-2">{r.place_of_supply}</td>
                        <td className="px-6 py-2 text-right">₹{Number(r.taxable_value).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        <td className="px-6 py-2 text-right">₹{Number(r.igst).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
          )}

          {/* Table 4 - ITC */}
          {data?.itc_details && (
            <Section title="4 - Eligible ITC">
              <TaxTable 
                rows={[
                  { label: '(A)(1) Import of goods', data: data.itc_details.imports },
                  ...(data.itc_details.import_services
                    ? [{ label: '(A)(2) Import of services', data: data.itc_details.import_services }]
                    : []),
                  { label: '(A)(3) Inward supplies liable to reverse charge (other than 1 & 2)', data: data.itc_details.inward_reverse_charge },
                  { label: '(A)(5) All other ITC', data: data.itc_details.other_itc },
                  { label: '(B)(1) ITC reversed — Rule 38/42/43 & s.17(5) blocked credit', data: data.itc_details.itc_reversed },
                  { label: '(C) Net ITC Available (A) - (B)', data: data.itc_details.net_itc }
                ]}
              />
            </Section>
          )}

          {/* Tax Payment */}
          {data && (
            <Section title="5 - Tax Liability">
              <TaxTable 
                rows={[
                  { label: 'From outward and reverse charge inward supplies', data: data.tax_liability }
                ]}
              />
            </Section>
          )}
        </div>
      </div>
    
  );
}

function SummaryCard({ label, value, subtext, color }: { label: string, value: string | number, subtext: string, color: 'blue' | 'purple' | 'green' | 'orange' }) {
  const colorClasses = {
    blue: 'bg-slate-50 text-primary-700 border-primary-100',
    purple: 'bg-purple-50 text-purple-700 border-purple-100',
    green: 'bg-green-50 text-green-700 border-green-100',
    orange: 'bg-orange-50 text-orange-700 border-orange-100',
  };

  return (
    <div className={`p-4 rounded-xl border ${colorClasses[color]}`}>
      <p className="text-sm font-medium opacity-80 mb-1">{label}</p>
      <p className="text-2xl font-bold mb-1">{value}</p>
      <p className="text-xs opacity-70">{subtext}</p>
    </div>
  );
}

function Section({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
        <h3 className="font-semibold text-gray-900">{title}</h3>
      </div>
      <div className="p-6">
        {children}
      </div>
    </div>
  );
}

type TaxTableRow =
  | { label: string; data: { taxable_value: number; igst: number; cgst: number; sgst: number; cess: number } }
  | {
      label: string;
      pooledRcm: { total: number; note: string };
    };

function TaxTable({ rows }: { rows: TaxTableRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-gray-700">Description</th>
            <th className="px-4 py-3 text-right font-medium text-gray-700">Taxable Value</th>
            <th className="px-4 py-3 text-right font-medium text-gray-700">IGST</th>
            <th className="px-4 py-3 text-right font-medium text-gray-700">CGST</th>
            <th className="px-4 py-3 text-right font-medium text-gray-700">SGST</th>
            <th className="px-4 py-3 text-right font-medium text-gray-700">Cess</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, i) =>
            'pooledRcm' in row ? (
              <tr key={i} className="hover:bg-gray-50 bg-violet-50/40">
                <td className="px-4 py-3 text-gray-900">
                  <div>{row.label}</div>
                  <p className="text-sm font-semibold text-violet-950 mt-2">
                    RCM total: ₹{row.pooledRcm.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-violet-900 mt-1 max-w-xl">{row.pooledRcm.note}</p>
                </td>
                <td className="px-4 py-3 text-right text-gray-500">₹0.00</td>
                <td className="px-4 py-3 text-right text-violet-900 font-medium">—</td>
                <td className="px-4 py-3 text-right text-violet-900 font-medium">—</td>
                <td className="px-4 py-3 text-right text-violet-900 font-medium">—</td>
                <td className="px-4 py-3 text-right text-gray-500">—</td>
              </tr>
            ) : (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-900">{row.label}</td>
                <td className="px-4 py-3 text-right text-gray-700">
                  ₹{row.data.taxable_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-3 text-right text-gray-700">
                  ₹{row.data.igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-3 text-right text-gray-700">
                  ₹{row.data.cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-3 text-right text-gray-700">
                  ₹{row.data.sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-3 text-right text-gray-700">
                  ₹{row.data.cess.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}


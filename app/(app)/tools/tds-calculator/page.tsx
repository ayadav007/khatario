'use client';

export const dynamic = 'force-dynamic';

import React, { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Percent, FileText, Info, DollarSign } from 'lucide-react';

// Common TDS rates for India
const COMMON_TDS_RATES = [
  { section: '194A - Interest (Bank FD)', rate: 10, category: 'Interest' },
  { section: '194C - Contractors', rate: 2, category: 'Contract' },
  { section: '194D - Insurance Commission', rate: 5, category: 'Commission' },
  { section: '194H - Commission/Brokerage', rate: 5, category: 'Commission' },
  { section: '194I - Rent (Land/Building)', rate: 10, category: 'Rent' },
  { section: '194I - Rent (Plant/Machinery)', rate: 2, category: 'Rent' },
  { section: '194J - Professional Services', rate: 10, category: 'Professional' },
  { section: '194Q - Purchase of Goods', rate: 0.1, category: 'Purchase' },
  { section: '194S - Crypto/Virtual Assets', rate: 1, category: 'Other' },
  { section: '194TDS - E-commerce', rate: 1, category: 'E-commerce' },
  { section: 'Custom Rate', rate: 0, category: 'Custom' },
];

export default function TDSCalculatorPage() {
  const [amount, setAmount] = useState('');
  const [selectedRate, setSelectedRate] = useState(COMMON_TDS_RATES[0]);
  const [customRate, setCustomRate] = useState('');

  const paymentAmount = parseFloat(amount) || 0;
  const tdsRate = selectedRate.rate === 0 && customRate ? parseFloat(customRate) : selectedRate.rate;

  const tdsAmount = (paymentAmount * tdsRate) / 100;
  const netAmount = paymentAmount - tdsAmount;

  return (
    
      <div className="space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <FileText className="w-6 h-6 text-primary-500" />
            TDS Calculator
          </h1>
          <p className="text-text-secondary text-sm mt-1">
            Calculate TDS (Tax Deducted at Source) on payments
          </p>
        </div>

        {/* Main Card */}
        <Card padding="md" className="space-y-6">
          {/* Payment Amount */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Payment Amount
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-bold">₹</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="input pl-8 text-lg font-semibold"
                step="0.01"
                min="0"
              />
            </div>
          </div>

          {/* TDS Section Selection */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              TDS Section / Rate
            </label>
            <select
              value={COMMON_TDS_RATES.findIndex(r => r.section === selectedRate.section)}
              onChange={(e) => {
                const index = parseInt(e.target.value);
                setSelectedRate(COMMON_TDS_RATES[index]);
                setCustomRate('');
              }}
              className="input"
            >
              {COMMON_TDS_RATES.map((rate, index) => (
                <option key={index} value={index}>
                  {rate.section} {rate.rate > 0 ? `(${rate.rate}%)` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Custom Rate Input */}
          {selectedRate.rate === 0 && (
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Custom TDS Rate (%)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                  <Percent className="w-4 h-4" />
                </span>
                <input
                  type="number"
                  value={customRate}
                  onChange={(e) => setCustomRate(e.target.value)}
                  placeholder="0"
                  className="input pl-10"
                  step="0.01"
                  min="0"
                  max="100"
                />
              </div>
            </div>
          )}

          {/* Quick Rate Presets */}
          {selectedRate.rate === 0 && (
            <div className="bg-slate-50 p-3 rounded-lg border border-primary-100">
              <div className="text-xs font-bold text-primary-900 mb-2">Common TDS Rates</div>
              <div className="grid grid-cols-5 gap-2">
                {[0.1, 1, 2, 5, 10, 15, 20, 30].map((rate) => (
                  <button
                    key={rate}
                    onClick={() => setCustomRate(rate.toString())}
                    className="py-1.5 px-2 bg-white rounded text-xs font-medium text-primary-700 hover:bg-slate-100 border border-primary-200 transition-colors"
                  >
                    {rate}%
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Results */}
          {amount && paymentAmount > 0 && tdsRate > 0 && (
            <div className="pt-4 border-t border-border space-y-4">
              <div className="bg-slate-50 p-4 rounded-lg border-2 border-primary-200">
                <div className="text-xs text-primary-600 mb-1 font-medium">TDS Rate Applied</div>
                <div className="text-2xl font-bold text-primary-700">{tdsRate}%</div>
                {selectedRate.section !== 'Custom Rate' && (
                  <div className="text-xs text-primary-600 mt-1">{selectedRate.section}</div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Payment Amount */}
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="text-xs text-gray-500 mb-1">Gross Payment Amount</div>
                  <div className="text-2xl font-bold text-gray-900">₹ {paymentAmount.toFixed(2)}</div>
                </div>

                {/* TDS Amount */}
                <div className="bg-red-50 p-4 rounded-lg border-2 border-red-200">
                  <div className="text-xs text-red-600 mb-1 font-medium">TDS Deducted</div>
                  <div className="text-2xl font-bold text-red-700">₹ {tdsAmount.toFixed(2)}</div>
                </div>

                {/* Net Amount */}
                <div className="bg-success-50 p-4 rounded-lg border-2 border-success-200 md:col-span-2">
                  <div className="text-xs text-success-600 mb-1 font-medium">Net Amount Payable</div>
                  <div className="text-3xl font-black text-success-700">₹ {netAmount.toFixed(2)}</div>
                  <div className="text-xs text-success-600 mt-2">
                    Amount after TDS deduction
                  </div>
                </div>
              </div>

              {/* Formula Display */}
              <div className="bg-slate-50 p-3 rounded-lg border border-primary-200">
                <div className="text-xs text-primary-900 font-mono">
                  Net Amount = ₹{paymentAmount.toFixed(2)} - ₹{tdsAmount.toFixed(2)} (TDS @ {tdsRate}%) = ₹{netAmount.toFixed(2)}
                </div>
              </div>
            </div>
          )}

          {/* Clear Button */}
          {amount && (
            <Button
              variant="ghost"
              onClick={() => {
                setAmount('');
                setSelectedRate(COMMON_TDS_RATES[0]);
                setCustomRate('');
              }}
              className="w-full"
            >
              Clear All
            </Button>
          )}
        </Card>

        {/* Info Card */}
        <Card padding="md" className="bg-amber-50 border-amber-100">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-sm text-amber-900">
              <div className="font-bold mb-2">Important Notes about TDS:</div>
              <ul className="list-disc list-inside space-y-1 text-amber-800 text-xs">
                <li>TDS rates may vary based on PAN availability and recipient type</li>
                <li>Threshold limits apply - TDS is deducted only above certain amounts</li>
                <li>Lower TDS rates apply if valid PAN is not provided</li>
                <li>This calculator provides estimates - consult a CA for accurate calculations</li>
                <li>TDS must be deposited to the government within specified due dates</li>
              </ul>
            </div>
          </div>
        </Card>
      </div>
    
  );
}


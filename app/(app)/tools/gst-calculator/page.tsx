'use client';

export const dynamic = 'force-dynamic';

import React, { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Calculator, Percent, DollarSign, ArrowDown, ArrowUp, Info } from 'lucide-react';

export default function GSTCalculatorPage() {
  const [amount, setAmount] = useState('');
  const [gstRate, setGstRate] = useState('18');
  const [calculationType, setCalculationType] = useState<'exclusive' | 'inclusive'>('exclusive');
  
  // Calculate GST
  const baseAmount = parseFloat(amount) || 0;
  let gstAmount = 0;
  let totalAmount = 0;
  let exclusiveAmount = 0;
  
  const rate = parseFloat(gstRate) || 0;
  
  if (calculationType === 'exclusive') {
    // GST is added to base amount
    exclusiveAmount = baseAmount;
    gstAmount = (baseAmount * rate) / 100;
    totalAmount = baseAmount + gstAmount;
  } else {
    // GST is included in base amount
    totalAmount = baseAmount;
    exclusiveAmount = (baseAmount * 100) / (100 + rate);
    gstAmount = totalAmount - exclusiveAmount;
  }
  
  const cgst = gstAmount / 2;
  const sgst = gstAmount / 2;
  const igst = gstAmount;
  
  const commonRates = [0, 5, 12, 18, 28];

  return (
    
      <div className="space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Calculator className="w-6 h-6 text-primary-500" />
            GST Calculator
          </h1>
          <p className="text-text-secondary text-sm mt-1">
            Calculate GST (CGST, SGST, IGST) on any amount
          </p>
        </div>

        {/* Main Calculator Card */}
        <Card padding="md" className="space-y-6">
          {/* Calculation Type Toggle */}
          <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
            <button
              onClick={() => setCalculationType('exclusive')}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                calculationType === 'exclusive'
                  ? 'bg-white text-primary-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              GST Exclusive (Add GST)
            </button>
            <button
              onClick={() => setCalculationType('inclusive')}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                calculationType === 'inclusive'
                  ? 'bg-white text-primary-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              GST Inclusive (Remove GST)
            </button>
          </div>

          {/* Amount Input */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              {calculationType === 'exclusive' ? 'Base Amount (Excluding GST)' : 'Total Amount (Including GST)'}
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

          {/* GST Rate */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              GST Rate (%)
            </label>
            <div className="grid grid-cols-5 gap-2 mb-2">
              {commonRates.map((rate) => (
                <button
                  key={rate}
                  onClick={() => setGstRate(rate.toString())}
                  className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    gstRate === rate.toString()
                      ? 'bg-primary-500 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {rate}%
                </button>
              ))}
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                <Percent className="w-4 h-4" />
              </span>
              <input
                type="number"
                value={gstRate}
                onChange={(e) => setGstRate(e.target.value)}
                placeholder="18"
                className="input pl-10"
                step="0.01"
                min="0"
                max="100"
              />
            </div>
          </div>

          {/* Results */}
          {amount && baseAmount > 0 && (
            <div className="pt-4 border-t border-border space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Base Amount */}
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="text-xs text-gray-500 mb-1">Base Amount (Excl. GST)</div>
                  <div className="text-2xl font-bold text-gray-900">₹ {exclusiveAmount.toFixed(2)}</div>
                </div>

                {/* GST Amount */}
                <div className="bg-slate-50 p-4 rounded-lg border-2 border-primary-200">
                  <div className="text-xs text-primary-600 mb-1 font-medium">Total GST ({rate}%)</div>
                  <div className="text-2xl font-bold text-primary-700">₹ {gstAmount.toFixed(2)}</div>
                </div>

                {/* Total Amount */}
                <div className="bg-success-50 p-4 rounded-lg border-2 border-success-200 md:col-span-2">
                  <div className="text-xs text-success-600 mb-1 font-medium">Total Amount (Incl. GST)</div>
                  <div className="text-3xl font-black text-success-700">₹ {totalAmount.toFixed(2)}</div>
                </div>
              </div>

              {/* CGST/SGST/IGST Breakdown */}
              <div className="bg-slate-50 p-4 rounded-lg border border-primary-100">
                <div className="text-xs font-bold text-primary-900 mb-3 uppercase tracking-wider">Tax Breakdown</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="bg-white p-3 rounded-md">
                    <div className="text-xs text-gray-500 mb-1">CGST ({rate / 2}%)</div>
                    <div className="text-lg font-bold text-gray-900">₹ {cgst.toFixed(2)}</div>
                  </div>
                  <div className="bg-white p-3 rounded-md">
                    <div className="text-xs text-gray-500 mb-1">SGST ({rate / 2}%)</div>
                    <div className="text-lg font-bold text-gray-900">₹ {sgst.toFixed(2)}</div>
                  </div>
                  <div className="bg-white p-3 rounded-md">
                    <div className="text-xs text-gray-500 mb-1">IGST ({rate}%)</div>
                    <div className="text-lg font-bold text-gray-900">₹ {igst.toFixed(2)}</div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-primary-200">
                  <div className="flex items-start gap-2 text-xs text-primary-800">
                    <Info className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>
                      <strong>Note:</strong> Use CGST + SGST for intra-state transactions, IGST for inter-state transactions.
                    </div>
                  </div>
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
                setGstRate('18');
              }}
              className="w-full"
            >
              Clear All
            </Button>
          )}
        </Card>

        {/* Info Card */}
        <Card padding="md" className="bg-slate-50 border-primary-100">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-primary-600 mt-0.5 shrink-0" />
            <div className="text-sm text-primary-900">
              <div className="font-bold mb-1">How to Use:</div>
              <ul className="list-disc list-inside space-y-1 text-primary-800">
                <li><strong>GST Exclusive:</strong> Enter base amount, GST will be added</li>
                <li><strong>GST Inclusive:</strong> Enter total amount, GST will be extracted</li>
                <li><strong>CGST + SGST:</strong> For same state transactions (e.g., within Maharashtra)</li>
                <li><strong>IGST:</strong> For different state transactions (e.g., Maharashtra to Karnataka)</li>
              </ul>
            </div>
          </div>
        </Card>
      </div>
    
  );
}


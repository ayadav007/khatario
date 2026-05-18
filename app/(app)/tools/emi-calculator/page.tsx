'use client';

export const dynamic = 'force-dynamic';

import React, { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { DollarSign, Percent, Calendar, TrendingUp, Info, ArrowDown } from 'lucide-react';

export default function EMICalculatorPage() {
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState('');
  const [tenure, setTenure] = useState(12);
  const [tenureType, setTenureType] = useState<'months' | 'years'>('months');

  const principalAmount = parseFloat(principal) || 0;
  const annualRate = parseFloat(rate) || 0;
  
  // Convert tenure to months
  const tenureMonths = tenureType === 'years' ? tenure * 12 : tenure;
  
  // Monthly interest rate
  const monthlyRate = annualRate / 12 / 100;
  
  let emi = 0;
  let totalAmount = 0;
  let totalInterest = 0;
  let breakdown: Array<{ month: number; principal: number; interest: number; balance: number }> = [];

  if (principalAmount > 0 && annualRate > 0 && tenureMonths > 0) {
    // EMI Formula: [P x R x (1+R)^N] / [(1+R)^N - 1]
    // Where P = Principal, R = Monthly Rate, N = Number of months
    if (monthlyRate > 0) {
      const emiNumerator = principalAmount * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths);
      const emiDenominator = Math.pow(1 + monthlyRate, tenureMonths) - 1;
      emi = emiNumerator / emiDenominator;
      
      totalAmount = emi * tenureMonths;
      totalInterest = totalAmount - principalAmount;
      
      // Generate breakdown for first 12 months or all if less
      let balance = principalAmount;
      const monthsToShow = Math.min(12, tenureMonths);
      for (let month = 1; month <= monthsToShow; month++) {
        const interestComponent = balance * monthlyRate;
        const principalComponent = emi - interestComponent;
        balance = balance - principalComponent;
        
        breakdown.push({
          month,
          principal: principalComponent,
          interest: interestComponent,
          balance: Math.max(0, balance)
        });
      }
    } else {
      // If rate is 0, EMI is just principal divided by months
      emi = principalAmount / tenureMonths;
      totalAmount = principalAmount;
      totalInterest = 0;
    }
  }

  return (
    
      <div className="space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Calendar className="w-6 h-6 text-primary-500" />
            EMI Calculator
          </h1>
          <p className="text-text-secondary text-sm mt-1">
            Calculate Equated Monthly Installment (EMI) for loans
          </p>
        </div>

        {/* Main Card */}
        <Card padding="md" className="space-y-6">
          {/* Principal Amount */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Loan Amount (Principal)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-bold">₹</span>
              <input
                type="number"
                value={principal}
                onChange={(e) => setPrincipal(e.target.value)}
                placeholder="0.00"
                className="input pl-8 text-lg font-semibold"
                step="0.01"
                min="0"
              />
            </div>
          </div>

          {/* Interest Rate */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Annual Interest Rate (%)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                <Percent className="w-4 h-4" />
              </span>
              <input
                type="number"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="12"
                className="input pl-10"
                step="0.01"
                min="0"
                max="100"
              />
            </div>
          </div>

          {/* Tenure Type Toggle */}
          <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
            <button
              onClick={() => {
                setTenureType('months');
                if (tenure > 300) setTenure(300);
              }}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                tenureType === 'months'
                  ? 'bg-white text-primary-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Months
            </button>
            <button
              onClick={() => {
                setTenureType('years');
                if (tenure > 25) setTenure(25);
              }}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                tenureType === 'years'
                  ? 'bg-white text-primary-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Years
            </button>
          </div>

          {/* Tenure Slider */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-text-secondary">
                Loan Tenure ({tenureType === 'years' ? 'Years' : 'Months'})
              </label>
              <span className="text-lg font-bold text-primary-600">
                {tenure} {tenureType === 'years' ? (tenure === 1 ? 'Year' : 'Years') : (tenure === 1 ? 'Month' : 'Months')}
              </span>
            </div>
            <div className="space-y-3">
              <input
                type="range"
                min="1"
                max={tenureType === 'years' ? 25 : 300}
                step="1"
                value={tenure}
                onChange={(e) => setTenure(parseInt(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary-500"
              />
              <div className="relative">
                <input
                  type="number"
                  value={tenure}
                  onChange={(e) => {
                    const value = parseInt(e.target.value);
                    const max = tenureType === 'years' ? 25 : 300;
                    if (value >= 1 && value <= max) {
                      setTenure(value);
                    }
                  }}
                  className="input text-center font-semibold"
                  step="1"
                  min="1"
                  max={tenureType === 'years' ? 25 : 300}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{tenureType}</span>
              </div>
            </div>
          </div>

          {/* Results */}
          {principal && principalAmount > 0 && rate && annualRate > 0 && tenure > 0 && (
            <div className="pt-4 border-t border-border space-y-4">
              {/* EMI Amount */}
              <div className="bg-slate-50 p-6 rounded-lg border-2 border-primary-200">
                <div className="text-xs text-primary-600 mb-2 font-medium uppercase tracking-wider">Monthly EMI</div>
                <div className="text-4xl font-black text-primary-700">₹ {emi.toFixed(2)}</div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Principal */}
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="text-xs text-gray-500 mb-1">Principal Amount</div>
                  <div className="text-xl font-bold text-gray-900">₹ {principalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>

                {/* Total Interest */}
                <div className="bg-red-50 p-4 rounded-lg border-2 border-red-200">
                  <div className="text-xs text-red-600 mb-1 font-medium">Total Interest</div>
                  <div className="text-xl font-bold text-red-700">₹ {totalInterest.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>

                {/* Total Amount */}
                <div className="bg-success-50 p-4 rounded-lg border-2 border-success-200">
                  <div className="text-xs text-success-600 mb-1 font-medium">Total Amount</div>
                  <div className="text-xl font-bold text-success-700">₹ {totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
              </div>

              {/* Breakdown Table */}
              {breakdown.length > 0 && (
                <div className="bg-white border border-border rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-4 py-3 border-b border-border">
                    <div className="text-sm font-bold text-gray-900">Payment Breakdown (First {breakdown.length} {breakdown.length === 1 ? 'Month' : 'Months'})</div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Month</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Principal</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Interest</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Balance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {breakdown.map((row) => (
                          <tr key={row.month} className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-sm font-medium text-gray-900">{row.month}</td>
                            <td className="px-4 py-2 text-sm text-right text-gray-900">₹ {row.principal.toFixed(2)}</td>
                            <td className="px-4 py-2 text-sm text-right text-gray-600">₹ {row.interest.toFixed(2)}</td>
                            <td className="px-4 py-2 text-sm text-right font-medium text-gray-900">₹ {row.balance.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Clear Button */}
          {principal && (
            <Button
              variant="ghost"
              onClick={() => {
                setPrincipal('');
                setRate('');
                setTenure(12);
                setTenureType('months');
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
              <div className="font-bold mb-2">About EMI:</div>
              <ul className="list-disc list-inside space-y-1 text-primary-800 text-xs">
                <li>EMI = [P × R × (1+R)^N] / [(1+R)^N - 1]</li>
                <li>Where P = Principal, R = Monthly Rate, N = Number of months</li>
                <li>Each EMI payment includes both principal and interest components</li>
                <li>In early months, interest component is higher; it decreases over time</li>
                <li>Total amount paid = EMI × Number of months</li>
              </ul>
            </div>
          </div>
        </Card>
      </div>
    
  );
}


'use client';

export const dynamic = 'force-dynamic';

import React, { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Percent, TrendingUp, Info } from 'lucide-react';

export default function InterestCalculatorPage() {
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState('');
  const [years, setYears] = useState(1);
  const [calculationType, setCalculationType] = useState<'simple' | 'compound'>('simple');
  
  const principalAmount = parseFloat(principal) || 0;
  const interestRate = parseFloat(rate) || 0;
  
  let interestAmount = 0;
  let totalAmount = 0;
  
  if (principalAmount > 0 && interestRate > 0 && years > 0) {
    if (calculationType === 'simple') {
      // Simple Interest: P * R * T / 100
      interestAmount = (principalAmount * interestRate * years) / 100;
      totalAmount = principalAmount + interestAmount;
    } else {
      // Compound Interest: P * (1 + R/100)^T - P
      totalAmount = principalAmount * Math.pow(1 + (interestRate / 100), years);
      interestAmount = totalAmount - principalAmount;
    }
  }

  return (
    
      <div className="space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-primary-500" />
            Interest Calculator
          </h1>
          <p className="text-text-secondary text-sm mt-1">
            Calculate interest on overdue invoices, loans, or any amount
          </p>
        </div>

        {/* Main Card */}
        <Card padding="md" className="space-y-6">
          {/* Principal Amount */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Principal Amount
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

          {/* Calculation Type Toggle */}
          <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
            <button
              onClick={() => setCalculationType('simple')}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                calculationType === 'simple'
                  ? 'bg-white text-primary-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Simple Interest
            </button>
            <button
              onClick={() => setCalculationType('compound')}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                calculationType === 'compound'
                  ? 'bg-white text-primary-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Compound Interest
            </button>
          </div>

          {/* Number of Years */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-text-secondary">
                Number of Years
              </label>
              <span className="text-lg font-bold text-primary-600">{years} {years === 1 ? 'Year' : 'Years'}</span>
            </div>
            <div className="space-y-3">
              <input
                type="range"
                min="0.1"
                max="30"
                step="0.1"
                value={years}
                onChange={(e) => setYears(parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary-500"
              />
              <div className="flex items-center justify-between text-xs text-gray-500 px-1">
                <span>0.1</span>
                <span>5</span>
                <span>10</span>
                <span>15</span>
                <span>20</span>
                <span>25</span>
                <span>30</span>
              </div>
              <div className="relative">
                <input
                  type="number"
                  value={years}
                  onChange={(e) => {
                    const value = parseFloat(e.target.value);
                    if (value >= 0.1 && value <= 30) {
                      setYears(value);
                    }
                  }}
                  className="input text-center font-semibold"
                  step="0.1"
                  min="0.1"
                  max="30"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">years</span>
              </div>
            </div>
          </div>

          {/* Results */}
          {principal && principalAmount > 0 && rate && interestRate > 0 && years > 0 && (
            <div className="pt-4 border-t border-border space-y-4">
              <div className="bg-slate-50 p-3 rounded-lg border border-primary-200">
                <div className="text-xs text-primary-600 mb-1 font-medium">Calculation Period</div>
                <div className="text-lg font-bold text-primary-900">
                  {years.toFixed(1)} {years === 1 ? 'Year' : 'Years'}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Principal */}
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="text-xs text-gray-500 mb-1">Principal Amount</div>
                  <div className="text-2xl font-bold text-gray-900">₹ {principalAmount.toFixed(2)}</div>
                </div>

                {/* Interest Amount */}
                <div className="bg-slate-50 p-4 rounded-lg border-2 border-primary-200">
                  <div className="text-xs text-primary-600 mb-1 font-medium">Interest Amount</div>
                  <div className="text-2xl font-bold text-primary-700">₹ {interestAmount.toFixed(2)}</div>
                </div>

                {/* Total Amount */}
                <div className="bg-success-50 p-4 rounded-lg border-2 border-success-200 md:col-span-2">
                  <div className="text-xs text-success-600 mb-1 font-medium">Total Amount (Principal + Interest)</div>
                  <div className="text-3xl font-black text-success-700">₹ {totalAmount.toFixed(2)}</div>
                </div>
              </div>
            </div>
          )}

          {/* Clear Button */}
          {principal && (
            <Button
              variant="ghost"
              onClick={() => {
                setPrincipal('');
                setRate('');
                setYears(1);
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
              <div className="font-bold mb-1">About Interest Types:</div>
              <ul className="list-disc list-inside space-y-1 text-primary-800 text-xs">
                <li><strong>Simple Interest:</strong> Interest calculated only on principal amount</li>
                <li><strong>Compound Interest:</strong> Interest calculated on principal + accumulated interest</li>
                <li>Calculations assume annual compounding for compound interest</li>
                <li>Use the slider or input field to adjust the number of years</li>
              </ul>
            </div>
          </div>
        </Card>
      </div>
    
  );
}


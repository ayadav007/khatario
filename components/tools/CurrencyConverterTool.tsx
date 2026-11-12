'use client';

import React, { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ArrowLeftRight, Info } from 'lucide-react';
import {
  exchangeRate as rateFor,
  RUPEES_PER_UNIT,
  CURRENCY_RATES_AS_OF,
  formatRatesDate,
} from '@/lib/tools/currency-converter';

const ALL_CURRENCIES = [
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
];

/** Only currencies that have a reference rate in the table. */
const CURRENCIES = ALL_CURRENCIES.filter((c) => c.code in RUPEES_PER_UNIT);

const RATES_DATE_TEXT = formatRatesDate(CURRENCY_RATES_AS_OF);

export function CurrencyConverterTool() {
  const [amount, setAmount] = useState('');
  const [fromCurrency, setFromCurrency] = useState('INR');
  const [toCurrency, setToCurrency] = useState('USD');

  const fromCurr = CURRENCIES.find(c => c.code === fromCurrency);
  const toCurr = CURRENCIES.find(c => c.code === toCurrency);

  // Worked out from the reference rate table on every change.
  const exchangeRate = rateFor(fromCurrency, toCurrency);

  const inputAmount = parseFloat(amount) || 0;
  const convertedAmount = exchangeRate ? inputAmount * exchangeRate : 0;

  const swapCurrencies = () => {
    const temp = fromCurrency;
    setFromCurrency(toCurrency);
    setToCurrency(temp);
  };

  return (
    <div className="space-y-6">
      {/* Main Card */}
      <Card padding="md" className="space-y-6">
        {/* From Currency */}
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">
            From
          </label>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-bold">
                  {fromCurr?.symbol || '₹'}
                </span>
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
            <div>
              <select
                value={fromCurrency}
                onChange={(e) => setFromCurrency(e.target.value)}
                className="input h-full font-medium"
              >
                {CURRENCIES.map((curr) => (
                  <option key={curr.code} value={curr.code}>
                    {curr.code}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="text-xs text-gray-500 mt-1">{fromCurr?.name}</div>
        </div>

        {/* Swap Button */}
        <div className="flex justify-center">
          <button
            onClick={swapCurrencies}
            className="p-2 bg-slate-100 text-primary-600 rounded-full hover:bg-primary-200 transition-colors"
            title="Swap currencies"
          >
            <ArrowLeftRight className="w-5 h-5" />
          </button>
        </div>

        {/* To Currency */}
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">
            To
          </label>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-bold">
                  {toCurr?.symbol || '$'}
                </span>
                <input
                  type="number"
                  value={convertedAmount > 0 ? convertedAmount.toFixed(2) : ''}
                  readOnly
                  className="input pl-8 text-lg font-semibold bg-gray-50"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div>
              <select
                value={toCurrency}
                onChange={(e) => setToCurrency(e.target.value)}
                className="input h-full font-medium"
              >
                {CURRENCIES.map((curr) => (
                  <option key={curr.code} value={curr.code}>
                    {curr.code}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="text-xs text-gray-500 mt-1">{toCurr?.name}</div>
        </div>

        {/* Exchange Rate Display */}
        <div className="bg-slate-50 p-4 rounded-lg border border-primary-200">
          <div className="text-xs text-primary-600 mb-1 font-medium">Exchange Rate</div>
          <div className="text-lg font-bold text-primary-900">
            1 {fromCurrency} = {exchangeRate.toFixed(4)} {toCurrency}
          </div>
          <div className="text-xs text-primary-600 mt-2">
            Reference rates as of {RATES_DATE_TEXT}. Banks and money changers charge a different rate.
          </div>
        </div>

        {/* Clear Button */}
        {amount && (
          <Button
            variant="ghost"
            onClick={() => setAmount('')}
            className="w-full"
          >
            Clear
          </Button>
        )}
      </Card>

      {/* Info Card */}
      <Card padding="md" className="bg-amber-50 border-amber-100">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-sm text-amber-900">
            <div className="font-bold mb-2">Exchange Rate Information:</div>
            <ul className="list-disc list-inside space-y-1 text-amber-800 text-xs">
              <li>Rates are the Reserve Bank of India reference rates (published by FBIL) as of {RATES_DATE_TEXT}. They do not update by themselves.</li>
              <li>Banks and money changers charge a different rate, and may add fees.</li>
              <li>Check with your bank before you quote a price or send money.</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}

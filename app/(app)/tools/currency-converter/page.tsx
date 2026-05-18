'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { RefreshCw, ArrowLeftRight, DollarSign, Info, Loader2 } from 'lucide-react';

const CURRENCIES = [
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
];

// Fallback exchange rates (approximate, as of common rates)
const FALLBACK_RATES: Record<string, number> = {
  USD: 83.0,
  EUR: 90.0,
  GBP: 105.0,
  AED: 22.6,
  SAR: 22.1,
  JPY: 0.56,
  CNY: 11.5,
  AUD: 54.0,
  CAD: 61.0,
  SGD: 61.5,
  CHF: 92.0,
};

export default function CurrencyConverterPage() {
  const [amount, setAmount] = useState('');
  const [fromCurrency, setFromCurrency] = useState('INR');
  const [toCurrency, setToCurrency] = useState('USD');
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fromCurr = CURRENCIES.find(c => c.code === fromCurrency);
  const toCurr = CURRENCIES.find(c => c.code === toCurrency);

  // Fetch exchange rate
  const fetchExchangeRate = async () => {
    if (fromCurrency === toCurrency) {
      setExchangeRate(1);
      return;
    }

    setLoading(true);
    try {
      // Try to fetch from a free API (you can use exchangerate-api.com or similar)
      // For now, using fallback rates
      if (fromCurrency === 'INR' && FALLBACK_RATES[toCurrency]) {
        setExchangeRate(FALLBACK_RATES[toCurrency]);
      } else if (toCurrency === 'INR' && FALLBACK_RATES[fromCurrency]) {
        setExchangeRate(1 / FALLBACK_RATES[fromCurrency]);
      } else {
        // For other currency pairs, use approximate conversion via USD
        const fromToUSD = fromCurrency === 'USD' ? 1 : (FALLBACK_RATES[fromCurrency] ? 1 / FALLBACK_RATES[fromCurrency] : 1);
        const usdToTo = toCurrency === 'USD' ? 1 : (FALLBACK_RATES[toCurrency] || 1);
        setExchangeRate(fromToUSD * usdToTo);
      }
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Error fetching exchange rate:', error);
      // Use fallback rates
      if (fromCurrency === 'INR' && FALLBACK_RATES[toCurrency]) {
        setExchangeRate(FALLBACK_RATES[toCurrency]);
      } else if (toCurrency === 'INR' && FALLBACK_RATES[fromCurrency]) {
        setExchangeRate(1 / FALLBACK_RATES[fromCurrency]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExchangeRate();
  }, [fromCurrency, toCurrency]);

  const inputAmount = parseFloat(amount) || 0;
  const convertedAmount = exchangeRate ? inputAmount * exchangeRate : 0;

  const swapCurrencies = () => {
    const temp = fromCurrency;
    setFromCurrency(toCurrency);
    setToCurrency(temp);
  };

  return (
    
      <div className="space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
              <RefreshCw className="w-6 h-6 text-primary-500" />
              Currency Converter
            </h1>
            <p className="text-text-secondary text-sm mt-1">
              Convert between Indian Rupee and other currencies
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchExchangeRate}
            disabled={loading}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

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
          {exchangeRate && (
            <div className="bg-slate-50 p-4 rounded-lg border border-primary-200">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-primary-600 mb-1 font-medium">Exchange Rate</div>
                  <div className="text-lg font-bold text-primary-900">
                    1 {fromCurrency} = {exchangeRate.toFixed(4)} {toCurrency}
                  </div>
                </div>
                {loading && <Loader2 className="w-5 h-5 animate-spin text-primary-600" />}
              </div>
              {lastUpdated && (
                <div className="text-xs text-primary-600 mt-2">
                  Last updated: {lastUpdated.toLocaleTimeString()}
                </div>
              )}
            </div>
          )}

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
                <li>Exchange rates are approximate and may not reflect real-time market rates</li>
                <li>Actual rates may vary based on bank charges, transfer fees, and market conditions</li>
                <li>For accurate rates, check with your bank or financial institution</li>
                <li>Rates shown are indicative and for reference purposes only</li>
              </ul>
            </div>
          </div>
        </Card>
      </div>
    
  );
}


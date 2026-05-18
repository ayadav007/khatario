'use client';

export const dynamic = 'force-dynamic';

import React, { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { DollarSign, Percent, TrendingUp, Info, ArrowUp, ArrowDown } from 'lucide-react';

export default function PriceMarginCalculatorPage() {
  const [calculationMode, setCalculationMode] = useState<'cost-to-price' | 'price-to-cost' | 'margin'>('cost-to-price');
  const [costPrice, setCostPrice] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [margin, setMargin] = useState('');
  const [markup, setMarkup] = useState('');

  const cost = parseFloat(costPrice) || 0;
  const selling = parseFloat(sellingPrice) || 0;
  const marginPercent = parseFloat(margin) || 0;
  const markupPercent = parseFloat(markup) || 0;

  let calculatedSelling = 0;
  let calculatedCost = 0;
  let calculatedMargin = 0;
  let calculatedMarkup = 0;
  let profit = 0;

  // Calculate based on mode
  if (calculationMode === 'cost-to-price') {
    // Given: Cost Price and Margin/Markup
    if (cost > 0) {
      if (marginPercent > 0) {
        // Margin = (Selling - Cost) / Selling * 100
        // Selling = Cost / (1 - Margin/100)
        calculatedSelling = cost / (1 - marginPercent / 100);
        calculatedMargin = marginPercent;
        profit = calculatedSelling - cost;
        calculatedMarkup = (profit / cost) * 100;
      } else if (markupPercent > 0) {
        // Markup = (Selling - Cost) / Cost * 100
        // Selling = Cost * (1 + Markup/100)
        calculatedSelling = cost * (1 + markupPercent / 100);
        calculatedMarkup = markupPercent;
        profit = calculatedSelling - cost;
        calculatedMargin = (profit / calculatedSelling) * 100;
      }
    }
  } else if (calculationMode === 'price-to-cost') {
    // Given: Selling Price and Margin/Markup
    if (selling > 0) {
      if (marginPercent > 0) {
        // Cost = Selling * (1 - Margin/100)
        calculatedCost = selling * (1 - marginPercent / 100);
        calculatedMargin = marginPercent;
        profit = selling - calculatedCost;
        calculatedMarkup = (profit / calculatedCost) * 100;
      } else if (markupPercent > 0) {
        // Cost = Selling / (1 + Markup/100)
        calculatedCost = selling / (1 + markupPercent / 100);
        calculatedMarkup = markupPercent;
        profit = selling - calculatedCost;
        calculatedMargin = (profit / selling) * 100;
      }
    }
  } else {
    // Given: Cost Price and Selling Price, calculate margin and markup
    if (cost > 0 && selling > 0) {
      profit = selling - cost;
      calculatedMargin = (profit / selling) * 100;
      calculatedMarkup = (profit / cost) * 100;
    }
  }

  return (
    
      <div className="space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-primary-500" />
            Price & Margin Calculator
          </h1>
          <p className="text-text-secondary text-sm mt-1">
            Calculate profit margins, markup, selling price, and cost price
          </p>
        </div>

        {/* Main Card */}
        <Card padding="md" className="space-y-6">
          {/* Calculation Mode Toggle */}
          <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
            <button
              onClick={() => {
                setCalculationMode('cost-to-price');
                setSellingPrice('');
                setMargin('');
                setMarkup('');
              }}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                calculationMode === 'cost-to-price'
                  ? 'bg-white text-primary-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Cost → Price
            </button>
            <button
              onClick={() => {
                setCalculationMode('price-to-cost');
                setCostPrice('');
                setMargin('');
                setMarkup('');
              }}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                calculationMode === 'price-to-cost'
                  ? 'bg-white text-primary-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Price → Cost
            </button>
            <button
              onClick={() => {
                setCalculationMode('margin');
                setMargin('');
                setMarkup('');
              }}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                calculationMode === 'margin'
                  ? 'bg-white text-primary-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Calculate Margin
            </button>
          </div>

          {/* Inputs based on mode */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Cost Price */}
            {(calculationMode === 'cost-to-price' || calculationMode === 'margin') && (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Cost Price
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-bold">₹</span>
                  <input
                    type="number"
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                    placeholder="0.00"
                    className="input pl-8"
                    step="0.01"
                    min="0"
                  />
                </div>
              </div>
            )}

            {/* Selling Price */}
            {(calculationMode === 'price-to-cost' || calculationMode === 'margin') && (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Selling Price
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-bold">₹</span>
                  <input
                    type="number"
                    value={sellingPrice}
                    onChange={(e) => setSellingPrice(e.target.value)}
                    placeholder="0.00"
                    className="input pl-8"
                    step="0.01"
                    min="0"
                  />
                </div>
              </div>
            )}

            {/* Margin or Markup Input */}
            {calculationMode !== 'margin' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Margin (%)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                      <Percent className="w-4 h-4" />
                    </span>
                    <input
                      type="number"
                      value={margin}
                      onChange={(e) => {
                        setMargin(e.target.value);
                        setMarkup('');
                      }}
                      placeholder="0"
                      className="input pl-10"
                      step="0.01"
                      min="0"
                      max="100"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Markup (%)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                      <Percent className="w-4 h-4" />
                    </span>
                    <input
                      type="number"
                      value={markup}
                      onChange={(e) => {
                        setMarkup(e.target.value);
                        setMargin('');
                      }}
                      placeholder="0"
                      className="input pl-10"
                      step="0.01"
                      min="0"
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Quick Margin Presets */}
          {calculationMode !== 'margin' && cost > 0 && (
            <div className="bg-slate-50 p-3 rounded-lg border border-primary-100">
              <div className="text-xs font-bold text-primary-900 mb-2">Quick Margin Presets</div>
              <div className="grid grid-cols-5 gap-2">
                {[10, 15, 20, 25, 30, 35, 40, 50, 60, 75].map((percent) => (
                  <button
                    key={percent}
                    onClick={() => {
                      setMargin(percent.toString());
                      setMarkup('');
                    }}
                    className="py-1.5 px-2 bg-white rounded text-xs font-medium text-primary-700 hover:bg-slate-100 border border-primary-200 transition-colors"
                  >
                    {percent}%
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Results */}
          {((calculationMode === 'cost-to-price' && cost > 0 && (marginPercent > 0 || markupPercent > 0)) ||
            (calculationMode === 'price-to-cost' && selling > 0 && (marginPercent > 0 || markupPercent > 0)) ||
            (calculationMode === 'margin' && cost > 0 && selling > 0)) && (
            <div className="pt-4 border-t border-border space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Cost Price */}
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="text-xs text-gray-500 mb-1">Cost Price</div>
                  <div className="text-2xl font-bold text-gray-900">
                    ₹ {(calculationMode === 'price-to-cost' ? calculatedCost : cost).toFixed(2)}
                  </div>
                </div>

                {/* Selling Price */}
                <div className="bg-success-50 p-4 rounded-lg border-2 border-success-200">
                  <div className="text-xs text-success-600 mb-1 font-medium">Selling Price</div>
                  <div className="text-2xl font-bold text-success-700">
                    ₹ {(calculationMode === 'cost-to-price' ? calculatedSelling : selling).toFixed(2)}
                  </div>
                </div>

                {/* Profit */}
                <div className="bg-slate-50 p-4 rounded-lg border-2 border-primary-200">
                  <div className="text-xs text-primary-600 mb-1 font-medium flex items-center gap-1">
                    <ArrowUp className="w-3 h-3" />
                    Profit
                  </div>
                  <div className="text-2xl font-bold text-primary-700">
                    ₹ {profit.toFixed(2)}
                  </div>
                </div>

                {/* Margin */}
                <div className="bg-slate-50 p-4 rounded-lg border-2 border-primary-200">
                  <div className="text-xs text-primary-600 mb-1 font-medium">Margin</div>
                  <div className="text-2xl font-bold text-primary-700">
                    {calculatedMargin.toFixed(2)}%
                  </div>
                  <div className="text-xs text-primary-600 mt-1">
                    (Profit / Selling Price)
                  </div>
                </div>
              </div>

              {/* Markup */}
              <div className="bg-amber-50 p-4 rounded-lg border-2 border-amber-200">
                <div className="text-xs text-amber-600 mb-1 font-medium">Markup</div>
                <div className="text-2xl font-bold text-amber-700">
                  {calculatedMarkup.toFixed(2)}%
                </div>
                <div className="text-xs text-amber-600 mt-1">
                  (Profit / Cost Price)
                </div>
              </div>
            </div>
          )}

          {/* Clear Button */}
          {(costPrice || sellingPrice || margin || markup) && (
            <Button
              variant="ghost"
              onClick={() => {
                setCostPrice('');
                setSellingPrice('');
                setMargin('');
                setMarkup('');
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
              <div className="font-bold mb-2">Difference between Margin and Markup:</div>
              <div className="space-y-2 text-primary-800 text-xs">
                <div>
                  <strong>Margin:</strong> Profit as a percentage of <em>selling price</em>
                  <br />
                  Formula: (Selling Price - Cost Price) / Selling Price × 100
                </div>
                <div>
                  <strong>Markup:</strong> Profit as a percentage of <em>cost price</em>
                  <br />
                  Formula: (Selling Price - Cost Price) / Cost Price × 100
                </div>
                <div className="pt-2 border-t border-primary-200">
                  <strong>Example:</strong> Cost ₹100, Selling ₹150
                  <br />
                  Margin = (150-100)/150 = 33.33% | Markup = (150-100)/100 = 50%
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    
  );
}


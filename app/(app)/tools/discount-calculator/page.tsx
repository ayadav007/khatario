'use client';

export const dynamic = 'force-dynamic';

import React, { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Percent, Tag, DollarSign, TrendingDown } from 'lucide-react';

export default function DiscountCalculatorPage() {
  const [originalPrice, setOriginalPrice] = useState('');
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('percentage');
  const [discountValue, setDiscountValue] = useState('');
  
  const price = parseFloat(originalPrice) || 0;
  const discount = parseFloat(discountValue) || 0;
  
  let discountAmount = 0;
  let finalPrice = 0;
  
  if (discountType === 'percentage') {
    discountAmount = (price * discount) / 100;
    finalPrice = price - discountAmount;
  } else {
    discountAmount = discount;
    finalPrice = price - discountAmount;
  }
  
  const savingsPercentage = price > 0 ? ((discountAmount / price) * 100).toFixed(2) : '0.00';

  return (
    
      <div className="space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Tag className="w-6 h-6 text-primary-500" />
            Discount Calculator
          </h1>
          <p className="text-text-secondary text-sm mt-1">
            Calculate discounts and final prices for your products
          </p>
        </div>

        {/* Main Card */}
        <Card padding="md" className="space-y-6">
          {/* Original Price */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Original Price
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-bold">₹</span>
              <input
                type="number"
                value={originalPrice}
                onChange={(e) => setOriginalPrice(e.target.value)}
                placeholder="0.00"
                className="input pl-8 text-lg font-semibold"
                step="0.01"
                min="0"
              />
            </div>
          </div>

          {/* Discount Type Toggle */}
          <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
            <button
              onClick={() => setDiscountType('percentage')}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                discountType === 'percentage'
                  ? 'bg-white text-primary-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Percentage (%)
            </button>
            <button
              onClick={() => setDiscountType('fixed')}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                discountType === 'fixed'
                  ? 'bg-white text-primary-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Fixed Amount (₹)
            </button>
          </div>

          {/* Discount Value */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              {discountType === 'percentage' ? 'Discount Percentage' : 'Discount Amount'}
            </label>
            <div className="relative">
              {discountType === 'percentage' ? (
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                  <Percent className="w-4 h-4" />
                </span>
              ) : (
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-bold">₹</span>
              )}
              <input
                type="number"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                placeholder={discountType === 'percentage' ? "0" : "0.00"}
                className={`input ${discountType === 'percentage' ? 'pl-10' : 'pl-8'} text-lg font-semibold`}
                step={discountType === 'percentage' ? "1" : "0.01"}
                min="0"
                max={discountType === 'percentage' ? "100" : undefined}
              />
            </div>
          </div>

          {/* Results */}
          {originalPrice && price > 0 && discountValue && (
            <div className="pt-4 border-t border-border space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Original Price */}
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="text-xs text-gray-500 mb-1">Original Price</div>
                  <div className="text-2xl font-bold text-gray-900">₹ {price.toFixed(2)}</div>
                </div>

                {/* Discount Amount */}
                <div className="bg-red-50 p-4 rounded-lg border-2 border-red-200">
                  <div className="text-xs text-red-600 mb-1 font-medium flex items-center gap-1">
                    <TrendingDown className="w-3 h-3" />
                    Discount Amount
                  </div>
                  <div className="text-2xl font-bold text-red-700">₹ {discountAmount.toFixed(2)}</div>
                  {discountType === 'fixed' && (
                    <div className="text-xs text-red-600 mt-1">
                      ({savingsPercentage}% off)
                    </div>
                  )}
                </div>

                {/* Final Price */}
                <div className="bg-success-50 p-4 rounded-lg border-2 border-success-200 md:col-span-2">
                  <div className="text-xs text-success-600 mb-1 font-medium">Final Price (After Discount)</div>
                  <div className="text-3xl font-black text-success-700">₹ {finalPrice.toFixed(2)}</div>
                  {discountType === 'percentage' && discount > 0 && (
                    <div className="text-sm text-success-600 mt-2">
                      You save ₹{discountAmount.toFixed(2)} ({discount}% off)
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Clear Button */}
          {originalPrice && (
            <Button
              variant="ghost"
              onClick={() => {
                setOriginalPrice('');
                setDiscountValue('');
              }}
              className="w-full"
            >
              Clear All
            </Button>
          )}
        </Card>

        {/* Quick Discount Presets */}
        {originalPrice && price > 0 && (
          <Card padding="md" className="bg-slate-50 border-primary-100">
            <div className="text-sm font-bold text-primary-900 mb-3">Quick Discount Presets</div>
            <div className="grid grid-cols-4 gap-2">
              {[5, 10, 15, 20, 25, 30, 40, 50].map((percent) => (
                <button
                  key={percent}
                  onClick={() => {
                    setDiscountType('percentage');
                    setDiscountValue(percent.toString());
                  }}
                  className="py-2 px-3 bg-white rounded-lg text-sm font-medium text-primary-700 hover:bg-slate-100 border border-primary-200 transition-colors"
                >
                  {percent}%
                </button>
              ))}
            </div>
          </Card>
        )}
      </div>
    
  );
}


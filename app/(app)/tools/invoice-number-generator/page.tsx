'use client';

export const dynamic = 'force-dynamic';

import React, { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { FileText, Copy, Check, RefreshCw, Info } from 'lucide-react';

export default function InvoiceNumberGeneratorPage() {
  const [prefix, setPrefix] = useState('INV');
  const [startNumber, setStartNumber] = useState(1);
  const [padding, setPadding] = useState(5);
  const [suffix, setSuffix] = useState('');
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [month, setMonth] = useState((new Date().getMonth() + 1).toString().padStart(2, '0'));
  const [includeYear, setIncludeYear] = useState(true);
  const [includeMonth, setIncludeMonth] = useState(false);
  const [generatedNumbers, setGeneratedNumbers] = useState<string[]>([]);
  const [count, setCount] = useState(10);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const generateInvoiceNumbers = () => {
    const numbers: string[] = [];
    for (let i = 0; i < count; i++) {
      let invoiceNumber = prefix;
      
      if (includeYear) {
        invoiceNumber += year;
      }
      if (includeMonth) {
        invoiceNumber += month;
      }
      
      const number = (startNumber + i).toString().padStart(padding, '0');
      invoiceNumber += number;
      
      if (suffix) {
        invoiceNumber += suffix;
      }
      
      numbers.push(invoiceNumber);
    }
    setGeneratedNumbers(numbers);
  };

  const copyToClipboard = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const copyAll = async () => {
    const allNumbers = generatedNumbers.join('\n');
    try {
      await navigator.clipboard.writeText(allNumbers);
      setCopiedIndex(-1);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Preview
  let previewNumber = prefix;
  if (includeYear) previewNumber += year;
  if (includeMonth) previewNumber += month;
  previewNumber += startNumber.toString().padStart(padding, '0');
  if (suffix) previewNumber += suffix;

  return (
    
      <div className="space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <FileText className="w-6 h-6 text-primary-500" />
            Invoice Number Generator
          </h1>
          <p className="text-text-secondary text-sm mt-1">
            Generate sequential invoice numbers with custom formatting
          </p>
        </div>

        {/* Main Card */}
        <Card padding="md" className="space-y-6">
          {/* Format Settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Prefix */}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Prefix (e.g., INV, BILL)
              </label>
              <input
                type="text"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value.toUpperCase())}
                className="input font-mono"
                placeholder="INV"
                maxLength={10}
              />
            </div>

            {/* Suffix */}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Suffix (optional)
              </label>
              <input
                type="text"
                value={suffix}
                onChange={(e) => setSuffix(e.target.value.toUpperCase())}
                className="input font-mono"
                placeholder=""
                maxLength={10}
              />
            </div>

            {/* Start Number */}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Start Number
              </label>
              <input
                type="number"
                value={startNumber}
                onChange={(e) => setStartNumber(parseInt(e.target.value) || 1)}
                className="input"
                min="1"
              />
            </div>

            {/* Zero Padding */}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Zero Padding (digits)
              </label>
              <input
                type="number"
                value={padding}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 1;
                  setPadding(Math.min(Math.max(val, 1), 10));
                }}
                className="input"
                min="1"
                max="10"
              />
              <div className="text-xs text-gray-500 mt-1">
                Example: 5 = 00001, 00002, etc.
              </div>
            </div>

            {/* Year */}
            {includeYear && (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Year
                </label>
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="input"
                  min="2000"
                  max="2099"
                />
              </div>
            )}

            {/* Month */}
            {includeMonth && (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Month
                </label>
                <input
                  type="number"
                  value={month}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 1;
                    setMonth(Math.min(Math.max(val, 1), 12).toString().padStart(2, '0'));
                  }}
                  className="input"
                  min="1"
                  max="12"
                />
              </div>
            )}
          </div>

          {/* Include Options */}
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeYear}
                onChange={(e) => setIncludeYear(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm text-gray-700">Include Year</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeMonth}
                onChange={(e) => setIncludeMonth(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm text-gray-700">Include Month</span>
            </label>
          </div>

          {/* Count */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Number of Invoices to Generate
            </label>
            <input
              type="number"
              value={count}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 1;
                setCount(Math.min(Math.max(val, 1), 100));
              }}
              className="input"
              min="1"
              max="100"
            />
          </div>

          {/* Preview */}
          <div className="bg-slate-50 p-4 rounded-lg border border-primary-200">
            <div className="text-xs text-primary-600 mb-1 font-medium">Preview Format</div>
            <div className="text-2xl font-mono font-bold text-primary-900">{previewNumber}</div>
            <div className="text-xs text-primary-600 mt-1">
              First invoice number that will be generated
            </div>
          </div>

          {/* Generate Button */}
          <Button onClick={generateInvoiceNumbers} className="w-full">
            <RefreshCw className="w-4 h-4 mr-2" />
            Generate Invoice Numbers
          </Button>

          {/* Generated Numbers */}
          {generatedNumbers.length > 0 && (
            <div className="pt-4 border-t border-border space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-bold text-gray-900">
                  Generated {generatedNumbers.length} Invoice Numbers
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copyAll}
                  className="flex items-center gap-2"
                >
                  {copiedIndex === -1 ? (
                    <>
                      <Check className="w-4 h-4" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      Copy All
                    </>
                  )}
                </Button>
              </div>

              <div className="bg-gray-50 border border-border rounded-lg p-4 max-h-96 overflow-y-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {generatedNumbers.map((num, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between bg-white p-3 rounded-lg border border-border hover:border-primary-300 transition-colors group"
                    >
                      <span className="font-mono font-semibold text-gray-900">{num}</span>
                      <button
                        onClick={() => copyToClipboard(num, index)}
                        className="p-1 text-gray-400 hover:text-primary-600 transition-colors opacity-0 group-hover:opacity-100"
                        title="Copy"
                      >
                        {copiedIndex === index ? (
                          <Check className="w-4 h-4 text-green-600" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>

        {/* Info Card */}
        <Card padding="md" className="bg-slate-50 border-primary-100">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-primary-600 mt-0.5 shrink-0" />
            <div className="text-sm text-primary-900">
              <div className="font-bold mb-2">Invoice Number Format Examples:</div>
              <ul className="list-disc list-inside space-y-1 text-primary-800 text-xs font-mono">
                <li>INV202500001 - With year, 5-digit padding</li>
                <li>INV20250100001 - With year and month</li>
                <li>INV00001 - Simple sequential</li>
                <li>BILL/2025/001 - With suffix separator</li>
              </ul>
            </div>
          </div>
        </Card>
      </div>
    
  );
}


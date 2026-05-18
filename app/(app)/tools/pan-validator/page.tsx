'use client';

export const dynamic = 'force-dynamic';

import React, { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { CheckCircle, XCircle, Info, CreditCard, AlertCircle } from 'lucide-react';

export default function PANValidatorPage() {
  const [pan, setPan] = useState('');
  const [validationResult, setValidationResult] = useState<{
    isValid: boolean;
    type?: string;
    details?: string;
    error?: string;
  } | null>(null);

  const validatePAN = (panNumber: string) => {
    // Remove spaces and convert to uppercase
    const cleanedPAN = panNumber.trim().toUpperCase();
    
    // PAN format: 5 letters + 4 digits + 1 letter (e.g., ABCDE1234F)
    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
    
    if (!cleanedPAN) {
      return { isValid: false, error: 'Please enter a PAN number' };
    }
    
    if (!panRegex.test(cleanedPAN)) {
      return { 
        isValid: false, 
        error: 'Invalid format. PAN should be in format: ABCDE1234F (5 letters, 4 digits, 1 letter)' 
      };
    }
    
    // Extract PAN type from first 3 letters
    const firstThree = cleanedPAN.substring(0, 3);
    const panTypeMap: Record<string, string> = {
      'AAA': 'Individual',
      'AAB': 'Individual',
      'AAC': 'Individual',
      'AAD': 'Individual',
      'AAE': 'Individual',
      'AAF': 'Individual',
      'AAG': 'Individual',
      'AAH': 'HUF (Hindu Undivided Family)',
      'AAL': 'LLP (Limited Liability Partnership)',
      'AAM': 'AOP (Association of Persons)',
      'AAN': 'AOP (Association of Persons)',
      'AAO': 'AOP (Association of Persons)',
      'AAP': 'AOP (Association of Persons)',
      'AAQ': 'AOP (Association of Persons)',
      'AAR': 'AOP (Association of Persons)',
      'AAS': 'AOP (Association of Persons)',
      'AAT': 'AOP (Association of Persons)',
      'AAU': 'AOP (Association of Persons)',
      'AAV': 'AOP (Association of Persons)',
      'ABK': 'Body of Individuals',
      'ABL': 'Body of Individuals',
      'ABM': 'Body of Individuals',
      'ABN': 'Body of Individuals',
      'ABO': 'Body of Individuals',
      'ABP': 'Body of Individuals',
      'ABQ': 'Body of Individuals',
      'ABR': 'Body of Individuals',
      'ABS': 'Body of Individuals',
      'ABT': 'Body of Individuals',
      'ACB': 'Company',
      'ACC': 'Company',
      'ACD': 'Company',
      'ACE': 'Company',
      'ACF': 'Company',
      'ACG': 'Company',
      'ACH': 'Company',
      'ACI': 'Company',
      'ACJ': 'Company',
      'ACK': 'Company',
      'ACL': 'Company',
      'ACM': 'Company',
      'ACN': 'Company',
      'ACO': 'Company',
      'ACP': 'Company',
      'ACQ': 'Company',
      'ACR': 'Company',
      'ACS': 'Company',
      'ACT': 'Company',
      'ACU': 'Company',
      'ACV': 'Company',
      'ACW': 'Company',
      'ACX': 'Company',
      'ACY': 'Company',
      'ACZ': 'Company',
    };
    
    const panType = panTypeMap[firstThree] || 'Individual/Other';
    
    // Extract 5th character (status)
    const fifthChar = cleanedPAN[4];
    const statusMap: Record<string, string> = {
      'A': 'Association of Persons',
      'B': 'Body of Individuals',
      'C': 'Company',
      'F': 'Firm',
      'G': 'Government',
      'H': 'HUF (Hindu Undivided Family)',
      'L': 'Local Authority',
      'J': 'Artificial Judicial Person',
      'P': 'Individual',
      'T': 'AOP (Trust)',
    };
    
    const entityType = statusMap[fifthChar] || 'Unknown';
    
    return {
      isValid: true,
      type: panType,
      details: `Entity Type: ${entityType} | Format: ${cleanedPAN.substring(0, 5)}${cleanedPAN.substring(5, 9)}${cleanedPAN.substring(9)}`
    };
  };

  const handleValidate = () => {
    const result = validatePAN(pan);
    setValidationResult(result);
  };

  const handleClear = () => {
    setPan('');
    setValidationResult(null);
  };

  return (
    
      <div className="space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-primary-500" />
            PAN Card Validator
          </h1>
          <p className="text-text-secondary text-sm mt-1">
            Validate and verify PAN (Permanent Account Number) card format
          </p>
        </div>

        {/* Main Card */}
        <Card padding="md" className="space-y-6">
          {/* PAN Input */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              PAN Number
            </label>
            <div className="relative">
              <input
                type="text"
                value={pan}
                onChange={(e) => {
                  const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
                  if (value.length <= 10) {
                    setPan(value);
                    setValidationResult(null);
                  }
                }}
                placeholder="ABCDE1234F"
                className="input text-lg font-mono tracking-widest uppercase"
                maxLength={10}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-mono">
                {pan.length}/10
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Format: 5 letters, 4 digits, 1 letter (e.g., ABCDE1234F)
            </p>
          </div>

          {/* Validate Button */}
          <Button
            onClick={handleValidate}
            disabled={!pan || pan.length !== 10}
            className="w-full"
          >
            Validate PAN
          </Button>

          {/* Result */}
          {validationResult && (
            <div className={`p-4 rounded-lg border-2 ${
              validationResult.isValid
                ? 'bg-green-50 border-green-200'
                : 'bg-red-50 border-red-200'
            }`}>
              <div className="flex items-start gap-3">
                {validationResult.isValid ? (
                  <CheckCircle className="w-6 h-6 text-green-600 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <div className={`font-bold text-lg mb-1 ${
                    validationResult.isValid ? 'text-green-900' : 'text-red-900'
                  }`}>
                    {validationResult.isValid ? 'Valid PAN Number' : 'Invalid PAN Number'}
                  </div>
                  {validationResult.type && (
                    <div className="text-sm text-green-800 mb-2">
                      <strong>Type:</strong> {validationResult.type}
                    </div>
                  )}
                  {validationResult.details && (
                    <div className="text-sm text-green-800 mb-2">
                      {validationResult.details}
                    </div>
                  )}
                  {validationResult.error && (
                    <div className="text-sm text-red-800">
                      {validationResult.error}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Clear Button */}
          {pan && (
            <Button variant="ghost" onClick={handleClear} className="w-full">
              Clear
            </Button>
          )}
        </Card>

        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card padding="md" className="bg-slate-50 border-primary-100">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-primary-600 mt-0.5 shrink-0" />
              <div className="text-sm text-primary-900">
                <div className="font-bold mb-2">PAN Format:</div>
                <div className="space-y-1 text-primary-800 text-xs">
                  <div>• 5 letters (A-Z)</div>
                  <div>• 4 digits (0-9)</div>
                  <div>• 1 letter (A-Z)</div>
                  <div className="mt-2 font-mono bg-slate-100 px-2 py-1 rounded">
                    ABCDE1234F
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card padding="md" className="bg-amber-50 border-amber-100">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-900">
                <div className="font-bold mb-2">Important:</div>
                <div className="space-y-1 text-amber-800 text-xs">
                  <div>• This validator checks format only</div>
                  <div>• Does not verify authenticity with IT department</div>
                  <div>• For official verification, use Income Tax e-filing portal</div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    
  );
}


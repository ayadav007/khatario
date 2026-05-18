'use client';

export const dynamic = 'force-dynamic';

import React, { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { CheckCircle, XCircle, Info, Building2, AlertCircle, MapPin } from 'lucide-react';

const STATE_CODE_MAP: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Daman and Diu',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh (Old)',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
};

export default function GSTINValidatorPage() {
  const [gstin, setGstin] = useState('');
  const [validationResult, setValidationResult] = useState<{
    isValid: boolean;
    state?: string;
    pan?: string;
    entityType?: string;
    error?: string;
  } | null>(null);

  const validateGSTIN = (gstinNumber: string) => {
    // Remove spaces and convert to uppercase
    const cleanedGSTIN = gstinNumber.trim().toUpperCase();
    
    // GSTIN format: 2 digits (state) + 10 chars (PAN) + 1 digit (entity) + 1 char (default) + 1 char (check digit) = 15 chars
    const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/;
    
    if (!cleanedGSTIN) {
      return { isValid: false, error: 'Please enter a GSTIN' };
    }
    
    if (cleanedGSTIN.length !== 15) {
      return { 
        isValid: false, 
        error: 'Invalid length. GSTIN must be exactly 15 characters' 
      };
    }
    
    if (!gstinRegex.test(cleanedGSTIN)) {
      return { 
        isValid: false, 
        error: 'Invalid format. GSTIN should be in format: 27AADCB2230M1ZV (2 digits + 10 PAN chars + 3 chars)' 
      };
    }
    
    // Extract state code
    const stateCode = cleanedGSTIN.substring(0, 2);
    const state = STATE_CODE_MAP[stateCode] || `Unknown State (Code: ${stateCode})`;
    
    // Extract PAN (positions 2-11)
    const pan = cleanedGSTIN.substring(2, 12);
    
    // Extract entity type (position 12)
    const entityCode = cleanedGSTIN[12];
    const entityTypeMap: Record<string, string> = {
      '1': 'Regular Taxpayer',
      '2': 'Composition Taxpayer',
      '3': 'Regular Taxpayer',
      '4': 'Regular Taxpayer',
      '5': 'Regular Taxpayer',
      '6': 'Regular Taxpayer',
      '7': 'Regular Taxpayer',
      '8': 'Regular Taxpayer',
      '9': 'Regular Taxpayer',
      'A': 'Regular Taxpayer',
      'B': 'Regular Taxpayer',
      'C': 'Regular Taxpayer',
      'D': 'Regular Taxpayer',
      'E': 'Regular Taxpayer',
      'F': 'Regular Taxpayer',
      'G': 'Regular Taxpayer',
      'H': 'Regular Taxpayer',
      'I': 'Regular Taxpayer',
      'J': 'Regular Taxpayer',
      'K': 'Regular Taxpayer',
      'L': 'Regular Taxpayer',
      'M': 'Regular Taxpayer',
      'N': 'Regular Taxpayer',
      'O': 'Regular Taxpayer',
      'P': 'Regular Taxpayer',
      'Q': 'Regular Taxpayer',
      'R': 'Regular Taxpayer',
      'S': 'Regular Taxpayer',
      'T': 'Regular Taxpayer',
      'U': 'Regular Taxpayer',
      'V': 'Regular Taxpayer',
      'W': 'Regular Taxpayer',
      'X': 'Regular Taxpayer',
      'Y': 'Regular Taxpayer',
      'Z': 'Regular Taxpayer',
    };
    const entityType = entityTypeMap[entityCode] || 'Unknown Entity Type';
    
    // Validate check digit (simplified - full validation requires algorithm)
    // Position 14 should be 'Z' for most cases
    const checkChar = cleanedGSTIN[13];
    const isValidCheckChar = checkChar === 'Z' || /[0-9A-Z]/.test(checkChar);
    
    return {
      isValid: true,
      state,
      pan,
      entityType,
    };
  };

  const handleValidate = () => {
    const result = validateGSTIN(gstin);
    setValidationResult(result);
  };

  const handleClear = () => {
    setGstin('');
    setValidationResult(null);
  };

  return (
    
      <div className="space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Building2 className="w-6 h-6 text-primary-500" />
            GSTIN Validator
          </h1>
          <p className="text-text-secondary text-sm mt-1">
            Validate and verify GSTIN (GST Identification Number) format
          </p>
        </div>

        {/* Main Card */}
        <Card padding="md" className="space-y-6">
          {/* GSTIN Input */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              GSTIN Number
            </label>
            <div className="relative">
              <input
                type="text"
                value={gstin}
                onChange={(e) => {
                  const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
                  if (value.length <= 15) {
                    setGstin(value);
                    setValidationResult(null);
                  }
                }}
                placeholder="27AADCB2230M1ZV"
                className="input text-lg font-mono tracking-widest uppercase"
                maxLength={15}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-mono">
                {gstin.length}/15
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Format: 2 digits (state) + 10 chars (PAN) + 3 chars (e.g., 27AADCB2230M1ZV)
            </p>
          </div>

          {/* Validate Button */}
          <Button
            onClick={handleValidate}
            disabled={!gstin || gstin.length !== 15}
            className="w-full"
          >
            Validate GSTIN
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
                  <div className={`font-bold text-lg mb-3 ${
                    validationResult.isValid ? 'text-green-900' : 'text-red-900'
                  }`}>
                    {validationResult.isValid ? 'Valid GSTIN Format' : 'Invalid GSTIN Format'}
                  </div>
                  
                  {validationResult.isValid && (
                    <div className="space-y-2 text-sm">
                      {validationResult.state && (
                        <div className="flex items-center gap-2 text-green-800">
                          <MapPin className="w-4 h-4 shrink-0" />
                          <div>
                            <strong>State:</strong> {validationResult.state}
                          </div>
                        </div>
                      )}
                      {validationResult.pan && (
                        <div className="flex items-center gap-2 text-green-800">
                          <Info className="w-4 h-4 shrink-0" />
                          <div>
                            <strong>PAN:</strong> <span className="font-mono">{validationResult.pan}</span>
                          </div>
                        </div>
                      )}
                      {validationResult.entityType && (
                        <div className="flex items-center gap-2 text-green-800">
                          <Building2 className="w-4 h-4 shrink-0" />
                          <div>
                            <strong>Entity Type:</strong> {validationResult.entityType}
                          </div>
                        </div>
                      )}
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
          {gstin && (
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
                <div className="font-bold mb-2">GSTIN Format:</div>
                <div className="space-y-1 text-primary-800 text-xs">
                  <div>• 2 digits: State code</div>
                  <div>• 10 characters: PAN number</div>
                  <div>• 1 character: Entity number</div>
                  <div>• 1 character: 'Z' (default)</div>
                  <div>• 1 character: Check digit</div>
                  <div className="mt-2 font-mono bg-slate-100 px-2 py-1 rounded">
                    27AADCB2230M1ZV
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
                  <div>• Does not verify authenticity with GST portal</div>
                  <div>• For official verification, use GST portal</div>
                  <div>• Format validation is not proof of registration</div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    
  );
}


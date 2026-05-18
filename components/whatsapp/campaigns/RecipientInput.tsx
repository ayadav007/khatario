'use client';

import { useState, useCallback, useRef } from 'react';
import { Card } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';
import { Upload, X, FileText, Users, AlertCircle, CheckCircle, UserPlus, AlertTriangle } from 'lucide-react';
import { normalizePhone, parseRecipientLine, isValidPhone } from '@/lib/utils/phone';
import { ContactGroupSelector } from './ContactGroupSelector';
import { Toast, ToastType } from '@/components/ui/Toast';

export interface Recipient {
  phone: string;
  name?: string;
}

interface RecipientInputProps {
  recipients: Recipient[];
  onChange: (recipients: Recipient[]) => void;
  businessId?: string;
  errors?: {
    recipients?: string;
  };
}

export function RecipientInput({ recipients, onChange, businessId, errors }: RecipientInputProps) {
  const [inputMode, setInputMode] = useState<'paste' | 'file' | 'groups'>('paste');
  const [showGroupSelector, setShowGroupSelector] = useState(false);
  const [unsubscribedCount, setUnsubscribedCount] = useState(0);
  const [pasteText, setPasteText] = useState('');
  const [filePreview, setFilePreview] = useState<{ name: string; rows: Recipient[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  // Stats
  const stats = {
    total: recipients.length,
    valid: recipients.filter(r => isValidPhone(r.phone)).length,
    invalid: recipients.filter(r => !isValidPhone(r.phone)).length,
  };

  const handlePasteTextChange = useCallback((text: string) => {
    setPasteText(text);
    
    // Parse on change
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    const parsed: Recipient[] = [];
    const seenPhones = new Set<string>();
    
    for (const line of lines) {
      const recipient = parseRecipientLine(line);
      if (recipient && isValidPhone(recipient.phone)) {
        const normalized = normalizePhone(recipient.phone);
        if (!seenPhones.has(normalized)) {
          seenPhones.add(normalized);
          parsed.push({ phone: normalized, name: recipient.name });
        }
      }
    }
    
    onChange(parsed);
  }, [onChange]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Only support CSV for now (XLSX can be converted to CSV or handled via backend API)
    if (!file.name.endsWith('.csv') && !file.name.endsWith('.xlsx')) {
      setToast({ message: 'Please upload a CSV or XLSX file', type: 'warning' });
      return;
    }

    if (file.name.endsWith('.csv')) {
      // Parse CSV
      const text = await file.text();
      const lines = text.split('\n').map(l => l.trim()).filter(l => l);
      
      // First line might be header
      const hasHeader = lines[0]?.toLowerCase().includes('phone') || lines[0]?.toLowerCase().includes('name');
      const dataLines = hasHeader ? lines.slice(1) : lines;
      
      const parsed: Recipient[] = [];
      const seenPhones = new Set<string>();
      
      for (const line of dataLines) {
        const recipient = parseRecipientLine(line);
        if (recipient && isValidPhone(recipient.phone)) {
          const normalized = normalizePhone(recipient.phone);
          if (!seenPhones.has(normalized)) {
            seenPhones.add(normalized);
            parsed.push({ phone: normalized, name: recipient.name });
          }
        }
      }
      
      setFilePreview({ name: file.name, rows: parsed.slice(0, 5) });
      onChange(parsed);
    } else {
      // XLSX - show message that it needs backend parsing
      setToast({
        message:
          'XLSX files will be parsed by the backend. Please ensure your file has "phone" column and optional "name" column.',
        type: 'info',
      });
      // For now, just set a placeholder
      setFilePreview({ name: file.name, rows: [] });
    }
  }, [onChange]);

  const handleRemoveFile = useCallback(() => {
    setFilePreview(null);
    onChange([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [onChange]);

  const handleClearPaste = useCallback(() => {
    setPasteText('');
    onChange([]);
  }, [onChange]);

  return (
    <Card padding="lg" className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Recipients</h3>
        
        {/* Input Mode Selection */}
        <div className="mb-4">
          <div className="grid grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => setInputMode('paste')}
              className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg border-2 transition-colors ${
                inputMode === 'paste'
                  ? 'border-primary-500 bg-slate-50 text-primary-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
              }`}
            >
              <FileText className="w-5 h-5" />
              <span className="font-medium">Paste</span>
            </button>
            <button
              type="button"
              onClick={() => setInputMode('file')}
              className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg border-2 transition-colors ${
                inputMode === 'file'
                  ? 'border-primary-500 bg-slate-50 text-primary-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
              }`}
            >
              <Upload className="w-5 h-5" />
              <span className="font-medium">Upload</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setInputMode('groups');
                setShowGroupSelector(true);
              }}
              className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg border-2 transition-colors ${
                inputMode === 'groups'
                  ? 'border-primary-500 bg-slate-50 text-primary-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
              }`}
            >
              <UserPlus className="w-5 h-5" />
              <span className="font-medium">From Groups</span>
            </button>
          </div>
        </div>

        {/* Paste Mode */}
        {inputMode === 'paste' && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone Numbers (one per line)
              </label>
              <Textarea
                value={pasteText}
                onChange={(e) => handlePasteTextChange(e.target.value)}
                placeholder={`+919876543210
919876543210
9876543210, John Doe
+919876543211`}
                className="min-h-[150px] font-mono text-sm"
              />
              <div className="flex items-center justify-between mt-2">
                <p className="text-xs text-gray-500">
                  Supported formats: +919876543210, 919876543210, 9876543210, phone,name
                </p>
                {pasteText && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleClearPaste}
                  >
                    <X className="w-4 h-4" />
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* File Upload Mode */}
        {inputMode === 'file' && (
          <div className="space-y-3">
            {filePreview ? (
              <div className="border-2 border-gray-200 rounded-lg p-4 bg-gray-50">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-primary-600" />
                    <span className="font-medium text-gray-900">{filePreview.name}</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleRemoveFile}
                  >
                    <X className="w-4 h-4" />
                    Remove
                  </Button>
                </div>
                {filePreview.rows.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-gray-700">Preview (first 5 rows):</p>
                    <div className="bg-white rounded border p-2 max-h-40 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left p-1">Phone</th>
                            <th className="text-left p-1">Name</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filePreview.rows.map((row, idx) => (
                            <tr key={idx} className="border-b">
                              <td className="p-1 font-mono">{row.phone}</td>
                              <td className="p-1">{row.name || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-primary-400 hover:bg-slate-50 transition-colors"
              >
                <Upload className="w-10 h-10 mx-auto text-gray-400 mb-2" />
                <p className="text-sm text-gray-600 mb-1">Click to upload CSV or XLSX file</p>
                <p className="text-xs text-gray-500">
                  Required column: <code className="bg-gray-100 px-1 rounded">phone</code>
                  <br />
                  Optional column: <code className="bg-gray-100 px-1 rounded">name</code>
                </p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        )}

        {/* Contact Groups Mode */}
        {inputMode === 'groups' && (
          <div className="space-y-3">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
              <UserPlus className="w-10 h-10 mx-auto text-gray-400 mb-2" />
              <p className="text-sm text-gray-600 mb-3">Select contacts from your saved groups</p>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowGroupSelector(true)}
              >
                <Users className="w-4 h-4 mr-2" />
                Select Groups
              </Button>
            </div>
          </div>
        )}

        {/* Unsubscribe Warning */}
        {unsubscribedCount > 0 && (
          <div className="mt-4 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-yellow-900">Unsubscribed Contacts Detected</p>
                <p className="text-sm text-yellow-800 mt-1">
                  {unsubscribedCount} contact(s) in your list have unsubscribed and will not receive messages.
                  These numbers will be automatically excluded when sending.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Stats */}
        {recipients.length > 0 && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-5 h-5 text-primary-600" />
              <span className="font-medium text-gray-900">Recipient Statistics</span>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
                <div className="text-xs text-gray-600">Total</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-600 flex items-center gap-1">
                  <CheckCircle className="w-5 h-5" />
                  {stats.valid}
                </div>
                <div className="text-xs text-gray-600">Valid</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-red-600 flex items-center gap-1">
                  <AlertCircle className="w-5 h-5" />
                  {stats.invalid}
                </div>
                <div className="text-xs text-gray-600">Invalid</div>
              </div>
            </div>
            {stats.invalid > 0 && (
              <p className="text-xs text-yellow-600 mt-2">
                ⚠️ {stats.invalid} invalid phone number(s) will be skipped
              </p>
            )}
          </div>
        )}

        {errors?.recipients && (
          <p className="text-sm text-red-600 mt-2">{errors.recipients}</p>
        )}
      </div>

      {/* Contact Group Selector Modal */}
      {showGroupSelector && businessId && (
        <ContactGroupSelector
          businessId={businessId}
          onClose={() => setShowGroupSelector(false)}
          onSelect={async (contacts) => {
            onChange(contacts);
            setShowGroupSelector(false);
            
            // Check for unsubscribed contacts
            if (contacts.length > 0 && businessId) {
              try {
                const phones = contacts.map(c => c.phone).join(',');
                const response = await fetch(`/api/whatsapp/unsubscribes?business_id=${businessId}&check_phones=${phones}`);
                const data = await response.json();
                setUnsubscribedCount(data.unsubscribed?.length || 0);
              } catch (error) {
                console.error('Error checking unsubscribes:', error);
              }
            }
          }}
        />
      )}
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </Card>
  );
}


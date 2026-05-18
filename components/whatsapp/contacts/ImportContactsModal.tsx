'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { X, Loader2, Upload, FileText, CheckCircle, AlertCircle } from 'lucide-react';
import { parseRecipientLine } from '@/lib/utils/phone';

interface ImportContactsModalProps {
  businessId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function ImportContactsModal({ businessId, onClose, onSuccess }: ImportContactsModalProps) {
  const [mode, setMode] = useState<'csv' | 'paste'>('csv');
  const [file, setFile] = useState<File | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setResult(null);
    }
  };

  const parseCSV = (text: string): any[] => {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    const contacts: any[] = [];

    // Skip header if present
    const startIndex = lines[0].toLowerCase().includes('phone') ? 1 : 0;

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      
      // Try to parse as CSV (comma-separated)
      const parts = line.split(',').map(p => p.trim().replace(/^"(.*)"$/, '$1'));
      
      if (parts.length >= 1 && parts[0]) {
        contacts.push({
          phone: parts[0],
          name: parts[1] || null,
          email: parts[2] || null,
          tags: parts[3] ? parts[3].split(';').map(t => t.trim()) : [],
        });
      }
    }

    return contacts;
  };

  const parsePasteText = (text: string): any[] => {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    const contacts: any[] = [];

    for (const line of lines) {
      const recipient = parseRecipientLine(line);
      if (recipient) {
        contacts.push({
          phone: recipient.phone,
          name: recipient.name || null,
          email: null,
          tags: [],
        });
      }
    }

    return contacts;
  };

  const handleImport = async () => {
    setLoading(true);
    setResult(null);

    try {
      let contacts: any[] = [];

      if (mode === 'csv' && file) {
        const text = await file.text();
        contacts = parseCSV(text);
      } else if (mode === 'paste' && pasteText) {
        contacts = parsePasteText(pasteText);
      }

      if (contacts.length === 0) {
        setResult({
          success: false,
          message: 'No valid contacts found',
        });
        return;
      }

      // Import contacts
      const response = await fetch('/api/whatsapp/contacts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          contacts,
          source: 'csv',
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setResult({
          success: false,
          message: data.error || 'Import failed',
        });
        return;
      }

      setResult({
        success: true,
        message: data.message,
        results: data.results,
      });

      setTimeout(() => {
        onSuccess();
      }, 2000);
    } catch (error) {
      console.error('Error importing contacts:', error);
      setResult({
        success: false,
        message: 'An error occurred during import',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b sticky top-0 bg-white">
          <h2 className="text-xl font-semibold text-text-primary">Import Contacts</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Mode Selection */}
          <div className="flex gap-2">
            <Button
              variant={mode === 'csv' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('csv')}
            >
              <Upload className="h-4 w-4 mr-2" />
              Upload CSV
            </Button>
            <Button
              variant={mode === 'paste' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('paste')}
            >
              <FileText className="h-4 w-4 mr-2" />
              Paste Text
            </Button>
          </div>

          {/* CSV Upload */}
          {mode === 'csv' && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full p-8 border-2 border-dashed border-gray-300 rounded-lg hover:border-primary-500 transition-colors"
              >
                {file ? (
                  <div className="flex items-center justify-center gap-3">
                    <FileText className="h-8 w-8 text-primary-600" />
                    <div className="text-left">
                      <p className="font-medium text-text-primary">{file.name}</p>
                      <p className="text-sm text-text-secondary">
                        {(file.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center">
                    <Upload className="h-12 w-12 mx-auto mb-3 text-gray-400" />
                    <p className="text-sm font-medium text-text-primary">
                      Click to upload CSV file
                    </p>
                    <p className="text-xs text-text-secondary mt-1">
                      CSV format: Phone, Name, Email, Tags
                    </p>
                  </div>
                )}
              </button>

              <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                <h4 className="text-sm font-medium text-gray-700 mb-2">CSV Format:</h4>
                <pre className="text-xs text-gray-600 overflow-x-auto">
                  {`Phone,Name,Email,Tags
919876543210,John Doe,john@example.com,customer; vip
919876543211,Jane Smith,jane@example.com,lead`}
                </pre>
              </div>
            </div>
          )}

          {/* Paste Text */}
          {mode === 'paste' && (
            <div>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={`Paste contacts here (one per line):
919876543210 - John Doe
919876543211, Jane Smith
919876543212`}
                rows={10}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none font-mono text-sm"
              />
              <p className="mt-2 text-xs text-gray-500">
                Supported formats: Phone - Name, Phone, Name or just Phone
              </p>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className={`p-4 rounded-lg ${
              result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
            }`}>
              <div className="flex items-start gap-3">
                {result.success ? (
                  <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <p className={`font-medium ${
                    result.success ? 'text-green-900' : 'text-red-900'
                  }`}>
                    {result.message}
                  </p>
                  {result.results && (
                    <div className="mt-2 text-sm text-gray-700 space-y-1">
                      <p>Total: {result.results.total}</p>
                      <p>Imported: {result.results.imported}</p>
                      <p>Skipped (duplicates): {result.results.skipped}</p>
                      <p>Errors: {result.results.errors}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-4">
            <Button
              variant="secondary"
              onClick={onClose}
              disabled={loading}
              className="flex-1"
            >
              {result?.success ? 'Close' : 'Cancel'}
            </Button>
            {!result?.success && (
              <Button
                onClick={handleImport}
                disabled={loading || (mode === 'csv' && !file) || (mode === 'paste' && !pasteText)}
                className="flex-1"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  'Import Contacts'
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

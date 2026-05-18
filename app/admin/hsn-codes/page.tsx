'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useAdmin } from '@/context/AdminContext';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';
import { Upload, Download, FileText, AlertCircle, CheckCircle, Loader2, Database } from 'lucide-react';

export default function HSNCodesPage() {
  const { admin } = useAdmin();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'append' | 'replace'>('append');
  const [uploading, setUploading] = useState(false);
  const [stats, setStats] = useState<{
    total: number;
    hsn: number;
    sac: number;
  } | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    stats?: {
      imported: number;
      updated: number;
      errors: number;
      total: number;
    };
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch statistics
  const fetchStats = async () => {
    if (!admin?.id) return;
    try {
      const res = await fetch('/api/admin/hsn-codes/stats', {
        ...platformAdminFetchInit,
      });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => {
    if (admin?.id) {
      void fetchStats();
    } else {
      setLoadingStats(false);
    }
  }, [admin?.id]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.type !== 'text/csv' && !selectedFile.name.endsWith('.csv')) {
        setResult({
          success: false,
          message: 'Please select a CSV file',
        });
        return;
      }
      setFile(selectedFile);
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!admin?.id) {
      setResult({
        success: false,
        message: 'Not signed in as platform admin',
      });
      return;
    }
    if (!file) {
      setResult({
        success: false,
        message: 'Please select a CSV file first',
      });
      return;
    }

    setUploading(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mode', mode);

      const res = await fetch('/api/admin/hsn-codes/upload', {
        ...platformAdminFetchInit,
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (res.ok) {
        setResult({
          success: true,
          message: data.message || 'HSN/SAC codes imported successfully',
          stats: data.stats,
        });
        setFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        // Refresh statistics after successful import
        fetchStats();
      } else {
        setResult({
          success: false,
          message: data.error || 'Failed to import HSN/SAC codes',
          stats: data.stats,
        });
      }
    } catch (error: any) {
      setResult({
        success: false,
        message: error.message || 'Failed to upload file',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDownloadTemplate = () => {
    const template = `code,description,gst_rate,category,is_service,keywords
19053100,Biscuits and similar baked products,5,Food & Beverages,false,"biscuit,cookie,snack"
998314,Software development services,18,IT Services,true,"software,development,IT"`;

    const blob = new Blob([template], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hsn_codes_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">HSN/SAC Code Management</h1>
        <p className="text-gray-600 mt-2">Upload and manage HSN/SAC codes for product lookup</p>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Codes</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {loadingStats ? (
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                ) : (
                  stats?.total.toLocaleString() || '0'
                )}
              </p>
            </div>
            <Database className="w-10 h-10 text-primary-600" />
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">HSN Codes</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {loadingStats ? (
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                ) : (
                  stats?.hsn.toLocaleString() || '0'
                )}
              </p>
            </div>
            <FileText className="w-10 h-10 text-green-600" />
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">SAC Codes</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {loadingStats ? (
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                ) : (
                  stats?.sac.toLocaleString() || '0'
                )}
              </p>
            </div>
            <FileText className="w-10 h-10 text-purple-600" />
          </div>
        </div>
      </div>

      {/* Upload Section */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Upload HSN/SAC Codes</h2>

        {/* Instructions */}
        <div className="bg-slate-50 border border-primary-200 rounded-lg p-4 mb-6">
          <div className="flex items-start">
            <AlertCircle className="w-5 h-5 text-primary-600 mt-0.5 mr-3 flex-shrink-0" />
            <div className="text-sm text-primary-800">
              <p className="font-medium mb-2">CSV File Format Required:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Columns: <code className="bg-slate-100 px-1 rounded">code,description,gst_rate,category,is_service,keywords</code></li>
                <li>First row must be header row</li>
                <li>HSN codes: 8 digits | SAC codes: 6 digits</li>
                <li><code className="bg-slate-100 px-1 rounded">is_service</code>: Use <code className="bg-slate-100 px-1 rounded">true</code> for SAC, <code className="bg-slate-100 px-1 rounded">false</code> for HSN</li>
                <li>Keywords should be comma-separated within quotes: <code className="bg-slate-100 px-1 rounded">"biscuit,cookie,snack"</code></li>
              </ul>
            </div>
          </div>
        </div>

        {/* File Upload */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select CSV File
            </label>
            <div className="flex items-center space-x-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileSelect}
                className="hidden"
                id="csv-file-input"
              />
              <label
                htmlFor="csv-file-input"
                className="flex items-center space-x-2 px-4 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition"
              >
                <Upload className="w-5 h-5 text-gray-600" />
                <span className="text-sm font-medium text-gray-700">
                  {file ? file.name : 'Choose CSV File'}
                </span>
              </label>
              {file && (
                <button
                  onClick={handleDownloadTemplate}
                  className="flex items-center space-x-2 px-4 py-2 text-sm text-primary-600 hover:text-primary-700"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Template</span>
                </button>
              )}
            </div>
            {file && (
              <p className="text-xs text-gray-500 mt-2">
                Selected: {file.name} ({(file.size / 1024).toFixed(2)} KB)
              </p>
            )}
          </div>

          {/* Upload Mode */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Upload Mode
            </label>
            <div className="flex space-x-4">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  value="append"
                  checked={mode === 'append'}
                  onChange={(e) => setMode(e.target.value as 'append' | 'replace')}
                  className="w-4 h-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                />
                <span className="text-sm text-gray-700">
                  <strong>Append</strong> - Add new codes, update existing ones
                </span>
              </label>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  value="replace"
                  checked={mode === 'replace'}
                  onChange={(e) => setMode(e.target.value as 'append' | 'replace')}
                  className="w-4 h-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                />
                <span className="text-sm text-gray-700">
                  <strong>Replace</strong> - Clear all existing codes and import new ones
                </span>
              </label>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              {mode === 'append'
                ? 'New codes will be added. Existing codes will be updated with new data.'
                : '⚠️ Warning: All existing HSN/SAC codes will be deleted before importing new ones.'}
            </p>
          </div>

          {/* Upload Button */}
          <div className="pt-4">
            <button
              onClick={handleUpload}
              disabled={!file || uploading}
              className="flex items-center space-x-2 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Uploading...</span>
                </>
              ) : (
                <>
                  <Upload className="w-5 h-5" />
                  <span>Upload & Import</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Result Message */}
      {result && (
        <div
          className={`rounded-xl border p-6 ${
            result.success
              ? 'bg-green-50 border-green-200'
              : 'bg-red-50 border-red-200'
          }`}
        >
          <div className="flex items-start">
            {result.success ? (
              <CheckCircle className="w-6 h-6 text-green-600 mt-0.5 mr-3 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-6 h-6 text-red-600 mt-0.5 mr-3 flex-shrink-0" />
            )}
            <div className="flex-1">
              <p
                className={`font-medium ${
                  result.success ? 'text-green-800' : 'text-red-800'
                }`}
              >
                {result.message}
              </p>
              {result.stats && (
                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-gray-600">Total Processed</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {result.stats.total}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600">Imported</p>
                    <p className="text-lg font-semibold text-green-600">
                      {result.stats.imported}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600">Updated</p>
                    <p className="text-lg font-semibold text-primary-600">
                      {result.stats.updated}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600">Errors</p>
                    <p className="text-lg font-semibold text-red-600">
                      {result.stats.errors}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Help Section */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mt-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Help & Resources</h2>
        <div className="space-y-4 text-sm text-gray-700">
          <div>
            <p className="font-medium mb-2">Where to download HSN/SAC codes:</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>
                <a
                  href="https://www.gst.gov.in/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-600 hover:underline"
                >
                  Official GST Portal
                </a>
              </li>
              <li>
                <a
                  href="https://www.cbic.gov.in/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-600 hover:underline"
                >
                  CBIC Website
                </a>
              </li>
              <li>
                <a
                  href="https://www.tallysolutions.com/business-tools-templates/free-hsn-code-finder/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-600 hover:underline"
                >
                  Tally HSN Code Finder
                </a>
              </li>
            </ul>
          </div>
          <div>
            <p className="font-medium mb-2">CSV Format Example:</p>
            <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto">
{`code,description,gst_rate,category,is_service,keywords
19053100,Biscuits and similar baked products,5,Food & Beverages,false,"biscuit,cookie,snack"
998314,Software development services,18,IT Services,true,"software,development,IT"`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}


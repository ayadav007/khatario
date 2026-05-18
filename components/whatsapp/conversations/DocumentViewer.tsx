'use client';

import React, { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';

interface DocumentViewerProps {
  documentUrl: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  pageCount?: number;
}

export function DocumentViewer({ 
  documentUrl, 
  fileName = 'Document', 
  fileSize,
  mimeType,
  pageCount
}: DocumentViewerProps) {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [actualFileSize, setActualFileSize] = useState<number | undefined>(fileSize);

  const isPDF = mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');

  // Fetch file size if not provided
  useEffect(() => {
    if (!actualFileSize && documentUrl) {
      fetch(documentUrl, { method: 'HEAD' })
        .then(response => {
          const size = response.headers.get('content-length');
          if (size) {
            setActualFileSize(parseInt(size, 10));
          }
        })
        .catch(() => {
          // Silently fail - we'll just show without size
        });
    }
  }, [documentUrl, actualFileSize]);

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileExtension = () => {
    return fileName.split('.').pop()?.toUpperCase() || 'FILE';
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const response = await fetch(documentUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
    } finally {
      setIsDownloading(false);
    }
  };

  // Build metadata string (e.g., "3 pages • PDF • 456 kB")
  const getMetadata = () => {
    const parts: string[] = [];
    
    if (pageCount) {
      parts.push(`${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`);
    }
    
    parts.push(getFileExtension());
    
    const size = formatFileSize(actualFileSize);
    if (size) {
      parts.push(size);
    }
    
    return parts.join(' • ');
  };

  return (
    <>
      {/* WhatsApp-style document preview */}
      <div 
        className="bg-white rounded-lg p-3 max-w-[280px] cursor-pointer hover:bg-gray-50 transition"
        onClick={() => isPDF && setIsPreviewOpen(true)}
      >
        <div className="flex items-center gap-3">
          {/* PDF Icon - WhatsApp style red icon */}
          <div className="flex-shrink-0 w-10 h-10 bg-[#dc2626] rounded flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
            </svg>
          </div>

          {/* File Info */}
          <div className="flex-1 min-w-0 pr-2">
            <div className="font-normal text-[#111b21] truncate mb-1" style={{ fontSize: '28px', lineHeight: '36px' }}>
              {fileName}
            </div>
            <div className="text-[#667781]" style={{ fontSize: '24px', lineHeight: '30px' }}>
              {getMetadata()}
            </div>
          </div>

          {/* Download Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDownload();
            }}
            disabled={isDownloading}
            className="flex-shrink-0 p-2 hover:bg-gray-100 rounded-full transition disabled:opacity-50"
            title="Download"
          >
            <Download className={`w-5 h-5 text-[#667781] ${isDownloading ? 'animate-bounce' : ''}`} />
          </button>
        </div>
      </div>

      {/* Preview Modal for PDFs */}
      {isPreviewOpen && isPDF && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-95 z-[9999] flex flex-col"
          onClick={() => setIsPreviewOpen(false)}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 text-white bg-black bg-opacity-50">
            <div className="font-medium truncate mr-4">{fileName}</div>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDownload();
                }}
                disabled={isDownloading}
                className="p-2 hover:bg-white hover:bg-opacity-20 rounded-full transition"
                title="Download"
              >
                <Download className={`w-5 h-5 ${isDownloading ? 'animate-bounce' : ''}`} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsPreviewOpen(false);
                }}
                className="p-2 hover:bg-white hover:bg-opacity-20 rounded-full transition"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Preview Content */}
          <div 
            className="flex-1 p-4 overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <iframe
              src={documentUrl}
              className="w-full h-full bg-white rounded"
              title={fileName}
            />
          </div>
        </div>
      )}
    </>
  );
}

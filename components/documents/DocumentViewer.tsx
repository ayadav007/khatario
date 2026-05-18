'use client';

import React from 'react';
import { X, Download } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { downloadDocument } from '@/lib/document-upload';

interface Document {
  id: string;
  file_name: string;
  file_url: string;
  file_type: string;
  mime_type?: string;
}

interface DocumentViewerProps {
  document: Document;
  onClose: () => void;
}

export function DocumentViewer({ document, onClose }: DocumentViewerProps) {
  const handleDownload = () => {
    downloadDocument(document.file_name, document.file_url, document.mime_type);
  };

  const isImage = document.file_type === 'image' || document.mime_type?.startsWith('image/');
  const isPDF = document.file_type === 'pdf' || document.mime_type === 'application/pdf';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75">
      <div className="relative w-full h-full max-w-6xl max-h-[90vh] bg-white rounded-lg overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-lg font-semibold text-text-primary truncate flex-1">
            {document.file_name}
          </h3>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={handleDownload}>
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
          {isImage ? (
            <img
              src={document.file_url}
              alt={document.file_name}
              className="max-w-full max-h-full object-contain"
            />
          ) : isPDF ? (
            <iframe
              src={document.file_url}
              className="w-full h-full min-h-[600px] border-none"
              title={document.file_name}
            />
          ) : (
            <div className="text-center text-text-secondary">
              <p className="mb-4">Preview not available for this file type</p>
              <Button onClick={handleDownload}>
                <Download className="w-4 h-4 mr-2" />
                Download to view
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


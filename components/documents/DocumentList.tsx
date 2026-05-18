'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Download, Eye, Trash2, File, FileText, Image, FileSpreadsheet, Loader2 } from 'lucide-react';
import { formatFileSize, getFileIcon, downloadDocument, previewDocument } from '@/lib/document-upload';
import { DocumentViewer } from './DocumentViewer';
import { useToastContext } from '@/contexts/ToastContext';

interface Document {
  id: string;
  file_name: string;
  file_url: string;
  file_type: string;
  file_size: number;
  mime_type?: string;
  description?: string;
  uploaded_by_name?: string;
  created_at: string;
}

interface DocumentListProps {
  entityType: string;
  entityId: string;
  businessId: string;
  onDelete?: () => void;
  showUploader?: boolean;
}

export function DocumentList({
  entityType,
  entityId,
  businessId,
  onDelete,
  showUploader = false,
}: DocumentListProps) {
  const toast = useToastContext();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [viewingDoc, setViewingDoc] = useState<Document | null>(null);

  useEffect(() => {
    fetchDocuments();
  }, [entityType, entityId, businessId]);

  const fetchDocuments = async () => {
    if (!businessId || !entityType || !entityId) return;

    setLoading(true);
    try {
      const res = await fetch(
        `/api/documents?business_id=${businessId}&entity_type=${entityType}&entity_id=${entityId}`
      );
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents || []);
      }
    } catch (error) {
      console.error('Error fetching documents:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (documentId: string) => {
    if (!confirm('Are you sure you want to delete this document?')) return;

    setDeleting(documentId);
    try {
      const res = await fetch(
        `/api/document-attachments/${documentId}?business_id=${businessId}`,
        { method: 'DELETE' }
      );

      if (res.ok) {
        await fetchDocuments();
        onDelete?.();
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to delete document');
      }
    } catch (error) {
      console.error('Error deleting document:', error);
      toast.error('Failed to delete document');
    } finally {
      setDeleting(null);
    }
  };

  const handleDownload = (doc: Document) => {
    downloadDocument(doc.file_name, doc.file_url, doc.mime_type);
  };

  const handleView = (doc: Document) => {
    setViewingDoc(doc);
  };

  const getFileIconComponent = (fileType: string, mimeType?: string) => {
    if (fileType === 'image') {
      return <Image className="w-5 h-5 text-primary-600" />;
    } else if (fileType === 'pdf' || mimeType === 'application/pdf') {
      return <FileText className="w-5 h-5 text-red-600" />;
    } else if (fileType === 'spreadsheet' || mimeType?.includes('excel') || mimeType === 'text/csv') {
      return <FileSpreadsheet className="w-5 h-5 text-green-600" />;
    }
    return <File className="w-5 h-5 text-gray-600" />;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="text-center py-8 text-text-secondary">
        <File className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>No documents attached</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {documents.map((doc) => (
          <div
            key={doc.id}
            className="flex items-center gap-4 p-3 border border-border rounded-lg hover:bg-gray-50 transition-colors"
          >
            {getFileIconComponent(doc.file_type, doc.mime_type)}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">
                {doc.file_name}
              </p>
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                <span>{formatFileSize(doc.file_size)}</span>
                {doc.uploaded_by_name && (
                  <>
                    <span>•</span>
                    <span>Uploaded by {doc.uploaded_by_name}</span>
                  </>
                )}
                {doc.created_at && (
                  <>
                    <span>•</span>
                    <span>{new Date(doc.created_at).toLocaleDateString()}</span>
                  </>
                )}
              </div>
              {doc.description && (
                <p className="text-xs text-text-secondary mt-1">{doc.description}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleView(doc)}
                title="View"
              >
                <Eye className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDownload(doc)}
                title="Download"
              >
                <Download className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(doc.id)}
                disabled={deleting === doc.id}
                className="text-red-600 hover:text-red-700"
                title="Delete"
              >
                {deleting === doc.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        ))}
      </div>

      {viewingDoc && (
        <DocumentViewer
          document={viewingDoc}
          onClose={() => setViewingDoc(null)}
        />
      )}
    </>
  );
}


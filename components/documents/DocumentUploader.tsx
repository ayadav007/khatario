'use client';

import React, { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { Upload, X, File, Loader2 } from 'lucide-react';
import { uploadDocument, validateFile, formatFileSize, DocumentUploadOptions } from '@/lib/document-upload';

interface DocumentUploaderProps {
  entityType: string;
  entityId: string;
  businessId: string;
  onUploadSuccess?: () => void;
  onUploadError?: (error: string) => void;
  maxSize?: number;
  allowedTypes?: string[];
  multiple?: boolean;
}

interface FilePreview {
  file: File;
  preview?: string;
  uploading: boolean;
  error?: string;
}

export function DocumentUploader({
  entityType,
  entityId,
  businessId,
  onUploadSuccess,
  onUploadError,
  maxSize,
  allowedTypes,
  multiple = true,
}: DocumentUploaderProps) {
  const [files, setFiles] = useState<FilePreview[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback((selectedFiles: FileList | null) => {
    if (!selectedFiles || selectedFiles.length === 0) return;

    const newFiles: FilePreview[] = [];
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      
      // Validate file
      const validation = validateFile(file, { maxSize, allowedTypes });
      if (!validation.valid) {
        onUploadError?.(validation.error || 'Invalid file');
        continue;
      }

      // Create preview for images
      const preview: FilePreview = {
        file,
        uploading: false,
      };

      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          setFiles((prev) => {
            const updated = [...prev];
            const index = updated.findIndex((f) => f.file === file);
            if (index >= 0) {
              updated[index].preview = e.target?.result as string;
            }
            return updated;
          });
        };
        reader.readAsDataURL(file);
      }

      newFiles.push(preview);
    }

    setFiles((prev) => (multiple ? [...prev, ...newFiles] : newFiles));
  }, [maxSize, allowedTypes, multiple, onUploadError]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleUpload = useCallback(async () => {
    if (files.length === 0) return;

    setUploading(true);
    const uploadOptions: DocumentUploadOptions = {
      entityType,
      entityId,
      businessId,
      maxSize,
      allowedTypes,
    };

    try {
      for (let i = 0; i < files.length; i++) {
        const filePreview = files[i];
        
        // Update uploading state
        setFiles((prev) => {
          const updated = [...prev];
          updated[i].uploading = true;
          return updated;
        });

        const result = await uploadDocument(filePreview.file, uploadOptions);

        if (result.success) {
          // Remove from list on success
          setFiles((prev) => prev.filter((_, idx) => idx !== i));
          onUploadSuccess?.();
        } else {
          // Show error
          setFiles((prev) => {
            const updated = [...prev];
            updated[i].uploading = false;
            updated[i].error = result.error;
            return updated;
          });
          onUploadError?.(result.error || 'Failed to upload file');
        }
      }
    } catch (error: any) {
      console.error('Error uploading files:', error);
      onUploadError?.(error.message || 'An unexpected error occurred');
    } finally {
      setUploading(false);
    }
  }, [files, entityType, entityId, businessId, maxSize, allowedTypes, onUploadSuccess, onUploadError]);

  return (
    <div className="space-y-4">
      {/* Drop Zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary-500 transition-colors cursor-pointer"
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="w-12 h-12 mx-auto mb-4 text-text-secondary" />
        <p className="text-text-primary font-medium mb-2">
          Drop files here or click to upload
        </p>
        <p className="text-sm text-text-secondary">
          {allowedTypes ? `Allowed: ${allowedTypes.map(t => t.split('/')[1]).join(', ')}` : 'Images, PDFs, Documents'}
          {maxSize && ` • Max size: ${formatFileSize(maxSize)}`}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple={multiple}
          className="hidden"
          onChange={(e) => handleFileSelect(e.target.files)}
          accept={allowedTypes?.join(',')}
        />
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((filePreview, index) => (
            <div
              key={index}
              className="flex items-center gap-4 p-3 border border-border rounded-lg bg-gray-50"
            >
              {filePreview.preview ? (
                <img
                  src={filePreview.preview}
                  alt={filePreview.file.name}
                  className="w-12 h-12 object-cover rounded"
                />
              ) : (
                <File className="w-12 h-12 text-text-secondary" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">
                  {filePreview.file.name}
                </p>
                <p className="text-xs text-text-secondary">
                  {formatFileSize(filePreview.file.size)}
                </p>
                {filePreview.error && (
                  <p className="text-xs text-red-600 mt-1">{filePreview.error}</p>
                )}
              </div>
              {filePreview.uploading ? (
                <Loader2 className="w-5 h-5 animate-spin text-primary-500" />
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(index);
                  }}
                  className="text-red-600 hover:text-red-700"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
          ))}
          <Button
            onClick={handleUpload}
            disabled={uploading || files.every((f) => f.uploading)}
            className="w-full"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Upload {files.length} file{files.length !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}


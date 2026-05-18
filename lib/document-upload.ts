/**
 * Document Upload Utility Library
 * Handles file uploads, validation, and storage
 * Currently uses base64 storage, but designed to be extensible to cloud storage (S3, Cloudinary, etc.)
 */

export interface DocumentUploadOptions {
  maxSize?: number; // Max file size in bytes
  allowedTypes?: string[]; // Allowed MIME types
  entityType: string; // 'invoice', 'purchase', etc.
  entityId: string;
  businessId: string;
  description?: string;
}

export interface DocumentUploadResult {
  success: boolean;
  document?: {
    id: string;
    file_name: string;
    file_url: string;
    file_type: string;
    file_size: number;
    mime_type: string;
  };
  error?: string;
}

/**
 * Upload a document to the server
 */
export async function uploadDocument(
  file: File,
  options: DocumentUploadOptions
): Promise<DocumentUploadResult> {
  try {
    // Validate file type
    const allowedTypes = options.allowedTypes || [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'text/plain'
    ];

    if (!allowedTypes.includes(file.type)) {
      return {
        success: false,
        error: `Invalid file type. Allowed types: ${allowedTypes.join(', ')}`
      };
    }

    // Validate file size
    const maxSize = options.maxSize || (file.type.startsWith('image/') ? 5 * 1024 * 1024 : 10 * 1024 * 1024);
    if (file.size > maxSize) {
      return {
        success: false,
        error: `File size too large. Maximum size is ${maxSize / (1024 * 1024)}MB`
      };
    }

    // Create FormData
    const formData = new FormData();
    formData.append('business_id', options.businessId);
    formData.append('entity_type', options.entityType);
    formData.append('entity_id', options.entityId);
    formData.append('file', file);
    if (options.description) {
      formData.append('description', options.description);
    }

    // Upload to API
    const response = await fetch('/api/documents', {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || 'Failed to upload document'
      };
    }

    return {
      success: true,
      document: data.document
    };
  } catch (error: any) {
    console.error('Error uploading document:', error);
    return {
      success: false,
      error: error.message || 'An unexpected error occurred'
    };
  }
}

/**
 * Get file type category from MIME type
 */
export function getFileTypeCategory(mimeType: string): string {
  if (mimeType.startsWith('image/')) {
    return 'image';
  } else if (mimeType === 'application/pdf') {
    return 'pdf';
  } else if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType === 'text/csv') {
    return 'spreadsheet';
  } else if (mimeType.includes('word') || mimeType.includes('document')) {
    return 'document';
  }
  return 'document';
}

/**
 * Get file icon based on file type
 */
export function getFileIcon(fileType: string, mimeType?: string): string {
  if (fileType === 'image') {
    return '🖼️';
  } else if (fileType === 'pdf' || mimeType === 'application/pdf') {
    return '📄';
  } else if (fileType === 'spreadsheet' || mimeType?.includes('excel') || mimeType === 'text/csv') {
    return '📊';
  } else if (fileType === 'document' || mimeType?.includes('word')) {
    return '📝';
  }
  return '📎';
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Validate file before upload (client-side)
 */
export function validateFile(file: File, options?: { maxSize?: number; allowedTypes?: string[] }): { valid: boolean; error?: string } {
  // Check file type
  if (options?.allowedTypes && !options.allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: `Invalid file type. Allowed types: ${options.allowedTypes.join(', ')}`
    };
  }

  // Check file size
  const maxSize = options?.maxSize || (file.type.startsWith('image/') ? 5 * 1024 * 1024 : 10 * 1024 * 1024);
  if (file.size > maxSize) {
    return {
      valid: false,
      error: `File size too large. Maximum size is ${formatFileSize(maxSize)}`
    };
  }

  return { valid: true };
}

/**
 * Download document (extracts base64 data URL)
 */
export function downloadDocument(fileName: string, fileUrl: string, mimeType?: string): void {
  // If it's a base64 data URL, convert to blob and download
  if (fileUrl.startsWith('data:')) {
    const link = document.createElement('a');
    link.href = fileUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } else {
    // For cloud storage URLs, open in new tab
    window.open(fileUrl, '_blank');
  }
}

/**
 * Preview document in new window/tab
 */
export function previewDocument(fileUrl: string): void {
  if (fileUrl.startsWith('data:')) {
    // For base64, open in new window
    const newWindow = window.open();
    if (newWindow) {
      newWindow.document.write(`<iframe src="${fileUrl}" style="width:100%;height:100%;border:none;"></iframe>`);
    }
  } else {
    // For cloud storage URLs, open directly
    window.open(fileUrl, '_blank');
  }
}


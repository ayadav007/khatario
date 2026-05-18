'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Toast, ToastType } from '@/components/ui/Toast';
import { X, Upload, Loader2, Image as ImageIcon, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/whatsapp/ConfirmDialog';

interface MediaItem {
  id: string;
  filename: string;
  original_filename: string;
  file_type: string;
  file_size: number;
  media_url: string;
  created_at: string;
}

interface MediaLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (mediaUrl: string) => void;
}

export function MediaLibraryModal({ isOpen, onClose, onSelect }: MediaLibraryModalProps) {
  const { business } = useAuth();
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchMedia = useCallback(async () => {
    if (!business?.id || !isOpen) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/media?business_id=${business.id}`);
      const data = await res.json();
      if (data.error) {
        setToast({ message: data.error, type: 'error' });
      } else {
        setMedia(data.media || []);
      }
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to load media', type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [business?.id, isOpen]);

  useEffect(() => {
    if (isOpen) {
      fetchMedia();
    }
  }, [isOpen, fetchMedia]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !business?.id) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setToast({ message: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.', type: 'error' });
      return;
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      setToast({ message: 'File size too large. Maximum size is 5MB.', type: 'error' });
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('business_id', business.id);
      formData.append('file', file);

      const res = await fetch('/api/whatsapp/media', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (data.error) {
        setToast({ message: data.error, type: 'error' });
      } else {
        setToast({ message: 'Image uploaded successfully', type: 'success' });
        await fetchMedia(); // Refresh list
      }
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to upload image', type: 'error' });
    } finally {
      setUploading(false);
      // Reset file input
      e.target.value = '';
    }
  };

  const executeDeleteMedia = async (mediaId: string) => {
    if (!business?.id) return;

    try {
      const res = await fetch(`/api/whatsapp/media?id=${mediaId}&business_id=${business.id}`, {
        method: 'DELETE',
      });

      const data = await res.json();
      if (data.error) {
        setToast({ message: data.error, type: 'error' });
      } else {
        setToast({ message: 'Image deleted successfully', type: 'success' });
        await fetchMedia(); // Refresh list
      }
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to delete image', type: 'error' });
    }
  };

  const handleDelete = (mediaId: string) => {
    if (!business?.id) return;
    setConfirmDialog({
      title: 'Confirm',
      message: 'Are you sure you want to delete this image?',
      onConfirm: () => {
        void executeDeleteMedia(mediaId).finally(() => setConfirmDialog(null));
      },
    });
  };

  const handleSelect = (mediaUrl: string) => {
    onSelect(mediaUrl);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <Card padding="lg" className="w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">Media Library</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Upload Section */}
        <div className="mb-4 pb-4 border-b">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
            onChange={handleFileUpload}
            disabled={uploading}
            className="hidden"
            id="media-upload-input"
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            variant="secondary"
            className="cursor-pointer"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Upload New Image
              </>
            )}
          </Button>
          <p className="text-xs text-gray-500 mt-1">
            Supported formats: JPEG, PNG, GIF, WebP (max 5MB)
          </p>
        </div>

        {/* Media Grid */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            </div>
          ) : media.length === 0 ? (
            <div className="text-center py-12">
              <ImageIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 mb-4">No images in library</p>
              <p className="text-sm text-gray-500">Upload an image to get started</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {media.map((item) => (
                <div
                  key={item.id}
                  className="group relative border border-gray-200 rounded-lg overflow-hidden hover:border-primary-500 transition-colors cursor-pointer"
                  onClick={() => handleSelect(item.media_url)}
                >
                  <div className="aspect-square bg-gray-100 flex items-center justify-center overflow-hidden">
                    <img
                      src={item.media_url}
                      alt={item.original_filename}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelect(item.media_url);
                        }}
                      >
                        Select
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="bg-white"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(item.id);
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="p-2 bg-white">
                    <p className="text-xs text-gray-600 truncate" title={item.original_filename}>
                      {item.original_filename}
                    </p>
                    <p className="text-xs text-gray-400">
                      {(item.file_size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Toast */}
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
        <ConfirmDialog
          isOpen={!!confirmDialog}
          title={confirmDialog?.title || ''}
          message={confirmDialog?.message || ''}
          variant="danger"
          confirmLabel="Confirm"
          onConfirm={() => {
            confirmDialog?.onConfirm();
          }}
          onCancel={() => setConfirmDialog(null)}
        />
      </Card>
    </div>
  );
}


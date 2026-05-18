'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import ReactCrop, { type Crop, convertToPixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Upload, X, FileText, Image as ImageIcon, AlertCircle, Loader2, Camera, FolderOpen } from 'lucide-react';

async function cropImageRegionToBlob(
  imageSrc: string,
  areaPixels: { x: number; y: number; width: number; height: number },
  jpegQuality = 0.92
): Promise<Blob> {
  const img = new window.Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Image failed to load'));
    img.src = imageSrc;
  });
  const sx = Math.max(0, Math.round(areaPixels.x));
  const sy = Math.max(0, Math.round(areaPixels.y));
  const sw = Math.min(img.naturalWidth - sx, Math.max(1, Math.round(areaPixels.width)));
  const sh = Math.min(img.naturalHeight - sy, Math.max(1, Math.round(areaPixels.height)));
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Crop failed'))),
      'image/jpeg',
      jpegQuality
    );
  });
}

interface InvoiceUploaderProps {
  businessId: string;
  /** May return a Promise (e.g. catalog matching before closing). */
  onExtractionComplete: (data: any) => void | Promise<void>;
  onError: (error: string) => void;
}

export function InvoiceUploader({ businessId, onExtractionComplete, onError }: InvoiceUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [stagedImageFile, setStagedImageFile] = useState<File | null>(null);
  const [stagedPreviewUrl, setStagedPreviewUrl] = useState<string | null>(null);
  const [cropUiBusy, setCropUiBusy] = useState(false);
  const [reactImgCrop, setReactImgCrop] = useState<Crop>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const stagedPreviewUrlRef = useRef<string | null>(null);
  const cropImgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    stagedPreviewUrlRef.current = stagedPreviewUrl;
  }, [stagedPreviewUrl]);

  useEffect(() => {
    return () => {
      const u = stagedPreviewUrlRef.current;
      if (u) URL.revokeObjectURL(u);
    };
  }, []);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const preprocessImage = useCallback((file: File): Promise<File> => {
    return new Promise((resolve, reject) => {
      const img = new window.Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        try {
          const MIN_LONG_SIDE = 1500;
          const MAX_LONG_SIDE = 3000;
          let { width, height } = img;
          const longSide = Math.max(width, height);

          if (longSide < MIN_LONG_SIDE) {
            const scale = MIN_LONG_SIDE / longSide;
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          } else if (longSide > MAX_LONG_SIDE) {
            const scale = MAX_LONG_SIDE / longSide;
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d')!;

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);

          // Unsharp mask: sharpen text edges
          const imageData = ctx.getImageData(0, 0, width, height);
          const blurred = ctx.getImageData(0, 0, width, height);
          const src = imageData.data;
          const dst = blurred.data;

          // Simple 3x3 box blur for the "blurred" copy
          for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
              const i = (y * width + x) * 4;
              for (let c = 0; c < 3; c++) {
                dst[i + c] = (
                  src[((y - 1) * width + x - 1) * 4 + c] +
                  src[((y - 1) * width + x) * 4 + c] +
                  src[((y - 1) * width + x + 1) * 4 + c] +
                  src[(y * width + x - 1) * 4 + c] +
                  src[(y * width + x) * 4 + c] +
                  src[(y * width + x + 1) * 4 + c] +
                  src[((y + 1) * width + x - 1) * 4 + c] +
                  src[((y + 1) * width + x) * 4 + c] +
                  src[((y + 1) * width + x + 1) * 4 + c]
                ) / 9;
              }
            }
          }

          // Apply unsharp: original + amount * (original - blurred)
          const amount = 0.4;
          for (let i = 0; i < src.length; i += 4) {
            for (let c = 0; c < 3; c++) {
              const val = src[i + c] + amount * (src[i + c] - dst[i + c]);
              src[i + c] = Math.max(0, Math.min(255, Math.round(val)));
            }
          }
          ctx.putImageData(imageData, 0, 0);

          canvas.toBlob(
            (blob) => {
              if (!blob) { resolve(file); return; }
              const processed = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
                type: 'image/jpeg',
              });
              resolve(processed);
            },
            'image/jpeg',
            0.85
          );
        } catch {
          resolve(file);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(file);
      };
      img.src = objectUrl;
    });
  }, []);

  const revokePreviewUrl = useCallback((url: string | null) => {
    if (!url) return;
    URL.revokeObjectURL(url);
  }, []);

  const discardStagedImage = useCallback(() => {
    setStagedPreviewUrl((prev) => {
      revokePreviewUrl(prev);
      return null;
    });
    setStagedImageFile(null);
    setReactImgCrop(undefined);
  }, [revokePreviewUrl]);

  const handleFileSelect = useCallback(
    (file: File) => {
      const allowedTypes = [
        'application/pdf',
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'image/bmp',
        'image/tiff',
      ];

      if (!allowedTypes.includes(file.type)) {
        onError('Invalid file type. Please upload PDF, JPG, PNG, GIF, BMP, or TIFF files');
        return;
      }

      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        onError('File size too large. Maximum size is 10MB');
        return;
      }

      discardStagedImage();
      setSelectedFile(null);

      if (file.type === 'application/pdf') {
        setSelectedFile(file);
        return;
      }

      setStagedImageFile(file);
      setStagedPreviewUrl(URL.createObjectURL(file));
      setReactImgCrop(undefined);
    },
    [discardStagedImage, onError],
  );

  const confirmStagedImage = useCallback(
    async (opts: { useCrop: boolean }) => {
      if (!stagedImageFile || !stagedPreviewUrl) return;

      setCropUiBusy(true);
      try {
        let fileBeforePreprocess = stagedImageFile;
        if (opts.useCrop) {
          if (!reactImgCrop || reactImgCrop.width <= 0 || reactImgCrop.height <= 0) {
            onError('Adjust the rectangle so it covers your invoice—drag corners or edges—or skip crop.');
            return;
          }
          const imgEl = cropImgRef.current;
          if (!imgEl || !imgEl.complete || imgEl.naturalWidth < 1 || imgEl.naturalHeight < 1) {
            onError('Image still loading — wait for the preview, then try again.');
            return;
          }
          let pixelCrop: { x: number; y: number; width: number; height: number };
          try {
            pixelCrop = convertToPixelCrop(reactImgCrop, imgEl.naturalWidth, imgEl.naturalHeight);
          } catch {
            onError('Could not compute crop.');
            return;
          }
          if (pixelCrop.width < 16 || pixelCrop.height < 16) {
            onError('Crop area is too small. Drag the corners to include more of the bill.');
            return;
          }
          try {
            const blob = await cropImageRegionToBlob(stagedPreviewUrl, pixelCrop);
            fileBeforePreprocess = new File(
              [blob],
              stagedImageFile.name.replace(/\.[^.]+$/, '') + '-crop.jpg',
              { type: 'image/jpeg' },
            );
          } catch {
            onError('We could not apply the crop. Try skipping crop or use another image.');
            return;
          }
        }

        let processed = await preprocessImage(fileBeforePreprocess);
        discardStagedImage();
        setSelectedFile(processed);
      } finally {
        setCropUiBusy(false);
      }
    },
    [discardStagedImage, onError, preprocessImage, reactImgCrop, stagedImageFile, stagedPreviewUrl],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        handleFileSelect(files[0]);
      }
    },
    [handleFileSelect],
  );

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleUploadAndExtract = async () => {
    if (!selectedFile) return;

    setIsProcessing(true);
    setProgress(0);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('business_id', businessId);

      // Simulate progress
      const progressInterval = setInterval(() => {
        setProgress(prev => Math.min(prev + 10, 90));
      }, 1000);

      const response = await fetch('/api/invoices/extract', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      clearInterval(progressInterval);
      setProgress(100);

      if (response.ok) {
        const result = await response.json();
        
        if (result.success) {
          await Promise.resolve(onExtractionComplete(result));
          setSelectedFile(null);
        } else {
          onError(result.error || 'Extraction failed');
        }
      } else {
        const error = await response.json();
        
        if (response.status === 503) {
          onError('Invoice extraction failed. Please check that the GROQ_API_KEY is configured in .env');
        } else {
          onError(error.error || 'Failed to extract invoice data');
        }
      }
    } catch (error: any) {
      console.error('Upload error:', error);
      onError(error.message || 'An error occurred during upload');
    } finally {
      setIsProcessing(false);
      setProgress(0);
    }
  };

  const handleRemoveFile = () => {
    discardStagedImage();
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  const getFileIcon = (file: File) => {
    if (file.type === 'application/pdf') {
      return <FileText className="w-8 h-8 text-red-500" />;
    }
    return <ImageIcon className="w-8 h-8 text-gray-500" />;
  };

  return (
    <div className="w-full">
      {stagedPreviewUrl && stagedImageFile ? (
        <div className="border border-border rounded-lg bg-white p-4 space-y-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">Preview &amp; crop (images only)</h3>
          <p className="text-xs text-text-secondary mt-0.5 max-w-xl">
                Drag corners or edges. If the invoice is tall,{' '}
                <span className="font-medium text-text-primary">scroll inside the grey area</span> to reach the
                bottom handles. The whole image stays selectable.
              </p>
              <p className="text-xs text-text-muted mt-1 truncate" title={stagedImageFile.name}>
                {stagedImageFile.name}
              </p>
            </div>
          </div>

          <div
            className="w-full max-h-[min(85vh,800px)] overflow-y-auto overflow-x-hidden rounded-lg border border-gray-200 bg-gray-100 py-2"
            style={
              {
                ['--rc-border-color' as string]: 'rgba(17,24,39,0.92)',
                ['--rc-drag-handle-bg-colour' as string]: 'rgba(17,24,39,0.78)',
                ['--rc-drag-handle-size' as string]: '14px',
                ['--rc-drag-bar-size' as string]: '8px',
              } as React.CSSProperties
            }
          >
            <ReactCrop
              crop={reactImgCrop}
              onChange={(_, pct) => setReactImgCrop(pct)}
              ruleOfThirds
              keepSelection
              disabled={cropUiBusy}
              className="block w-full max-w-full"
            >
              <img
                ref={cropImgRef}
                src={stagedPreviewUrl}
                alt="Invoice preview for cropping"
                className="block h-auto w-full max-w-full object-contain select-none"
                draggable={false}
                onLoad={(e) => {
                  const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
                  if (w > 0 && h > 0) {
                    setReactImgCrop({ unit: '%', x: 0, y: 0, width: 100, height: 100 });
                  }
                }}
              />
            </ReactCrop>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <button
              type="button"
              disabled={cropUiBusy}
              onClick={() => {
                discardStagedImage();
                setSelectedFile(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
                if (cameraInputRef.current) cameraInputRef.current.value = '';
                setTimeout(() => fileInputRef.current?.click(), 0);
              }}
              className="w-full sm:w-auto px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Choose another file
            </button>
            <button
              type="button"
              disabled={cropUiBusy}
              onClick={() => {
                discardStagedImage();
                if (fileInputRef.current) fileInputRef.current.value = '';
                if (cameraInputRef.current) cameraInputRef.current.value = '';
              }}
              className="w-full sm:w-auto px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={cropUiBusy}
              onClick={() => void confirmStagedImage({ useCrop: false })}
              className="w-full sm:w-auto px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Skip crop — use full image
            </button>
            <button
              type="button"
              disabled={cropUiBusy}
              onClick={() => void confirmStagedImage({ useCrop: true })}
              className="w-full sm:w-auto sm:ml-auto px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:bg-gray-400 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
            >
              {cropUiBusy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Preparing…
                </>
              ) : (
                'Use cropped area'
              )}
            </button>
          </div>
        </div>
      ) : !selectedFile ? (
        <>
          {isMobile ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-xl p-5 hover:border-gray-400 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  <Camera className="w-8 h-8 text-gray-500" />
                  <span className="text-sm font-medium text-gray-700">Take Photo</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-xl p-5 hover:border-gray-400 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  <FolderOpen className="w-8 h-8 text-gray-500" />
                  <span className="text-sm font-medium text-gray-700">Choose File</span>
                </button>
              </div>
              <p className="text-xs text-gray-500 text-center">
                PDF, JPG, PNG, GIF, BMP, TIFF (max 10MB)
              </p>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileInputChange}
                className="hidden"
              />
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.gif,.bmp,.tiff"
                onChange={handleFileInputChange}
                className="hidden"
              />
            </div>
          ) : (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`
                border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
                ${isDragging 
                  ? 'border-gray-400 bg-gray-50' 
                  : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
                }
              `}
            >
              <Upload className={`w-12 h-12 mx-auto mb-4 ${isDragging ? 'text-gray-700' : 'text-gray-400'}`} />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Upload Invoice
              </h3>
              <p className="text-sm text-gray-600 mb-2">
                Drag and drop an invoice file here, or click to browse
              </p>
              <p className="text-xs text-gray-500">
                Supported: PDF, JPG, PNG, GIF, BMP, TIFF (max 10MB)
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.gif,.bmp,.tiff"
                onChange={handleFileInputChange}
                className="hidden"
              />
            </div>
          )}
        </>
      ) : (
        <div className="border border-gray-300 rounded-lg p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center space-x-3 flex-1">
              {getFileIcon(selectedFile)}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {selectedFile.name}
                </p>
                <p className="text-xs text-gray-500">
                  {(selectedFile.size / 1024).toFixed(2)} KB
                </p>
              </div>
            </div>
            <button
              onClick={handleRemoveFile}
              disabled={isProcessing}
              className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {isProcessing && (
            <div className="mb-4">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-gray-600">Processing invoice...</span>
                <span className="text-gray-900 font-medium">{progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-2">
                This may take 15-30 seconds depending on the file size and complexity
              </p>
            </div>
          )}

          <button
            onClick={handleUploadAndExtract}
            disabled={isProcessing}
            className="w-full bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center space-x-2 transition-colors"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Extracting Data...</span>
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                <span>Extract Invoice Data</span>
              </>
            )}
          </button>
        </div>
      )}

      <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start space-x-2">
          <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">How it works:</p>
            <ol className="list-decimal list-inside space-y-1 text-xs">
              <li>Upload your invoice — images open in a crop step first.</li>
              <li>For photos, drag corners/edges so the scanner box covers exactly the bill (optional).</li>
              <li>Our system reads supplier, line items, and amounts.</li>
              <li>Review edits, then the purchase form auto-fills.</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

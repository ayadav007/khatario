'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useRef } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Upload, Download, X, Image as ImageIcon, FileImage, Loader2, CheckCircle, Info } from 'lucide-react';

interface ImageFile {
  file: File;
  originalSize: number;
  compressedSize: number;
  compressedBlob: Blob | null;
  preview: string;
  quality: number;
}

export default function ImageSizeReducerPage() {
  const [images, setImages] = useState<ImageFile[]>([]);
  const [quality, setQuality] = useState(80);
  const [maxWidth, setMaxWidth] = useState(1920);
  const [maxHeight, setMaxHeight] = useState(1080);
  const [format, setFormat] = useState<'jpeg' | 'webp' | 'png'>('jpeg');
  const [processing, setProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const compressImage = async (file: File, quality: number, maxWidth: number, maxHeight: number, format: string): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // Calculate new dimensions maintaining aspect ratio
          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = width * ratio;
            height = height * ratio;
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Could not get canvas context'));
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve(blob);
              } else {
                reject(new Error('Failed to compress image'));
              }
            },
            `image/${format}`,
            quality / 100
          );
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setProcessing(true);

    const newImages: ImageFile[] = [];

    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;

      const preview = URL.createObjectURL(file);
      
      try {
        const compressedBlob = await compressImage(file, quality, maxWidth, maxHeight, format);
        
        newImages.push({
          file,
          originalSize: file.size,
          compressedSize: compressedBlob.size,
          compressedBlob,
          preview,
          quality,
        });
      } catch (error) {
        console.error('Error compressing image:', error);
      }
    }

    setImages(prev => [...prev, ...newImages]);
    setProcessing(false);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const recompressImage = async (index: number) => {
    const image = images[index];
    if (!image) return;

    setProcessing(true);
    try {
      const compressedBlob = await compressImage(image.file, quality, maxWidth, maxHeight, format);
      
      setImages(prev => prev.map((img, i) => 
        i === index 
          ? { ...img, compressedBlob, compressedSize: compressedBlob.size, quality }
          : img
      ));
    } catch (error) {
      console.error('Error recompressing:', error);
    } finally {
      setProcessing(false);
    }
  };

  const downloadImage = (index: number) => {
    const image = images[index];
    if (!image || !image.compressedBlob) return;

    const url = URL.createObjectURL(image.compressedBlob);
    const a = document.createElement('a');
    a.href = url;
    const originalName = image.file.name.replace(/\.[^/.]+$/, '');
    a.download = `${originalName}_compressed.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const removeImage = (index: number) => {
    const image = images[index];
    URL.revokeObjectURL(image.preview);
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const downloadAll = () => {
    images.forEach((_, index) => downloadImage(index));
  };

  const totalOriginalSize = images.reduce((sum, img) => sum + img.originalSize, 0);
  const totalCompressedSize = images.reduce((sum, img) => sum + img.compressedSize, 0);
  const totalSavings = totalOriginalSize - totalCompressedSize;
  const savingsPercent = totalOriginalSize > 0 ? ((totalSavings / totalOriginalSize) * 100).toFixed(1) : '0';

  return (
    
      <div className="space-y-6 max-w-6xl mx-auto">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <FileImage className="w-6 h-6 text-primary-500" />
            Image Size Reducer
          </h1>
          <p className="text-text-secondary text-sm mt-1">
            Compress and reduce image file sizes while maintaining quality
          </p>
        </div>

        {/* Settings Card */}
        <Card padding="md" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Quality */}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Quality: {quality}%
              </label>
              <input
                type="range"
                min="10"
                max="100"
                step="5"
                value={quality}
                onChange={(e) => {
                  const newQuality = parseInt(e.target.value);
                  setQuality(newQuality);
                  // Recompress all images
                  images.forEach((_, index) => recompressImage(index));
                }}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary-500"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>Low</span>
                <span>High</span>
              </div>
            </div>

            {/* Max Width */}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Max Width: {maxWidth}px
              </label>
              <input
                type="range"
                min="100"
                max="4000"
                step="100"
                value={maxWidth}
                onChange={(e) => {
                  setMaxWidth(parseInt(e.target.value));
                  images.forEach((_, index) => recompressImage(index));
                }}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary-500"
              />
            </div>

            {/* Max Height */}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Max Height: {maxHeight}px
              </label>
              <input
                type="range"
                min="100"
                max="4000"
                step="100"
                value={maxHeight}
                onChange={(e) => {
                  setMaxHeight(parseInt(e.target.value));
                  images.forEach((_, index) => recompressImage(index));
                }}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary-500"
              />
            </div>
          </div>

          {/* Format Selection */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Output Format
            </label>
            <div className="flex gap-2">
              {(['jpeg', 'webp', 'png'] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => {
                    setFormat(fmt);
                    images.forEach((_, index) => recompressImage(index));
                  }}
                  className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                    format === fmt
                      ? 'bg-primary-500 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {fmt.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </Card>

        {/* Upload Area */}
        <Card padding="md">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            className="hidden"
            id="image-upload"
          />
          <label
            htmlFor="image-upload"
            className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <Upload className="w-12 h-12 text-gray-400 mb-4" />
            <div className="text-center">
              <div className="text-lg font-medium text-gray-700 mb-1">
                Click to upload images
              </div>
              <div className="text-sm text-gray-500">
                PNG, JPG, JPEG, WEBP (Multiple files supported)
              </div>
            </div>
          </label>
        </Card>

        {/* Summary */}
        {images.length > 0 && (
          <Card padding="md" className="bg-success-50 border-success-200">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-success-600 mb-1">Total Images</div>
                <div className="text-2xl font-bold text-success-700">{images.length}</div>
              </div>
              <div>
                <div className="text-xs text-success-600 mb-1">Original Size</div>
                <div className="text-2xl font-bold text-success-700">{formatBytes(totalOriginalSize)}</div>
              </div>
              <div>
                <div className="text-xs text-success-600 mb-1">Compressed Size</div>
                <div className="text-2xl font-bold text-success-700">{formatBytes(totalCompressedSize)}</div>
              </div>
              <div>
                <div className="text-xs text-success-600 mb-1">Savings</div>
                <div className="text-2xl font-bold text-success-700">
                  {formatBytes(totalSavings)} ({savingsPercent}%)
                </div>
              </div>
            </div>
            <Button
              onClick={downloadAll}
              className="mt-4 w-full bg-success-600 hover:bg-success-700"
            >
              <Download className="w-4 h-4 mr-2" />
              Download All Compressed Images
            </Button>
          </Card>
        )}

        {/* Images List */}
        {images.length > 0 && (
          <div className="space-y-4">
            {images.map((image, index) => {
              const reductionPercent = ((1 - image.compressedSize / image.originalSize) * 100).toFixed(1);
              return (
                <Card key={index} padding="md">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Preview */}
                    <div className="relative">
                      <img
                        src={image.preview}
                        alt={`Preview ${index + 1}`}
                        className="w-full h-48 object-contain rounded-lg border border-border"
                      />
                      <button
                        onClick={() => removeImage(index)}
                        className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Info */}
                    <div className="space-y-2">
                      <div className="font-medium text-text-primary truncate">{image.file.name}</div>
                      <div className="text-sm space-y-1">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Original:</span>
                          <span className="font-medium">{formatBytes(image.originalSize)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Compressed:</span>
                          <span className="font-medium text-success-600">{formatBytes(image.compressedSize)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Reduction:</span>
                          <span className="font-bold text-success-700">{reductionPercent}%</span>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2">
                      <Button
                        onClick={() => downloadImage(index)}
                        className="w-full"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => recompressImage(index)}
                        disabled={processing}
                      >
                        {processing ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Processing...
                          </>
                        ) : (
                          'Recompress'
                        )}
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Info Card */}
        <Card padding="md" className="bg-slate-50 border-primary-100">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-primary-600 mt-0.5 shrink-0" />
            <div className="text-sm text-primary-900">
              <div className="font-bold mb-2">Tips for Best Results:</div>
              <ul className="list-disc list-inside space-y-1 text-primary-800 text-xs">
                <li>JPEG: Best for photos, smaller file size</li>
                <li>WebP: Modern format, best compression with quality</li>
                <li>PNG: Best for images with transparency, larger file size</li>
                <li>Lower quality = smaller file but may reduce image clarity</li>
                <li>Resizing large images can significantly reduce file size</li>
              </ul>
            </div>
          </div>
        </Card>
      </div>
    
  );
}


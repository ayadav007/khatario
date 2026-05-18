'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, Download, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, RotateCw } from 'lucide-react';
import { format } from 'date-fns';

interface MediaLightboxProps {
  media: {
    url: string;
    type: 'image' | 'video';
    caption?: string;
    timestamp: string;
    sender?: string;
  };
  allMedia: Array<{
    id: string;
    url: string;
    type: 'image' | 'video';
    caption?: string;
    timestamp: string;
    sender?: string;
  }>;
  currentIndex: number;
  onClose: () => void;
  onNavigate?: (index: number) => void;
}

export function MediaLightbox({ 
  media, 
  allMedia, 
  currentIndex, 
  onClose, 
  onNavigate 
}: MediaLightboxProps) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && currentIndex > 0 && onNavigate) {
        onNavigate(currentIndex - 1);
      }
      if (e.key === 'ArrowRight' && currentIndex < allMedia.length - 1 && onNavigate) {
        onNavigate(currentIndex + 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, allMedia.length, onClose, onNavigate]);

  // Reset zoom/rotation when media changes
  useEffect(() => {
    setZoom(1);
    setRotation(0);
  }, [media.url]);

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const response = await fetch(media.url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `media_${Date.now()}.${media.type === 'image' ? 'jpg' : 'mp4'}`;
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

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.25, 0.5));
  const handleRotate = () => setRotation(prev => (prev + 90) % 360);

  const canNavigateLeft = currentIndex > 0;
  const canNavigateRight = currentIndex < allMedia.length - 1;

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-95 z-50 flex flex-col"
      onClick={onClose}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 text-white bg-black bg-opacity-50">
        <div className="flex-1">
          {media.sender && (
            <div className="font-medium">{media.sender}</div>
          )}
          <div className="text-sm text-gray-300">
            {format(new Date(media.timestamp), 'MMM dd, yyyy • h:mm a')}
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {media.type === 'image' && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleZoomOut();
                }}
                disabled={zoom <= 0.5}
                className="p-2 hover:bg-white hover:bg-opacity-20 rounded-full transition disabled:opacity-50 disabled:cursor-not-allowed"
                title="Zoom out"
              >
                <ZoomOut className="w-5 h-5" />
              </button>
              <span className="text-sm min-w-[60px] text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleZoomIn();
                }}
                disabled={zoom >= 3}
                className="p-2 hover:bg-white hover:bg-opacity-20 rounded-full transition disabled:opacity-50 disabled:cursor-not-allowed"
                title="Zoom in"
              >
                <ZoomIn className="w-5 h-5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRotate();
                }}
                className="p-2 hover:bg-white hover:bg-opacity-20 rounded-full transition"
                title="Rotate"
              >
                <RotateCw className="w-5 h-5" />
              </button>
            </>
          )}
          
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDownload();
            }}
            disabled={isDownloading}
            className="p-2 hover:bg-white hover:bg-opacity-20 rounded-full transition disabled:opacity-50"
            title="Download"
          >
            <Download className={`w-5 h-5 ${isDownloading ? 'animate-bounce' : ''}`} />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="p-2 hover:bg-white hover:bg-opacity-20 rounded-full transition"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Media Content */}
      <div className="flex-1 flex items-center justify-center p-4 relative overflow-hidden">
        {/* Navigation Arrows */}
        {canNavigateLeft && onNavigate && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(currentIndex - 1);
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-3 bg-black bg-opacity-50 hover:bg-opacity-70 rounded-full transition text-white"
            title="Previous"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        <div 
          className="max-w-full max-h-full flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          {media.type === 'image' ? (
            <img
              src={media.url}
              alt={media.caption || 'Image'}
              className="max-w-full max-h-[calc(100vh-200px)] object-contain transition-transform duration-200"
              style={{
                transform: `scale(${zoom}) rotate(${rotation}deg)`,
                cursor: zoom > 1 ? 'move' : 'default'
              }}
              draggable={false}
            />
          ) : (
            <video
              src={media.url}
              controls
              autoPlay
              className="max-w-full max-h-[calc(100vh-200px)] object-contain"
              style={{
                maxWidth: '90vw'
              }}
            >
              Your browser does not support video playback.
            </video>
          )}
        </div>

        {canNavigateRight && onNavigate && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(currentIndex + 1);
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 bg-black bg-opacity-50 hover:bg-opacity-70 rounded-full transition text-white"
            title="Next"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </div>

      {/* Caption */}
      {media.caption && (
        <div className="p-4 text-white bg-black bg-opacity-50 text-center">
          <p className="max-w-2xl mx-auto">{media.caption}</p>
        </div>
      )}

      {/* Media Counter */}
      {allMedia.length > 1 && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 px-3 py-1 bg-black bg-opacity-70 text-white text-sm rounded-full">
          {currentIndex + 1} / {allMedia.length}
        </div>
      )}
    </div>
  );
}

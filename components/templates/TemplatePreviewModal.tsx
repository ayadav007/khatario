'use client';

import React from 'react';
import { X, ZoomIn, ZoomOut, Download, Check } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TemplatePreviewPlaceholder } from './TemplatePreviewPlaceholder';

interface TemplatePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  template: {
    id: string;
    name: string;
    description: string;
    active: boolean;
    color: string;
    isComposition?: boolean;
    features: string[];
  };
  onActivate?: () => void;
  customSettings?: any;
}

export const TemplatePreviewModal: React.FC<TemplatePreviewModalProps> = ({
  isOpen,
  onClose,
  template,
  onActivate,
  customSettings
}) => {
  const [zoom, setZoom] = React.useState(100);
  
  // Build iframe URL with custom settings if provided
  const getPreviewUrl = () => {
    let url = `/api/template-preview?template_id=${template.id}`;
    if (customSettings) {
      url += `&settings=${encodeURIComponent(JSON.stringify(customSettings))}`;
    }
    return url;
  };

  if (!isOpen) return null;

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 10, 150));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 10, 50));

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 transition-opacity"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div 
          className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col pointer-events-auto transform transition-all"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div className="flex items-center gap-4">
              <div 
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: `${template.color}20` }}
              >
                <div className="w-6 h-6 rounded-md" style={{ backgroundColor: template.color }} />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">{template.name}</h2>
                <p className="text-sm text-gray-600">{template.description}</p>
              </div>
              {template.active && (
                <div className="ml-4 px-3 py-1.5 bg-green-100 text-green-700 rounded-lg text-xs font-bold flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" />
                  ACTIVE
                </div>
              )}
            </div>
            
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition"
            >
              <X className="w-6 h-6 text-gray-500" />
            </button>
          </div>

          {/* Toolbar */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-gray-50">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 font-medium">Zoom:</span>
              <button
                onClick={handleZoomOut}
                disabled={zoom <= 50}
                className="p-1.5 hover:bg-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-sm font-mono font-bold text-gray-900 w-12 text-center">
                {zoom}%
              </span>
              <button
                onClick={handleZoomIn}
                disabled={zoom >= 150}
                className="p-1.5 hover:bg-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm">
                <Download className="w-4 h-4 mr-2" />
                Download PDF
              </Button>
              {!template.active && onActivate && (
                <Button variant="primary" size="sm" onClick={onActivate}>
                  <Check className="w-4 h-4 mr-2" />
                  Activate Template
                </Button>
              )}
            </div>
          </div>

          {/* Preview Area */}
          <div className="flex-1 overflow-auto bg-gradient-to-br from-gray-100 to-gray-200 p-8">
            <div 
              className="mx-auto transition-all duration-200 shadow-2xl bg-white"
              style={{
                width: `${(794 * zoom) / 100}px`,
                transform: `scale(1)`,
                transformOrigin: 'top center'
              }}
            >
              <iframe
                src={getPreviewUrl()}
                className="w-full border-0"
                style={{ 
                  height: `${(1123 * zoom) / 100}px`,
                  aspectRatio: '794/1123'
                }}
                title={`${template.name} Preview`}
                key={JSON.stringify(customSettings)} // Force reload when settings change
              />
            </div>
          </div>

          {/* Footer Info */}
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-2">Template Features:</h4>
                <div className="flex flex-wrap gap-2">
                  {template.features.map((feature, idx) => (
                    <span 
                      key={idx}
                      className="px-3 py-1 bg-white text-gray-700 text-xs font-medium rounded-lg border border-gray-200"
                    >
                      {feature}
                    </span>
                  ))}
                </div>
              </div>
              <div className="text-right text-xs text-gray-500">
                <p>Preview generated from template: <span className="font-mono">{template.id}</span></p>
                <p className="mt-1">Actual invoices will use your business data</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};


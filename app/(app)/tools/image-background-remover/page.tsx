'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useRef, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Upload, Download, X, Image as ImageIcon, Wand2, Loader2, Info, AlertCircle, ExternalLink, Sparkles, Eraser } from 'lucide-react';

interface ImageFile {
  file: File;
  preview: string;
  processed: string | null;
  processing: boolean;
  maskBlob: Blob | null; // Store for future restoration features
}

declare global {
  interface Window {
    SelfieSegmentation: any;
  }
}

export default function ImageBackgroundRemoverPage() {
  const [image, setImage] = useState<ImageFile | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [loadingModel, setLoadingModel] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [brushSize, setBrushSize] = useState(20);
  const [isDrawing, setIsDrawing] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const editCanvasRef = useRef<HTMLCanvasElement>(null);
  const segmentationRef = useRef<any>(null);

  // Load MediaPipe scripts
  useEffect(() => {
    if (window.SelfieSegmentation) {
      setModelLoaded(true);
      return;
    }

    setLoadingModel(true);
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js';
    script.async = true;
    script.onload = () => {
      initModel();
    };
    script.onerror = () => {
      setError('Failed to load AI model. Please check your internet connection.');
      setLoadingModel(false);
    };
    document.body.appendChild(script);

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  const initModel = () => {
    try {
      const selfieSegmentation = new window.SelfieSegmentation({
        locateFile: (file: string) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`;
        }
      });

      selfieSegmentation.setOptions({
        modelSelection: 1, // 1 for landscape/complex (higher quality)
      });

      selfieSegmentation.onResults((results: any) => {
        processResults(results);
      });

      segmentationRef.current = selfieSegmentation;
      setModelLoaded(true);
      setLoadingModel(false);
    } catch (err) {
      console.error('Model init error:', err);
      setError('Failed to initialize AI model.');
      setLoadingModel(false);
    }
  };

  const processResults = (results: any) => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = results.image;
    canvas.width = width;
    canvas.height = height;

    // Apply probability mask with softening
    ctx.globalCompositeOperation = 'copy';
    ctx.filter = 'blur(1.5px)'; // Tightens the mask to reduce haloing
    ctx.drawImage(results.segmentationMask, 0, 0, width, height);
    
    ctx.globalCompositeOperation = 'source-in';
    ctx.filter = 'none';
    ctx.drawImage(results.image, 0, 0, width, height);

    const processedUrl = canvas.toDataURL('image/png');
    setImage(prev => prev ? { ...prev, processed: processedUrl, processing: false, maskBlob: null } : null);
    setProcessing(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    const preview = URL.createObjectURL(file);
    setImage({
      file,
      preview,
      processed: null,
      processing: false,
      maskBlob: null
    });
    setError(null);
    setIsRefining(false);
  };

  const removeBackground = async () => {
    if (!image || !segmentationRef.current) return;

    setProcessing(true);
    setError(null);

    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = image.preview;
      });

      const canvas = canvasRef.current || document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      
      await segmentationRef.current.send({ image: img });
    } catch (err: any) {
      console.error('Error removing background:', err);
      setError('Failed to remove background. Please try a different image.');
      setProcessing(false);
    }
  };

  const downloadImage = () => {
    if (!image?.processed) return;
    const link = document.createElement('a');
    link.download = `khatario_bg_removed_${Date.now()}.png`;
    link.href = image.processed;
    link.click();
  };

  // Manual Refinement
  const startRefining = () => {
    if (!image?.processed) return;
    setIsRefining(true);
    
    setTimeout(() => {
      const canvas = editCanvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        const img = new Image();
        img.onload = () => {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
        };
        img.src = image.processed!;
      }
    }, 100);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !editCanvasRef.current) return;
    const canvas = editCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const x = (clientX - rect.left) * (canvas.width / rect.width);
    const y = (clientY - rect.top) * (canvas.height / rect.height);

    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'destination-out'; // Erase mode

    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const stopDrawing = () => {
    if (isDrawing && editCanvasRef.current) {
      setImage(prev => prev ? { ...prev, processed: editCanvasRef.current!.toDataURL('image/png') } : null);
    }
    setIsDrawing(false);
  };

  const reset = () => {
    if (image) URL.revokeObjectURL(image.preview);
    setImage(null);
    setError(null);
    setIsRefining(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    
      <div className="space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-primary-500" />
              Professional AI Background Remover
            </h1>
            <p className="text-text-secondary text-sm mt-1">
              AI extraction + Magic Brush for pixel-perfect results
            </p>
          </div>
          {loadingModel && (
            <div className="flex items-center gap-2 text-sm text-primary-600 bg-slate-50 px-3 py-1 rounded-full border border-primary-100 animate-pulse">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading AI Engine...
            </div>
          )}
          {modelLoaded && !loadingModel && (
            <div className="flex items-center gap-2 text-sm text-success-600 bg-success-50 px-3 py-1 rounded-full border border-success-100">
              <div className="w-2 h-2 rounded-full bg-success-500 mr-1" />
              Pro AI Ready
            </div>
          )}
        </div>

        {/* Upload Area */}
        {!image && (
          <Card padding="md">
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" id="image-upload" />
            <label htmlFor="image-upload" className="flex flex-col items-center justify-center w-full h-80 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer bg-gray-50 hover:bg-gray-100 transition-all group">
              <div className="p-4 bg-white rounded-full shadow-sm group-hover:scale-110 transition-transform mb-4">
                <Upload className="w-10 h-10 text-primary-500" />
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-gray-700 mb-2">Upload Portrait or Product Photo</div>
                <div className="text-sm text-gray-500 max-w-xs">AI extraction works best with people and clear objects</div>
              </div>
            </label>
          </Card>
        )}

        {/* Error Message */}
        {error && (
          <Card padding="md" className="bg-red-50 border-red-200">
            <div className="flex items-start gap-3 text-red-800">
              <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
              <div><div className="font-bold">Notice</div><div className="text-sm">{error}</div></div>
            </div>
          </Card>
        )}

        {/* Image Processing */}
        {image && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Input Side */}
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Original Image</span>
                <button onClick={reset} className="text-xs text-red-500 hover:underline">Change Image</button>
              </div>
              <Card padding="none" className="overflow-hidden bg-gray-100 flex items-center justify-center min-h-[350px]">
                <img src={image.preview} alt="Original" className="max-w-full max-h-[450px] object-contain" />
              </Card>
            </div>

            {/* Result Side */}
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Processed Result</span>
                {image.processed && (
                  <button onClick={downloadImage} className="text-xs text-primary-600 hover:underline flex items-center gap-1 font-bold">
                    <Download className="w-3 h-3" /> Save PNG
                  </button>
                )}
              </div>
              
              <Card padding="none" className="overflow-hidden bg-gray-100 flex items-center justify-center min-h-[350px] relative border-2 border-primary-50">
                {!image.processed && !processing && (
                  <div className="text-center p-8">
                    <Wand2 className="w-12 h-12 text-primary-200 mx-auto mb-4" />
                    <Button onClick={removeBackground} disabled={!modelLoaded} className="shadow-lg">
                      <Sparkles className="w-4 h-4 mr-2" /> Start Extraction
                    </Button>
                  </div>
                )}

                {processing && (
                  <div className="absolute inset-0 bg-white/90 flex flex-col items-center justify-center z-10">
                    <Loader2 className="w-10 h-10 text-primary-500 animate-spin mb-3" />
                    <div className="font-bold text-primary-900">AI Subject Extraction...</div>
                  </div>
                )}

                {image.processed && (
                  <div className="w-full h-full flex flex-col">
                    <div
                      className="flex-1 flex items-center justify-center bg-white min-h-[350px]"
                      style={{
                        backgroundImage: 'linear-gradient(45deg, #f0f0f0 25%, transparent 25%), linear-gradient(-45deg, #f0f0f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f0f0f0 75%), linear-gradient(-45deg, transparent 75%, #f0f0f0 75%)',
                        backgroundSize: '20px 20px',
                      }}
                    >
                      {!isRefining ? (
                        <img src={image.processed} alt="Result" className="max-w-full max-h-[450px] object-contain drop-shadow-xl" />
                      ) : (
                        <canvas
                          ref={editCanvasRef}
                          onMouseDown={(e) => { setIsDrawing(true); draw(e); }}
                          onMouseMove={draw}
                          onMouseUp={stopDrawing}
                          onMouseLeave={stopDrawing}
                          onTouchStart={(e) => { setIsDrawing(true); draw(e); }}
                          onTouchMove={draw}
                          onTouchEnd={stopDrawing}
                          className="max-w-full max-h-[450px] object-contain cursor-crosshair"
                        />
                      )}
                    </div>
                    
                    <div className="p-3 border-t bg-white">
                      {!isRefining ? (
                        <Button variant="ghost" size="sm" onClick={startRefining} className="w-full text-xs gap-2 border border-dashed border-gray-300">
                          <Eraser className="w-3.5 h-3.5" /> Use Magic Brush to clean edges
                        </Button>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase text-gray-400">Magic Brush Active</span>
                            <Button variant="ghost" size="sm" onClick={() => setIsRefining(false)} className="h-6 text-[10px]">Finish</Button>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] text-gray-500 whitespace-nowrap">Size: {brushSize}px</span>
                            <input type="range" min="2" max="50" value={brushSize} onChange={(e) => setBrushSize(parseInt(e.target.value))} className="w-full h-1 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-primary-500" />
                          </div>
                          <div className="text-[10px] text-primary-600 bg-slate-50 p-1.5 rounded flex items-center gap-1.5">
                            <Info className="w-3 h-3" /> Drag over leftover background to erase it perfectly.
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}

        <canvas ref={canvasRef} className="hidden" />

        {/* Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card padding="md" className="bg-slate-100/50 border-primary-100">
            <div className="flex items-start gap-3 text-primary-900">
              <Sparkles className="w-4 h-4 mt-0.5 shrink-0 text-primary-600" />
              <div className="text-xs italic">The AI extracts the main subject automatically. For complex edges like hair or overlapping objects, use the <b>Magic Brush</b> to manually clean any leftover background.</div>
            </div>
          </Card>
          <Card padding="md" className="bg-success-50/50 border-success-100">
            <div className="flex items-start gap-3 text-success-900">
              <Info className="w-4 h-4 mt-0.5 shrink-0 text-success-600" />
              <div className="text-xs italic">All processing happens locally on your computer. Your private photos never leave this browser and are not stored anywhere.</div>
            </div>
          </Card>
        </div>
      </div>
    
  );
}

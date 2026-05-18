'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera, Loader2, Check } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import toast from 'react-hot-toast';

interface ItemSearchResult {
  id: string;
  name: string;
  code?: string;
  barcode?: string;
  unit: string;
  item_type?: 'goods' | 'service';
  selling_price: number | null;
  purchase_price?: number;
  tax_rate: number;
  hsn_sac?: string;
  current_stock: number;
  image_url?: string;
  has_variants?: boolean;
  variants?: any[];
}

interface ContinuousBarcodeScannerProps {
  onItemScanned: (item: ItemSearchResult, variantId?: string) => void;
  onClose: () => void;
  businessId: string;
}

export const ContinuousBarcodeScanner: React.FC<ContinuousBarcodeScannerProps> = ({
  onItemScanned,
  onClose,
  businessId
}) => {
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastScannedItem, setLastScannedItem] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [isReadyForNextScan, setIsReadyForNextScan] = useState(true);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerIdRef = useRef<string>(`continuous-barcode-scanner-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  const isInitializingRef = useRef(false);
  const initScannerRef = useRef<(() => Promise<void>) | null>(null);
  const formats = ['EAN_13', 'CODE_128', 'QR_CODE', 'UPC_A', 'EAN_8', 'CODE_39', 'CODE_93', 'ITF'];
  const lastScannedBarcodeRef = useRef<string | null>(null);
  const isProcessingRef = useRef(false);

  // Function to play beep sound on successful scan - clearer and more audible
  const playBeepSound = () => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Create a more audible beep with two tones (like a scanner)
      const oscillator1 = audioContext.createOscillator();
      const oscillator2 = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator1.connect(gainNode);
      oscillator2.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      // Two-tone beep: higher frequency for clarity
      oscillator1.frequency.value = 1000; // Higher frequency for clarity
      oscillator2.frequency.value = 1200; // Second tone for richer sound
      oscillator1.type = 'sine';
      oscillator2.type = 'sine';
      
      // Louder and longer beep
      gainNode.gain.setValueAtTime(0.5, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);
      
      oscillator1.start(audioContext.currentTime);
      oscillator2.start(audioContext.currentTime);
      oscillator1.stop(audioContext.currentTime + 0.15);
      oscillator2.stop(audioContext.currentTime + 0.15);
    } catch (err) {
      // Fallback: silently fail if audio context is not available
      console.debug('Could not play beep sound:', err);
    }
  };

  // Search for item by barcode
  const searchItemByBarcode = async (barcode: string): Promise<ItemSearchResult | null> => {
    try {
      const res = await fetch(`/api/items/search?business_id=${businessId}&q=${encodeURIComponent(barcode)}`);
      if (res.ok) {
        const data = await res.json();
        const items = data.items || [];
        
        // Find exact barcode match (prioritized by API)
        const exactMatch = items.find((item: ItemSearchResult) => 
          item.barcode === barcode || 
          item.variants?.some((v: any) => v.barcode === barcode)
        );
        
        if (exactMatch) {
          // If barcode matches a variant, return item with variant info
          const matchingVariant = exactMatch.variants?.find((v: any) => v.barcode === barcode);
          if (matchingVariant) {
            return {
              ...exactMatch,
              variantId: matchingVariant.id,
              variantName: matchingVariant.variant_name,
              variantAttributes: matchingVariant.attributes,
              selling_price: matchingVariant.selling_price ?? exactMatch.selling_price,
              current_stock: matchingVariant.current_stock
            } as any;
          }
          return exactMatch;
        }
        
        // If single result, return it
        if (items.length === 1) {
          return items[0];
        }
        
        // Multiple matches - return first one (user can manually adjust if needed)
        if (items.length > 0) {
          return items[0];
        }
      }
      return null;
    } catch (err) {
      console.error('Search error:', err);
      return null;
    }
  };

  useEffect(() => {
    let isMounted = true;
    
    const initScanner = async () => {
      // Prevent double initialization (React Strict Mode)
      if (isInitializingRef.current) {
        return;
      }
      isInitializingRef.current = true;
      
      // Wait for the container to be in the DOM
      await new Promise(resolve => setTimeout(resolve, 100));
      
      if (!isMounted) {
        isInitializingRef.current = false;
        return;
      }

      // Clean up any existing scanner first
      if (scannerRef.current) {
        try {
          const wasScanning = scannerRef.current.getState && scannerRef.current.getState() === 2; // 2 = scanning
          if (wasScanning) {
            await scannerRef.current.stop();
          }
          await scannerRef.current.clear();
        } catch (err) {
          // Ignore cleanup errors
        }
        scannerRef.current = null;
      }

      // Clear the container element completely
      const containerElement = document.getElementById(scannerIdRef.current);
      if (containerElement) {
        // Remove all child elements
        while (containerElement.firstChild) {
          containerElement.removeChild(containerElement.firstChild);
        }
        // Also clear innerHTML as backup
        containerElement.innerHTML = '';
        
        // Add CSS to prevent duplicate video elements and ensure proper overlay
        const style = document.createElement('style');
        style.id = `scanner-style-${scannerIdRef.current}`;
        style.textContent = `
          #${scannerIdRef.current} video:not(:first-of-type) {
            display: none !important;
          }
          #${scannerIdRef.current} > div {
            position: relative !important;
            width: 100% !important;
            height: 100% !important;
          }
          #${scannerIdRef.current} video {
            width: 100% !important;
            height: 100% !important;
            object-fit: cover !important;
          }
          /* Ensure the qrbox (white frame) is overlaid on the video */
          #${scannerIdRef.current} #qr-shaded-region {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: 100% !important;
            z-index: 10 !important;
            pointer-events: none !important;
          }
          #${scannerIdRef.current} #qr-shaded-region > div {
            position: absolute !important;
          }
          /* Ensure the scanning box frame is visible and centered */
          #${scannerIdRef.current} [id^="qr-shaded-region"] {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            z-index: 10 !important;
          }
        `;
        if (!document.getElementById(style.id)) {
          document.head.appendChild(style);
        }
      }

      if (!isMounted) return;

      try {
        // Check if MediaDevices API is available
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          const isSecure = window.location.protocol === 'https:' || 
                          window.location.hostname === 'localhost' || 
                          window.location.hostname === '127.0.0.1' ||
                          window.location.hostname.endsWith('.local');
          
          if (!isSecure) {
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            let message = 'Camera access requires HTTPS (secure connection). ';
            if (isMobile) {
              message += 'For mobile testing, you can use a tunnel service like ngrok, or set up HTTPS. On desktop, you can access via localhost.';
            } else {
              message += 'For development, access via localhost (http://localhost:3000) or set up HTTPS. For production, HTTPS is required.';
            }
            setError(message);
          } else {
            setError('Camera API not supported in this browser. Please use a modern browser like Chrome, Firefox, or Safari.');
          }
          isInitializingRef.current = false;
          return;
        }

        // First, check camera permission state if Permissions API is available
        let permissionState = 'prompt'; // Default to prompt if API not available
        try {
          if (navigator.permissions && navigator.permissions.query) {
            const permissionResult = await navigator.permissions.query({ name: 'camera' as PermissionName });
            permissionState = permissionResult.state;
            console.log('Camera permission state:', permissionState);
          }
        } catch (permQueryErr) {
          // Permissions API might not be supported, continue anyway
          console.log('Permissions API not available, proceeding with getUserMedia');
        }

        // If permission is denied, show helpful message
        if (permissionState === 'denied') {
          const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
          let instructions = '';
          if (isMobile) {
            instructions = 'On mobile: Go to browser settings → Site settings → Camera → Allow. Then refresh the page.';
          } else {
            instructions = 'Click the camera icon in your browser\'s address bar, then select "Allow". Or go to browser settings → Privacy → Site settings → Camera.';
          }
          setError(`Camera permission is blocked. ${instructions}`);
          setPermissionDenied(true);
          isInitializingRef.current = false;
          return;
        }

        // Request camera permission explicitly
        // This will trigger the browser's permission prompt if state is "prompt"
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          // Permission granted, stop the stream immediately (we just needed permission)
          stream.getTracks().forEach(track => track.stop());
        } catch (permErr: any) {
          console.error('Camera permission error:', permErr);
          if (permErr.name === 'NotAllowedError' || permErr.name === 'PermissionDeniedError') {
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            let instructions = '';
            if (isMobile) {
              instructions = 'Go to browser settings → Site settings → Camera → Allow. Then refresh the page.';
            } else {
              instructions = 'Click the camera icon in your browser\'s address bar, then select "Allow".';
            }
            setError(`Camera permission denied. ${instructions}`);
            setPermissionDenied(true);
            isInitializingRef.current = false;
            return;
          } else if (permErr.name === 'NotFoundError') {
            setError('No camera found on this device.');
            isInitializingRef.current = false;
            return;
          } else if (permErr.name === 'NotReadableError') {
            setError('Camera is already in use by another application. Please close other apps using the camera.');
            isInitializingRef.current = false;
            return;
          }
          // For other errors, continue to try Html5Qrcode.getCameras()
        }

        const html5QrCode = new Html5Qrcode(scannerIdRef.current);
        scannerRef.current = html5QrCode;

        // Get available cameras with better error handling for mobile
        let devices;
        try {
          devices = await Html5Qrcode.getCameras();
        } catch (err: any) {
          console.error('Error getting cameras:', err);
          // If we already checked permission above, provide more specific error
          if (err.message?.includes('NotAllowedError') || err.name === 'NotAllowedError') {
            setError('Camera permission denied. Please allow camera access in your browser settings and refresh the page.');
            setPermissionDenied(true);
            isInitializingRef.current = false;
            return;
          }
          throw err;
        }
        
        if (devices && devices.length > 0) {
          // Better camera selection for mobile and desktop
          // On mobile, prefer back camera; on desktop, use any available
          const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
          
          let selectedCamera = devices[0].id;
          if (isMobile) {
            // Try to find back camera first
            const backCamera = devices.find(d => 
              d.label.toLowerCase().includes('back') || 
              d.label.toLowerCase().includes('rear') ||
              d.label.toLowerCase().includes('environment')
            );
            if (backCamera) {
              selectedCamera = backCamera.id;
            } else {
              // If no back camera found, try the last camera (often back camera on mobile)
              selectedCamera = devices[devices.length - 1].id;
            }
          }

          // Start scanning with improved configuration for better barcode detection
          await html5QrCode.start(
            selectedCamera,
            {
              fps: 30, // Increased FPS for faster scanning
              qrbox: function(viewfinderWidth, viewfinderHeight) {
                // Use much larger scanning area for better barcode detection
                // Barcodes are typically wider than QR codes
                const minEdgePercentage = 0.85; // Use 85% of the smaller dimension (increased from 75%)
                const minEdgeSize = Math.min(viewfinderWidth, viewfinderHeight);
                const qrboxSize = Math.floor(minEdgeSize * minEdgePercentage);
                // For barcodes, use a wider rectangle (better for horizontal barcodes)
                return {
                  width: Math.min(qrboxSize * 1.8, viewfinderWidth * 0.95), // Increased width
                  height: Math.min(qrboxSize * 0.8, viewfinderHeight * 0.6) // Increased height
                };
              },
              aspectRatio: 1.777778, // 16:9 aspect ratio (better for barcodes)
              // @ts-ignore - formatsToSupport is valid but not in TypeScript definitions
              formatsToSupport: formats,
              // @ts-ignore - Additional config for better detection
              disableFlip: false, // Allow image flipping for better detection
              // @ts-ignore
              videoConstraints: {
                facingMode: isMobile ? 'environment' : 'user', // Back camera on mobile
                width: { ideal: 1280 },
                height: { ideal: 720 }
              }
            },
            async (decodedText) => {
              // Success callback - search and add item
              if (decodedText && decodedText.trim()) {
                const barcode = decodedText.trim();
                
                // Prevent duplicate scans of the same barcode
                if (isProcessingRef.current) {
                  return; // Already processing a scan
                }
                
                // Check if this is the same barcode we just scanned (within last 1 second)
                if (lastScannedBarcodeRef.current === barcode) {
                  return; // Ignore duplicate scan
                }
                
                // Mark as processing
                isProcessingRef.current = true;
                lastScannedBarcodeRef.current = barcode;
                
                try {
                  const item = await searchItemByBarcode(barcode);
                  if (item) {
                    // Debug: Log the item structure
                    console.log('[ContinuousScanner] Item found:', {
                      id: item.id,
                      name: item.name,
                      barcode: item.barcode,
                      selling_price: item.selling_price,
                      tax_rate: item.tax_rate,
                      fullItem: item
                    });
                    
                    // Check if name is actually the barcode
                    if (item.name === item.barcode || item.name === barcode) {
                      console.error('[ContinuousScanner] WARNING: Item name is the barcode!', item);
                      toast.error(`Item found but name is barcode: ${item.name}. Check database.`, {
                        duration: 3000,
                      });
                    }
                    
                    setLastScannedItem(item.name);
                    onItemScanned(item, (item as any).variantId);
                    
                    // Play beep sound to indicate successful scan
                    playBeepSound();
                    
                    // Brief pause to prevent duplicate scans (500ms = 0.5 seconds)
                    setIsReadyForNextScan(false);
                    await new Promise(resolve => setTimeout(resolve, 500));
                    setIsReadyForNextScan(true);
                    
                    // Clear the last scanned barcode after delay to allow scanning same item again if needed
                    setTimeout(() => {
                      lastScannedBarcodeRef.current = null;
                    }, 1000);
                  } else {
                    toast.error(`Item with barcode "${barcode}" not found`, {
                      duration: 2000,
                    });
                    // Shorter delay for errors
                    setIsReadyForNextScan(false);
                    await new Promise(resolve => setTimeout(resolve, 300));
                    setIsReadyForNextScan(true);
                    lastScannedBarcodeRef.current = null;
                  }
                } finally {
                  // Reset processing flag after a delay
                  setTimeout(() => {
                    isProcessingRef.current = false;
                  }, 600);
                }
              }
            },
            (errorMessage) => {
              // Error callback - log for debugging but don't show to user
              // Most errors are just "no barcode found" which is normal during scanning
              if (errorMessage && 
                  !errorMessage.includes('No QR code') && 
                  !errorMessage.includes('NotFoundException') &&
                  !errorMessage.includes('No MultiFormat Readers')) {
                // Only log actual errors, not normal "not found" messages
                console.debug('[Continuous Barcode Scanner] Error:', errorMessage);
              }
            }
          );
          
          setIsScanning(true);
        } else {
          setError('No camera found. Please ensure your device has a camera and permissions are granted.');
        }
      } catch (err: any) {
        console.error('Scanner initialization error:', err);
        isInitializingRef.current = false;
        
        // Better error messages for mobile and desktop
        if (err.name === 'NotAllowedError' || err.message?.includes('permission') || err.message?.includes('Permission denied')) {
          setError('Camera permission denied. Please allow camera access in your browser settings and refresh the page.');
          setPermissionDenied(true);
        } else if (err.name === 'NotFoundError' || err.message?.includes('No camera')) {
          setError('No camera found on this device. Please ensure your device has a camera.');
        } else if (err.name === 'NotReadableError' || err.message?.includes('not readable')) {
          setError('Camera is already in use by another application. Please close other apps using the camera.');
        } else if (err.message?.includes('HTTPS') || err.message?.includes('secure context')) {
          setError('Camera access requires HTTPS. Please use a secure connection.');
        } else {
          const errorMsg = err.message || 'Failed to initialize camera scanner.';
          // Provide more helpful error for mobile
          if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
            setError(`Mobile camera error: ${errorMsg}. Please check camera permissions in browser settings.`);
          } else {
            setError(errorMsg);
          }
        }
      }
    };

    initScanner();

    return () => {
      isMounted = false;
      isInitializingRef.current = false;
      stopScanner();
      // Remove the style tag
      const styleTag = document.getElementById(`scanner-style-${scannerIdRef.current}`);
      if (styleTag) {
        styleTag.remove();
      }
    };
  }, []);

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        // Check if scanner is actually running before trying to stop
        try {
          await scannerRef.current.stop();
        } catch (stopErr: any) {
          // Ignore "already stopped" errors
          if (!stopErr.message?.includes('already') && !stopErr.message?.includes('not started')) {
            console.warn('Error stopping scanner:', stopErr);
          }
        }
        
        try {
          await scannerRef.current.clear();
        } catch (clearErr) {
          // Ignore clear errors
        }
        
        // Clear the container element
        const containerElement = document.getElementById(scannerIdRef.current);
        if (containerElement) {
          containerElement.innerHTML = '';
        }
      } catch (err) {
        console.error('Error stopping scanner:', err);
      }
      setIsScanning(false);
    }
  };

  const handleClose = async () => {
    await stopScanner();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 z-[10000] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-primary-600 text-white">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5" />
            <h3 className="text-lg font-semibold">Continuous Barcode Scanner</h3>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-primary-700 rounded-lg transition-colors"
            aria-label="Close scanner"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scanner Container */}
        <div className="flex-1 flex items-center justify-center p-4 bg-black relative">
          {error ? (
            <div className="text-center text-white p-6">
              <Camera className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-sm mb-2">{error}</p>
              <div className="flex gap-2 justify-center mt-4">
                {permissionDenied && (
                  <>
                    <button
                      onClick={async () => {
                        setError(null);
                        setPermissionDenied(false);
                        isInitializingRef.current = false;
                        
                        // Check if MediaDevices API is available
                        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                          const isSecure = window.location.protocol === 'https:' || 
                                          window.location.hostname === 'localhost' || 
                                          window.location.hostname === '127.0.0.1' ||
                                          window.location.hostname.endsWith('.local');
                          
                          if (!isSecure) {
                            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                            let message = 'Camera access requires HTTPS (secure connection). ';
                            if (isMobile) {
                              message += 'For mobile testing, use a tunnel service like ngrok, or set up HTTPS.';
                            } else {
                              message += 'For development, access via localhost (http://localhost:3000) or set up HTTPS.';
                            }
                            setError(message);
                          } else {
                            setError('Camera API not supported in this browser. Please use a modern browser like Chrome, Firefox, or Safari.');
                          }
                          setPermissionDenied(false);
                          return;
                        }
                        
                        // Try to get camera access directly - this is the most reliable way to check
                        try {
                          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                          stream.getTracks().forEach(track => track.stop());
                          
                          // Permission granted! Re-initialize the scanner
                          console.log('Permission granted, re-initializing scanner...');
                          if (initScannerRef.current) {
                            // Reset the initialization flag so it can run again
                            isInitializingRef.current = false;
                            await initScannerRef.current();
                          } else {
                            // Fallback: reload page
                            window.location.reload();
                          }
                        } catch (retryErr: any) {
                          console.error('Retry error:', retryErr);
                          if (retryErr.name === 'NotAllowedError' || retryErr.name === 'PermissionDeniedError') {
                            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                            if (isMobile) {
                              setError('Permission still denied. Please ensure you\'ve enabled camera access in browser settings, then click "Refresh Page" to reload.');
                            } else {
                              setError('Permission still denied. Please click the camera icon in your browser\'s address bar and select "Allow", then click "Refresh Page".');
                            }
                          } else if (retryErr.name === 'NotFoundError') {
                            setError('No camera found on this device.');
                          } else if (retryErr.name === 'NotReadableError') {
                            setError('Camera is already in use by another application. Please close other apps using the camera.');
                          } else {
                            setError(`Error: ${retryErr.message || 'Failed to access camera'}`);
                          }
                          setPermissionDenied(true);
                        }
                      }}
                      className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700"
                    >
                      Try Again
                    </button>
                    <button
                      onClick={() => {
                        window.location.reload();
                      }}
                      className="px-4 py-2 bg-gray-600 text-white rounded-lg text-sm font-medium hover:bg-gray-700"
                    >
                      Refresh Page
                    </button>
                  </>
                )}
                <button
                  onClick={handleClose}
                  className="px-4 py-2 bg-white text-gray-900 rounded-lg text-sm font-medium hover:bg-gray-100"
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <>
              <div
                id={scannerIdRef.current}
                className="w-full h-full"
                style={{ minHeight: '300px' }}
              />
              {isScanning && (
                <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-75 text-white px-4 py-2 rounded-full text-sm flex items-center gap-2 z-10">
                  <Loader2 className={`w-4 h-4 ${isReadyForNextScan ? '' : 'animate-spin'}`} />
                  {isReadyForNextScan ? (
                    <span>✓ Ready to scan - Point camera at barcode</span>
                  ) : (
                    <span>Processing... Please wait (0.3s)</span>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Instructions */}
        <div className="p-4 border-t bg-gray-50">
          <p className="text-xs text-gray-600 text-center mb-2">
            Point camera at barcodes. Items will be added automatically.
          </p>
          <p className="text-xs text-gray-500 text-center">
            Scanning the same item multiple times will increment quantity.
          </p>
        </div>
      </div>
    </div>
  );
};


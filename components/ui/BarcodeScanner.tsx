'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera, Loader2 } from 'lucide-react';

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  onClose: () => void;
  formats?: string[];
}

export const BarcodeScanner: React.FC<BarcodeScannerProps> = ({
  onScan,
  onClose,
  formats = ['EAN_13', 'CODE_128', 'QR_CODE', 'UPC_A', 'EAN_8', 'CODE_39', 'CODE_93', 'ITF']
}) => {
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [manualBarcode, setManualBarcode] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scannerIdRef = useRef<string>(`barcode-scanner-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  const isInitializingRef = useRef(false);
  const initScannerRef = useRef<(() => Promise<void>) | null>(null);

  // Function to play beep sound on successful scan
  const playBeepSound = () => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800; // Beep frequency (Hz)
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.1);
    } catch (err) {
      // Fallback: silently fail if audio context is not available
      console.debug('Could not play beep sound:', err);
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
          
          setCameraId(selectedCamera);

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
            (decodedText) => {
              // Success callback
              console.log('[Barcode Scanner] Successfully scanned:', decodedText);
              
              // Play beep sound to indicate successful scan
              playBeepSound();
              
              setIsScanning(false);
              onScan(decodedText);
              stopScanner();
            },
            (errorMessage) => {
              // Error callback - log for debugging but don't show to user
              // Most errors are just "no barcode found" which is normal during scanning
              if (errorMessage && 
                  !errorMessage.includes('No QR code') && 
                  !errorMessage.includes('NotFoundException') &&
                  !errorMessage.includes('No MultiFormat Readers')) {
                // Only log actual errors, not normal "not found" messages
                console.debug('[Barcode Scanner] Error:', errorMessage);
              }
            }
          );
          
          setIsScanning(true);
        } else {
          setError('No camera found. Please ensure your device has a camera and permissions are granted.');
        }
        isInitializingRef.current = false;
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
        
        // Force clear the container element completely
        const containerElement = document.getElementById(scannerIdRef.current);
        if (containerElement) {
          // Remove all child elements
          while (containerElement.firstChild) {
            containerElement.removeChild(containerElement.firstChild);
          }
          containerElement.innerHTML = '';
        }
      } catch (err) {
        console.error('Error stopping scanner:', err);
        // Force clear the container even if stop fails
        const containerElement = document.getElementById(scannerIdRef.current);
        if (containerElement) {
          while (containerElement.firstChild) {
            containerElement.removeChild(containerElement.firstChild);
          }
          containerElement.innerHTML = '';
        }
      }
      setIsScanning(false);
      scannerRef.current = null;
    } else {
      // Even if no scanner ref, clear the container
      const containerElement = document.getElementById(scannerIdRef.current);
      if (containerElement) {
        while (containerElement.firstChild) {
          containerElement.removeChild(containerElement.firstChild);
        }
        containerElement.innerHTML = '';
      }
    }
  };

  const handleClose = async () => {
    await stopScanner();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 z-[10000] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-primary-600" />
            <h3 className="text-lg font-semibold text-gray-900">Scan Barcode</h3>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close scanner"
          >
            <X className="w-5 h-5 text-gray-600" />
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
                ref={containerRef}
                className="w-full h-full relative"
                style={{ 
                  minHeight: '300px',
                  position: 'relative',
                  overflow: 'hidden'
                }}
              />
              {isScanning && (
                <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-50 text-white px-3 py-1 rounded-full text-sm flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Scanning...
                </div>
              )}
            </>
          )}
        </div>

        {/* Instructions and Manual Input */}
        <div className="p-4 border-t bg-gray-50">
          {!showManualInput ? (
            <>
              <p className="text-xs text-gray-600 text-center mb-2">
                Point your camera at a barcode. The scanner will automatically detect it.
              </p>
              <div className="text-xs text-gray-500 text-center space-y-1 mb-3">
                <p>💡 Tips for better scanning:</p>
                <ul className="list-disc list-inside space-y-0.5 text-left max-w-xs mx-auto">
                  <li>Ensure good lighting</li>
                  <li>Hold the barcode flat and steady</li>
                  <li>Center the barcode in the camera view (the white frame should appear overlaid on the video)</li>
                  <li>Move closer if the barcode is too small</li>
                </ul>
              </div>
              <button
                onClick={() => setShowManualInput(true)}
                className="text-xs text-primary-600 hover:text-primary-700 underline mx-auto block"
              >
                Can't scan? Enter barcode manually
              </button>
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-gray-600 text-center mb-2">
                Enter barcode manually
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualBarcode}
                  onChange={(e) => setManualBarcode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && manualBarcode.trim()) {
                      onScan(manualBarcode.trim());
                      handleClose();
                    }
                  }}
                  placeholder="Enter barcode number"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  autoFocus
                />
                <button
                  onClick={() => {
                    if (manualBarcode.trim()) {
                      onScan(manualBarcode.trim());
                      handleClose();
                    }
                  }}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!manualBarcode.trim()}
                >
                  Use
                </button>
                <button
                  onClick={() => {
                    setShowManualInput(false);
                    setManualBarcode('');
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};


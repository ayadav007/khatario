import { useEffect, useRef, useState, useCallback } from 'react';

interface UseBarcodeScannerOptions {
  onScan: (barcode: string) => void;
  onScanStart?: () => void; // Called when rapid input is detected (scan starting)
  minLength?: number;
  maxLength?: number;
  scanTimeout?: number;
  enabled?: boolean;
}

/**
 * Hook to detect barcode scanner input
 * Physical scanners act like keyboards - they type rapidly and end with Enter
 * This hook detects that pattern and distinguishes it from manual typing
 * 
 * Enhanced to detect:
 * 1. Enter key with barcode-length string (standard scanner behavior)
 * 2. Rapid input (all characters within 200ms) - some scanners don't send Enter
 * 3. Input pause after rapid typing (scanner finished, no more input coming)
 */
export function useBarcodeScanner({
  onScan,
  onScanStart,
  minLength = 3,
  maxLength = 50,
  scanTimeout = 100, // Time between keystrokes to consider it a scan (ms)
  enabled = true
}: UseBarcodeScannerOptions) {
  const [isScanning, setIsScanning] = useState(false);
  const inputBuffer = useRef('');
  const lastKeyTime = useRef(0);
  const firstKeyTime = useRef(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const rapidScanTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const scanStartCalled = useRef(false); // Track if onScanStart was called for current scan

  const triggerScan = useCallback((barcode: string) => {
    const trimmed = barcode.trim();
    if (trimmed.length >= minLength && trimmed.length <= maxLength) {
      setIsScanning(true);
      onScan(trimmed);
      
      // Reset after a short delay
      setTimeout(() => {
        inputBuffer.current = '';
        setIsScanning(false);
        scanStartCalled.current = false; // Reset scan start flag
      }, 200);
    }
  }, [minLength, maxLength, onScan]);

  const handleKeyPress = useCallback((e: KeyboardEvent) => {
    if (!enabled) {
      return;
    }

    const now = Date.now();
    const timeSinceLastKey = now - lastKeyTime.current;

    if (e.key === 'Enter' && inputBuffer.current.length >= minLength) {
      // Call onScanStart if not already called (for Enter-key scans)
      if (onScanStart && !scanStartCalled.current) {
        onScanStart();
        scanStartCalled.current = true;
      }
      
      e.preventDefault();
      e.stopPropagation();
      
      triggerScan(inputBuffer.current);
      
      inputBuffer.current = '';
      lastKeyTime.current = 0;
      firstKeyTime.current = 0;
      
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (rapidScanTimeoutRef.current) {
        clearTimeout(rapidScanTimeoutRef.current);
        rapidScanTimeoutRef.current = null;
      }
      return;
    }

    // If too much time passed since last key, reset buffer (manual typing)
    // BUT: Don't reset if we're in the middle of rapid input (within 500ms of first key)
    const timeSinceFirstKey = firstKeyTime.current > 0 ? now - firstKeyTime.current : Infinity;
    const isRapidInputInProgress = firstKeyTime.current > 0 && timeSinceFirstKey < 500; // Allow 500ms for rapid input
    
    if (timeSinceLastKey > scanTimeout && inputBuffer.current.length > 0 && !isRapidInputInProgress) {
      inputBuffer.current = '';
      firstKeyTime.current = 0;
      scanStartCalled.current = false; // Reset when manual typing detected
    }

    // Add character to buffer if it's a printable character
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Track first key time for rapid input detection
      const isFirstKey = inputBuffer.current.length === 0;
      if (isFirstKey) {
        firstKeyTime.current = now;
        // DON'T call onScanStart here - wait to see if it's rapid input
      }
      
      inputBuffer.current += e.key;
      lastKeyTime.current = now;
      
      // Clear buffer if it gets too long (manual typing)
      if (inputBuffer.current.length > maxLength) {
        inputBuffer.current = '';
        firstKeyTime.current = 0;
        scanStartCalled.current = false;
        return;
      }

      // Clear existing timeouts
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (rapidScanTimeoutRef.current) {
        clearTimeout(rapidScanTimeoutRef.current);
        rapidScanTimeoutRef.current = null;
      }

      // Detect rapid input pattern (scanner typing)
      const timeSinceFirstKey = now - firstKeyTime.current;
      const isRapidInput = timeSinceFirstKey < 300; // All characters within 300ms
      const isBarcodeLength = inputBuffer.current.length >= 8; // Typical barcode length

      // Call onScanStart only when we detect rapid input (barcode scan in progress)
      // This prevents calling it on normal typing (e.g., customer name)
      // Only trigger after 4+ characters entered rapidly (strong indicator of barcode scan)
      if (isRapidInput && inputBuffer.current.length >= 4 && onScanStart && !scanStartCalled.current) {
        // Check if user is actively typing in a non-item input field
        const activeElement = document.activeElement;
        const isInputField = activeElement && (
          activeElement.tagName === 'INPUT' || 
          activeElement.tagName === 'TEXTAREA'
        );
        
        // If focused on an input, check if it's a customer-related field
        const inputId = activeElement?.id || '';
        const inputName = (activeElement as HTMLInputElement)?.name || '';
        const inputClassName = activeElement?.className || '';
        const inputPlaceholder = (activeElement as HTMLInputElement)?.placeholder || '';
        const isCustomerField = isInputField && (
          inputId.toLowerCase().includes('customer') ||
          inputName.toLowerCase().includes('customer') ||
          inputClassName.toLowerCase().includes('customer') ||
          inputPlaceholder.toLowerCase().includes('customer')
        );
        
        // Only call onScanStart if NOT typing in a customer field
        // This prevents focus shift when typing customer name
        if (!isCustomerField) {
          onScanStart();
          scanStartCalled.current = true;
        }
      }

      // If rapid input and barcode-length, set timeout to trigger scan (scanner might not send Enter)
      if (isRapidInput && isBarcodeLength) {
        rapidScanTimeoutRef.current = setTimeout(() => {
          // Check if input stopped (no new keys for 150ms after rapid input)
          const timeSinceLast = Date.now() - lastKeyTime.current;
          if (timeSinceLast >= 150 && inputBuffer.current.length >= minLength) {
            triggerScan(inputBuffer.current);
            inputBuffer.current = '';
            firstKeyTime.current = 0;
          }
        }, 150);
      }

      // Set timeout to clear buffer if no more input (manual typing)
      // BUT: Only clear if we're NOT in rapid input mode
      timeoutRef.current = setTimeout(() => {
        const timeSinceFirst = Date.now() - firstKeyTime.current;
        const isRapidInputInProgress = firstKeyTime.current > 0 && timeSinceFirst < 500;
        if (!isRapidInputInProgress) {
          inputBuffer.current = '';
          firstKeyTime.current = 0;
        }
      }, scanTimeout * 3);
    }
  }, [enabled, minLength, maxLength, scanTimeout, triggerScan, onScanStart, isScanning]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    // Use capture phase to catch events before they reach input fields
    document.addEventListener('keydown', handleKeyPress, true);

    return () => {
      document.removeEventListener('keydown', handleKeyPress, true);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (rapidScanTimeoutRef.current) {
        clearTimeout(rapidScanTimeoutRef.current);
      }
    };
  }, [enabled, handleKeyPress]);

  return {
    isScanning,
    clearBuffer: () => {
      inputBuffer.current = '';
      lastKeyTime.current = 0;
      firstKeyTime.current = 0;
    }
  };
}


'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, Camera } from 'lucide-react';
import { BarcodeScanner } from './BarcodeScanner';
import { normalizeBarcode } from '@/lib/barcode-validator';
import { searchOfflineItems, searchCatalogItemsLocal, OFFLINE_CATALOG_EMPTY_HINT } from '@/lib/offline/catalog/client-search';
import { isAppOffline } from '@/lib/network/offline-state';
import toast from 'react-hot-toast';

interface ItemVariant {
  id: string;
  variant_name: string;
  attributes: Record<string, any>;
  selling_price?: number | null;
  current_stock: number;
  sku?: string;
  barcode?: string;
}

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
  variants?: ItemVariant[];
}

interface ItemAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (item: ItemSearchResult) => void;
  placeholder?: string;
  onSelectDone?: () => void;
  disabled?: boolean;
  inputRef?: React.RefObject<HTMLInputElement>;
  onAddNew?: () => void;
  className?: string;
  warehouseId?: string;
}

const BARCODE_PATTERN = /\d/;
function looksLikeBarcode(s: string): boolean {
  return s.length >= 8 && s.length <= 50 && /^[A-Za-z0-9]+$/.test(s) && BARCODE_PATTERN.test(s);
}

export const ItemAutocomplete: React.FC<ItemAutocompleteProps> = ({
  value,
  onChange,
  onSelect,
  placeholder,
  onSelectDone,
  disabled = false,
  inputRef: externalInputRef,
  onAddNew,
  className,
  warehouseId
}) => {
  const { business, user } = useAuth();
  const [query, setQuery] = useState(value || '');
  const [results, setResults] = useState<ItemSearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const suppressOpenRef = useRef(false);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const [selectedItemForVariant, setSelectedItemForVariant] = useState<ItemSearchResult | null>(null);
  const [showVariantSelector, setShowVariantSelector] = useState(false);
  const [highlightedVariantIndex, setHighlightedVariantIndex] = useState(0);
  const variantButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const [scanningBarcode, setScanningBarcode] = useState(false);
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  
  const lastSearchedBarcodeRef = useRef<string>('');
  const lastSearchRef = useRef<string>('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const userTypingRef = useRef(false);
  
  const inputValueRef = useRef<string>('');
  const inputKeyTimeRef = useRef<number>(0);
  const inputFirstKeyTimeRef = useRef<number>(0);
  const inputBarcodeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Ref callback to sync both internal and external refs
  const setInputRef = React.useCallback((node: HTMLInputElement | null) => {
    if (inputRef && 'current' in inputRef) {
      (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
    }
    if (externalInputRef && typeof externalInputRef === 'object' && 'current' in externalInputRef) {
      (externalInputRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
    }
  }, [externalInputRef]);

  // Update dropdown position when opened or scrolled
  useEffect(() => {
    if (!isOpen) {
      setDropdownPosition(null);
      return;
    }

    if (!inputRef.current) {
      // If input ref not ready, try again after a short delay
      const timer = setTimeout(() => {
        if (inputRef.current && isOpen) {
          const rect = inputRef.current.getBoundingClientRect();
          setDropdownPosition({
            top: rect.bottom + 4,
            left: rect.left,
            width: Math.max(rect.width, 300)
          });
        }
      }, 10);
      return () => clearTimeout(timer);
    }

    const updatePosition = () => {
      if (inputRef.current) {
        const rect = inputRef.current.getBoundingClientRect();
        // Use getBoundingClientRect() for accurate viewport-relative positioning
        // This ensures the dropdown appears correctly even when page layout changes (e.g., payment section expanded)
        setDropdownPosition({
          top: rect.bottom + 4, // Add 4px gap, no need for scrollY since using fixed positioning
          left: rect.left, // No need for scrollX since using fixed positioning
          width: Math.max(rect.width, 300)
        });
      }
    };

    updatePosition();
    // Use requestAnimationFrame to ensure position updates after layout changes
    const rafId = requestAnimationFrame(updatePosition);
    
    // Listen to scroll on all elements (including parent containers)
    const scrollHandler = () => requestAnimationFrame(updatePosition);
    const resizeHandler = () => requestAnimationFrame(updatePosition);
    
    window.addEventListener('scroll', scrollHandler, true);
    window.addEventListener('resize', resizeHandler);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', scrollHandler, true);
      window.removeEventListener('resize', resizeHandler);
    };
  }, [isOpen, query, results.length]); // Also update when query or results change (layout might shift)

  // Click outside handler
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node) &&
          dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = React.useCallback((item: ItemSearchResult) => {
    lastSearchedBarcodeRef.current = '';
    isSearchingRef.current = false;
    userTypingRef.current = false;

    // If item has variants, show variant selector
    if (item.has_variants && item.variants && item.variants.length > 0) {
      setSelectedItemForVariant(item);
      setShowVariantSelector(true);
      setIsOpen(false);
      return;
    }
    
    // Otherwise, proceed with normal selection
    setQuery(item.name);
    onChange(item.name); // Update parent input text
    onSelect(item); // Trigger data population
    setIsOpen(false);
    setResults([]);
    suppressOpenRef.current = true; // prevent immediate reopen from search effect
    setHighlightedIndex(-1);
    if (onSelectDone) onSelectDone();
  }, [onChange, onSelect, onSelectDone]);

  const performSearch = React.useCallback(async (searchQuery: string, autoSelect: boolean = false) => {
    if (!business?.id || !searchQuery.trim()) {
      setResults([]);
      return Promise.resolve();
    }

    const trimmed = searchQuery.trim();
    if (!autoSelect && trimmed === lastSearchRef.current) {
      return Promise.resolve();
    }
    lastSearchRef.current = trimmed;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    
    if (autoSelect || document.activeElement === inputRef.current) {
      setIsOpen(true);
    }

    try {
      let foundItems: ItemSearchResult[] = [];
      if (user?.id) {
        const offlineItems = await searchOfflineItems(
          { businessId: business.id, userId: user.id },
          trimmed,
          { warehouseId, limit: 50 }
        );
        if (offlineItems != null) {
          foundItems = offlineItems as ItemSearchResult[];
        } else if (isAppOffline()) {
          setResults([]);
          if (autoSelect) {
            toast.error(OFFLINE_CATALOG_EMPTY_HINT, { duration: 5000 });
          }
          return;
        }
      }

      if (foundItems.length === 0 && !isAppOffline()) {
        const warehouseParam = warehouseId ? `&warehouse_id=${warehouseId}` : '';
        const searchUrl = `/api/items/search?business_id=${business.id}&q=${encodeURIComponent(trimmed)}${warehouseParam}`;
        const res = await fetch(searchUrl, { signal: controller.signal });
        if (!res.ok) {
          if (user?.id) {
            const fallback = await searchCatalogItemsLocal(
              { businessId: business.id, userId: user.id },
              trimmed,
              { warehouseId, limit: 50 }
            );
            if (fallback?.length) {
              foundItems = fallback as ItemSearchResult[];
            }
          }
          if (foundItems.length === 0) {
            setResults([]);
            if (autoSelect) {
              toast.error('Failed to search for item. Please try again.', { duration: 3000 });
            }
            return;
          }
        } else {
          const data = await res.json();
          foundItems = data.items || [];
        }
      }

      setResults(foundItems);
      
      if (autoSelect) {
        if (foundItems.length === 1) {
          const item = foundItems[0];
          
          if (item.has_variants && item.variants && item.variants.length > 0) {
            const matchingVariant = item.variants.find((v: any) => 
              v.barcode && normalizeBarcode(v.barcode) === normalizeBarcode(trimmed)
            );
            
            if (matchingVariant) {
              const itemWithVariant: ItemSearchResult = {
                ...item,
                selling_price: matchingVariant.selling_price ?? item.selling_price,
                current_stock: matchingVariant.current_stock,
                ...({ variantId: matchingVariant.id, variantName: matchingVariant.variant_name, variantAttributes: matchingVariant.attributes } as any)
              };
              setQuery(`${item.name} - ${matchingVariant.variant_name}`);
              onChange(`${item.name} - ${matchingVariant.variant_name}`);
              onSelect(itemWithVariant);
              setIsOpen(false);
              setResults([]);
              toast.success(`Variant "${matchingVariant.variant_name}" added successfully!`, { duration: 2000, icon: '✓' });
              if (onSelectDone) onSelectDone();
              return;
            } else {
              setSelectedItemForVariant(item);
              setShowVariantSelector(true);
              setIsOpen(false);
              toast(`Item "${item.name}" has variants. Please select one.`, { duration: 3000 });
              return;
            }
          }
          
          handleSelect(item);
          toast.success(`Item "${item.name}" added successfully!`, { duration: 2000, icon: '✓' });
        } else if (foundItems.length > 1) {
          let exactMatch: any = null;
          let exactVariant: any = null;
          
          for (const item of foundItems) {
            if (item.barcode && normalizeBarcode(item.barcode) === normalizeBarcode(trimmed)) {
              exactMatch = item;
              break;
            }
            if (item.has_variants && item.variants && item.variants.length > 0) {
              const variant = item.variants.find((v: any) => 
                v.barcode && normalizeBarcode(v.barcode) === normalizeBarcode(trimmed)
              );
              if (variant) {
                exactMatch = item;
                exactVariant = variant;
                break;
              }
            }
          }
          
          if (exactMatch) {
            if (exactVariant) {
              const itemWithVariant: ItemSearchResult = {
                ...exactMatch,
                selling_price: exactVariant.selling_price ?? exactMatch.selling_price,
                current_stock: exactVariant.current_stock,
                ...({ variantId: exactVariant.id, variantName: exactVariant.variant_name, variantAttributes: exactVariant.attributes } as any)
              };
              setQuery(`${exactMatch.name} - ${exactVariant.variant_name}`);
              onChange(`${exactMatch.name} - ${exactVariant.variant_name}`);
              onSelect(itemWithVariant);
              setIsOpen(false);
              setResults([]);
              toast.success(`Variant "${exactVariant.variant_name}" added successfully!`, { duration: 2000, icon: '✓' });
              if (onSelectDone) onSelectDone();
            } else {
              handleSelect(exactMatch);
              toast.success(`Item "${exactMatch.name}" added successfully!`, { duration: 2000, icon: '✓' });
            }
          } else {
            setIsOpen(true);
            toast(`Found ${foundItems.length} items matching barcode. Please select one.`, { duration: 3000 });
          }
        } else {
          setIsOpen(false);
          toast.error(`Item with barcode "${trimmed}" not found.`, { duration: 3000 });
          lastSearchedBarcodeRef.current = '';
          isSearchingRef.current = false;
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setResults([]);
      if (autoSelect) {
        toast.error('Error searching for item. Please try again.', { duration: 3000 });
      }
    } finally {
      setLoading(false);
    }
  }, [business?.id, handleSelect]);

  useEffect(() => {
    if (suppressOpenRef.current) {
      suppressOpenRef.current = false;
      setIsOpen(false);
      return;
    }

    if (scanningBarcode) return;

    if (!userTypingRef.current && document.activeElement !== inputRef.current) {
      return;
    }

    const timer = setTimeout(() => {
      if (!query || query.length < 1) {
        setResults([]);
        setIsOpen(false);
        return;
      }
      performSearch(query, false);
    }, 350);

    return () => clearTimeout(timer);
  }, [query, performSearch, scanningBarcode]);

  const handleBarcodeScan = React.useCallback((barcode: string) => {
    if (disabled) return;
    
    if (isSearchingRef.current && barcode === lastSearchedBarcodeRef.current) {
      return;
    }
    
    lastSearchedBarcodeRef.current = barcode;
    isSearchingRef.current = true;
    setScanningBarcode(true);
    setQuery(barcode);
    onChange(barcode);
    
    performSearch(barcode, true).finally(() => {
      isSearchingRef.current = false;
      setScanningBarcode(false);
    });
  }, [disabled, onChange, performSearch]);

  const lastQueryRef = useRef<string>('');
  const lastQueryTimeRef = useRef<number>(0);
  const rapidInputTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSearchingRef = useRef<boolean>(false);

  useEffect(() => {
    if (!query || query.length < 8 || disabled || showCameraScanner) {
      lastQueryRef.current = query;
      return;
    }

    if (scanningBarcode || (isSearchingRef.current && query === lastSearchedBarcodeRef.current)) {
      lastQueryRef.current = query;
      return;
    }

    if (!looksLikeBarcode(query)) {
      lastQueryRef.current = query;
      lastQueryTimeRef.current = Date.now();
      return;
    }

    const now = Date.now();
    const timeSinceLastChange = now - lastQueryTimeRef.current;
    const queryLength = query.length;
    const lastQueryLength = lastQueryRef.current.length;

    if (rapidInputTimeoutRef.current) {
      clearTimeout(rapidInputTimeoutRef.current);
    }

    const isRapidInput = queryLength > lastQueryLength && timeSinceLastChange < 200;
    const waitMs = isRapidInput ? 200 : 400;

    rapidInputTimeoutRef.current = setTimeout(() => {
      if (query !== lastSearchedBarcodeRef.current && !isSearchingRef.current && looksLikeBarcode(query)) {
        lastSearchedBarcodeRef.current = query;
        isSearchingRef.current = true;
        setScanningBarcode(true);
        performSearch(query, true).finally(() => {
          isSearchingRef.current = false;
          setScanningBarcode(false);
        });
      }
    }, waitMs);

    lastQueryRef.current = query;
    lastQueryTimeRef.current = now;

    return () => {
      if (rapidInputTimeoutRef.current) {
        clearTimeout(rapidInputTimeoutRef.current);
      }
    };
  }, [query, disabled, showCameraScanner, performSearch, scanningBarcode]);

  // Handle barcode scan from camera
  const handleCameraScan = (barcode: string) => {
    setShowCameraScanner(false);
    setScanningBarcode(true);
    setQuery(barcode);
    onChange(barcode);
    performSearch(barcode, true);
    setTimeout(() => setScanningBarcode(false), 1000);
  };

  // Reset highlighted index and refs when variant selector opens
  useEffect(() => {
    if (showVariantSelector && selectedItemForVariant) {
      setHighlightedVariantIndex(0); // Start with base item
      // Initialize refs array size (base item + variants)
      const totalOptions = 1 + (selectedItemForVariant.variants?.length || 0);
      variantButtonRefs.current = new Array(totalOptions).fill(null);
    }
  }, [showVariantSelector, selectedItemForVariant]);

  // Keyboard navigation for variant selector
  useEffect(() => {
    if (!showVariantSelector || !selectedItemForVariant) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const maxIndex = selectedItemForVariant.variants?.length || 0; // 0 = base, 1+ = variants
        setHighlightedVariantIndex(prev => Math.min(prev + 1, maxIndex));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedVariantIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const currentIndex = highlightedVariantIndex;
        if (currentIndex === 0) {
          // Select base item
          if (!selectedItemForVariant) return;
          setQuery(selectedItemForVariant.name);
          onChange(selectedItemForVariant.name);
          onSelect(selectedItemForVariant);
          setShowVariantSelector(false);
          setSelectedItemForVariant(null);
          setHighlightedVariantIndex(0);
          setIsOpen(false);
          setResults([]);
          if (onSelectDone) onSelectDone();
        } else {
          // Select variant
          const variant = selectedItemForVariant.variants?.[currentIndex - 1];
          if (variant && selectedItemForVariant) {
            const itemWithVariant: ItemSearchResult = {
              ...selectedItemForVariant,
              selling_price: variant.selling_price ?? selectedItemForVariant.selling_price,
              current_stock: variant.current_stock,
              tax_rate: selectedItemForVariant.tax_rate, // Explicitly preserve tax_rate from base item
              ...({ variantId: variant.id, variantName: variant.variant_name, variantAttributes: variant.attributes } as any)
            };
            setQuery(`${selectedItemForVariant.name} - ${variant.variant_name}`);
            onChange(`${selectedItemForVariant.name} - ${variant.variant_name}`);
            onSelect(itemWithVariant);
            setShowVariantSelector(false);
            setSelectedItemForVariant(null);
            setHighlightedVariantIndex(0);
            setIsOpen(false);
            setResults([]);
            if (onSelectDone) onSelectDone();
          }
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setShowVariantSelector(false);
        setSelectedItemForVariant(null);
        setHighlightedVariantIndex(0);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showVariantSelector, selectedItemForVariant, highlightedVariantIndex, onChange, onSelect, onSelectDone]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (showVariantSelector && variantButtonRefs.current[highlightedVariantIndex]) {
      variantButtonRefs.current[highlightedVariantIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
    }
  }, [highlightedVariantIndex, showVariantSelector]);

  const handleBaseItemSelect = () => {
    if (!selectedItemForVariant) return;
    
    // Select base item without variant
    setQuery(selectedItemForVariant.name);
    onChange(selectedItemForVariant.name);
    onSelect(selectedItemForVariant);
    setShowVariantSelector(false);
    setSelectedItemForVariant(null);
    setHighlightedVariantIndex(0);
    setIsOpen(false);
    setResults([]);
    if (onSelectDone) onSelectDone();
  };

  const handleVariantSelect = (variant: ItemVariant) => {
    if (!selectedItemForVariant) return;
    
    // Create a modified item with variant information
    // IMPORTANT: Preserve tax_rate from base item (variants inherit tax_rate from base item)
    const itemWithVariant: ItemSearchResult = {
      ...selectedItemForVariant,
      selling_price: variant.selling_price ?? selectedItemForVariant.selling_price,
      current_stock: variant.current_stock,
      tax_rate: selectedItemForVariant.tax_rate, // Explicitly preserve tax_rate from base item
      // Add variant info to the item (parent can access via item.variantId, etc.)
      ...({ variantId: variant.id, variantName: variant.variant_name, variantAttributes: variant.attributes } as any)
    };
    
    setQuery(`${selectedItemForVariant.name} - ${variant.variant_name}`);
    onChange(`${selectedItemForVariant.name} - ${variant.variant_name}`);
    onSelect(itemWithVariant);
    setShowVariantSelector(false);
    setSelectedItemForVariant(null);
    setHighlightedVariantIndex(0);
    setIsOpen(false);
    setResults([]);
    if (onSelectDone) onSelectDone();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    inputValueRef.current = newValue;
    userTypingRef.current = true;
    setQuery(newValue);
    onChange(newValue);
    if (newValue.length > 0) {
      setIsOpen(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const currentValue = input.value;
    const now = Date.now();

    inputValueRef.current = currentValue;
    
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (inputValueRef.current.length === 1) {
        inputFirstKeyTimeRef.current = now;
      }
      inputKeyTimeRef.current = now;
      
      if (inputBarcodeTimeoutRef.current) {
        clearTimeout(inputBarcodeTimeoutRef.current);
      }
      
      const timeSinceFirst = now - inputFirstKeyTimeRef.current;
      const isRapidInput = timeSinceFirst < 300 && currentValue.length >= 8;

      if (isRapidInput) {
        inputBarcodeTimeoutRef.current = setTimeout(() => {
          const finalValue = input.value;
          const timeSinceLast = Date.now() - inputKeyTimeRef.current;

          if (timeSinceLast >= 150 && looksLikeBarcode(finalValue)) {
            if (finalValue !== lastSearchedBarcodeRef.current && !isSearchingRef.current) {
              handleBarcodeScan(finalValue);
            }
          }
        }, 150);
      }
    }
    
    if (e.key === 'Enter' && looksLikeBarcode(currentValue)) {
      if (currentValue !== lastSearchedBarcodeRef.current && !isSearchingRef.current) {
        e.preventDefault();
        handleBarcodeScan(currentValue);
        return;
      }
    }
    
    if (!isOpen && results.length === 1 && (e.key === 'Tab' || e.key === 'Enter')) {
      e.preventDefault();
      handleSelect(results[0]);
      return;
    }

    if (!isOpen || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => {
        const next = prev + 1;
        return next >= results.length ? 0 : next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => {
        const next = prev - 1;
        return next < 0 ? results.length - 1 : next;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const idx = highlightedIndex >= 0 ? highlightedIndex : 0;
      handleSelect(results[idx]);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const idx = highlightedIndex >= 0 ? highlightedIndex : 0;
      handleSelect(results[idx]);
    }
  };

  return (
    <div ref={wrapperRef} className="relative w-full flex items-center gap-2">
      <div className="flex-1">
        <input
          ref={setInputRef}
          type="text"
          className={`w-full bg-transparent border-none focus:ring-0 py-2 px-1 font-medium placeholder-gray-400 text-[21px] min-h-[40px] ${className || ''}`}
          placeholder={placeholder || "Search Item"}
          value={query}
          onChange={handleInputChange}
          onFocus={() => {
            userTypingRef.current = true;
            if (results.length > 0 || query.length > 0) {
              setIsOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
      </div>
      {!disabled && (
        <button
          type="button"
          onClick={() => {
            // Open camera scanner on both mobile and desktop
            setShowCameraScanner(true);
          }}
          className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-600 hover:text-primary-600"
          title="Scan barcode with camera"
        >
          {scanningBarcode ? (
            <Loader2 className="w-4 h-4 animate-spin text-primary-600" />
          ) : (
            <Camera className="w-4 h-4" />
          )}
        </button>
      )}
      
      {/* Dropdown - Fixed positioning to escape overflow constraints */}
      {isOpen && (dropdownPosition || results.length > 0 || loading) && (
        <div 
          ref={dropdownRef}
          className="fixed bg-white border border-border rounded-lg shadow-lg z-[9999] max-h-60 overflow-y-auto"
          style={{
            boxShadow: 'rgba(0,0,0,0.1) 0px 4px 12px',
            top: dropdownPosition ? `${dropdownPosition.top}px` : 'auto',
            left: dropdownPosition ? `${dropdownPosition.left}px` : 'auto',
            width: dropdownPosition ? `${dropdownPosition.width}px` : '300px',
            position: 'fixed' // Explicitly set fixed positioning
          }}
        >
          {loading && (
            <div className="p-3 text-center text-text-secondary flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Searching...
            </div>
          )}
          
          {!loading && results.length > 0 && results.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              className={`w-full text-left px-3 py-2 border-b border-border last:border-none transition-colors flex justify-between items-center group ${highlightedIndex === idx ? 'bg-slate-50' : 'hover:bg-slate-50'}`}
              onMouseEnter={() => setHighlightedIndex(idx)}
              onClick={() => handleSelect(item)}
            >
              <div className="flex items-center gap-3">
                {item.image_url ? (
                  <img src={item.image_url} alt={item.name} className="w-10 h-10 object-cover rounded-lg border border-border" />
                ) : (
                  <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center border border-border">
                    <span className="text-gray-400 text-[10px] font-bold">{item.name.charAt(0).toUpperCase()}</span>
                  </div>
                )}
                <div>
                  <div className="font-medium text-text-primary text-sm flex items-center gap-2">
                    {item.name}
                    {item.item_type === 'service' && (
                      <span className="text-[10px] uppercase bg-slate-100 text-primary-700 px-1.5 py-0.5 rounded font-bold leading-none">Service</span>
                    )}
                  </div>
                  <div className="text-xs text-text-secondary flex items-center gap-2">
                    <span>Code: {item.code || 'N/A'}</span>
                    <span>|</span>
                    {item.item_type === 'service' ? (
                      <span>Service</span>
                    ) : (
                      <span className={`font-medium px-1.5 py-0.5 rounded ${
                        item.current_stock <= 0 
                          ? 'bg-red-100 text-red-700' 
                          : item.current_stock <= 10 
                            ? 'bg-yellow-100 text-yellow-700' 
                            : 'bg-green-100 text-green-700'
                      }`}>
                        Stock: {item.current_stock} {item.unit}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right ml-4">
                <div className="font-semibold text-primary-600 text-sm">
                  {item.selling_price !== null ? `₹ ${Number(item.selling_price).toFixed(2)}` : 'Price N/A'}
                </div>
                <div className="text-xs text-text-muted">Tax: {item.tax_rate}%</div>
              </div>
            </button>
          ))}
          
          {!loading && results.length === 0 && query.length > 0 && (
             <div className="p-3">
               <div className="text-center text-text-secondary text-sm mb-2">
                 No items found for "{query}"
               </div>
               <button
                 type="button"
                 className="w-full px-3 py-2 text-sm text-primary-600 hover:bg-slate-50 rounded-md border border-primary-200 font-medium"
                 onMouseDown={(e) => {
                   e.preventDefault();
                   if (onAddNew) {
                     onAddNew();
                   } else {
                     window.location.href = '/items/new';
                   }
                 }}
               >
                 + Add New Item
               </button>
             </div>
          )}
        </div>
      )}

      {/* Variant Selector Modal */}
      {showVariantSelector && selectedItemForVariant && selectedItemForVariant.variants && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-[10000] flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[80vh] overflow-y-auto">
            <div className="p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Select Variant</h3>
              <p className="text-sm text-gray-600 mt-1">{selectedItemForVariant.name}</p>
              <p className="text-xs text-gray-500 mt-2">Use ↑ ↓ arrow keys to navigate, Enter to select, Esc to cancel</p>
            </div>
            <div className="p-4">
              <div className="space-y-2">
                {/* Base Item Option */}
                <button
                  ref={(el) => { variantButtonRefs.current[0] = el; }}
                  type="button"
                  onClick={handleBaseItemSelect}
                  onMouseEnter={() => setHighlightedVariantIndex(0)}
                  className={`w-full text-left p-3 rounded-lg transition-colors ${
                    highlightedVariantIndex === 0
                      ? 'border-2 border-primary-500 bg-slate-100 shadow-md'
                      : 'border-2 border-primary-300 bg-slate-50 hover:bg-slate-100 hover:border-primary-400'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="font-medium text-gray-900 flex items-center gap-2">
                        {selectedItemForVariant.name}
                        <span className="text-xs bg-primary-200 text-primary-800 px-2 py-0.5 rounded font-semibold">Base Item</span>
                        {highlightedVariantIndex === 0 && (
                          <span className="text-xs text-primary-600 font-semibold ml-auto">← Press Enter</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
                        <span className={`font-medium px-1.5 py-0.5 rounded ${
                          selectedItemForVariant.current_stock <= 0 
                            ? 'bg-red-100 text-red-700' 
                            : selectedItemForVariant.current_stock <= 10 
                              ? 'bg-yellow-100 text-yellow-700' 
                              : 'bg-green-100 text-green-700'
                        }`}>
                          Stock: {selectedItemForVariant.current_stock}
                        </span>
                        {selectedItemForVariant.selling_price !== null && <span>Price: ₹{Number(selectedItemForVariant.selling_price).toFixed(2)}</span>}
                        {selectedItemForVariant.barcode && <span>Barcode: {selectedItemForVariant.barcode}</span>}
                      </div>
                    </div>
                  </div>
                </button>
                
                {/* Variants */}
                {selectedItemForVariant.variants.map((variant, index) => {
                  const variantIndex = index + 1; // +1 because 0 is base item
                  return (
                    <button
                      key={variant.id}
                      ref={(el) => { variantButtonRefs.current[variantIndex] = el; }}
                      type="button"
                      onClick={() => handleVariantSelect(variant)}
                      onMouseEnter={() => setHighlightedVariantIndex(variantIndex)}
                      className={`w-full text-left p-3 rounded-lg transition-colors ${
                        highlightedVariantIndex === variantIndex
                          ? 'border-2 border-primary-500 bg-slate-100 shadow-md'
                          : 'border border-gray-200 hover:bg-slate-50 hover:border-primary-300'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="font-medium text-gray-900 flex items-center gap-2">
                            {variant.variant_name}
                            {highlightedVariantIndex === variantIndex && (
                              <span className="text-xs text-primary-600 font-semibold ml-auto">← Press Enter</span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {variant.attributes && Object.keys(variant.attributes).length > 0 && (
                              <>
                                {Object.entries(variant.attributes).map(([key, value], idx) => (
                                  <span key={key}>
                                    {idx > 0 && ' | '}
                                    <span className="font-medium">{key}:</span> {String(value)}
                                  </span>
                                ))}
                                {' | '}
                              </>
                            )}
                            <span className={`font-medium px-1.5 py-0.5 rounded ${
                              variant.current_stock <= 0 
                                ? 'bg-red-100 text-red-700' 
                                : variant.current_stock <= 10 
                                  ? 'bg-yellow-100 text-yellow-700' 
                                  : 'bg-green-100 text-green-700'
                            }`}>
                              Stock: {variant.current_stock}
                            </span>
                            {variant.selling_price && ` | Price: ₹${variant.selling_price.toFixed(2)}`}
                            {variant.barcode && ` | Barcode: ${variant.barcode}`}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowVariantSelector(false);
                  setSelectedItemForVariant(null);
                }}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Camera Scanner Modal */}
      {showCameraScanner && (
        <BarcodeScanner
          onScan={handleCameraScan}
          onClose={() => setShowCameraScanner(false)}
        />
      )}
    </div>
  );
};

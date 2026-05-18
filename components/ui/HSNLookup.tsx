'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Search, Check, Loader2 } from 'lucide-react';

interface HSNResult {
  code: string;
  description: string;
  gst_rate: number;
  category: string;
  is_service: boolean;
  source?: string;
  confidence?: string;
  warnings?: string[];
  reasoning?: string;
  useCase?: string;
}

interface HSNLookupProps {
  value: string;
  onChange: (code: string) => void;
  onSelect: (result: HSNResult) => void;
  placeholder?: string;
  disabled?: boolean;
}

export const HSNLookup: React.FC<HSNLookupProps> = ({
  value,
  onChange,
  onSelect,
  placeholder = 'Search HSN/SAC code...',
  disabled = false
}) => {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<HSNResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync with external value
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Click outside handler
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (query.length < 2) {
        setResults([]);
        setIsOpen(false);
        return;
      }

      setLoading(true);
      setIsOpen(true);
      try {
        const res = await fetch(`/api/hsn/lookup?q=${encodeURIComponent(query)}&limit=10`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.results || []);
          setIsOpen(data.results?.length > 0);
        } else {
          setResults([]);
        }
      } catch (err) {
        console.error('HSN lookup error:', err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const handleSelect = (result: HSNResult) => {
    setQuery(result.code);
    onChange(result.code);
    onSelect(result);
    setIsOpen(false);
    setResults([]);
    setHighlightedIndex(-1);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setQuery(newValue);
    onChange(newValue);
    if (newValue.length > 0) {
      setIsOpen(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || results.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < results.length) {
          handleSelect(results[highlightedIndex]);
        } else if (results.length > 0) {
          handleSelect(results[0]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setHighlightedIndex(-1);
        break;
    }
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (results.length > 0) setIsOpen(true);
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full pl-10 pr-3 py-2 border border-border rounded-md bg-background text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />
        )}
      </div>

      {isOpen && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto">
          {results.map((result, index) => (
            <div
              key={result.code}
              onClick={() => handleSelect(result)}
              className={`px-4 py-3 cursor-pointer transition-colors ${
                index === highlightedIndex
                  ? 'bg-slate-50 border-l-2 border-primary-500'
                  : 'hover:bg-gray-50'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-text-primary">{result.code}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      result.is_service
                        ? 'bg-slate-100 text-primary-700'
                        : 'bg-green-100 text-green-700'
                    }`}>
                      {result.is_service ? 'SAC' : 'HSN'}
                    </span>
                    <span className="text-xs text-text-secondary">
                      {result.gst_rate}% GST
                    </span>
                    {result.source === 'ai' && (
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        result.confidence === 'high'
                          ? 'bg-green-100 text-green-700'
                          : result.confidence === 'medium'
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-orange-100 text-orange-700'
                      }`}>
                        AI {result.confidence}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-text-secondary line-clamp-1">
                    {result.description}
                  </p>
                  {result.useCase && (
                    <p className="text-xs text-primary-600 mt-1 font-medium">
                      💡 {result.useCase}
                    </p>
                  )}
                  {result.category && !result.useCase && (
                    <p className="text-xs text-text-secondary mt-1">
                      {result.category}
                    </p>
                  )}
                  {result.reasoning && (
                    <p className="text-xs text-gray-500 mt-1 italic">
                      {result.reasoning}
                    </p>
                  )}
                  {result.warnings && result.warnings.length > 0 && (
                    <div className="mt-1 space-y-1">
                      {result.warnings.map((warning, idx) => (
                        <p key={idx} className="text-xs text-orange-600">
                          {warning}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
                {index === highlightedIndex && (
                  <Check className="w-4 h-4 text-primary-600 flex-shrink-0 ml-2" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {isOpen && !loading && query.length >= 2 && results.length === 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg p-4 text-center text-sm text-text-secondary">
          No HSN/SAC codes found for "{query}"
        </div>
      )}
    </div>
  );
};


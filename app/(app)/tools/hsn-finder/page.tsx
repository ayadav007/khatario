'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Search, Download, FileText, Tag, Filter, Loader2, ExternalLink } from 'lucide-react';

interface HSNCode {
  code: string;
  desc: string;
  rate: string;
  category: string;
}

export default function HSNFinderPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [allData, setAllData] = useState<HSNCode[]>([]);
  const [filteredData, setFilteredData] = useState<HSNCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('All');

  useEffect(() => {
    async function loadData() {
      try {
        const res = await fetch('/data/hsn_master.json');
        if (res.ok) {
          const data = await res.json();
          setAllData(data);
          setFilteredData(data);
        } else {
          // Fallback if JSON not found (e.g. script hasn't run)
          const fallback = [
            { code: '6109', desc: 'T-shirts, singlets and other vests, knitted or crocheted', rate: '5', category: 'Garments' },
            { code: '6204', desc: 'Ladies suits, blazer, dresses, skirts', rate: '12', category: 'Garments' },
            { code: '9983', desc: 'Professional, technical and business services', rate: '18', category: 'Services' },
            { code: '8471', desc: 'Computers and related hardware', rate: '18', category: 'Electronics' },
            { code: '1905', desc: 'Biscuits, bread, cakes, pastries', rate: '18', category: 'Food & Groceries' }
          ];
          setAllData(fallback);
          setFilteredData(fallback);
        }
      } catch (e) {
        console.error('Failed to load HSN data', e);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  useEffect(() => {
    const query = searchQuery.toLowerCase();
    const filtered = allData.filter(item => 
      (selectedCategory === 'All' || item.category.includes(selectedCategory)) &&
      (item.code.toLowerCase().includes(query) || item.desc.toLowerCase().includes(query))
    );
    setFilteredData(filtered);
  }, [searchQuery, allData, selectedCategory]);

  const categories = ['All', 'Garments', 'Food', 'Electronics', 'Services'];

  return (
    
      <div className="space-y-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
              <Search className="w-6 h-6 text-primary-500" />
              GST HSN/SAC Finder Tool
            </h1>
            <p className="text-text-secondary text-sm mt-1">
              Search the most commonly used HSN codes and GST rates for Indian small businesses.
            </p>
          </div>
          <Button 
            onClick={() => window.open('/downloads/Most_Used_HSN_India.xlsx', '_blank')}
            variant="secondary" 
            className="flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Download Excel Master
          </Button>
        </div>

        {/* Search & Filter Bar */}
        <Card className="p-4 bg-slate-50 border-primary-100">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input 
                type="text"
                placeholder="Search by code (e.g. 6109) or item name (e.g. T-shirt)..."
                className="input pl-10 w-full h-12 text-base shadow-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5 text-gray-400" />
              <select 
                className="input h-12 flex-1 shadow-sm"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
              >
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
          </div>
        </Card>

        {/* Results */}
        <div className="space-y-4">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">
              {filteredData.length} Results Found
            </h2>
            <p className="text-[10px] text-text-muted italic">
              * Rates are indicative. Verify with official notifications.
            </p>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border border-border">
              <Loader2 className="w-10 h-10 animate-spin text-primary-500 mb-4" />
              <p className="text-text-secondary">Loading HSN Master Data...</p>
            </div>
          ) : filteredData.length > 0 ? (
            <div className="grid grid-cols-1 gap-3">
              {filteredData.map((item, idx) => (
                <div 
                  key={idx}
                  className="bg-white p-4 rounded-xl border border-border hover:border-primary-300 hover:shadow-md transition-all group"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex gap-4">
                      <div className="w-12 h-12 bg-slate-50 text-primary-600 rounded-lg flex items-center justify-center font-bold text-lg shrink-0">
                        {item.code.substring(0, 2)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono font-bold text-primary-700 bg-slate-50 px-2 py-0.5 rounded text-sm">
                            #{item.code}
                          </span>
                          <span className="text-[10px] uppercase font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded tracking-wider">
                            {item.category}
                          </span>
                        </div>
                        <p className="text-text-primary font-medium leading-snug">
                          {item.desc}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-2xl font-black text-success-600">
                        {item.rate}%
                      </div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase">GST Rate</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-20 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
              <Tag className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-bold text-gray-900">No HSN codes found</h3>
              <p className="text-text-secondary max-w-xs mx-auto mt-2 text-sm">
                Try searching with a different keyword or check the category filter.
              </p>
              <Button 
                variant="ghost" 
                className="mt-6"
                onClick={() => { setSearchQuery(''); setSelectedCategory('All'); }}
              >
                Clear Filters
              </Button>
            </div>
          )}
        </div>

        {/* Info Footer */}
        <div className="bg-slate-50 p-6 rounded-2xl border border-primary-100 mt-10">
          <h3 className="text-primary-900 font-bold mb-2 flex items-center gap-2 text-sm">
            <FileText className="w-4 h-4" />
            About this Tool
          </h3>
          <p className="text-primary-800 text-xs leading-relaxed">
            This tool provides a curated list of HSN (Goods) and SAC (Services) codes specifically used by Indian MSMEs. 
            The data is updated periodically. For legal compliance, always refer to the official notifications 
            published by the <a href="https://www.cbic.gov.in/" target="_blank" className="underline font-bold inline-flex items-center gap-0.5">CBIC <ExternalLink className="w-2 h-2" /></a>.
          </p>
        </div>
      </div>
    
  );
}


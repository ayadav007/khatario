'use client';

export const dynamic = 'force-dynamic';

/**
 * NOTE:
 * This module is intentionally isolated.
 * Do NOT import CRM, WhatsApp, or campaign logic here.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Loader2, Search, Download, FileSpreadsheet, FileText, ExternalLink, AlertCircle } from 'lucide-react';
import { NormalizedLead } from '@/lib/google-leads/normalizer';
import { useToastContext } from '@/contexts/ToastContext';

export default function GoogleLeadExtractorPage() {
  const toast = useToastContext();
  const [keyword, setKeyword] = useState('');
  const [location, setLocation] = useState('');
  const [radius, setRadius] = useState(5);
  const [maxResults, setMaxResults] = useState(50);
  const [useFreeAPI, setUseFreeAPI] = useState(true); // Default to free API
  const [loading, setLoading] = useState(false);
  const [leads, setLeads] = useState<(NormalizedLead | any)[]>([]);
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setLeads([]);
    setSelectedLeads(new Set());

    try {
      const response = await fetch('/api/tools/google-leads/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: keyword.trim(),
          location: location.trim(),
          radius: radius * 1000, // Convert km to meters
          maxResults: maxResults,
          useFreeAPI: useFreeAPI,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to search for leads');
      }

      setLeads(data.leads || []);
      
      // Select all leads by default
      setSelectedLeads(new Set(data.leads.map((lead: any) => lead.place_id)));
      
    } catch (err: any) {
      console.error('Search error:', err);
      setError(err.message || 'An error occurred while searching for leads');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (format: 'csv' | 'excel') => {
    if (selectedLeads.size === 0) {
      toast.warning('Please select at least one lead to export');
      return;
    }

    setExporting(true);

    try {
      // Filter leads to only selected ones
      const leadsToExport = leads.filter(lead => selectedLeads.has(lead.place_id));

      const response = await fetch('/api/tools/google-leads/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leads: leadsToExport,
          format,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to export leads');
      }

      // Download file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `google-leads-${new Date().toISOString().split('T')[0]}.${format === 'csv' ? 'csv' : 'xlsx'}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

    } catch (err: any) {
      console.error('Export error:', err);
      toast.error(err.message || 'Failed to export leads');
    } finally {
      setExporting(false);
    }
  };

  const toggleSelectLead = (placeId: string) => {
    const newSelected = new Set(selectedLeads);
    if (newSelected.has(placeId)) {
      newSelected.delete(placeId);
    } else {
      newSelected.add(placeId);
    }
    setSelectedLeads(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedLeads.size === filteredLeads.length) {
      setSelectedLeads(new Set());
    } else {
      setSelectedLeads(new Set(filteredLeads.map(lead => lead.place_id)));
    }
  };

  // Filter leads based on search query
  const filteredLeads = leads.filter(lead => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      lead.business_name.toLowerCase().includes(query) ||
      lead.address.toLowerCase().includes(query) ||
      (lead.phone && lead.phone.toLowerCase().includes(query)) ||
      (lead.website && lead.website.toLowerCase().includes(query))
    );
  });

  return (
    
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Google Lead Extractor</h1>
          <p className="text-gray-600">
            Extract public business data from Google Places. Free to use. No login required.
          </p>
        </div>

        {/* API Selection */}
        <Card padding="md" className="bg-purple-50 border-purple-200">
          <div className="flex items-start gap-3 mb-4">
            <AlertCircle className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-purple-900 mb-2">Choose Data Source</p>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="apiSource"
                  checked={useFreeAPI}
                  onChange={() => setUseFreeAPI(true)}
                  className="w-4 h-4 text-purple-600"
                />
                <div>
                  <span className="font-medium text-purple-900">OpenStreetMap (FREE)</span>
                  <p className="text-xs text-purple-700 mt-1">
                    Completely free, no API key needed. Limited data (no phone numbers, ratings, or reviews in most cases).
                  </p>
                </div>
              </label>
              <label className="flex items-center gap-3 cursor-pointer mt-3">
                <input
                  type="radio"
                  name="apiSource"
                  checked={!useFreeAPI}
                  onChange={() => setUseFreeAPI(false)}
                  className="w-4 h-4 text-purple-600"
                />
                <div>
                  <span className="font-medium text-purple-900">Google Places API (Paid, Free Tier Available)</span>
                  <p className="text-xs text-purple-700 mt-1">
                    $200 free credits/month (~11,000+ requests). Rich data including phone, ratings, reviews, websites.
                    Requires API key. See <a href="https://developers.google.com/maps/billing-and-pricing/pricing" target="_blank" rel="noopener noreferrer" className="underline">pricing</a>.
                  </p>
                </div>
              </label>
            </div>
          </div>
        </Card>

        {/* Search Form */}
        <Card padding="md">
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Business Keyword <span className="text-red-500">*</span>
                </label>
                <Input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="e.g., Interior designers, Restaurants, Plumbers"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Location <span className="text-red-500">*</span>
                </label>
                <Input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g., Bangalore, Mumbai, 560001"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Radius (km)
                </label>
                <Input
                  type="number"
                  value={radius}
                  onChange={(e) => setRadius(Number(e.target.value))}
                  min="1"
                  max="50"
                  step="1"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Max Results
                </label>
                <Input
                  type="number"
                  value={maxResults}
                  onChange={(e) => setMaxResults(Math.min(100, Math.max(1, Number(e.target.value))))}
                  min="1"
                  max="100"
                  step="1"
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full md:w-auto"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Extracting Leads...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4 mr-2" />
                  Extract Leads
                </>
              )}
            </Button>
          </form>
        </Card>

        {/* Error Message */}
        {error && (
          <Card padding="md" className="bg-red-50 border-red-200">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-red-800">
                <p className="font-medium">Error</p>
                <p>{error}</p>
              </div>
            </div>
          </Card>
        )}

        {/* Results */}
        {leads.length > 0 && (
          <Card padding="none">
            {/* Results Header */}
            <div className="p-4 border-b border-gray-200 flex items-center justify-between flex-wrap gap-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  Results ({filteredLeads.length} of {leads.length})
                </h2>
              </div>

              {/* Search within results */}
              <div className="flex-1 max-w-md">
                <Input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search within results..."
                  className="w-full"
                />
              </div>

              {/* Export Buttons */}
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => handleExport('csv')}
                  disabled={exporting || selectedLeads.size === 0}
                  size="sm"
                >
                  {exporting ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <FileText className="w-4 h-4 mr-2" />
                  )}
                  Export CSV ({selectedLeads.size})
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => handleExport('excel')}
                  disabled={exporting || selectedLeads.size === 0}
                  size="sm"
                >
                  {exporting ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                  )}
                  Export Excel ({selectedLeads.size})
                </Button>
              </div>
            </div>

            {/* Results Table */}
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={selectedLeads.size === filteredLeads.length && filteredLeads.length > 0}
                        onChange={toggleSelectAll}
                        className="rounded border-gray-300"
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Business Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Phone
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Address
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Website
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Rating
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Reviews
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Maps
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredLeads.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                        No leads match your search query.
                      </td>
                    </tr>
                  ) : (
                    filteredLeads.map((lead) => (
                      <tr key={lead.place_id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedLeads.has(lead.place_id)}
                            onChange={() => toggleSelectLead(lead.place_id)}
                            className="rounded border-gray-300"
                          />
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">
                          {lead.business_name}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {lead.phone || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate" title={lead.address}>
                          {lead.address || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {lead.website ? (
                            <a
                              href={`https://${lead.website}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary-600 hover:text-primary-800"
                            >
                              {lead.website}
                            </a>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {lead.rating ? lead.rating.toFixed(1) : '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {lead.reviews ? lead.reviews.toLocaleString() : '-'}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <a
                            href={lead.maps_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary-600 hover:text-primary-800 inline-flex items-center gap-1"
                          >
                            View
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Empty State */}
        {!loading && leads.length === 0 && !error && (
          <Card padding="lg" className="text-center">
            <p className="text-gray-500">
              Enter your search criteria above and click "Extract Leads" to get started.
            </p>
          </Card>
        )}
      </div>
    
  );
}


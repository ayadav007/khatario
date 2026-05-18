'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MessageSquare, Inbox, Clock, CheckCircle, XCircle, Loader2, Tag, Settings2, User } from 'lucide-react';
import { useWhatsAppSocket } from '@/hooks/useWhatsAppSocket';

interface SummaryBarProps {
  businessId: string;
  activeFilter?: 'unread' | 'new' | 'open' | 'pending' | 'closed' | string | null; // string for label/lead status IDs
  onFilterClick: (filter: 'unread' | 'new' | 'open' | 'pending' | 'closed' | string | null, type?: 'status' | 'label' | 'lead_status') => void;
}

interface SummaryData {
  unread: number;
  new: number;
  open: number;
  pending: number;
  closed: number;
  bot_resolved?: number;
  hot?: number;
  warm?: number;
  cold?: number;
  not_interested?: number;
}

interface Label {
  id: string;
  name: string;
  color: string;
  count?: number; // Will be calculated
}

interface LeadStatus {
  value: string;
  label: string;
  count?: number; // Will be calculated
}

export function SummaryBar({ businessId, activeFilter, onFilterClick }: SummaryBarProps) {
  const [summary, setSummary] = useState<SummaryData>({
    unread: 0,
    new: 0,
    open: 0,
    pending: 0,
    closed: 0,
    hot: 0,
    warm: 0,
    cold: 0,
    not_interested: 0
  });
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCustomize, setShowCustomize] = useState(false);
  const fetchingRef = useRef(false); // Prevent concurrent fetches
  
  // Load visible items from localStorage on mount
  const getStoredVisibleItems = (): {
    statuses: string[];
    labels: string[];
    leadStatuses: string[];
  } => {
    if (typeof window === 'undefined' || !businessId) {
      return {
        statuses: ['unread', 'new', 'open', 'pending', 'closed'],
        labels: [],
        leadStatuses: []
      };
    }
    
    try {
      const stored = localStorage.getItem(`whatsapp_summary_filters_${businessId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          statuses: parsed.statuses || ['unread', 'new', 'open', 'pending', 'closed'],
          labels: parsed.labels || [],
          leadStatuses: parsed.leadStatuses || []
        };
      }
    } catch (error) {
      console.error('Error loading filter preferences:', error);
    }
    
    return {
      statuses: ['unread', 'new', 'open', 'pending', 'closed'],
      labels: [],
      leadStatuses: []
    };
  };

  const [visibleItems, setVisibleItems] = useState<{
    statuses: string[];
    labels: string[];
    leadStatuses: string[];
  }>(getStoredVisibleItems());

  // Save to localStorage whenever visibleItems changes
  useEffect(() => {
    if (typeof window !== 'undefined' && businessId) {
      try {
        localStorage.setItem(`whatsapp_summary_filters_${businessId}`, JSON.stringify(visibleItems));
      } catch (error) {
        console.error('Error saving filter preferences:', error);
      }
    }
  }, [visibleItems, businessId]);

  // AI-based lead status options (from whatsapp_lead_profiles.lead_status)
  // These are auto-calculated by AI, but users can manually override
  const leadStatusOptions: LeadStatus[] = [
    { value: 'hot', label: 'Hot Leads' },
    { value: 'warm', label: 'Warm Leads' },
    { value: 'cold', label: 'Cold Leads' },
    { value: 'not_interested', label: 'Not Interested' }
  ];

  const fetchSummary = useCallback(async () => {
    if (!businessId || fetchingRef.current) return;
    
    fetchingRef.current = true;
    try {
      const res = await fetch(`/api/whatsapp/conversations/summary?business_id=${businessId}`);
      if (res.ok) {
        const data = await res.json();
        setSummary(data.summary || {
          unread: 0,
          new: 0,
          open: 0,
          pending: 0,
          closed: 0,
          hot: 0,
          warm: 0,
          cold: 0,
          not_interested: 0
        });
      }
    } catch (error) {
      console.error('Error fetching summary:', error);
    } finally {
      fetchingRef.current = false;
    }
  }, [businessId]);

  const fetchLabels = useCallback(async () => {
    if (!businessId) return;

    try {
      const res = await fetch(`/api/whatsapp/labels?business_id=${businessId}`);
      if (res.ok) {
        const data = await res.json();
        setLabels(data.labels || []);
      }
    } catch (error) {
      console.error('Error fetching labels:', error);
    }
  }, [businessId]);

  // Listen to SSE events for real-time updates
  const { connected: wsConnected } = useWhatsAppSocket({
    businessId: businessId || null,
    enabled: !!businessId,
    onSummaryUpdate: useCallback((event: any) => {
      // Update summary from SSE event (currently only has unread, but can update partial data)
      // SSE events currently only send unread_conversations, so we update that
      if (event.summary && event.summary.unread_conversations !== undefined) {
        setSummary(prev => ({
          ...prev,
          unread: event.summary.unread_conversations || 0
        }));
      }
    }, [])
  });

  // Initial fetches
  useEffect(() => {
    if (businessId) {
      fetchSummary();
      fetchLabels();
    }
  }, [businessId]); // Only depend on businessId, not the callbacks

  // Fallback polling: Only poll if SSE is disconnected, and less frequently (30s instead of 10s)
  useEffect(() => {
    if (!businessId) return;
    
    // If SSE is connected, use longer interval (60s) as backup
    // If SSE is disconnected, poll more frequently (30s)
    const intervalMs = wsConnected ? 60000 : 30000;
    
    const interval = setInterval(() => {
      fetchSummary();
    }, intervalMs);

    return () => clearInterval(interval);
  }, [businessId, wsConnected, fetchSummary]);

  useEffect(() => {
    setLoading(false);
  }, [summary]);

  const statusItems = [
    {
      key: 'unread' as const,
      label: 'Unread',
      icon: Inbox,
      count: summary.unread,
      type: 'status' as const
    },
    {
      key: 'new' as const,
      label: 'New',
      icon: MessageSquare,
      count: summary.new,
      type: 'status' as const
    },
    {
      key: 'open' as const,
      label: 'Open',
      icon: CheckCircle,
      count: summary.open,
      type: 'status' as const
    },
    {
      key: 'pending' as const,
      label: 'Pending',
      icon: Clock,
      count: summary.pending,
      type: 'status' as const
    },
    {
      key: 'closed' as const,
      label: 'Closed',
      icon: XCircle,
      count: summary.closed,
      type: 'status' as const
    },
    {
      key: 'bot_resolved' as const,
      label: 'Bot Resolved',
      icon: CheckCircle,
      count: summary.bot_resolved ?? 0,
      type: 'status' as const
    }
  ];

  const visibleStatusItems = statusItems.filter(item => visibleItems.statuses.includes(item.key));
  const visibleLabelItems = labels
    .filter(label => visibleItems.labels.includes(label.id))
    .map(label => ({
      key: `label:${label.id}`, // Prefix with type to ensure uniqueness
      displayKey: label.id, // Keep original key for filter matching
      label: label.name,
      icon: Tag,
      count: undefined, // Counts disabled for performance - can be added later with dedicated counts API
      color: label.color,
      type: 'label' as const
    }));
  const visibleLeadStatusItems = leadStatusOptions
    .filter(status => visibleItems.leadStatuses.includes(status.value))
    .map(status => ({
      key: `lead_status:${status.value}`, // Prefix with type to ensure uniqueness
      displayKey: status.value, // Keep original key for filter matching
      label: status.label,
      icon: User,
      count: summary[status.value as keyof SummaryData] as number | undefined, // Get count from summary (hot, warm, cold, not_interested)
      type: 'lead_status' as const
    }));

  const allVisibleItems = [...visibleStatusItems, ...visibleLabelItems, ...visibleLeadStatusItems];

  const colorMap: Record<string, { bg: string; text: string; active: string }> = {
    unread: { bg: 'bg-red-50', text: 'text-red-700', active: 'bg-red-100 border-red-300' },
    new: { bg: 'bg-amber-50', text: 'text-amber-700', active: 'bg-amber-100 border-amber-300' },
    open: { bg: 'bg-emerald-50', text: 'text-emerald-700', active: 'bg-emerald-100 border-emerald-300' },
    pending: { bg: 'bg-orange-50', text: 'text-orange-700', active: 'bg-orange-100 border-orange-300' },
    closed: { bg: 'bg-gray-100', text: 'text-gray-700', active: 'bg-gray-200 border-gray-400' },
    bot_resolved: { bg: 'bg-purple-50', text: 'text-purple-700', active: 'bg-purple-100 border-purple-300' }
  };

  if (loading) {
    return (
      <div className="bg-gradient-to-r from-slate-50 to-gray-50 border-b border-gray-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-center gap-3">
          <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
          <span className="text-sm text-gray-600">Loading overview...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-slate-50 to-gray-50 border-b border-gray-200 px-6 py-4 flex-shrink-0">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-700">Overview</span>
          <button
            onClick={() => setShowCustomize(!showCustomize)}
            className="p-1.5 hover:bg-gray-200 rounded-lg transition-colors"
            title="Customize filters"
          >
            <Settings2 className="w-4 h-4 text-gray-600" />
          </button>
        </div>
        
        <div className="flex items-center gap-3 flex-wrap">
          {allVisibleItems.map((item) => {
            const Icon = item.icon;
            // Use displayKey for filter matching (for labels/lead statuses), or key for status items
            const filterKey = 'displayKey' in item ? item.displayKey : item.key;
            // For lead_status items, check if activeFilter matches the value (could be passed directly)
            // For other items, check exact match with filterKey
            const isActive = item.type === 'lead_status' 
              ? (activeFilter === filterKey || activeFilter === item.key)
              : activeFilter === filterKey;
            
            // Get colors - use custom color for labels, default map for statuses
            // Use filterKey for colorMap lookup (removes type prefix)
            let colors = colorMap[filterKey] || {
              bg: 'bg-slate-50',
              text: 'text-primary-700',
              active: 'bg-slate-100 border-primary-300'
            };
            
            // Override with label color if it's a label
            if (item.type === 'label' && 'color' in item) {
              const labelColor = item.color;
              colors = {
                bg: `${labelColor}15`,
                text: labelColor,
                active: `${labelColor}30`
              };
            }
            
            return (
              <button
                key={item.key} // Use prefixed key for React uniqueness
                onClick={() => {
                  onFilterClick(isActive ? null : filterKey, item.type);
                }}
                className={`
                  flex items-center gap-2.5 px-4 py-2 rounded-xl transition-all duration-200
                  border-2 ${isActive ? colors.active : `${colors.bg} border-transparent hover:border-gray-300`}
                  ${isActive ? 'shadow-sm' : 'hover:shadow-sm'}
                `}
                title={`Filter by ${item.label}`}
                style={(item.type === 'label' && 'color' in item) ? {
                  borderColor: isActive ? (item as any).color : 'transparent'
                } : {}}
              >
                <Icon className={`w-4 h-4 ${colors.text}`} style={(item.type === 'label' && 'color' in item) ? { color: (item as any).color } : {}} />
                <span className={`text-sm font-medium ${colors.text}`} style={(item.type === 'label' && 'color' in item) ? { color: (item as any).color } : {}}>{item.label}</span>
                {item.count !== undefined && (
                  <span 
                    className={`
                      px-2.5 py-0.5 rounded-full text-xs font-bold
                      ${isActive ? colors.active : colors.bg} ${colors.text}
                      min-w-[24px] text-center
                    `}
                    style={(item.type as string) === 'label' ? { 
                      backgroundColor: isActive ? `${(item as any).color}30` : `${(item as any).color}15`,
                      color: (item as any).color 
                    } : {}}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Customize Modal */}
      {showCustomize && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="bg-white rounded-lg p-4 shadow-lg border border-gray-200">
            <h4 className="text-sm font-semibold text-gray-900 mb-3">Customize Overview Filters</h4>
            
            {/* Status Filters */}
            <div className="mb-4">
              <label className="text-xs font-medium text-gray-700 mb-2 block">Status Filters</label>
              <div className="flex flex-wrap gap-2">
                {statusItems.map(item => (
                  <label key={item.key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visibleItems.statuses.includes(item.key)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setVisibleItems(prev => ({
                            ...prev,
                            statuses: [...prev.statuses, item.key]
                          }));
                        } else {
                          setVisibleItems(prev => ({
                            ...prev,
                            statuses: prev.statuses.filter(s => s !== item.key)
                          }));
                        }
                      }}
                      className="rounded border-gray-300"
                    />
                    <span className="text-xs text-gray-700">{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Lead Status Filters */}
            <div className="mb-4">
              <label className="text-xs font-medium text-gray-700 mb-2 block">Lead Status Filters</label>
              <div className="flex flex-wrap gap-2">
                {leadStatusOptions.map(status => (
                  <label key={status.value} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visibleItems.leadStatuses.includes(status.value)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setVisibleItems(prev => ({
                            ...prev,
                            leadStatuses: [...prev.leadStatuses, status.value]
                          }));
                        } else {
                          setVisibleItems(prev => ({
                            ...prev,
                            leadStatuses: prev.leadStatuses.filter(s => s !== status.value)
                          }));
                        }
                      }}
                      className="rounded border-gray-300"
                    />
                    <span className="text-xs text-gray-700">{status.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Label Filters */}
            {labels.length > 0 && (
              <div>
                <label className="text-xs font-medium text-gray-700 mb-2 block">Label Filters</label>
                <div className="flex flex-wrap gap-2">
                  {labels.map(label => (
                    <label key={label.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={visibleItems.labels.includes(label.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setVisibleItems(prev => ({
                              ...prev,
                              labels: [...prev.labels, label.id]
                            }));
                          } else {
                            setVisibleItems(prev => ({
                              ...prev,
                              labels: prev.labels.filter(l => l !== label.id)
                            }));
                          }
                        }}
                        className="rounded border-gray-300"
                      />
                      <span 
                        className="text-xs px-2 py-0.5 rounded"
                        style={{ 
                          backgroundColor: `${label.color}20`,
                          color: label.color 
                        }}
                      >
                        {label.name}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {labels.length === 0 && (
              <p className="text-xs text-gray-500 italic">No labels created yet. Create labels from the conversation list.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

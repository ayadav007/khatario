'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { MessageSquare, Inbox, Clock, CheckCircle, XCircle, Loader2, Tag, Settings2, User, Hand, Headphones, Bot, Volume2, VolumeX } from 'lucide-react';
import { useWhatsAppSocket } from '@/hooks/useWhatsAppSocket';
import { isInboxSoundOn, requestInboxNotificationPermission, setInboxSoundOn, type InboxState, type TeamMember } from './inbox';

export interface InboxFilter {
  state: InboxState | null;
  /** 'me', 'others' or a user id; only for Intervened. Undefined = anyone. */
  intervenedBy?: string;
}

interface SummaryBarProps {
  businessId: string;
  activeFilter?: 'unread' | 'new' | 'open' | 'pending' | 'closed' | string | null; // string for label/lead status IDs
  onFilterClick: (filter: 'unread' | 'new' | 'open' | 'pending' | 'closed' | string | null, type?: 'status' | 'label' | 'lead_status') => void;
  inboxFilter?: InboxFilter;
  onInboxFilter?: (filter: InboxFilter) => void;
  /** SSE / live list updates connected */
  wsConnected?: boolean;
  /** WhatsApp session linked */
  whatsappConnected?: boolean;
  /** Dev-only cache clear */
  onClearCache?: () => void;
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
  active?: number;
  requesting?: number;
  intervened?: number;
  intervened_by_me?: number;
  intervened_by_others?: number;
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

export function SummaryBar({
  businessId,
  activeFilter,
  onFilterClick,
  inboxFilter,
  onInboxFilter,
  wsConnected: wsConnectedProp,
  whatsappConnected,
  onClearCache,
}: SummaryBarProps) {
  const [isSupervisor, setIsSupervisor] = useState(false);
  const [agents, setAgents] = useState<TeamMember[]>([]);
  const [soundOn, setSoundOn] = useState(true);
  const summaryRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSoundOn(isInboxSoundOn());
  }, []);
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
        statuses: ['unread'],
        labels: [],
        leadStatuses: []
      };
    }
    
    try {
      const stored = localStorage.getItem(`whatsapp_summary_filters_${businessId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          statuses: parsed.statuses || ['unread'],
          labels: parsed.labels || [],
          leadStatuses: parsed.leadStatuses || []
        };
      }
    } catch (error) {
      console.error('Error loading filter preferences:', error);
    }
    
    return {
      statuses: ['unread'],
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
        setIsSupervisor(!!data.viewer?.is_supervisor);
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

  // Ownership changes move chats between Requesting / Intervened / Active; refetch counts (debounced).
  const scheduleSummaryRefresh = useCallback(() => {
    if (summaryRefreshRef.current) clearTimeout(summaryRefreshRef.current);
    summaryRefreshRef.current = setTimeout(() => {
      void fetchSummary();
    }, 1500);
  }, [fetchSummary]);

  useEffect(() => () => {
    if (summaryRefreshRef.current) clearTimeout(summaryRefreshRef.current);
  }, []);

  // Listen to SSE events for real-time updates
  const { connected: wsConnected } = useWhatsAppSocket({
    businessId: businessId || null,
    enabled: !!businessId,
    onConversationUpdate: scheduleSummaryRefresh,
    onConversationHidden: scheduleSummaryRefresh,
    onSummaryUpdate: scheduleSummaryRefresh,
  });

  useEffect(() => {
    if (!businessId || !isSupervisor) return;
    fetch(`/api/whatsapp/users?business_id=${businessId}`)
      .then((res) => (res.ok ? res.json() : { users: [] }))
      .then((data) => setAgents((data.users || []).filter((u: TeamMember) => u.can_receive !== false)))
      .catch(() => setAgents([]));
  }, [businessId, isSupervisor]);

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

  const inboxItems: Array<{
    key: InboxState;
    label: string;
    title: string;
    icon: typeof Hand;
    count: number;
    colors: { bg: string; text: string; active: string };
  }> = [
    {
      key: 'requesting',
      label: 'Requesting',
      title: 'Customers waiting for a person. Anyone can intervene.',
      icon: Hand,
      count: summary.requesting ?? 0,
      colors: { bg: 'bg-amber-50', text: 'text-amber-700', active: 'bg-amber-100 border-amber-300' },
    },
    {
      key: 'intervened',
      label: 'Intervened',
      title: isSupervisor ? 'Chats a team member is handling' : 'Chats you are handling',
      icon: Headphones,
      count: summary.intervened ?? 0,
      colors: { bg: 'bg-blue-50', text: 'text-blue-700', active: 'bg-blue-100 border-blue-300' },
    },
    {
      key: 'active',
      label: 'Active',
      title: 'Chats the bot is handling',
      icon: Bot,
      count: summary.active ?? 0,
      colors: { bg: 'bg-gray-100', text: 'text-gray-700', active: 'bg-gray-200 border-gray-400' },
    },
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


  const colorMap: Record<string, { bg: string; text: string; active: string }> = {
    unread: { bg: 'bg-red-50', text: 'text-red-700', active: 'bg-red-100 border-red-300' },
    new: { bg: 'bg-amber-50', text: 'text-amber-700', active: 'bg-amber-100 border-amber-300' },
    open: { bg: 'bg-emerald-50', text: 'text-emerald-700', active: 'bg-emerald-100 border-emerald-300' },
    pending: { bg: 'bg-orange-50', text: 'text-orange-700', active: 'bg-orange-100 border-orange-300' },
    closed: { bg: 'bg-gray-100', text: 'text-gray-700', active: 'bg-gray-200 border-gray-400' },
    bot_resolved: { bg: 'bg-purple-50', text: 'text-purple-700', active: 'bg-purple-100 border-purple-300' }
  };

  const isItemActive = (item: (typeof visibleStatusItems)[0] | (typeof visibleLabelItems)[0] | (typeof visibleLeadStatusItems)[0]) => {
    const filterKey = 'displayKey' in item ? item.displayKey : item.key;
    return item.type === 'lead_status'
      ? (activeFilter === filterKey || activeFilter === item.key)
      : activeFilter === filterKey;
  };

  /** Hide zero-count status/lead chips unless active; Unread always stays; labels always if customized. */
  const filterItemsToShow = [
    ...visibleStatusItems,
    ...visibleLabelItems,
    ...visibleLeadStatusItems,
  ].filter((item) => {
    if (item.type === 'label') return true;
    if (item.type === 'status' && item.key === 'unread') return true;
    if (isItemActive(item)) return true;
    return (item.count ?? 0) > 0;
  });

  const liveConnected = wsConnectedProp ?? wsConnected;

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-1 py-1">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
        <span className="text-xs text-gray-500">Loading overview…</span>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs font-semibold text-gray-600">Overview</span>
          <button
            onClick={() => setShowCustomize(!showCustomize)}
            className="p-1 hover:bg-gray-200 rounded-md transition-colors"
            title="Customize filters"
            aria-expanded={showCustomize}
          >
            <Settings2 className="w-3.5 h-3.5 text-gray-500" />
          </button>
        </div>

        <div className="flex items-center gap-1.5 flex-1 min-w-0 flex-wrap">
          {onInboxFilter && inboxItems.map((item) => {
            const Icon = item.icon;
            const isActive = inboxFilter?.state === item.key;
            return (
              <button
                key={`inbox:${item.key}`}
                type="button"
                onClick={() => onInboxFilter(isActive ? { state: null } : { state: item.key })}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                  isActive
                    ? `${item.colors.active} shadow-sm`
                    : `${item.colors.bg} border-transparent hover:border-gray-300`
                }`}
                title={item.title}
              >
                <Icon className={`w-3.5 h-3.5 ${item.colors.text}`} />
                <span className={item.colors.text}>{item.label}</span>
                <span className={`min-w-[1.25rem] text-center font-bold ${item.colors.text}`}>
                  {item.count}
                </span>
              </button>
            );
          })}

          {onInboxFilter && isSupervisor && inboxFilter?.state === 'intervened' && (
            <div className="flex items-center gap-0.5 rounded-lg border border-blue-200 bg-white p-0.5 text-[11px]">
              {[
                { key: undefined as string | undefined, label: 'Anyone' },
                { key: 'me', label: `Me (${summary.intervened_by_me ?? 0})` },
                { key: 'others', label: `Others (${summary.intervened_by_others ?? 0})` },
              ].map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => onInboxFilter({ state: 'intervened', intervenedBy: opt.key })}
                  className={`rounded-md px-1.5 py-0.5 font-medium ${
                    inboxFilter.intervenedBy === opt.key ? 'bg-blue-100 text-blue-800' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
              {agents.length > 0 && (
                <select
                  className="rounded-md border-0 bg-transparent py-0.5 pl-1 pr-5 text-[11px] text-gray-700 focus:ring-0"
                  value={inboxFilter.intervenedBy && !['me', 'others'].includes(inboxFilter.intervenedBy) ? inboxFilter.intervenedBy : ''}
                  onChange={(e) => onInboxFilter({ state: 'intervened', intervenedBy: e.target.value || undefined })}
                  aria-label="Intervened by agent"
                >
                  <option value="">Agent…</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {onInboxFilter && filterItemsToShow.length > 0 && (
            <span className="hidden sm:block w-px h-4 bg-gray-300 shrink-0 mx-0.5" aria-hidden />
          )}

          {filterItemsToShow.map((item) => {
            const Icon = item.icon;
            const filterKey = 'displayKey' in item ? item.displayKey : item.key;
            const isActive = isItemActive(item);

            let colors = colorMap[filterKey] || {
              bg: 'bg-slate-50',
              text: 'text-primary-700',
              active: 'bg-slate-100 border-primary-300',
            };

            if (item.type === 'label' && 'color' in item) {
              const labelColor = item.color;
              colors = {
                bg: `${labelColor}15`,
                text: labelColor,
                active: `${labelColor}30`,
              };
            }

            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onFilterClick(isActive ? null : filterKey, item.type)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border transition-colors ${
                  isActive
                    ? `${colors.active} shadow-sm`
                    : `${colors.bg} border-transparent hover:border-gray-300`
                }`}
                title={`Filter by ${item.label}`}
                style={
                  item.type === 'label' && 'color' in item
                    ? { borderColor: isActive ? (item as { color: string }).color : 'transparent' }
                    : undefined
                }
              >
                <Icon
                  className={`w-3 h-3 ${colors.text}`}
                  style={item.type === 'label' && 'color' in item ? { color: (item as { color: string }).color } : undefined}
                />
                <span
                  className={colors.text}
                  style={item.type === 'label' && 'color' in item ? { color: (item as { color: string }).color } : undefined}
                >
                  {item.label}
                </span>
                {item.count !== undefined && (
                  <span
                    className={`font-bold tabular-nums ${colors.text}`}
                    style={
                      item.type === 'label' && 'color' in item
                        ? { color: (item as { color: string }).color }
                        : undefined
                    }
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 shrink-0 text-xs text-gray-600 ml-1">
          {onInboxFilter && (
            <button
              type="button"
              onClick={() => {
                const next = !soundOn;
                setSoundOn(next);
                setInboxSoundOn(next);
                if (next) requestInboxNotificationPermission();
              }}
              className="p-1 rounded-md text-gray-500 hover:bg-gray-200"
              title={soundOn ? 'Sound alerts on. Click to mute.' : 'Sound alerts off. Click to turn on.'}
              aria-label={soundOn ? 'Mute inbox alerts' : 'Turn on inbox alerts'}
            >
              {soundOn ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            </button>
          )}

          {wsConnectedProp !== undefined && (
            <span
              className="inline-flex items-center gap-1"
              title="Server-sent events for new messages and list updates"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                  liveConnected ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
                }`}
              />
              <span className="hidden md:inline">{liveConnected ? 'Live' : 'Reconnecting…'}</span>
            </span>
          )}

          {whatsappConnected !== undefined && (
            whatsappConnected ? (
              <span className="inline-flex items-center gap-1" title="Your WhatsApp number is connected">
                <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-emerald-500" />
                <span className="hidden md:inline">WhatsApp</span>
              </span>
            ) : (
              <Link
                href="/settings/whatsapp"
                className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-amber-800 border border-amber-200 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                title="WhatsApp is not connected. Open settings to scan the QR code."
              >
                <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-amber-500" />
                Offline — connect
              </Link>
            )
          )}

          {onClearCache && process.env.NODE_ENV === 'development' && (
            <button
              type="button"
              onClick={onClearCache}
              className="text-[11px] text-primary-600 hover:underline"
            >
              Clear cache
            </button>
          )}
        </div>
      </div>

      {showCustomize && (
        <div className="mt-2 pt-2 border-t border-gray-200">
          <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-200">
            <h4 className="text-xs font-semibold text-gray-900 mb-2">Customize Overview Filters</h4>
            <p className="text-[11px] text-gray-500 mb-3">
              Status and lead filters with a count of 0 stay hidden until they have conversations (Unread always shows).
            </p>

            <div className="mb-3">
              <label className="text-[11px] font-medium text-gray-700 mb-1.5 block">Status Filters</label>
              <div className="flex flex-wrap gap-2">
                {statusItems.map((item) => (
                  <label key={item.key} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visibleItems.statuses.includes(item.key)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setVisibleItems((prev) => ({
                            ...prev,
                            statuses: [...prev.statuses, item.key],
                          }));
                        } else {
                          setVisibleItems((prev) => ({
                            ...prev,
                            statuses: prev.statuses.filter((s) => s !== item.key),
                          }));
                        }
                      }}
                      className="rounded border-gray-300"
                    />
                    <span className="text-[11px] text-gray-700">{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="mb-3">
              <label className="text-[11px] font-medium text-gray-700 mb-1.5 block">Lead Status Filters</label>
              <div className="flex flex-wrap gap-2">
                {leadStatusOptions.map((status) => (
                  <label key={status.value} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visibleItems.leadStatuses.includes(status.value)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setVisibleItems((prev) => ({
                            ...prev,
                            leadStatuses: [...prev.leadStatuses, status.value],
                          }));
                        } else {
                          setVisibleItems((prev) => ({
                            ...prev,
                            leadStatuses: prev.leadStatuses.filter((s) => s !== status.value),
                          }));
                        }
                      }}
                      className="rounded border-gray-300"
                    />
                    <span className="text-[11px] text-gray-700">{status.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {labels.length > 0 ? (
              <div>
                <label className="text-[11px] font-medium text-gray-700 mb-1.5 block">Label Filters</label>
                <div className="flex flex-wrap gap-2">
                  {labels.map((label) => (
                    <label key={label.id} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={visibleItems.labels.includes(label.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setVisibleItems((prev) => ({
                              ...prev,
                              labels: [...prev.labels, label.id],
                            }));
                          } else {
                            setVisibleItems((prev) => ({
                              ...prev,
                              labels: prev.labels.filter((l) => l !== label.id),
                            }));
                          }
                        }}
                        className="rounded border-gray-300"
                      />
                      <span
                        className="text-[11px] px-1.5 py-0.5 rounded"
                        style={{
                          backgroundColor: `${label.color}20`,
                          color: label.color,
                        }}
                      >
                        {label.name}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-gray-500 italic">
                No labels created yet. Create labels from the conversation list.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

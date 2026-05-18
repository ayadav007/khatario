'use client';

import React, { useState } from 'react';
import { format, isToday, isYesterday } from 'date-fns';
import { Search, Loader2, Pin, BellOff, Bot, Megaphone, User, Filter, Tag, MoreVertical } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { NewConversationModal } from './NewConversationModal';
import { LabelManagerModal } from '../labels/LabelManagerModal';
import { ExportButton } from './ExportButton';

export interface Conversation {
  id: string;
  conversation_id: string;
  from_number: string;
  last_message_text: string;
  last_message_at: string;
  last_message_direction: 'incoming' | 'outgoing';
  unread_count: number;
  status: string;
  customer_id?: string;
  customer_name?: string;
  customer_phone?: string;
  is_pinned?: boolean;
  is_muted?: boolean;
  is_blocked?: boolean;
  is_group?: boolean;
  group_name?: string;
  labels?: Array<{ id: string; name: string; color: string }>;
  assigned_to?: string;
  assigned_agent_name?: string;
  lead_status?: string;
  conversation_status?: string;
  profile_picture_url?: string | null;
}

export interface FilterState {
  status?: string;
  assigned_to?: string;
  lead_status?: string;
  conversation_status?: string;
  label_id?: string;
}

interface ConversationListProps {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSearch: (query: string) => void;
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
  loading?: boolean;
  isLoadingMore?: boolean;
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
  businessId?: string;
  initialPhoneNumber?: string;
}

// Helper function to format phone number
function formatPhoneNumber(phone: string): string {
  if (!phone) return 'Unknown';
  let cleanPhone = phone.replace('@s.whatsapp.net', '').replace(/\D/g, '');
  if (cleanPhone.length > 13) {
    cleanPhone = cleanPhone.slice(-12);
  }
  if (cleanPhone.length === 12) {
    return `+${cleanPhone.slice(0, 2)} ${cleanPhone.slice(2, 7)} ${cleanPhone.slice(7)}`;
  }
  if (cleanPhone.length === 11) {
    return `+${cleanPhone.slice(0, 1)} ${cleanPhone.slice(1, 6)} ${cleanPhone.slice(6)}`;
  }
  if (cleanPhone.length === 10) {
    return `${cleanPhone.slice(0, 5)} ${cleanPhone.slice(5)}`;
  }
  if (cleanPhone.length > 10) {
    return `+${cleanPhone.slice(0, -10)} ${cleanPhone.slice(-10, -5)} ${cleanPhone.slice(-5)}`;
  }
  return cleanPhone;
}

// Helper function to get display name
function getDisplayName(conv: Conversation): string {
  if (conv.is_group && conv.group_name) {
    return conv.group_name;
  }
  if (conv.customer_name) {
    return conv.customer_name;
  }
  return formatPhoneNumber(conv.conversation_id || conv.from_number);
}

// Generate consistent avatar color from JID/phone (hue from char codes)
function getAvatarStyle(id: string): React.CSSProperties {
  const hue = [...(id || 'x')].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  return {
    background: `hsl(${hue}, 35%, 45%)`,
    color: `hsl(${hue}, 80%, 92%)`,
  };
}

// Format the last message preview with "You:" prefix and media emoji
const MEDIA_PREVIEW: Record<string, string> = {
  image: '📷 Photo',
  video: '📹 Video',
  audio: '🎵 Audio',
  voice: '🎵 Voice message',
  document: '📎 Document',
  sticker: '🔖 Sticker',
  location: '📍 Location',
  contact: '👤 Contact',
  poll: '📊 Poll',
};

function formatLastMessage(text: string | undefined, direction: string | undefined): string {
  if (!text) return 'No messages yet';
  const mediaKey = Object.keys(MEDIA_PREVIEW).find(k =>
    text === `[${k.charAt(0).toUpperCase() + k.slice(1)}]` ||
    text.toLowerCase() === `[${k}]` ||
    text === `[Media]`
  );
  const preview = mediaKey ? MEDIA_PREVIEW[mediaKey] : (text === '[Media]' ? '📎 Media' : text);
  return direction === 'outgoing' ? `You: ${preview}` : preview;
}

// Status badge colors
function getStatusColor(status?: string): string {
  switch (status) {
    case 'open':
      return 'bg-emerald-100 text-emerald-700 border border-emerald-200';
    case 'pending':
      return 'bg-amber-100 text-amber-700 border border-amber-200';
    case 'closed':
      return 'bg-gray-100 text-gray-600 border border-gray-200';
    case 'bot_resolved':
      return 'bg-purple-100 text-purple-700 border border-purple-200';
    default:
      return 'bg-gray-100 text-gray-600 border border-gray-200';
  }
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onSearch,
  filters,
  onFilterChange,
  loading = false,
  isLoadingMore = false,
  onScroll,
  businessId,
  initialPhoneNumber
}: ConversationListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewConversationModal, setShowNewConversationModal] = useState(false);
  
  // Open modal with initial phone number if provided
  React.useEffect(() => {
    if (initialPhoneNumber && businessId) {
      setShowNewConversationModal(true);
    }
  }, [initialPhoneNumber, businessId]);
  const [showLabelManagerModal, setShowLabelManagerModal] = useState(false);
  const [updatingLabel, setUpdatingLabel] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [availableLabels, setAvailableLabels] = useState<Array<{ id: string; name: string; color: string }>>([]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    onSearch(query);
  };

  // Fetch available labels
  React.useEffect(() => {
    if (!businessId) return;
    
    fetch(`/api/whatsapp/labels?business_id=${businessId}`)
      .then(res => res.json())
      .then(data => {
        if (data.labels) {
          setAvailableLabels(data.labels);
        }
      })
      .catch(err => console.error('Error fetching labels:', err));
  }, [businessId]);

  // Close menu when clicking outside
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (openMenuId) {
        setOpenMenuId(null);
      }
    }

    if (openMenuId) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [openMenuId]);

  const handleAssignLabel = async (conversationId: string, labelId: string) => {
    if (!businessId) return;
    
    setUpdatingLabel(labelId);
    try {
      const conv = conversations.find(c => c.id === conversationId);
      const hasLabel = conv?.labels?.some(l => l.id === labelId);
      
      const res = await fetch(
        `/api/whatsapp/conversations/${conversationId}/labels?business_id=${businessId}${hasLabel ? `&label_id=${labelId}` : ''}`,
        {
          method: hasLabel ? 'DELETE' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: hasLabel ? undefined : JSON.stringify({ label_id: labelId })
        }
      );
      
      if (res.ok) {
        onSelect(conversationId); // Trigger refresh
        setOpenMenuId(null);
      }
    } catch (error) {
      console.error('Error assigning label:', error);
    } finally {
      setUpdatingLabel(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white" style={{ minHeight: 0, overflow: 'hidden' }}>
      {/* Header - WhatsApp style */}
      <div className="bg-[#008069] px-4 pt-3 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-3 min-h-[44px]">
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 24 24" className="w-6 h-6 text-white fill-current">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
            </div>
            <h3 className="text-white font-medium text-lg whitespace-nowrap">WhatsApp</h3>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setShowNewConversationModal(true)}
              className="p-2 text-white hover:bg-white/10 rounded-full transition-colors flex-shrink-0"
              title="New chat"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
              </svg>
            </button>
            {businessId && (
              <ExportButton
                businessId={businessId}
                filters={filters}
                disabled={loading}
              />
            )}
            <button
              onClick={() => setShowLabelManagerModal(true)}
              className="p-2 text-white hover:bg-white/10 rounded-full transition-colors flex-shrink-0"
              title="Manage Labels"
            >
              <Tag className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        {/* Search - WhatsApp style */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            type="text"
            placeholder="Ask Meta AI or Search"
            value={searchQuery}
            onChange={handleSearchChange}
            className="pl-10 pr-4 py-2 bg-white text-gray-900 placeholder-gray-500 border-0 rounded-lg focus:ring-0 focus:outline-none text-sm"
          />
        </div>
        
      </div>

      {/* Conversations List */}
      <div 
        className="flex-1 overflow-y-auto" 
        style={{ minHeight: 0 }}
        onScroll={onScroll}
      >
        {loading && conversations.length === 0 ? (
          /* SKELETON PLACEHOLDERS */
          <div>
            {Array.from({ length: 5 }).map((_, idx) => (
              <div key={`skeleton-${idx}`} className="flex items-center p-3 border-b border-gray-100">
                <div className="w-10 h-10 bg-gray-200 rounded-full animate-pulse mr-3" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-gray-200 rounded w-1/3 animate-pulse" />
                  <div className="h-2 bg-gray-200 rounded w-2/3 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
          /* END SKELETON PLACEHOLDERS */
        ) : conversations.length === 0 ? (
          <div className="text-center text-gray-500 py-12 px-4">
            <p className="text-gray-600">No conversations found</p>
          </div>
        ) : (
          <>
            {conversations.map((conv) => {
            const msgDate = new Date(conv.last_message_at);
            const timeStr = isToday(msgDate)
              ? format(msgDate, 'h:mm a').toLowerCase()
              : isYesterday(msgDate)
              ? 'Yesterday'
              : format(msgDate, 'MMM d');

            const displayName = getDisplayName(conv);
            const isSelected = selectedId === conv.id;

            const phoneNumber = !conv.is_group ? (conv.customer_phone || formatPhoneNumber(conv.from_number)) : null;

            return (
              <div
                key={conv.id}
                className={`px-4 py-3 cursor-pointer transition-colors group ${
                  isSelected
                    ? 'bg-[#e9edef]'
                    : 'hover:bg-[#f5f6f6] active:bg-[#e9edef]'
                }`}
                onClick={() => onSelect(conv.id)}
              >
                <div className="flex items-center gap-3 relative">
                  {/* Avatar - Circular */}
                  {conv.profile_picture_url ? (
                    <img
                      src={conv.profile_picture_url}
                      alt={displayName}
                      className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        const fallback = target.nextElementSibling as HTMLElement;
                        if (fallback) {
                          fallback.classList.remove('hidden');
                          fallback.style.display = 'flex';
                        }
                      }}
                    />
                  ) : null}
                  <div
                    className={`w-12 h-12 rounded-full flex items-center justify-center font-medium text-lg flex-shrink-0 ${conv.profile_picture_url ? 'hidden' : ''}`}
                    style={getAvatarStyle(conv.conversation_id || conv.from_number || conv.id)}
                  >
                    {displayName.charAt(0).toUpperCase()}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-1">
                      <h4 className="font-medium text-[#111b21] truncate" style={{ fontSize: '15px', fontFamily: '"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif' }}>
                        {displayName}
                      </h4>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className="text-xs text-[#667781]">
                          {timeStr}
                        </span>
                        {/* Three dots menu */}
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId(openMenuId === conv.id ? null : conv.id);
                            }}
                            className="p-1 text-[#667781] hover:bg-[#e9edef] rounded-full transition-colors"
                            title="More options"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>
                          {openMenuId === conv.id && (
                            <div 
                              className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 min-w-[200px]"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="px-3 py-2 border-b border-gray-100">
                                <p className="text-xs font-semibold text-gray-500 uppercase">Assign Label</p>
                              </div>
                              {availableLabels.length === 0 ? (
                                <div className="px-4 py-2 text-xs text-gray-500">
                                  No labels available. Create labels first.
                                </div>
                              ) : (
                                availableLabels.map((label) => {
                                  const isAssigned = conv.labels?.some(l => l.id === label.id);
                                  return (
                                    <button
                                      key={label.id}
                                      onClick={() => handleAssignLabel(conv.id, label.id)}
                                      disabled={updatingLabel === label.id}
                                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                                    >
                                      <div 
                                        className="w-3 h-3 rounded-full flex-shrink-0"
                                        style={{ backgroundColor: label.color }}
                                      />
                                      <span className="flex-1">{label.name}</span>
                                      {isAssigned && (
                                        <span className="text-[#008069] text-xs">✓</span>
                                      )}
                                      {updatingLabel === label.id && (
                                        <Loader2 className="w-3 h-3 animate-spin text-gray-400" />
                                      )}
                                    </button>
                                  );
                                })
                              )}
                              <div className="px-4 py-2 border-t border-gray-100 mt-1">
                                <button
                                  onClick={() => {
                                    setShowLabelManagerModal(true);
                                    setOpenMenuId(null);
                                  }}
                                  className="w-full text-left text-sm text-[#008069] hover:bg-gray-100 flex items-center gap-2"
                                >
                                  <Tag className="w-4 h-4" />
                                  Manage Labels
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    {/* Phone number (if not a group) */}
                    {phoneNumber && (
                      <p className="text-[#667781] mb-1 truncate" style={{ fontSize: '12.8px', fontFamily: '"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif' }}>
                        {phoneNumber}
                      </p>
                    )}

                    {/* Last message and unread */}
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[#667781] truncate flex-1 font-normal" style={{ fontSize: '14.2px', fontFamily: '"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif' }}>
                        {formatLastMessage(conv.last_message_text, conv.last_message_direction)}
                      </p>
                      {conv.unread_count > 0 && (
                        <span className="bg-[#25d366] text-white text-xs font-medium rounded-full px-1.5 py-0.5 min-w-[20px] text-center flex-shrink-0">
                          {conv.unread_count > 9 ? '9+' : conv.unread_count}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
            })}
            {isLoadingMore && (
              <div className="px-4 py-3 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                <span className="ml-2 text-sm text-gray-500">Loading more...</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* New Conversation Modal */}
      {businessId && (
        <NewConversationModal
          isOpen={showNewConversationModal}
          onClose={() => setShowNewConversationModal(false)}
          onSuccess={() => {
            // Conversation will appear automatically via WebSocket events
          }}
          businessId={businessId}
          initialPhoneNumber={initialPhoneNumber}
        />
      )}
    </div>
  );
}


'use client';

/**
 * Enhanced Bot Rules Tab with Professional-Grade Features
 * Includes: Advanced triggers, response types, chaining, conditions, actions, context variables
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Toast, ToastType } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/whatsapp/ConfirmDialog';
import { 
  Plus, Edit2, Trash2, Check, X, Save, AlertCircle, Play, Copy, 
  Search, Filter, Info, HelpCircle, Phone, LinkIcon
} from 'lucide-react';

// Enhanced interfaces
interface Label {
  id: string;
  name: string;
  color: string;
}

interface BotRule {
  id: string;
  name: string;
  category?: string;
  trigger_type: 'keyword' | 'exact_match' | 'starts_with' | 'ends_with' | 
                'match_all_keywords' | 'match_any_keyword' | 'regex' | 'all' | 
                'first_message' | 'message_type';
  trigger_value: string;
  trigger_conditions?: {
    required_label_ids?: string[];
    excluded_label_ids?: string[];
    min_inactivity_minutes?: number;
    sender_types?: ('individual' | 'group')[];
    conversation_state?: string;
  };
  is_active: boolean;
  priority: number;
  response_type: 'text' | 'image' | 'video' | 'document' | 'audio' | 'list' | 'button' | 'template';
  response_message: string;
  response_media_url?: string;
  response_media_type?: string;
  response_options?: Array<{ id: string; title: string; description?: string }>; // Old format - kept for backward compatibility
  // New button format (same as bulk campaigns)
  quickReplies?: string[];
  callToActions?: {
    phone?: { title: string; phone: string };
    url?: { title: string; url: string };
  };
  footer?: string;
  next_rule_id?: string;
  end_flow?: boolean;
  only_for_individuals: boolean;
  auto_actions?: {
    add_labels?: string[];
    remove_labels?: string[];
    assign_to_user_id?: string;
    create_lead?: boolean;
    update_crm_field?: Record<string, any>;
    send_followup_after_minutes?: number;
    save_context?: Record<string, string>;
  };
  fallback_message?: string;
  expected_input_type?: 'text' | 'number' | 'yes_no' | 'email' | 'phone' | 'menu_option';
  context_variables?: {
    extract?: string[];
    store_as?: Record<string, string>;
  };
  delay_seconds?: number;
  enable_typing?: boolean;
  created_at?: string;
  updated_at?: string;
}

export function BotRulesTabEnhanced() {
  const { business } = useAuth();
  const [rules, setRules] = useState<BotRule[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingRule, setEditingRule] = useState<BotRule | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // Form state with all new fields
  const [formData, setFormData] = useState<Partial<BotRule>>({
    name: '',
    category: '',
    trigger_type: 'keyword',
    trigger_value: '',
    trigger_conditions: {},
    is_active: true,
    priority: 0,
    response_type: 'text',
    response_message: '',
    response_media_url: '',
    response_options: [], // Old format - kept for backward compatibility
    quickReplies: [], // New format for button messages
    callToActions: {}, // New format for button messages
    footer: '', // Footer for button messages
    next_rule_id: undefined,
    end_flow: false,
    only_for_individuals: true,
    auto_actions: {},
    fallback_message: '',
    expected_input_type: 'text',
    context_variables: {},
    delay_seconds: 0
    // enable_typing removed - now using global settings in /settings/whatsapp
  });

  const fetchRules = useCallback(async () => {
    if (!business?.id) return;

    try {
      setLoading(true);
      const res = await fetch(`/api/whatsapp/bot-rules?business_id=${business.id}`);
      const data = await res.json();
      
      if (res.ok) {
        setRules(data.rules || []);
      } else {
        setError(data.error || 'Failed to fetch rules');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch rules');
    } finally {
      setLoading(false);
    }
  }, [business?.id]);

  const fetchLabels = useCallback(async () => {
    if (!business?.id) return;

    try {
      const res = await fetch(`/api/whatsapp/labels?business_id=${business.id}`);
      const data = await res.json();
      if (res.ok) {
        setLabels(data.labels || []);
      }
    } catch (err) {
      console.error('Error fetching labels:', err);
    }
  }, [business?.id]);

  useEffect(() => {
    fetchRules();
    fetchLabels();
  }, [fetchRules, fetchLabels]);

  const categories = ['all', ...Array.from(new Set(rules.map(r => r.category).filter(Boolean)))];
  const filteredRules = rules.filter(rule => {
    const matchesSearch = !searchQuery || 
      rule.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.trigger_value?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || rule.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });


  const handleCreate = () => {
    setEditingRule(null);
    setFormData({
      name: '',
      category: '',
      trigger_type: 'keyword',
      trigger_value: '',
      trigger_conditions: {},
      is_active: true,
      priority: 0,
      response_type: 'text',
      response_message: '',
      response_media_url: '',
      response_options: [], // Old format - kept for backward compatibility
      quickReplies: [], // New format for button messages
      callToActions: {}, // New format for button messages
      footer: '', // Footer for button messages
      next_rule_id: undefined,
      end_flow: false,
      only_for_individuals: true,
      auto_actions: {},
      fallback_message: '',
      expected_input_type: 'text',
      context_variables: {},
      delay_seconds: 0
      // enable_typing removed - now using global settings in /settings/whatsapp
    });
    setShowForm(true);
    setError(null);
  };

  const handleEdit = (rule: BotRule) => {
    setEditingRule(rule);
    
    // Convert button format if needed
    let formDataToSet: Partial<BotRule> = {
      ...rule,
      trigger_conditions: rule.trigger_conditions || {},
      auto_actions: rule.auto_actions || {},
      context_variables: rule.context_variables || {},
    };
    
    // If it's a button type and has response_options but not the new format, convert it
    if (rule.response_type === 'button' && rule.response_options && !rule.quickReplies) {
      const converted = convertResponseOptionsToButtonFormat(rule.response_options as any);
      formDataToSet.quickReplies = converted.quickReplies;
      formDataToSet.callToActions = converted.callToActions;
      formDataToSet.footer = converted.footer;
    }
    
    setFormData(formDataToSet);
    setShowForm(true);
    setError(null);
  };

  const handleCancel = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setShowForm(false);
    setEditingRule(null);
    setFormData({});
    setError(null);
  };

  const handleSave = async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!business?.id) return;

    if (!formData.name || !formData.response_message) {
      setError('Name and response message are required');
      return;
    }

    // Validate trigger value (not needed for 'all' or 'first_message')
    if (formData.trigger_type !== 'all' && formData.trigger_type !== 'first_message' && 
        !formData.trigger_value?.trim()) {
      setError('Trigger value is required');
      return;
    }

    // Validate regex if trigger_type is regex
    if (formData.trigger_type === 'regex' && formData.trigger_value) {
      try {
        new RegExp(formData.trigger_value);
      } catch (e) {
        setError('Invalid regex pattern');
        return;
      }
    }

    try {
      setLoading(true);
      setError(null);

      const url = editingRule
        ? `/api/whatsapp/bot-rules/${editingRule.id}`
        : '/api/whatsapp/bot-rules';

      const method = editingRule ? 'PATCH' : 'POST';

      // Prepare data for saving - convert button format to response_options for DB
      const dataToSave: any = {
        business_id: business.id,
        ...formData
      };
      
      // If button type, convert new format to response_options
      if (formData.response_type === 'button') {
        const responseOptions = convertButtonFormatToResponseOptions(
          formData.quickReplies,
          formData.callToActions,
          formData.footer
        );
        dataToSave.response_options = responseOptions.length > 0 ? responseOptions : null;
        // Don't send quickReplies/callToActions/footer to backend (it uses response_options)
        delete dataToSave.quickReplies;
        delete dataToSave.callToActions;
        delete dataToSave.footer;
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataToSave)
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to save rule');
      }

      await fetchRules();
      handleCancel();
    } catch (err: any) {
      setError(err.message || 'Failed to save rule');
    } finally {
      setLoading(false);
    }
  };

  const executeDeleteRule = async (ruleId: string) => {
    if (!business?.id) return;

    try {
      setLoading(true);
      const res = await fetch(`/api/whatsapp/bot-rules/${ruleId}?business_id=${business.id}`, {
        method: 'DELETE'
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete rule');
      }

      await fetchRules();
    } catch (err: any) {
      setError(err.message || 'Failed to delete rule');
    } finally {
      setLoading(false);
    }
  };

  const requestDeleteRule = (ruleId: string) => {
    setConfirmDialog({
      title: 'Confirm',
      message: 'Are you sure you want to delete this rule? This cannot be undone.',
      onConfirm: () => {
        void executeDeleteRule(ruleId).finally(() => setConfirmDialog(null));
      },
    });
  };

  const handleDuplicate = (rule: BotRule) => {
    setEditingRule(null);
    setFormData({
      ...rule,
      name: `${rule.name} (Copy)`,
      id: undefined, // Remove ID so it creates a new rule
    });
    setShowForm(true);
  };

  const handleTestRule = (rule: BotRule) => {
    // TODO: Implement test functionality
    const preview =
      rule.response_message.length > 50
        ? `${rule.response_message.substring(0, 50)}...`
        : rule.response_message;
    setToast({
      message: `Test functionality coming soon. Rule: ${rule.name}. Trigger: ${rule.trigger_type} — ${rule.trigger_value}. Response: ${preview}`,
      type: 'info',
    });
  };

  // Helper functions for format conversion
  // Convert new format (quickReplies/callToActions/footer) to response_options for DB storage
  const convertButtonFormatToResponseOptions = (
    quickReplies?: string[],
    callToActions?: { phone?: { title: string; phone: string }; url?: { title: string; url: string } },
    footer?: string
  ): Array<{ id: string; title: string; type?: 'quick_reply' | 'call' | 'url'; phone?: string; url?: string }> => {
    const options: Array<{ id: string; title: string; type?: 'quick_reply' | 'call' | 'url'; phone?: string; url?: string }> = [];
    
    // Add quick replies
    if (quickReplies) {
      quickReplies.forEach((title, index) => {
        if (title.trim()) {
          options.push({
            id: `quick_reply_${index}`,
            title: title.trim(),
            type: 'quick_reply'
          });
        }
      });
    }
    
    // Add call to actions
    if (callToActions) {
      if (callToActions.phone?.title && callToActions.phone?.phone) {
        options.push({
          id: 'call_button',
          title: callToActions.phone.title,
          type: 'call',
          phone: callToActions.phone.phone
        });
      }
      
      if (callToActions.url?.title && callToActions.url?.url) {
        options.push({
          id: 'url_button',
          title: callToActions.url.title,
          type: 'url',
          url: callToActions.url.url
        });
      }
    }
    
    // Store footer in a special option
    if (footer?.trim()) {
      options.push({
        id: '__footer__',
        title: footer.trim(),
        type: 'quick_reply' // Just to satisfy type
      });
    }
    
    return options;
  };

  // Convert response_options back to new format (quickReplies/callToActions/footer)
  const convertResponseOptionsToButtonFormat = (
    responseOptions?: Array<{ id: string; title: string; type?: 'quick_reply' | 'call' | 'url'; phone?: string; url?: string }>
  ): { quickReplies: string[]; callToActions: { phone?: { title: string; phone: string }; url?: { title: string; url: string } }; footer: string } => {
    const quickReplies: string[] = [];
    const callToActions: { phone?: { title: string; phone: string }; url?: { title: string; url: string } } = {};
    let footer = '';
    
    if (responseOptions) {
      responseOptions.forEach(option => {
        if (option.id === '__footer__') {
          footer = option.title;
        } else if (option.type === 'quick_reply') {
          quickReplies.push(option.title);
        } else if (option.type === 'call' && option.phone) {
          callToActions.phone = { title: option.title, phone: option.phone };
        } else if (option.type === 'url' && option.url) {
          callToActions.url = { title: option.title, url: option.url };
        }
      });
    }
    
    return { quickReplies, callToActions, footer };
  };

  // Helper functions for form management
  // Old format handlers (kept for list messages)
  const addResponseOption = () => {
    setFormData(prev => {
      const newOptions = [...(prev.response_options || []), { 
        id: `opt_${Date.now()}`, 
        title: '', 
        description: '' 
      }];
      return { ...prev, response_options: newOptions };
    });
  };

  const removeResponseOption = (index: number) => {
    setFormData(prev => {
      const newOptions = prev.response_options?.filter((_, i) => i !== index) || [];
      return { ...prev, response_options: newOptions };
    });
  };

  const updateResponseOption = (index: number, field: string, value: string) => {
    setFormData(prev => {
      const newOptions = [...(prev.response_options || [])];
      newOptions[index] = { ...newOptions[index], [field]: value };
      return { ...prev, response_options: newOptions };
    });
  };

  // New format handlers for button messages (Quick Replies)
  const handleAddQuickReply = useCallback(() => {
    setFormData(prev => {
      const quickReplies = prev.quickReplies || [];
      if (quickReplies.length < 3) {
        return { ...prev, quickReplies: [...quickReplies, ''] };
      }
      return prev;
    });
  }, []);

  const handleQuickReplyChange = useCallback((index: number, value: string) => {
    setFormData(prev => {
      const quickReplies = [...(prev.quickReplies || [])];
      quickReplies[index] = value.substring(0, 20); // Max 20 chars
      return { ...prev, quickReplies };
    });
  }, []);

  const handleRemoveQuickReply = useCallback((index: number) => {
    setFormData(prev => {
      const quickReplies = (prev.quickReplies || []).filter((_, i) => i !== index);
      return { ...prev, quickReplies };
    });
  }, []);

  // New format handlers for button messages (Call to Actions)
  const handleAddCallToAction = useCallback((type: 'phone' | 'url') => {
    setFormData(prev => {
      const callToActions = prev.callToActions || {};
      if (type === 'phone') {
        return { ...prev, callToActions: { ...callToActions, phone: { title: '', phone: '' } } };
      } else {
        return { ...prev, callToActions: { ...callToActions, url: { title: '', url: '' } } };
      }
    });
  }, []);

  const handleCallToActionChange = useCallback((type: 'phone' | 'url', field: 'title' | 'phone' | 'url', value: string) => {
    setFormData(prev => {
      const callToActions = prev.callToActions || {};
      if (type === 'phone' && callToActions.phone) {
        return {
          ...prev,
          callToActions: {
            ...callToActions,
            phone: {
              ...callToActions.phone,
              [field]: field === 'title' ? value.substring(0, 20) : value
            }
          }
        };
      } else if (type === 'url' && callToActions.url) {
        return {
          ...prev,
          callToActions: {
            ...callToActions,
            url: {
              ...callToActions.url,
              [field]: field === 'title' ? value.substring(0, 20) : value
            }
          }
        };
      }
      return prev;
    });
  }, []);

  const handleRemoveCallToAction = useCallback((type: 'phone' | 'url') => {
    setFormData(prev => {
      const callToActions = { ...(prev.callToActions || {}) };
      delete callToActions[type];
      return { ...prev, callToActions };
    });
  }, []);

  const updateTriggerCondition = (field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      trigger_conditions: {
        ...(prev.trigger_conditions || {}),
        [field]: value
      }
    }));
  };

  const updateAutoAction = (field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      auto_actions: {
        ...(prev.auto_actions || {}),
        [field]: value
      }
    }));
  };

  const renderTriggerTypeSection = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Trigger Type *
        </label>
        <select
          value={formData.trigger_type || 'keyword'}
          onChange={(e) =>
            setFormData(prev => ({
              ...prev,
              trigger_type: e.target.value as any
            }))
          }
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <optgroup label="Text Matching">
            <option value="keyword">Keyword (contains)</option>
            <option value="exact_match">Exact Match</option>
            <option value="starts_with">Starts With</option>
            <option value="ends_with">Ends With</option>
            <option value="match_any_keyword">Match ANY Keyword (comma-separated)</option>
            <option value="match_all_keywords">Match ALL Keywords (comma-separated)</option>
            <option value="regex">Regex Pattern</option>
          </optgroup>
          <optgroup label="Special Triggers">
            <option value="all">All Messages</option>
            <option value="first_message">First Message from User</option>
            <option value="message_type">Message Type (image/document/etc)</option>
          </optgroup>
        </select>
      </div>

      {formData.trigger_type !== 'all' && formData.trigger_type !== 'first_message' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Trigger Value *
            {formData.trigger_type === 'match_any_keyword' || formData.trigger_type === 'match_all_keywords' ? (
              <span className="text-xs text-gray-500 ml-2">(comma-separated)</span>
            ) : formData.trigger_type === 'regex' ? (
              <span className="text-xs text-gray-500 ml-2">(regex pattern)</span>
            ) : null}
          </label>
          <Input
            value={formData.trigger_value || ''}
            onChange={(e) =>
              setFormData(prev => ({
                ...prev,
                trigger_value: e.target.value
              }))
            }
            placeholder={
              formData.trigger_type === 'match_any_keyword' || formData.trigger_type === 'match_all_keywords'
                ? 'hello, hi, hey'
                : formData.trigger_type === 'regex'
                ? '/pattern/'
                : formData.trigger_type === 'message_type'
                ? 'image, document, audio, video'
                : 'e.g., hello'
            }
          />
        </div>
      )}
    </div>
  );

  const renderResponseTypeSection = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Response Type
        </label>
        <select
          value={formData.response_type || 'text'}
          onChange={(e) =>
            setFormData(prev => ({
              ...prev,
              response_type: e.target.value as any
            }))
          }
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="text">Text Message</option>
          <option value="image">Image</option>
          <option value="video">Video</option>
          <option value="document">Document/PDF</option>
          <option value="audio">Audio</option>
          <option value="button">Quick Buttons</option>
          <option value="list">List Message</option>
          <option value="template">Template Message</option>
        </select>
      </div>

      {(formData.response_type === 'image' || formData.response_type === 'video' || 
        formData.response_type === 'document' || formData.response_type === 'audio') && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Media URL *
          </label>
          <Input
            value={formData.response_media_url || ''}
            onChange={(e) =>
              setFormData(prev => ({
                ...prev,
                response_media_url: e.target.value
              }))
            }
            placeholder="https://example.com/media.jpg"
          />
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Response Message *
          <span className="text-xs text-gray-500 ml-2">
            Use {`{{name}}`}, {`{{phone}}`}, {`{{variable}}`} for dynamic content
          </span>
        </label>
        <Textarea
          value={formData.response_message || ''}
          onChange={(e) =>
            setFormData(prev => ({
              ...prev,
              response_message: e.target.value
            }))
          }
          placeholder="Enter your response message... Use {{variables}} for dynamic content"
          className="min-h-[100px]"
        />
        <div className="mt-2 text-xs text-gray-500">
          Available variables: {`{{name}}`}, {`{{phone}}`}, {`{{email}}`}, {`{{last_order}}`}, {`{{balance}}`}
        </div>
      </div>

      {/* List Options (old format - kept for list messages) */}
      {formData.response_type === 'list' && (
        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-3">
            <label className="block text-sm font-medium text-gray-700">
              List Options
              <span className="text-xs text-gray-500 ml-2">(Unlimited)</span>
            </label>
            <Button type="button" onClick={addResponseOption} size="sm" variant="secondary">
              <Plus className="w-4 h-4 mr-1" />
              Add Option
            </Button>
          </div>
          <div className="space-y-3">
            {formData.response_options?.map((option, index) => (
              <div key={index} className="flex gap-2 items-start p-3 bg-gray-50 rounded-lg">
                <div className="flex-1 space-y-2">
                  <Input
                    placeholder="Option ID (e.g., opt1)"
                    value={option.id}
                    onChange={(e) => updateResponseOption(index, 'id', e.target.value)}
                  />
                  <Input
                    placeholder="Option Title"
                    value={option.title}
                    onChange={(e) => updateResponseOption(index, 'title', e.target.value)}
                  />
                  <Input
                    placeholder="Option Description (optional)"
                    value={option.description || ''}
                    onChange={(e) => updateResponseOption(index, 'description', e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeResponseOption(index)}
                  className="p-2 text-red-600 hover:text-red-800"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Button Options (new format - same as single message and bulk campaigns) */}
      {formData.response_type === 'button' && (
        <div className="border-t pt-4 space-y-4">
          <div>
            <h4 className="text-base font-semibold text-gray-900 mb-2">Interactive Actions</h4>
            <p className="text-sm text-gray-600 mb-4">
              In addition to your message, you can send actions with your message. Maximum 20 characters are allowed in CTA button title & Quick Replies.
              You can add up to 3 Quick Reply buttons and 2 Call to Action buttons (1 Phone + 1 URL) in the same message.
            </p>
          </div>

          {/* Quick Replies Section */}
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-700">
                Quick Replies (up to 3)
              </label>
              {(formData.quickReplies || []).length > 0 && (
                <span className="text-xs text-gray-500">
                  {(formData.quickReplies || []).filter(r => r.trim()).length}/3
                </span>
              )}
            </div>
            <div className="space-y-3">
              {(formData.quickReplies || []).map((reply, index) => (
                <div key={index} className="flex items-center gap-3">
                  <div className="flex-1">
                    <Input
                      type="text"
                      value={reply}
                      onChange={(e) => handleQuickReplyChange(index, e.target.value)}
                      placeholder={`Quick Reply ${index + 1}`}
                      className="text-sm"
                    />
                  </div>
                  <div className="text-xs text-gray-500 min-w-[3rem] text-right">
                    {reply.length}/20
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveQuickReply(index)}
                    className="text-gray-400 hover:text-red-600 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {(formData.quickReplies || []).length < 3 && (
                <button
                  type="button"
                  onClick={handleAddQuickReply}
                  className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  Add Quick Reply
                </button>
              )}
            </div>
          </div>

          {/* Call to Actions Section */}
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-4">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">
                Call to Actions (1 Phone + 1 URL)
              </label>
              {(formData.callToActions?.phone || formData.callToActions?.url) && (
                <span className="text-xs text-gray-500">
                  {(formData.callToActions?.phone ? 1 : 0) + (formData.callToActions?.url ? 1 : 0)}/2
                </span>
              )}
            </div>

            {/* Phone CTA */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700 flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  Phone Number
                </span>
                {formData.callToActions?.phone && (
                  <button
                    type="button"
                    onClick={() => handleRemoveCallToAction('phone')}
                    className="text-xs text-red-600 hover:text-red-700"
                  >
                    Remove
                  </button>
                )}
              </div>
              {formData.callToActions?.phone ? (
                <div className="space-y-2 pl-6">
                  <Input
                    type="text"
                    value={formData.callToActions.phone.title}
                    onChange={(e) => handleCallToActionChange('phone', 'title', e.target.value)}
                    placeholder="Button Title (e.g., Call Us)"
                    className="text-sm"
                  />
                  <div className="text-xs text-gray-500 text-right">
                    {formData.callToActions.phone.title.length}/20
                  </div>
                  <Input
                    type="tel"
                    value={formData.callToActions.phone.phone}
                    onChange={(e) => handleCallToActionChange('phone', 'phone', e.target.value)}
                    placeholder="Phone Number (e.g., 919876543210)"
                    className="text-sm"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => handleAddCallToAction('phone')}
                  className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1 pl-6"
                >
                  <Plus className="w-4 h-4" />
                  Add Phone Number
                </button>
              )}
            </div>

            {/* URL CTA */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700 flex items-center gap-2">
                  <LinkIcon className="w-4 h-4" />
                  URL
                </span>
                {formData.callToActions?.url && (
                  <button
                    type="button"
                    onClick={() => handleRemoveCallToAction('url')}
                    className="text-xs text-red-600 hover:text-red-700"
                  >
                    Remove
                  </button>
                )}
              </div>
              {formData.callToActions?.url ? (
                <div className="space-y-2 pl-6">
                  <Input
                    type="text"
                    value={formData.callToActions.url.title}
                    onChange={(e) => handleCallToActionChange('url', 'title', e.target.value)}
                    placeholder="Button Title (e.g., Visit Us)"
                    className="text-sm"
                  />
                  <div className="text-xs text-gray-500 text-right">
                    {formData.callToActions.url.title.length}/20
                  </div>
                  <Input
                    type="url"
                    value={formData.callToActions.url.url}
                    onChange={(e) => handleCallToActionChange('url', 'url', e.target.value)}
                    placeholder="URL (e.g., https://example.com)"
                    className="text-sm"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => handleAddCallToAction('url')}
                  className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1 pl-6"
                >
                  <Plus className="w-4 h-4" />
                  Add URL
                </button>
              )}
            </div>
          </div>

          {/* Footer (Optional) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Footer (optional)
            </label>
            <Input
              type="text"
              value={formData.footer || ''}
              onChange={(e) =>
                setFormData(prev => ({
                  ...prev,
                  footer: e.target.value
                }))
              }
              placeholder="Optional footer text"
              className="text-sm"
            />
          </div>
        </div>
      )}
    </div>
  );

  const renderChainingSection = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={formData.end_flow || false}
          onChange={(e) =>
            setFormData(prev => ({
              ...prev,
              end_flow: e.target.checked,
              next_rule_id: undefined
            }))
          }
          className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
        />
        <label className="text-sm font-medium text-gray-700">End conversation flow after this rule</label>
      </div>

      {!formData.end_flow && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Next Step (Chain to another rule)
            </label>
            <select
              value={formData.next_rule_id || ''}
              onChange={(e) =>
                setFormData(prev => ({
                  ...prev,
                  next_rule_id: e.target.value || undefined
                }))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">-- No next step --</option>
              {rules
                .filter(r => r.id !== editingRule?.id)
                .map(rule => (
                  <option key={rule.id} value={rule.id}>
                    {rule.name} (Priority: {rule.priority})
                  </option>
                ))}
            </select>
          </div>

          {formData.response_type === 'list' && formData.response_options && formData.response_options.length > 0 && (
            <div className="bg-slate-50 border border-primary-200 rounded-lg p-3">
              <p className="text-sm text-primary-800 mb-2">
                <Info className="w-4 h-4 inline mr-1" />
                Configure chain mappings for each option in the "Actions" section below
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Expected Input Type
            </label>
            <select
              value={formData.expected_input_type || 'text'}
              onChange={(e) =>
                setFormData(prev => ({
                  ...prev,
                  expected_input_type: e.target.value as any
                }))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="yes_no">Yes/No</option>
              <option value="email">Email</option>
              <option value="phone">Phone Number</option>
              <option value="menu_option">Menu Option (from buttons/list)</option>
            </select>
          </div>

          {formData.expected_input_type !== 'text' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fallback Message (if invalid input)
              </label>
              <Textarea
                value={formData.fallback_message || ''}
                onChange={(e) =>
                  setFormData(prev => ({
                    ...prev,
                    fallback_message: e.target.value
                  }))
                }
                placeholder="e.g., Please enter a valid email address"
                className="min-h-[60px]"
              />
            </div>
          )}
        </>
      )}
    </div>
  );

  const renderConditionsSection = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Required Labels (rule only triggers if conversation has ALL these labels)
        </label>
        <div className="flex flex-wrap gap-2">
          {labels.map(label => {
            const isSelected = formData.trigger_conditions?.required_label_ids?.includes(label.id);
            return (
              <button
                key={label.id}
                type="button"
                onClick={() => {
                  const current = formData.trigger_conditions?.required_label_ids || [];
                  const updated = isSelected
                    ? current.filter(id => id !== label.id)
                    : [...current, label.id];
                  updateTriggerCondition('required_label_ids', updated);
                }}
                className={`px-3 py-1 rounded-full text-sm border-2 ${
                  isSelected
                    ? 'bg-slate-50 border-primary-500 text-primary-700'
                    : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
                }`}
                style={isSelected ? { borderColor: label.color } : {}}
              >
                {label.name}
              </button>
            );
          })}
          {labels.length === 0 && (
            <p className="text-sm text-gray-500">No labels available. Create labels in Conversations tab.</p>
          )}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Excluded Labels (rule won't trigger if conversation has ANY of these labels)
        </label>
        <div className="flex flex-wrap gap-2">
          {labels.map(label => {
            const isSelected = formData.trigger_conditions?.excluded_label_ids?.includes(label.id);
            return (
              <button
                key={label.id}
                type="button"
                onClick={() => {
                  const current = formData.trigger_conditions?.excluded_label_ids || [];
                  const updated = isSelected
                    ? current.filter(id => id !== label.id)
                    : [...current, label.id];
                  updateTriggerCondition('excluded_label_ids', updated);
                }}
                className={`px-3 py-1 rounded-full text-sm border-2 ${
                  isSelected
                    ? 'bg-red-50 border-red-500 text-red-700'
                    : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
                }`}
                style={isSelected ? { borderColor: label.color } : {}}
              >
                {label.name}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Minimum Inactivity (minutes)
          <span className="text-xs text-gray-500 ml-2">Only trigger if user hasn't messaged in X minutes</span>
        </label>
        <Input
          type="number"
          value={formData.trigger_conditions?.min_inactivity_minutes || ''}
          onChange={(e) => updateTriggerCondition('min_inactivity_minutes', parseInt(e.target.value) || undefined)}
          placeholder="e.g., 60"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Sender Types
        </label>
        <div className="flex gap-4">
          {['individual', 'group'].map(type => {
            const isSelected = formData.trigger_conditions?.sender_types?.includes(type as any);
            return (
              <label key={type} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={(e) => {
                    const current = formData.trigger_conditions?.sender_types || [];
                    const updated = e.target.checked
                      ? [...current, type]
                      : current.filter(t => t !== type);
                    updateTriggerCondition('sender_types', updated);
                  }}
                  className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                />
                <span className="text-sm text-gray-700 capitalize">{type}</span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );

  const renderActionsSection = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Add Labels (automatically add these labels to the conversation)
        </label>
        <div className="flex flex-wrap gap-2">
          {labels.map(label => {
            const isSelected = formData.auto_actions?.add_labels?.includes(label.id);
            return (
              <button
                key={label.id}
                type="button"
                onClick={() => {
                  const current = formData.auto_actions?.add_labels || [];
                  const updated = isSelected
                    ? current.filter(id => id !== label.id)
                    : [...current, label.id];
                  updateAutoAction('add_labels', updated);
                }}
                className={`px-3 py-1 rounded-full text-sm border-2 ${
                  isSelected
                    ? 'bg-green-50 border-green-500 text-green-700'
                    : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
                }`}
                style={isSelected ? { borderColor: label.color } : {}}
              >
                {label.name}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Remove Labels (automatically remove these labels from the conversation)
        </label>
        <div className="flex flex-wrap gap-2">
          {labels.map(label => {
            const isSelected = formData.auto_actions?.remove_labels?.includes(label.id);
            return (
              <button
                key={label.id}
                type="button"
                onClick={() => {
                  const current = formData.auto_actions?.remove_labels || [];
                  const updated = isSelected
                    ? current.filter(id => id !== label.id)
                    : [...current, label.id];
                  updateAutoAction('remove_labels', updated);
                }}
                className={`px-3 py-1 rounded-full text-sm border-2 ${
                  isSelected
                    ? 'bg-orange-50 border-orange-500 text-orange-700'
                    : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
                }`}
                style={isSelected ? { borderColor: label.color } : {}}
              >
                {label.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={formData.auto_actions?.create_lead || false}
          onChange={(e) => updateAutoAction('create_lead', e.target.checked)}
          className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
        />
        <label className="text-sm font-medium text-gray-700">
          Create Lead in CRM (if customer doesn't exist)
        </label>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Send Follow-up After (minutes)
          <span className="text-xs text-gray-500 ml-2">Automatically send a follow-up message after X minutes</span>
        </label>
        <Input
          type="number"
          value={formData.auto_actions?.send_followup_after_minutes || ''}
          onChange={(e) => updateAutoAction('send_followup_after_minutes', parseInt(e.target.value) || undefined)}
          placeholder="e.g., 30"
        />
      </div>
    </div>
  );

  const renderAdvancedSection = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Category
        </label>
        <Input
          value={formData.category || ''}
          onChange={(e) =>
            setFormData(prev => ({
              ...prev,
              category: e.target.value
            }))
          }
          placeholder="e.g., Welcome, FAQ, Pricing, CRM"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Extract Context Variables
          <span className="text-xs text-gray-500 ml-2">Variables to extract from user messages</span>
        </label>
        <Input
          value={formData.context_variables?.extract?.join(', ') || ''}
          onChange={(e) => {
            const extract = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
            setFormData(prev => ({
              ...prev,
              context_variables: {
                ...(prev.context_variables || {}),
                extract
              }
            }));
          }}
          placeholder="name, phone, email, budget (comma-separated)"
        />
      </div>
    </div>
  );


  if (showForm) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {editingRule ? 'Edit Bot Rule' : 'Create New Bot Rule'}
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Configure automated responses with advanced triggers and actions
            </p>
          </div>
          <Button variant="secondary" type="button" onClick={handleCancel}>
            <X className="w-4 h-4 mr-2" />
            Cancel
          </Button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
            <button 
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setError(null);
              }} 
              className="ml-auto"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <Card padding="lg" className="space-y-6">
          {/* Basic Info */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Rule Name *
              </label>
              <Input
                value={formData.name || ''}
                onChange={(e) =>
                  setFormData(prev => ({
                    ...prev,
                    name: e.target.value
                  }))
                }
                placeholder="e.g., Welcome Message"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Priority
              </label>
              <Input
                type="number"
                value={formData.priority || 0}
                onChange={(e) =>
                  setFormData(prev => ({
                    ...prev,
                    priority: parseInt(e.target.value) || 0
                  }))
                }
                placeholder="0"
              />
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.is_active ?? true}
                  onChange={(e) =>
                    setFormData(prev => ({
                      ...prev,
                      is_active: e.target.checked
                    }))
                  }
                  className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                />
                <span className="text-sm font-medium text-gray-700">Active</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.only_for_individuals ?? true}
                  onChange={(e) =>
                    setFormData(prev => ({
                      ...prev,
                      only_for_individuals: e.target.checked
                    }))
                  }
                  className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                />
                <span className="text-sm font-medium text-gray-700">Individual Only</span>
              </label>
            </div>
          </div>

          {/* Trigger Configuration - Always visible */}
          <div className="border border-gray-200 rounded-lg">
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <h3 className="font-medium text-gray-900">Trigger Configuration</h3>
            </div>
            <div className="p-4">
              {renderTriggerTypeSection()}
            </div>
          </div>

          {/* Response Configuration - Always visible */}
          <div className="border border-gray-200 rounded-lg">
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <h3 className="font-medium text-gray-900">Response Configuration</h3>
            </div>
            <div className="p-4">
              {renderResponseTypeSection()}
            </div>
          </div>

          {/* Message Chaining & Flow Control - Always visible */}
          <div className="border border-gray-200 rounded-lg">
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <h3 className="font-medium text-gray-900">Message Chaining & Flow Control</h3>
            </div>
            <div className="p-4">
              {renderChainingSection()}
            </div>
          </div>

          {/* Advanced Conditions & Filters - Always visible */}
          <div className="border border-gray-200 rounded-lg">
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <h3 className="font-medium text-gray-900">Advanced Conditions & Filters</h3>
            </div>
            <div className="p-4">
              {renderConditionsSection()}
            </div>
          </div>

          {/* Auto Actions - Always visible */}
          <div className="border border-gray-200 rounded-lg">
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <h3 className="font-medium text-gray-900">Auto Actions</h3>
            </div>
            <div className="p-4">
              {renderActionsSection()}
            </div>
          </div>

          {/* Advanced Settings - Always visible */}
          <div className="border border-gray-200 rounded-lg">
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <h3 className="font-medium text-gray-900">Advanced Settings</h3>
            </div>
            <div className="p-4">
              {renderAdvancedSection()}
            </div>
          </div>

          {/* Save Buttons */}
          <div className="flex gap-3 justify-end border-t pt-4">
            <Button variant="secondary" type="button" onClick={handleCancel} disabled={loading}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={loading} className="flex items-center gap-2">
              {loading ? (
                <>Saving...</>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  {editingRule ? 'Update Rule' : 'Create Rule'}
                </>
              )}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Bot Auto-Reply Rules</h2>
          <p className="text-sm text-gray-600 mt-1">
            Configure professional-grade automated responses and conversation flows
          </p>
        </div>
        <Button onClick={handleCreate} className="flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Create Rule
        </Button>
      </div>

      {/* Filters */}
      <Card padding="md">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <Input
              placeholder="Search rules..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="all">All Categories</option>
            {categories.filter(c => c !== 'all').map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
      </Card>

      {/* Rules List */}
      {loading && !rules.length ? (
        <Card padding="lg" className="text-center py-12">
          <p className="text-gray-500">Loading rules...</p>
        </Card>
      ) : filteredRules.length === 0 ? (
        <Card padding="lg" className="text-center py-12">
          <p className="text-gray-500 mb-4">No bot rules configured yet</p>
          <Button onClick={handleCreate}>
            <Plus className="w-4 h-4 mr-2" />
            Create Your First Rule
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredRules.map((rule) => (
            <Card key={rule.id} padding="lg">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold text-gray-900">{rule.name}</h3>
                    {rule.category && (
                      <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded">
                        {rule.category}
                      </span>
                    )}
                    {rule.is_active ? (
                      <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded">
                        Active
                      </span>
                    ) : (
                      <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-800 rounded">
                        Inactive
                      </span>
                    )}
                    <span className="px-2 py-1 text-xs font-medium bg-slate-100 text-primary-800 rounded">
                      Priority: {rule.priority}
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600 mb-3">
                    <div>
                      <span className="font-medium">Trigger: </span>
                      <span className="capitalize">{rule.trigger_type.replace(/_/g, ' ')}</span>
                      {rule.trigger_type !== 'all' && rule.trigger_type !== 'first_message' && (
                        <span className="ml-2 px-2 py-1 bg-gray-100 rounded text-xs">
                          {rule.trigger_value}
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="font-medium">Response: </span>
                      <span className="capitalize">{rule.response_type}</span>
                      {rule.only_for_individuals && (
                        <span className="ml-2 text-xs text-gray-500">(Individual chats only)</span>
                      )}
                      {rule.next_rule_id && (
                        <span className="ml-2 text-xs text-primary-600">→ Chained</span>
                      )}
                      {rule.end_flow && (
                        <span className="ml-2 text-xs text-orange-600">→ Ends Flow</span>
                      )}
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-3 mb-3">
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{rule.response_message}</p>
                  </div>

                  {rule.response_options && rule.response_options.length > 0 && (
                    <div className="mb-3">
                      <p className="text-sm font-medium text-gray-700 mb-1">Options:</p>
                      <div className="flex flex-wrap gap-2">
                        {rule.response_options.map((opt, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-1 bg-slate-50 text-primary-700 rounded text-xs"
                          >
                            {opt.title || opt.id}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {(rule.auto_actions?.add_labels?.length || rule.auto_actions?.remove_labels?.length || 
                    rule.auto_actions?.create_lead) && (
                    <div className="text-xs text-gray-500 mt-2">
                      Actions: 
                      {rule.auto_actions?.add_labels?.length && ` Add ${rule.auto_actions.add_labels.length} label(s)`}
                      {rule.auto_actions?.remove_labels?.length && ` Remove ${rule.auto_actions.remove_labels.length} label(s)`}
                      {rule.auto_actions?.create_lead && ' Create Lead'}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 ml-4">
                  <button
                    type="button"
                    onClick={() => handleTestRule(rule)}
                    className="p-2 text-primary-600 rounded hover:bg-slate-50"
                    title="Test Rule"
                  >
                    <Play className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDuplicate(rule)}
                    className="p-2 text-gray-600 rounded hover:bg-gray-100"
                    title="Duplicate"
                  >
                    <Copy className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEdit(rule)}
                    className="p-2 text-primary-600 rounded hover:bg-slate-50"
                    title="Edit"
                  >
                    <Edit2 className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => requestDeleteRule(rule.id)}
                    className="p-2 text-red-600 rounded hover:bg-red-50"
                    title="Delete"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
      <ConfirmDialog
        isOpen={!!confirmDialog}
        title={confirmDialog?.title || ''}
        message={confirmDialog?.message || ''}
        variant="danger"
        confirmLabel="Confirm"
        onConfirm={() => {
          confirmDialog?.onConfirm();
        }}
        onCancel={() => setConfirmDialog(null)}
      />
    </div>
  );
}

// Export as default for now, can be renamed later
export function BotRulesTab() {
  return <BotRulesTabEnhanced />;
}


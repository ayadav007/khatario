'use client';

import React, { useState, useEffect } from 'react';
import { Save, Eye, EyeOff, Loader2, ExternalLink, Info } from 'lucide-react';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

interface AIConfigTabProps {
  businessId: string;
}

export default function AIConfigTab({ businessId }: AIConfigTabProps) {
  const [provider, setProvider] = useState('groq');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [chatbotEnabled, setChatbotEnabled] = useState(true);
  const [leadAnalyzerEnabled, setLeadAnalyzerEnabled] = useState(true);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(500);
  const [mode, setMode] = useState<'dev' | 'prod'>('prod');
  const [devAllowedPhones, setDevAllowedPhones] = useState<string[]>(['', '', '']);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Model suggestions per provider
  const modelSuggestions: Record<string, string[]> = {
    openai: ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo', 'gpt-4o'],
    gemini: ['gemini-pro', 'gemini-pro-vision', 'gemini-1.5-pro'],
    groq: ['llama-3.1-8b-instant', 'llama-3.1-70b-versatile', 'mixtral-8x7b-32768'],
    anthropic: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'],
    custom: [],
  };

  // Load existing config
  useEffect(() => {
    loadConfig();
  }, [businessId]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/settings/ai-config?business_id=${businessId}`
      );
      const data = await response.json();

      if (data.config) {
        setProvider(data.config.provider || 'groq');
        setApiKey(data.config.api_key || '');
        setApiBaseUrl(data.config.api_base_url || '');
        setModel(data.config.model || '');
        setChatbotEnabled(data.config.chatbot_enabled !== false);
        setLeadAnalyzerEnabled(data.config.lead_analyzer_enabled !== false);
        setTemperature(parseFloat(data.config.temperature) || 0.7);
        setMaxTokens(parseInt(data.config.max_tokens) || 500);
        setMode(data.config.mode === 'dev' ? 'dev' : 'prod');
        const phones = Array.isArray(data.config.dev_allowed_phones) 
          ? data.config.dev_allowed_phones 
          : [];
        setDevAllowedPhones([...phones, '', '', ''].slice(0, 3));
      }
    } catch (err: any) {
      console.error('Error loading AI config:', err);
      setError('Failed to load configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!apiKey.trim()) {
      setError('API key is required');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/settings/ai-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          provider,
          apiKey: apiKey.trim(),
          apiBaseUrl: apiBaseUrl.trim() || null,
          model: model.trim() || null,
          chatbotEnabled,
          leadAnalyzerEnabled,
          temperature,
          maxTokens,
          mode,
          devAllowedPhones: devAllowedPhones.filter(p => p.trim() !== ''),
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess('Configuration saved successfully!');
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError(data.error || 'Failed to save configuration');
      }
    } catch (err: any) {
      console.error('Error saving AI config:', err);
      setError('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className={SETTINGS_CONTENT_WIDTH}>
      <div className="rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6 dark:bg-slate-900/80">
        <div>
          <h2 className="text-2xl font-bold mb-2">AI Sales Agent Configuration</h2>
          <p className="text-text-secondary">
            Configure your AI provider to enable intelligent chatbot and lead analysis for WhatsApp conversations.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-md">
            {success}
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-8 xl:grid-cols-2 xl:items-start">
          <div className="min-w-0 space-y-6">
        {/* Provider Selection */}
        <div>
          <label className="block text-sm font-medium mb-2">
            AI Provider *
          </label>
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              setModel(''); // Reset model when provider changes
            }}
            className="w-full px-3 py-2 border rounded-md"
          >
            <option value="groq">Groq (Fast, affordable)</option>
            <option value="openai">OpenAI (GPT-4)</option>
            <option value="gemini">Google Gemini</option>
            <option value="anthropic">Anthropic Claude</option>
            <option value="custom">Custom API</option>
          </select>
          <div className="mt-2 space-y-1">
            <a
              href={
                provider === 'openai' ? 'https://platform.openai.com/api-keys' :
                provider === 'gemini' ? 'https://makersuite.google.com/app/apikey' :
                provider === 'groq' ? 'https://console.groq.com/keys' :
                provider === 'anthropic' ? 'https://console.anthropic.com/' :
                '#'
              }
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary-600 hover:underline inline-flex items-center gap-1"
            >
              Get API Key <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* API Key */}
        <div>
          <label className="block text-sm font-medium mb-2">
            API Key *
          </label>
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your API key"
              className="w-full px-3 py-2 pr-10 border rounded-md"
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
            >
              {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-text-muted mt-1">
            Your API key is stored securely and only used for your business.
          </p>
        </div>

        {/* Model Selection */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Model {provider !== 'custom' && '(Optional)'}
          </label>
          {modelSuggestions[provider]?.length > 0 ? (
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
            >
              <option value="">Default model</option>
              {modelSuggestions[provider].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Enter model name"
              className="w-full px-3 py-2 border rounded-md"
            />
          )}
        </div>

        {/* Custom Base URL */}
        {provider === 'custom' && (
          <div>
            <label className="block text-sm font-medium mb-2">
              API Base URL *
            </label>
            <input
              type="text"
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              placeholder="https://api.your-service.com/v1/chat/completions"
              className="w-full px-3 py-2 border rounded-md"
            />
            <p className="text-xs text-text-muted mt-1">
              Must be OpenAI-compatible endpoint
            </p>
          </div>
        )}
          </div>

          <div className="min-w-0 space-y-6">
        {/* Feature Toggles */}
        <div className="border-t border-border pt-4 xl:border-0 xl:pt-0">
          <h3 className="text-lg font-semibold mb-3">Features</h3>
          <div className="space-y-3">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={chatbotEnabled}
                onChange={(e) => setChatbotEnabled(e.target.checked)}
                className="w-4 h-4 text-primary-600"
              />
              <div>
                <div className="font-medium">AI Sales Agent Chatbot</div>
                <div className="text-sm text-text-secondary">
                  Automatically respond to customer inquiries on WhatsApp
                </div>
              </div>
            </label>

            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={leadAnalyzerEnabled}
                onChange={(e) => setLeadAnalyzerEnabled(e.target.checked)}
                className="w-4 h-4 text-primary-600"
              />
              <div>
                <div className="font-medium">AI Lead Analyzer</div>
                <div className="text-sm text-text-secondary">
                  Automatically analyze and score leads from conversations
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* Deployment Mode */}
        <div className="border-t pt-4">
          <h3 className="text-lg font-semibold mb-3">Deployment Mode</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Mode *
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="mode"
                    value="dev"
                    checked={mode === 'dev'}
                    onChange={(e) => setMode(e.target.value as 'dev' | 'prod')}
                    className="w-4 h-4 text-primary-600"
                  />
                  <div>
                    <div className="font-medium">Development</div>
                    <div className="text-xs text-text-secondary">
                      Only respond to allowed phone numbers (for testing). Other numbers are stored in CRM but not auto-replied.
                    </div>
                  </div>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="mode"
                    value="prod"
                    checked={mode === 'prod'}
                    onChange={(e) => setMode(e.target.value as 'dev' | 'prod')}
                    className="w-4 h-4 text-primary-600"
                  />
                  <div>
                    <div className="font-medium">Production</div>
                    <div className="text-xs text-text-secondary">
                      Respond to all incoming messages
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {mode === 'dev' && (
              <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-md">
                <div className="mb-3">
                  <label className="block text-sm font-medium mb-2">
                    Allowed Phone Numbers (2-3 numbers)
                  </label>
                  <p className="text-xs text-text-secondary mb-3">
                    Enter phone numbers with country code (e.g., 919876543210). Only these numbers will receive AI responses in Dev mode.
                  </p>
                  <div className="space-y-2">
                    {devAllowedPhones.map((phone, index) => (
                      <input
                        key={index}
                        type="text"
                        value={phone}
                        onChange={(e) => {
                          const newPhones = [...devAllowedPhones];
                          newPhones[index] = e.target.value;
                          setDevAllowedPhones(newPhones);
                        }}
                        placeholder={`Phone ${index + 1} (e.g., 919876543210)`}
                        className="w-full px-3 py-2 border rounded-md text-sm"
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Advanced Settings */}
        <div className="border-t border-border pt-4">
          <h3 className="text-lg font-semibold mb-3">Advanced Settings</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Temperature: {temperature.toFixed(1)}
              </label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full"
              />
              <p className="text-xs text-text-muted mt-1">
                Lower = more focused, Higher = more creative
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Max Tokens
              </label>
              <input
                type="number"
                min="100"
                max="2000"
                step="100"
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value))}
                className="w-full px-3 py-2 border rounded-md"
              />
              <p className="text-xs text-text-muted mt-1">
                Maximum response length (higher = more expensive)
              </p>
            </div>
          </div>
        </div>

        {/* Info Box */}
        <div className="bg-slate-50 border border-primary-200 p-4 rounded-md dark:bg-slate-800/40 dark:border-primary-800">
          <div className="flex gap-2">
            <Info className="w-5 h-5 text-primary-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-primary-800 dark:text-primary-200">
              <strong>Note:</strong> The AI chatbot will access your product catalog
              and pricing to answer customer questions. It acts as a professional sales
              agent and can help qualify leads automatically.
            </div>
          </div>
        </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="mt-6 flex justify-end border-t border-border pt-6">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Configuration
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

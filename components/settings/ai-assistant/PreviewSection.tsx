'use client';

/**
 * Preview Section
 * 
 * Predefined sample customer questions
 * Deterministic simulated responses
 * Clear "Preview only" disclaimer
 */

import React, { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { WhatsAppBotUIConfig } from '@/types/whatsapp-bot-config';
import {
  SampleQuestions,
  generatePreviewResponse,
  SafeModeInfo,
} from '@/types/preview-mode-presets';
import { AlertCircle, Send, Loader2 } from 'lucide-react';

interface PreviewMessage {
  id: string;
  type: 'customer' | 'ai';
  content: string;
  timestamp: Date;
}

interface PreviewSectionProps {
  config: WhatsAppBotUIConfig;
}

export function PreviewSection({ config }: PreviewSectionProps) {
  const [messages, setMessages] = useState<PreviewMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [customQuestion, setCustomQuestion] = useState('');

  const handleSampleQuestionClick = (question: string) => {
    // Add customer message
    const customerMsg: PreviewMessage = {
      id: Date.now().toString(),
      type: 'customer',
      content: question,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, customerMsg]);

    // Generate AI response
    setIsGenerating(true);
    setTimeout(() => {
      const aiResponse = generatePreviewResponse(question, config);
      const aiMsg: PreviewMessage = {
        id: (Date.now() + 1).toString(),
        type: 'ai',
        content: aiResponse,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, aiMsg]);
      setIsGenerating(false);
    }, 500); // Simulate delay
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customQuestion.trim()) return;

    handleSampleQuestionClick(customQuestion);
    setCustomQuestion('');
  };

  const handleClear = () => {
    setMessages([]);
  };

  return (
    <Card padding="lg">
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-text-primary mb-2">Preview</h2>
          <p className="text-sm text-text-secondary">
            Test how your assistant responds to customer messages.
          </p>
        </div>

        {/* Safe Mode Info */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="font-semibold text-yellow-900 mb-2">Preview Mode - Simplified Responses</h3>
              <p className="text-sm text-yellow-800 mb-3">
                These are <strong>simplified mock responses</strong> for preview only. They demonstrate how your settings affect tone and response style, but are not contextually aware like the real AI.
              </p>
              <ul className="text-sm text-yellow-700 space-y-1 mb-3">
                <li className="flex items-start gap-2">
                  <span className="text-yellow-600 mt-1">•</span>
                  <span><strong>Real AI responses</strong> understand context, conversation history, and customer intent</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-yellow-600 mt-1">•</span>
                  <span>Preview responses use simple keyword matching and templates</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-yellow-600 mt-1">•</span>
                  <span>No API costs - preview is completely free</span>
                </li>
              </ul>
              <div className="bg-yellow-100 border border-yellow-300 rounded p-2 mt-3">
                <p className="text-sm text-yellow-900">
                  <strong>Note:</strong> Actual customer conversations will use the real AI, which understands context, distinguishes between "order status" and "place order", handles complaints appropriately, and maintains conversation flow.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Sample Questions */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-text-primary">
            Sample Questions
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {SampleQuestions.map((question) => (
              <button
                key={question.id}
                onClick={() => handleSampleQuestionClick(question.text)}
                disabled={isGenerating}
                className="px-4 py-2 text-sm text-left border border-border rounded-lg hover:border-primary-300 hover:bg-slate-50 dark:hover:bg-primary-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {question.text}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Question Input */}
        <form onSubmit={handleCustomSubmit} className="space-y-2">
          <label className="block text-sm font-medium text-text-primary">
            Or type your own question
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={customQuestion}
              onChange={(e) => setCustomQuestion(e.target.value)}
              placeholder="Type a question..."
              className="flex-1 px-4 py-2 border border-border rounded-lg bg-surface text-text-primary focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              disabled={isGenerating}
            />
            <Button type="submit" disabled={!customQuestion.trim() || isGenerating}>
              <Send className="w-4 h-4" />
              Send
            </Button>
          </div>
        </form>

        {/* Preview Conversation */}
        {(messages.length > 0 || isGenerating) && (
          <div className="space-y-4 border-t pt-4">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-text-primary">
                Conversation Preview
              </label>
              <Button variant="secondary" size="sm" onClick={handleClear}>
                Clear
              </Button>
            </div>
            <div className="space-y-4 max-h-96 overflow-y-auto p-4 bg-gray-50 dark:bg-slate-800/50 rounded-lg">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.type === 'customer' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-4 py-2 ${
                      message.type === 'customer'
                        ? 'bg-primary-500 text-white'
                        : 'bg-surface border border-border text-text-primary'
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    <p className={`text-xs mt-1 ${message.type === 'customer' ? 'text-primary-100' : 'text-text-muted'}`}>
                      {message.timestamp.toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))}
              {isGenerating && (
                <div className="flex justify-start">
                  <div className="bg-surface border border-border rounded-lg px-4 py-2">
                    <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

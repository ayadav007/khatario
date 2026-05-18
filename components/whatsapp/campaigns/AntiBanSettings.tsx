'use client';

import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Shield, Clock, AlertTriangle } from 'lucide-react';

export interface AntiBanSettings {
  delayBetweenMessages: number; // seconds
  randomDelayJitter: number; // ±seconds
  batchSize: number; // messages per batch
  pauseBetweenBatches: number; // seconds
  dailySendLimit?: number; // optional limit
}

interface AntiBanSettingsProps {
  settings: AntiBanSettings;
  onChange: (settings: AntiBanSettings) => void;
  recipientCount: number;
}

export function AntiBanSettings({ settings, onChange, recipientCount }: AntiBanSettingsProps) {
  const handleChange = (field: keyof AntiBanSettings, value: number | undefined) => {
    onChange({ ...settings, [field]: value });
  };

  // Calculate estimated sending time
  const calculateEstimatedTime = () => {
    if (recipientCount === 0) return { hours: 0, minutes: 0 };
    
    const avgDelay = settings.delayBetweenMessages + settings.randomDelayJitter;
    const batches = Math.ceil(recipientCount / settings.batchSize);
    const timePerBatch = (settings.batchSize * avgDelay) + settings.pauseBetweenBatches;
    const totalSeconds = batches * timePerBatch;
    
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.ceil((totalSeconds % 3600) / 60);
    
    return { hours, minutes };
  };

  const estimatedTime = calculateEstimatedTime();

  return (
    <Card padding="lg" className="space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-5 h-5 text-primary-600" />
          <h3 className="text-lg font-semibold text-gray-900">Anti-Ban & Sending Controls</h3>
        </div>
        
        {/* Warning Banner */}
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-yellow-800">
              <p className="font-medium mb-1">⚠️ WhatsApp Ban Warning</p>
              <p className="text-xs">
                Sending too many messages too quickly can result in account bans. Use these controls to manage 
                sending speed and reduce ban risk. Start with conservative settings and adjust based on your account's 
                reputation and WhatsApp's behavior patterns.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {/* Delay Between Messages */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Delay Between Messages (seconds)
            </label>
            <Input
              type="number"
              min="1"
              value={settings.delayBetweenMessages}
              onChange={(e) => handleChange('delayBetweenMessages', parseInt(e.target.value) || 1)}
            />
            <p className="text-xs text-gray-500 mt-1">
              Minimum delay between each message. Recommended: 2-5 seconds.
            </p>
          </div>

          {/* Random Delay Jitter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Random Delay Variation (±seconds)
            </label>
            <Input
              type="number"
              min="0"
              value={settings.randomDelayJitter}
              onChange={(e) => handleChange('randomDelayJitter', parseInt(e.target.value) || 0)}
            />
            <p className="text-xs text-gray-500 mt-1">
              Random variation to make sending patterns less predictable. Recommended: 1-3 seconds.
            </p>
          </div>

          {/* Batch Size */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Batch Size (messages per batch)
            </label>
            <Input
              type="number"
              min="1"
              value={settings.batchSize}
              onChange={(e) => handleChange('batchSize', parseInt(e.target.value) || 1)}
            />
            <p className="text-xs text-gray-500 mt-1">
              Number of messages to send before pausing. Recommended: 15-30 messages.
            </p>
          </div>

          {/* Pause Between Batches */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Pause Between Batches (seconds)
            </label>
            <Input
              type="number"
              min="0"
              value={settings.pauseBetweenBatches}
              onChange={(e) => handleChange('pauseBetweenBatches', parseInt(e.target.value) || 0)}
            />
            <p className="text-xs text-gray-500 mt-1">
              Pause duration after each batch. Recommended: 60-180 seconds (1-3 minutes).
            </p>
          </div>

          {/* Daily Send Limit */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Daily Send Limit (optional)
            </label>
            <Input
              type="number"
              min="1"
              value={settings.dailySendLimit || ''}
              onChange={(e) => handleChange('dailySendLimit', e.target.value ? parseInt(e.target.value) : undefined)}
              placeholder="Leave empty for no limit"
            />
            <p className="text-xs text-gray-500 mt-1">
              Maximum messages to send per day. Leave empty for no limit.
            </p>
          </div>
        </div>

        {/* Estimated Time */}
        {recipientCount > 0 && (
          <div className="mt-6 p-4 bg-slate-50 border border-primary-200 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-5 h-5 text-primary-600" />
              <span className="font-medium text-primary-900">Estimated Sending Time</span>
            </div>
            <div className="text-2xl font-bold text-primary-900">
              {estimatedTime.hours > 0 && `${estimatedTime.hours}h `}
              {estimatedTime.minutes}m
            </div>
            <p className="text-xs text-primary-700 mt-1">
              Based on {recipientCount} recipients with current settings
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}


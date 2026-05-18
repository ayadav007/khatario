'use client';

import { useState } from 'react';
import { SendMessageSingleTab } from './SendMessageSingleTab';
import { CampaignSendTab } from './campaigns/CampaignSendTab';
import { MessageSquare, Users } from 'lucide-react';

type TabType = 'single' | 'campaign';

export function SendMessageTab() {
  const [activeTab, setActiveTab] = useState<TabType>('single');

  return (
    <div className="space-y-6">
      {/* Tab Selection */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-8">
          <button
            onClick={() => setActiveTab('single')}
            className={`pb-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'single'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              Single Message
            </div>
          </button>
          <button
            onClick={() => setActiveTab('campaign')}
            className={`pb-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'campaign'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              Bulk Campaign
            </div>
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'single' && <SendMessageSingleTab />}
      {activeTab === 'campaign' && <CampaignSendTab />}
    </div>
  );
}

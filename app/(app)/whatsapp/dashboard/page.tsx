'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { StatusOverview } from '@/components/whatsapp/dashboard/StatusOverview';
import { AgentPerformance } from '@/components/whatsapp/dashboard/AgentPerformance';
import { CampaignPerformance } from '@/components/whatsapp/dashboard/CampaignPerformance';
import { BotVsHuman } from '@/components/whatsapp/dashboard/BotVsHuman';
import { useAuth } from '@/contexts/AuthContext';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';

export default function WhatsAppDashboardPage() {
  const { business } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusData, setStatusData] = useState<any>(null);
  const [agentData, setAgentData] = useState<any>(null);
  const [campaignData, setCampaignData] = useState<any>(null);
  const [botVsHumanData, setBotVsHumanData] = useState<any>(null);

  useEffect(() => {
    if (business?.id) {
      fetchDashboardData();
    }
  }, [business?.id]);

  const fetchDashboardData = async () => {
    if (!business?.id) return;

    setLoading(true);
    setError(null);
    try {
      // Fetch core data — if these fail, show the error banner
      const [overviewRes, agentsRes] = await Promise.all([
        fetch(`/api/whatsapp/dashboard/overview?business_id=${business.id}`),
        fetch(`/api/whatsapp/dashboard/agents?business_id=${business.id}`),
      ]);

      if (!overviewRes.ok || !agentsRes.ok) {
        throw new Error('Failed to fetch dashboard data');
      }

      const overview = await overviewRes.json();
      setStatusData(overview.status);
      setBotVsHumanData(overview.botVsHuman);

      const agents = await agentsRes.json();
      setAgentData(agents.agents);

      // Campaigns is optional — silently skip if not available (addon not active or table missing)
      try {
        const campaignsRes = await fetch(`/api/whatsapp/dashboard/campaigns?business_id=${business.id}`);
        if (campaignsRes.ok) {
          const campaigns = await campaignsRes.json();
          setCampaignData(campaigns.campaigns);
        }
      } catch {
        // Campaigns not available — leave campaignData as null
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      setError('Failed to load data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!business?.id) {
    return (
      
        <div className="flex items-center justify-center h-[600px]">
          <p className="text-gray-600">Please select a business</p>
        </div>
      
    );
  }

  return (
    
      <div className="space-y-6">
        <MobileDuplicatePageChrome
          title="WhatsApp CRM dashboard"
          description="Overview of your WhatsApp conversations and performance"
        />

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
            <p className="text-sm text-red-600">{error}</p>
            <button onClick={() => fetchDashboardData()} className="text-sm text-red-700 font-medium hover:underline">Retry</button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            <span className="ml-3 text-gray-600">Loading dashboard data...</span>
          </div>
        ) : (
          <>
            {/* Widget Grid */}
            <div className="space-y-6">
              {/* Row 1: Status Overview */}
              <StatusOverview data={statusData} loading={loading} />

              {/* Row 2: Agent Performance */}
              <AgentPerformance data={agentData} loading={loading} />

              {/* Row 3: Campaign Performance and Bot vs Human */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <CampaignPerformance data={campaignData} loading={loading} />
                <BotVsHuman data={botVsHumanData} loading={loading} />
              </div>
            </div>
          </>
        )}
      </div>
    
  );
}


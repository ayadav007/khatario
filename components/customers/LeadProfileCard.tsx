'use client';

import React from 'react';
import { TrendingUp, TrendingDown, Minus, Flame, AlertCircle, User, MessageSquare, Clock } from 'lucide-react';

interface LeadProfile {
  lead_score: number;
  lead_status: 'hot' | 'warm' | 'cold' | 'not_interested';
  interest_level: 'high' | 'medium' | 'low' | 'none';
  behavior_tags: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  key_topics: string[];
  purchase_intent: number;
  urgency_level: 'high' | 'medium' | 'low';
  ai_summary: string;
  ai_insights: any;
  total_messages: number;
  response_rate: number;
  last_analyzed_at: string;
}

interface LeadProfileCardProps {
  profile: LeadProfile;
}

export default function LeadProfileCard({ profile }: LeadProfileCardProps) {
  const getScoreColor = (score: number) => {
    if (score >= 70) return 'text-green-600 bg-green-100';
    if (score >= 40) return 'text-yellow-600 bg-yellow-100';
    return 'text-red-600 bg-red-100';
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      hot: 'bg-red-100 text-red-700 border-red-200',
      warm: 'bg-orange-100 text-orange-700 border-orange-200',
      cold: 'bg-slate-100 text-primary-700 border-primary-200',
      not_interested: 'bg-gray-100 text-gray-700 border-gray-200',
    };
    return styles[status] || styles.cold;
  };

  const getSentimentIcon = (sentiment: string) => {
    switch (sentiment) {
      case 'positive':
        return <TrendingUp className="w-4 h-4 text-green-600" />;
      case 'negative':
        return <TrendingDown className="w-4 h-4 text-red-600" />;
      default:
        return <Minus className="w-4 h-4 text-gray-600" />;
    }
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-IN', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateString;
    }
  };

  return (
    <div className="bg-white rounded-lg border shadow-sm p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <User className="w-5 h-5 text-primary-600" />
          Lead Profile
        </h3>
        <span className={`px-3 py-1 text-xs font-semibold rounded-full border ${getStatusBadge(profile.lead_status)}`}>
          {profile.lead_status.toUpperCase().replace('_', ' ')}
        </span>
      </div>

      {/* Lead Score */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">Lead Score</span>
          <span className={`text-2xl font-bold ${getScoreColor(profile.lead_score).split(' ')[0]}`}>
            {profile.lead_score}/100
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full ${getScoreColor(profile.lead_score).split(' ')[1]}`}
            style={{ width: `${profile.lead_score}%` }}
          />
        </div>
      </div>

      {/* Purchase Intent */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">Purchase Intent</span>
          <span className="text-lg font-semibold">{profile.purchase_intent}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="h-2 rounded-full bg-primary-500"
            style={{ width: `${profile.purchase_intent}%` }}
          />
        </div>
      </div>

      {/* AI Summary */}
      {profile.ai_summary && (
        <div className="bg-slate-50 border border-primary-200 rounded-md p-4">
          <p className="text-sm text-primary-900">{profile.ai_summary}</p>
        </div>
      )}

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 gap-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-gray-500" />
          <div>
            <div className="text-xs text-gray-500">Total Messages</div>
            <div className="text-sm font-semibold">{profile.total_messages}</div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-gray-500" />
          <div>
            <div className="text-xs text-gray-500">Response Rate</div>
            <div className="text-sm font-semibold">{profile.response_rate}%</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {getSentimentIcon(profile.sentiment)}
          <div>
            <div className="text-xs text-gray-500">Sentiment</div>
            <div className="text-sm font-semibold capitalize">{profile.sentiment}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-orange-500" />
          <div>
            <div className="text-xs text-gray-500">Urgency</div>
            <div className="text-sm font-semibold capitalize">{profile.urgency_level}</div>
          </div>
        </div>
      </div>

      {/* Behavior Tags */}
      {profile.behavior_tags && profile.behavior_tags.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">Behavior Tags</h4>
          <div className="flex flex-wrap gap-2">
            {profile.behavior_tags.map((tag, idx) => (
              <span
                key={idx}
                className="px-2 py-1 text-xs font-medium bg-purple-100 text-purple-700 rounded-md"
              >
                {tag.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Key Topics */}
      {profile.key_topics && profile.key_topics.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">Key Topics Discussed</h4>
          <div className="flex flex-wrap gap-2">
            {profile.key_topics.map((topic, idx) => (
              <span
                key={idx}
                className="px-2 py-1 text-xs font-medium bg-slate-100 text-primary-700 rounded-md"
              >
                {topic}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recommended Actions */}
      {profile.ai_insights?.recommendedActions && profile.ai_insights.recommendedActions.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            Recommended Actions
          </h4>
          <ul className="space-y-1">
            {profile.ai_insights.recommendedActions.map((action: string, idx: number) => (
              <li key={idx} className="text-sm text-gray-700 flex items-start gap-2">
                <span className="text-primary-600 mt-1">•</span>
                <span>{action}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Last Analyzed */}
      <div className="text-xs text-gray-500 text-center pt-2 border-t">
        Last analyzed: {formatDate(profile.last_analyzed_at)}
      </div>
    </div>
  );
}

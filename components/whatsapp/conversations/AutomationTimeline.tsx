'use client';

import React from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { Bot, MousePointerClick, ArrowRight, ArrowLeft, Phone, Link2, Megaphone, Activity } from 'lucide-react';

export interface TimelineEvent {
  id: string;
  event_type: 'bot_message' | 'button_clicked' | 'flow_entered' | 'flow_exited' | 'cta_clicked' | 'campaign_triggered';
  description: string;
  icon: string;
  event_data?: Record<string, any>;
  created_at: string;
}

interface AutomationTimelineProps {
  events: TimelineEvent[];
}

const iconMap: Record<string, React.ReactNode> = {
  bot: <Bot className="w-4 h-4" />,
  'mouse-pointer-click': <MousePointerClick className="w-4 h-4" />,
  'arrow-right': <ArrowRight className="w-4 h-4" />,
  'arrow-left': <ArrowLeft className="w-4 h-4" />,
  phone: <Phone className="w-4 h-4" />,
  link: <Link2 className="w-4 h-4" />,
  megaphone: <Megaphone className="w-4 h-4" />,
  activity: <Activity className="w-4 h-4" />
};

export function AutomationTimeline({ events }: AutomationTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-gray-500">
        No automation events yet
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200" />

      {/* Events */}
      <div className="space-y-4">
        {events.map((event, index) => (
          <div key={event.id} className="relative flex gap-3">
            {/* Icon */}
            <div className="relative z-10 flex-shrink-0 w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-primary-600">
              {iconMap[event.icon] || iconMap.activity}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 pb-4">
              <p className="text-sm font-medium text-gray-900">
                {event.description}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


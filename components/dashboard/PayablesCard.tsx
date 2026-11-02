'use client';

import React from 'react';
import { AgingMoneyCard, type AgingBreakdown } from '@/components/dashboard/AgingMoneyCard';

interface PayablesCardProps {
  total: number;
  aging: AgingBreakdown;
}

export const PayablesCard: React.FC<PayablesCardProps> = ({ total, aging }) => (
  <AgingMoneyCard
    title="Total Payables"
    total={total}
    aging={aging}
    newHref="/purchases/new"
    listHref="/purchases"
    tooltipLines={[
      <><strong>Current:</strong> Bills not yet due (within payment terms)</>,
      <><strong>Overdue:</strong> Bills past their due date, broken down by days overdue</>,
      'Click on any section to view filtered bills',
    ]}
  />
);

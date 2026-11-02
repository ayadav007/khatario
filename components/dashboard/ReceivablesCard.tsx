'use client';

import React from 'react';
import { AgingMoneyCard, type AgingBreakdown } from '@/components/dashboard/AgingMoneyCard';

interface ReceivablesCardProps {
  total: number;
  aging: AgingBreakdown;
}

export const ReceivablesCard: React.FC<ReceivablesCardProps> = ({ total, aging }) => (
  <AgingMoneyCard
    title="Total Receivables"
    total={total}
    aging={aging}
    newHref="/invoices/new"
    listHref="/invoices"
    tooltipLines={[
      <><strong>Current:</strong> Invoices not yet due (within payment terms)</>,
      <><strong>Overdue:</strong> Invoices past their due date, broken down by days overdue</>,
      'Click on any section to view filtered invoices',
    ]}
  />
);

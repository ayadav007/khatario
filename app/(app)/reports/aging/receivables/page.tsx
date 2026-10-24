'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { AgingReport } from '@/components/reports/AgingReport';

function ReceivablesAgingPage() {
  return <AgingReport kind="receivables" />;
}

export default withPageAuth('reports', 'read', ReceivablesAgingPage);

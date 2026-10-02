'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { AgingReport } from '@/components/reports/AgingReport';

function PayablesAgingPage() {
  return <AgingReport kind="payables" />;
}

export default withPageAuth('reports', 'read', PayablesAgingPage);

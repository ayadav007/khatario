'use client';

import React from 'react';
import { withPageAuth } from '@/lib/auth/withPageAuth';

interface ReportsLayoutProps {
  children: React.ReactNode;
}

function ReportsLayout({ children }: ReportsLayoutProps) {
  return <>{children}</>;
}

export default withPageAuth('reports', 'read', ReportsLayout);

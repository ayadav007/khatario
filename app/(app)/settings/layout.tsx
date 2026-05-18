'use client';

import React from 'react';
import { withPageAuth } from '@/lib/auth/withPageAuth';

interface SettingsLayoutProps {
  children: React.ReactNode;
}

function SettingsLayout({ children }: SettingsLayoutProps) {
  return <>{children}</>;
}

export default withPageAuth('settings', 'read', SettingsLayout);

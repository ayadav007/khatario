'use client';

import React from 'react';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { SettingsModuleGuard } from '@/components/settings/SettingsModuleGuard';

interface SettingsLayoutProps {
  children: React.ReactNode;
}

function SettingsLayout({ children }: SettingsLayoutProps) {
  return <SettingsModuleGuard>{children}</SettingsModuleGuard>;
}

export default withPageAuth('settings', 'read', SettingsLayout);

'use client';

import React from 'react';
import { withPageAuth } from '@/lib/auth/withPageAuth';

interface ItemsLayoutProps {
  children: React.ReactNode;
}

function ItemsLayout({ children }: ItemsLayoutProps) {
  return <>{children}</>;
}

export default withPageAuth('items', 'read', ItemsLayout);

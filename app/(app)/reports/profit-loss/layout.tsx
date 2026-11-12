import type { ReactNode } from 'react';
import { ProfitLossTabs } from '@/components/reports/ProfitLossTabs';

export default function ProfitLossLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ProfitLossTabs />
      {children}
    </>
  );
}

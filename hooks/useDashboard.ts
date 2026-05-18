import { useState, useEffect } from 'react';

interface DashboardData {
  kpis: {
    todaySales: number;
    todayPurchases: number;
    receivables: number;
    payables: number;
  };
  recentInvoices: Array<{
    id: string;
    number: string;
    customer: string;
    date: string;
    amount: number;
    status: string;
  }>;
  lowStockItems: Array<{
    id: string;
    name: string;
    stock: number;
    minStock: number;
    status: string;
  }>;
}

export function useDashboard(businessId: string | null) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) {
      setLoading(false);
      return;
    }

    async function fetchDashboard() {
      try {
        setLoading(true);
        setError(null);

        const date = new Date().toISOString().split('T')[0];
        const response = await fetch(
          `/api/dashboard?business_id=${businessId}&date=${date}`
        );

        if (!response.ok) {
          throw new Error('Failed to fetch dashboard data');
        }

        const result = await response.json();
        setData(result);
      } catch (err: any) {
        setError(err.message);
        console.error('Dashboard fetch error:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchDashboard();

    // Refresh every 5 minutes
    const interval = setInterval(fetchDashboard, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [businessId]);

  return { data, loading, error };
}


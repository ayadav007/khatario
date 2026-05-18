'use client';

export const dynamic = 'force-dynamic';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Redirect from /purchases/categories to /items/categories
 * Categories are for items, which are used in purchases
 */
export default function PurchaseCategoriesRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/items/categories');
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <p className="text-gray-600">Redirecting...</p>
    </div>
  );
}


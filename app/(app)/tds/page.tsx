'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FileText, DollarSign, Receipt, CheckCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';

export default function TDSPage() {
  const { business } = useAuth();

  return (
    
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">TDS Management</h1>
          <p className="text-sm text-text-secondary mt-1">Manage Tax Deducted at Source</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Link href="/tds/categories">
            <Card className="p-6 hover:shadow-lg transition-shadow cursor-pointer">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-slate-100 rounded-lg">
                  <FileText className="w-6 h-6 text-primary-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-text-primary">TDS Categories</h3>
                  <p className="text-sm text-text-secondary">Manage sections & rates</p>
                </div>
              </div>
            </Card>
          </Link>

          <Link href="/tds/transactions">
            <Card className="p-6 hover:shadow-lg transition-shadow cursor-pointer">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-green-100 rounded-lg">
                  <Receipt className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-text-primary">TDS Transactions</h3>
                  <p className="text-sm text-text-secondary">View all deductions</p>
                </div>
              </div>
            </Card>
          </Link>

          <Link href="/tds/payments">
            <Card className="p-6 hover:shadow-lg transition-shadow cursor-pointer">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-purple-100 rounded-lg">
                  <DollarSign className="w-6 h-6 text-purple-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-text-primary">TDS Payments</h3>
                  <p className="text-sm text-text-secondary">Record deposits</p>
                </div>
              </div>
            </Card>
          </Link>

          <Link href="/tds/certificates">
            <Card className="p-6 hover:shadow-lg transition-shadow cursor-pointer">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-orange-100 rounded-lg">
                  <CheckCircle className="w-6 h-6 text-orange-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-text-primary">Certificates</h3>
                  <p className="text-sm text-text-secondary">Form 16A generation</p>
                </div>
              </div>
            </Card>
          </Link>
        </div>

        <Link href="/reports/tds">
          <Card className="p-6 hover:shadow-lg transition-shadow cursor-pointer">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-text-primary">TDS Reports</h3>
                <p className="text-sm text-text-secondary">View summary and section-wise reports</p>
              </div>
              <Button variant="ghost">View Reports</Button>
            </div>
          </Card>
        </Link>
      </div>
    
  );
}


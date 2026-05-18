'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Download, Mail, Loader2, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useParams, useRouter } from 'next/navigation';
import { useToastContext } from '@/contexts/ToastContext';
import Link from 'next/link';

export default function PayslipViewPage() {
  const params = useParams();
  const router = useRouter();
  const { business } = useAuth();
  const toast = useToastContext();
  const salaryPaymentId = params.id as string;
  const [loading, setLoading] = useState(true);
  const [htmlContent, setHtmlContent] = useState<string>('');

  useEffect(() => {
    if (salaryPaymentId && business?.id) {
      fetchPayslip();
    }
  }, [salaryPaymentId, business?.id]);

  const fetchPayslip = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/employees/salary/payslips/${salaryPaymentId}/html?business_id=${business.id}`);
      if (res.ok) {
        const html = await res.text();
        setHtmlContent(html);
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to load payslip');
        router.push('/employees/salary/payments');
      }
    } catch (error) {
      console.error('Error fetching payslip:', error);
      toast.error('Failed to load payslip');
      router.push('/employees/salary/payments');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      
        <div className="flex items-center justify-center h-[calc(100vh-100px)]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      
    );
  }

  return (
    
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Link href="/employees/salary/payments">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Salary Payments
            </Button>
          </Link>
          <div className="flex gap-2">
            <a
              href={`/api/employees/salary/payslips/${salaryPaymentId}/pdf?business_id=${business?.id}`}
              target="_blank"
              download
            >
              <Button>
                <Download className="w-4 h-4 mr-2" />
                Download PDF
              </Button>
            </a>
          </div>
        </div>

        <Card>
          <div className="p-6">
            <div
              className="payslip-content"
              dangerouslySetInnerHTML={{ __html: htmlContent }}
              style={{
                maxWidth: '100%',
                overflow: 'auto',
              }}
            />
          </div>
        </Card>
      </div>
    
  );
}


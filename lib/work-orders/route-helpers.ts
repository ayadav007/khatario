import { NextResponse } from 'next/server';
import { AuthorizationError } from '@/lib/authorization';
import { InvoiceCreateServiceError } from '@/lib/invoices/invoice-create-service';
import { WorkOrderInputError } from '@/lib/work-orders/work-order';

export function workOrderErrorResponse(error: any, fallback: string): NextResponse {
  if (error instanceof WorkOrderInputError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof AuthorizationError) {
    return error.toNextResponse();
  }
  if (error instanceof InvoiceCreateServiceError) {
    return NextResponse.json(
      { error: error.message, code: error.code, ...(error.details || {}) },
      { status: error.statusCode }
    );
  }
  if (error?.code === '23505') {
    return NextResponse.json(
      { error: 'This work order number is already used. Change the number and try again.' },
      { status: 409 }
    );
  }
  if (typeof error?.statusCode === 'number' && error.statusCode < 500) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode });
  }
  console.error(fallback, error);
  return NextResponse.json({ error: fallback, details: error?.message }, { status: 500 });
}

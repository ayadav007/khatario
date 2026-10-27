import { redirect } from 'next/navigation';

/**
 * Single-item stock requests were replaced by Supplier Hub orders (multi-line, with backorders,
 * bills and receiving). Open requests were moved there by migration 430.
 */
export default function RetiredRequestsPage() {
  redirect('/supply-orders');
}

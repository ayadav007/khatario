# API Usage Guide

This guide shows how to use the Khatario API endpoints in your components.

## Authentication

Currently, API endpoints require a `business_id` parameter. In production, you should implement proper authentication (JWT tokens, session-based auth, etc.).

## Base URL

Development: `http://localhost:3000/api`
Production: `https://yourdomain.com/api`

## API Endpoints

### Dashboard

**GET** `/api/dashboard?business_id={id}&date={date}`

```typescript
const response = await fetch(
  `/api/dashboard?business_id=${businessId}&date=${date}`
);
const data = await response.json();
```

Returns:
- `kpis`: Today's sales, purchases, receivables, payables
- `recentInvoices`: Latest 10 invoices
- `lowStockItems`: Items below minimum stock

### Customers

**GET** `/api/customers?business_id={id}&search={term}&filter={filter}`

```typescript
const response = await fetch(
  `/api/customers?business_id=${businessId}&search=${search}`
);
const { customers } = await response.json();
```

**POST** `/api/customers`

```typescript
const response = await fetch('/api/customers', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    business_id: businessId,
    name: 'ABC Traders',
    phone: '+91 9876543210',
    email: 'abc@example.com',
    address: '123 Street',
    gstin: '29ABCDE1234F1Z5',
  }),
});
const { customer } = await response.json();
```

**GET** `/api/customers/{id}`

```typescript
const response = await fetch(`/api/customers/${customerId}`);
const { customer, transactions, totalReceivable } = await response.json();
```

**PUT** `/api/customers/{id}`

```typescript
const response = await fetch(`/api/customers/${customerId}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Updated Name',
    phone: '+91 9876543211',
  }),
});
const { customer } = await response.json();
```

### Items

**GET** `/api/items?business_id={id}&search={term}&category={id}&stock_filter={filter}`

```typescript
const response = await fetch(
  `/api/items?business_id=${businessId}&search=${search}`
);
const { items } = await response.json();
```

**POST** `/api/items`

```typescript
const response = await fetch('/api/items', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    business_id: businessId,
    name: 'Product A',
    code: 'PROD-001',
    category_id: categoryId,
    unit: 'PCS',
    hsn_sac: '12345678',
    purchase_price: 100,
    selling_price: 150,
    mrp: 200,
    tax_rate: 18,
    opening_stock: 100,
    min_stock: 10,
  }),
});
const { item } = await response.json();
```

### Invoices

**GET** `/api/invoices?business_id={id}&search={term}&status={status}`

```typescript
const response = await fetch(
  `/api/invoices?business_id=${businessId}&status=final`
);
const { invoices } = await response.json();
```

**POST** `/api/invoices`

```typescript
const response = await fetch('/api/invoices', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    business_id: businessId,
    customer_id: customerId,
    invoice_date: '2024-01-15',
    due_date: '2024-02-15',
    status: 'final',
    items: [
      {
        item_id: itemId,
        item_name: 'Product A',
        quantity: 2,
        unit: 'PCS',
        unit_price: 150,
        tax_rate: 18,
        discount_percent: 0,
      },
    ],
    discount_total: 0,
    additional_charges: 0,
    notes: 'Thank you!',
    terms: 'Payment due in 30 days',
  }),
});
const { invoice } = await response.json();
```

**POST** `/api/invoices/{id}/whatsapp`

```typescript
const response = await fetch(`/api/invoices/${invoiceId}/whatsapp`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    pdf_url: 'https://example.com/invoices/inv-001.pdf',
    custom_message: 'Hello! Please find your invoice attached.',
  }),
});
const result = await response.json();
```

## Using React Hooks

We've created custom hooks for easier API usage:

### useDashboard

```typescript
import { useDashboard } from '@/hooks/useDashboard';

function DashboardPage() {
  const { data, loading, error } = useDashboard(businessId);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      <h1>Sales Today: ₹ {data?.kpis.todaySales}</h1>
      {/* ... */}
    </div>
  );
}
```

### useCustomers

```typescript
import { useCustomers } from '@/hooks/useCustomers';

function CustomersPage() {
  const [search, setSearch] = useState('');
  const { customers, loading, error } = useCustomers({
    businessId,
    search,
    filter: 'all',
  });

  // Use customers data
}
```

## Error Handling

Always handle errors properly:

```typescript
try {
  const response = await fetch('/api/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Request failed');
  }

  const result = await response.json();
  // Handle success
} catch (error) {
  console.error('API Error:', error);
  // Show error to user
}
```

## Example: Complete Component with API

```typescript
'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export default function CustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  const businessId = 'your-business-id'; // Get from auth/session

  useEffect(() => {
    async function fetchCustomers() {
      try {
        setLoading(true);
        const params = new URLSearchParams({
          business_id: businessId,
          ...(search && { search }),
        });

        const response = await fetch(`/api/customers?${params}`);
        if (!response.ok) throw new Error('Failed to fetch');

        const { customers } = await response.json();
        setCustomers(customers);
        setError(null);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchCustomers();
  }, [businessId, search]);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search customers..."
      />
      {customers.map((customer) => (
        <div key={customer.id}>{customer.name}</div>
      ))}
    </div>
  );
}
```

## Next Steps

1. Implement authentication middleware
2. Add request validation (use Zod schemas)
3. Add rate limiting
4. Implement caching for frequently accessed data
5. Add pagination for large lists
6. Implement real-time updates (WebSockets/Server-Sent Events)


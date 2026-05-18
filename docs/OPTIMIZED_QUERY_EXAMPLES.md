# Optimized Query Examples

These are examples of how to optimize existing queries after the indexes are added.

## 1. Dashboard Aging Calculation (Optimized)

### Current Implementation (JavaScript)
```typescript
// Fetches ALL invoices, calculates in JavaScript
const receivablesInvoices = await queryRows(`
  SELECT id, invoice_date, due_date, grand_total, COALESCE(paid_amount, 0) as paid_amount
  FROM invoices
  WHERE business_id = $1 AND status != 'cancelled' AND (grand_total - COALESCE(paid_amount, 0)) > 0
`, [businessId]);

// Then calculates aging in JavaScript loop
receivablesInvoices.forEach((inv) => {
  // ... aging calculation
});
```

### Optimized Implementation (SQL)
```sql
WITH aging_data AS (
  SELECT 
    grand_total - COALESCE(paid_amount, 0) as outstanding,
    CASE 
      WHEN due_date IS NOT NULL THEN due_date
      ELSE invoice_date
    END as effective_date
  FROM invoices
  WHERE business_id = $1 
    AND status != 'cancelled'
    AND (grand_total - COALESCE(paid_amount, 0)) > 0
)
SELECT 
  SUM(outstanding) as total,
  SUM(CASE WHEN CURRENT_DATE - effective_date <= 0 THEN outstanding ELSE 0 END) as current,
  SUM(CASE WHEN CURRENT_DATE - effective_date BETWEEN 1 AND 15 THEN outstanding ELSE 0 END) as days_1_15,
  SUM(CASE WHEN CURRENT_DATE - effective_date BETWEEN 16 AND 30 THEN outstanding ELSE 0 END) as days_16_30,
  SUM(CASE WHEN CURRENT_DATE - effective_date BETWEEN 31 AND 45 THEN outstanding ELSE 0 END) as days_31_45,
  SUM(CASE WHEN CURRENT_DATE - effective_date > 45 THEN outstanding ELSE 0 END) as days_45_plus
FROM aging_data;
```

**Benefits:**
- Calculates in database (faster)
- Only returns aggregated results (less data transfer)
- Uses indexes efficiently

## 2. Invoice Search (Optimized)

### Current Implementation
```sql
SELECT i.*, c.name as customer_name, c.phone as customer_phone
FROM invoices i
LEFT JOIN customers c ON i.customer_id = c.id
WHERE i.business_id = $1 
  AND i.status != 'cancelled'
  AND (i.invoice_number ILIKE '%search%' OR c.name ILIKE '%search%')
ORDER BY i.invoice_date DESC
LIMIT 100
```

### Optimized Implementation (After Trigram Index)
```sql
-- Uses trigram index for fast fuzzy search
SELECT 
  i.id, i.invoice_number, i.invoice_date, i.grand_total, 
  i.payment_status, i.status, i.due_date,
  c.name as customer_name, c.phone as customer_phone
FROM invoices i
LEFT JOIN customers c ON i.customer_id = c.id
WHERE i.business_id = $1 
  AND i.status != 'cancelled'
  AND (
    i.invoice_number % $2  -- Trigram similarity operator (uses index)
    OR c.name % $2
  )
ORDER BY i.invoice_date DESC
LIMIT 100
```

**Note:** The `%` operator is trigram similarity. For exact prefix matching, use:
```sql
WHERE i.invoice_number ILIKE $2 || '%'  -- Trailing wildcard can use index
```

## 3. Invoice List with Aging Filter (Optimized)

### Current Implementation
```sql
-- Calculates days_overdue twice in same query
SELECT i.*, 
  CASE 
    WHEN i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE AND (i.grand_total - COALESCE(i.paid_amount, 0)) > 0 
      THEN CURRENT_DATE - i.due_date
    WHEN i.due_date IS NULL AND i.invoice_date < CURRENT_DATE AND (i.grand_total - COALESCE(i.paid_amount, 0)) > 0
      THEN CURRENT_DATE - i.invoice_date
    ELSE 0
  END as days_overdue
FROM invoices i
WHERE i.business_id = $1
  AND status != 'cancelled'
  AND (
    CASE 
      WHEN i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE 
        THEN CURRENT_DATE - i.due_date
      WHEN i.due_date IS NULL AND i.invoice_date < CURRENT_DATE
        THEN CURRENT_DATE - i.invoice_date
      ELSE 0
    END
  ) >= $2 AND (
    CASE 
      WHEN i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE 
        THEN CURRENT_DATE - i.due_date
      WHEN i.due_date IS NULL AND i.invoice_date < CURRENT_DATE
        THEN CURRENT_DATE - i.invoice_date
      ELSE 0
    END
  ) <= $3
```

### Optimized Implementation
```sql
WITH invoice_aging AS (
  SELECT 
    i.*,
    CASE 
      WHEN i.due_date IS NOT NULL THEN i.due_date
      ELSE i.invoice_date
    END as effective_date,
    i.grand_total - COALESCE(i.paid_amount, 0) as outstanding
  FROM invoices i
  WHERE i.business_id = $1
    AND i.status != 'cancelled'
    AND (i.grand_total - COALESCE(i.paid_amount, 0)) > 0
)
SELECT 
  ia.*,
  CURRENT_DATE - ia.effective_date as days_overdue
FROM invoice_aging ia
WHERE CURRENT_DATE - ia.effective_date >= $2
  AND CURRENT_DATE - ia.effective_date <= $3
ORDER BY ia.invoice_date DESC
LIMIT 100
```

**Benefits:**
- Calculates effective_date once
- Uses CTE for clarity
- Can use indexes on effective_date

## 4. Customer Count Query (Optimized)

### Current Implementation
```sql
-- Two separate queries
SELECT COUNT(*) as total FROM customers WHERE business_id = $1 AND is_active = true;
SELECT * FROM customers WHERE business_id = $1 AND is_active = true LIMIT $2 OFFSET $3;
```

### Optimized Implementation
```sql
-- Single query with window function
SELECT 
  *,
  COUNT(*) OVER() as total
FROM customers
WHERE business_id = $1 AND is_active = true
ORDER BY name ASC
LIMIT $2 OFFSET $3;
```

**Benefits:**
- One query instead of two
- Same result, faster execution

## 5. Dashboard Overview - Combined Queries

### Current Implementation
```typescript
// 10+ separate queries
const salesRes = await queryOne('SELECT SUM(grand_total) FROM invoices...');
const purchasesRes = await queryOne('SELECT SUM(grand_total) FROM purchases...');
const cogsRes = await queryOne('SELECT SUM(...) FROM invoice_items...');
// ... etc
```

### Optimized Implementation (Using CTEs)
```sql
WITH sales_data AS (
  SELECT COALESCE(SUM(grand_total), 0) as total
  FROM invoices
  WHERE business_id = $1 AND invoice_date >= $2 AND invoice_date <= $3 AND status != 'cancelled'
),
purchases_data AS (
  SELECT COALESCE(SUM(grand_total), 0) as total
  FROM purchases
  WHERE business_id = $1 AND bill_date >= $2 AND bill_date <= $3 AND status != 'cancelled'
),
cogs_data AS (
  SELECT COALESCE(SUM(ii.quantity * COALESCE(i.purchase_price, 0)), 0) as total
  FROM invoice_items ii
  JOIN invoices inv ON ii.invoice_id = inv.id
  LEFT JOIN items i ON ii.item_id = i.id
  WHERE inv.business_id = $1 AND inv.invoice_date >= $2 AND inv.invoice_date <= $3 AND inv.status != 'cancelled'
)
SELECT 
  s.total as sales,
  p.total as purchases,
  c.total as cogs,
  s.total - c.total as profit
FROM sales_data s, purchases_data p, cogs_data c;
```

**Benefits:**
- Single database round trip
- Better query planning
- Faster overall execution

## Implementation Notes

1. **Trigram Indexes**: Require `pg_trgm` extension (already in migration)
2. **CTEs**: Use for complex calculations, better readability
3. **Window Functions**: Use for COUNT queries to avoid double queries
4. **Index Usage**: Always check `EXPLAIN ANALYZE` to verify indexes are used

## Testing Optimized Queries

```sql
-- Enable query timing
\timing

-- Test original query
EXPLAIN ANALYZE SELECT ...;

-- Test optimized query
EXPLAIN ANALYZE SELECT ...;

-- Compare execution times and index usage
```


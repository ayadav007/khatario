# 🔍 Invoice / Proforma / Bill of Supply Architecture Audit

**Date:** 2024-12-19  
**Auditor:** Senior Product + Backend Engineer  
**Scope:** Complete lifecycle audit of document type handling

---

## 📊 A. Root Cause Analysis

### **Why Form Data Persists When Switching Document Types**

#### **1. Conflicting useEffect Handlers**

**Location:** `app/invoices/new/page.tsx`

**Problem:** Two separate `useEffect` hooks handle document type changes, creating a race condition:

**Effect #1 (Lines 462-475):** URL-based type change with dirty check
```typescript
useEffect(() => {
  const typeFromUrl = searchParams.get('type') as DocumentType | null;
  const effectiveUrlType = typeFromUrl && allowedDocTypes.includes(typeFromUrl) ? typeFromUrl : 'tax_invoice';
  
  if (effectiveUrlType !== documentType) {
    if (isDirty) {
      setPendingTypeChange(effectiveUrlType);
      setShowResetConfirm(true);  // Shows confirmation dialog
    } else {
      setDocumentType(effectiveUrlType);
      setInvoicePrefix(DOCUMENT_TYPE_PREFIXES[effectiveUrlType]);
      // ❌ NO FORM RESET HERE
    }
  }
}, [searchParams, documentType, isDirty]);
```

**Effect #2 (Lines 815-892):** Document type sync with form reset
```typescript
useEffect(() => {
  const newTypeParam = searchParams.get('type') as DocumentType | null;
  const newDocType: DocumentType = newTypeParam && allowedDocTypes.includes(newTypeParam) ? newTypeParam : 'tax_invoice';
  
  if (newDocType !== documentType) {
    setDocumentType(newDocType);
    setInvoicePrefix(DOCUMENT_TYPE_PREFIXES[newDocType]);
    setInvoiceNumber('');
    setRows(prev => prev.map(r => calculateRow(r, true)));
    
    // ✅ Form reset happens here, BUT...
    if (!savedInvoiceId) {  // ❌ Only resets if not editing existing invoice
      setCustomerId('');
      setSelectedCustomer(null);
      setRows([...]); // Reset rows
      // ... reset all fields
    }
  }
}, [searchParams, documentType]);
```

**Root Cause:**
- **Effect #1** runs first and shows confirmation dialog if `isDirty === true`
- **Effect #2** only resets if `!savedInvoiceId` (not editing)
- If user dismisses confirmation or if `isDirty` is false, Effect #2 might not reset properly
- **Dependency arrays differ:** Effect #1 depends on `isDirty`, Effect #2 doesn't
- This creates unpredictable behavior

#### **2. Missing Form Key Update on Type Change**

**Location:** `app/invoices/new/page.tsx:451, 508, 2423`

**Problem:** Form is keyed by `formKey`, but this key is only incremented in `handleConfirmReset`:

```typescript
const [formKey, setFormKey] = useState(0);

// Form is keyed:
<div key={formKey} className="max-w-[1600px] mx-auto space-y-4">

// But formKey is only updated here:
const handleConfirmReset = (action: 'save' | 'discard' | 'cancel') => {
  // ...
  setFormKey(prev => prev + 1);  // ✅ Only updated on confirmation
};
```

**Root Cause:**
- React uses `key` to determine if component should remount
- When `documentType` changes but `formKey` doesn't, React reuses the same component instance
- State persists because React doesn't know the form should reset
- **Solution:** Increment `formKey` whenever `documentType` changes (not just on confirmation)

#### **3. Shared State Across Document Types**

**Location:** `app/invoices/new/page.tsx:394-520`

**Problem:** All document types share the same state variables:

```typescript
const [customerId, setCustomerId] = useState('');
const [rows, setRows] = useState<InvoiceItemRow[]>([...]);
const [notes, setNotes] = useState('');
const [extraCharges, setExtraCharges] = useState<ExtraCharge[]>([]);
// ... all shared state
```

**Root Cause:**
- No separation between document types at the state level
- When `documentType` changes, state variables don't automatically reset
- React state persists across re-renders unless explicitly cleared
- **This is by design in React**, but we need explicit reset logic

#### **4. Conditional Reset Logic**

**Location:** `app/invoices/new/page.tsx:862-889`

**Problem:** Form reset only happens if `!savedInvoiceId`:

```typescript
// Reset form when switching document types (only if not in edit mode)
if (!savedInvoiceId) {
  setCustomerId('');
  // ... reset all fields
}
```

**Root Cause:**
- This prevents reset when editing an existing invoice (correct behavior)
- BUT it also prevents reset when switching types on a NEW document that hasn't been saved yet
- If user switches type before first save, `savedInvoiceId` is `null`, so reset should happen
- However, the reset might be blocked by Effect #1's confirmation dialog

#### **5. isDirty Detection Issues**

**Location:** `app/invoices/new/page.tsx:454-459`

**Problem:** `isDirty` is set based on form content, but might not accurately reflect user intent:

```typescript
useEffect(() => {
  const hasItems = rows.length > 1 || (rows[0]?.name !== '' || rows[0]?.itemId !== '');
  if (hasItems || customerId || notes || extraCharges.length > 0) {
    setIsDirty(true);
  }
}, [rows, customerId, notes, extraCharges]);
```

**Root Cause:**
- `isDirty` never gets reset to `false` automatically
- Once form becomes dirty, it stays dirty even after switching types
- This causes confirmation dialog to always show, blocking automatic reset

---

## 📋 B. Expected Behavior Table

| Action | Tax Invoice | Proforma Invoice | Bill of Supply | Notes |
|--------|------------|------------------|----------------|-------|
| **New Creation** | Start with empty form, prefix "INV" | Start with empty form, prefix "PI" | Start with empty form, prefix "BOS" | Each type is a separate document |
| **Switching Type (Clean Form)** | Reset form, change prefix to "INV" | Reset form, change prefix to "PI" | Reset form, change prefix to "BOS" | No confirmation needed if form is empty |
| **Switching Type (Dirty Form)** | Show confirmation: "Switch to Tax Invoice? Current data will be lost." | Show confirmation: "Switch to Proforma? Current data will be lost." | Show confirmation: "Switch to Bill of Supply? Current data will be lost." | User must confirm or cancel |
| **Save as Draft** | Save with `document_type='tax_invoice'`, prefix "INV" | Save with `document_type='proforma_invoice'`, prefix "PI" | Save with `document_type='bill_of_supply'`, prefix "BOS" | Drafts are type-specific |
| **Reload Draft** | Load invoice with `document_type='tax_invoice'` | Load proforma with `document_type='proforma_invoice'` | Load BOS with `document_type='bill_of_supply'` | Cannot switch type of existing draft |
| **Preview** | Show preview with Tax Invoice heading | Show preview with Proforma Invoice heading | Show preview with Bill of Supply heading | Template respects document type |
| **Tax Calculation** | Calculate CGST/SGST or IGST | Calculate CGST/SGST or IGST (for reference) | **NO TAX** (taxPercent = 0) | Bill of Supply is tax-exempt |
| **Final Save** | Save as final Tax Invoice | Save as final Proforma Invoice | Save as final Bill of Supply | Cannot change type after finalization |

### **Key Principles:**

1. **Document Types are Mutually Exclusive:** A document cannot be both a Tax Invoice and a Proforma Invoice
2. **Drafts are Type-Specific:** A draft Tax Invoice cannot become a Proforma Invoice
3. **Type Switching = New Document:** Switching types creates a new document context, not a modification
4. **Tax Rules are Type-Dependent:** Bill of Supply has no tax, others have tax
5. **Prefixes are Type-Specific:** Each type has its own numbering sequence

---

## 🛠️ C. Recommended Fix (Minimal & Correct)

### **Fix Strategy: Single Source of Truth + Explicit Reset**

**Principle:** Document type change should ALWAYS reset the form (unless editing existing document), with confirmation only for dirty forms.

### **Step 1: Consolidate Document Type Change Logic**

**Remove:** Effect #1 (lines 462-475) - the confirmation-only handler  
**Keep:** Effect #2 (lines 815-892) - the reset handler, but improve it

**New Unified Effect:**

```typescript
// Single effect to handle document type changes
useEffect(() => {
  const newTypeParam = searchParams.get('type') as DocumentType | null;
  const newDocType: DocumentType = newTypeParam && allowedDocTypes.includes(newTypeParam) 
    ? newTypeParam 
    : initialDocType; // Use initialDocType, not hardcoded 'tax_invoice'
  
  // Only proceed if type actually changed
  if (newDocType === documentType) {
    return;
  }
  
  // If editing existing invoice, don't allow type change
  if (savedInvoiceId) {
    console.warn('[Invoice] Cannot change document type of existing invoice');
    // Optionally, revert URL or show error
    return;
  }
  
  // Check if form is dirty
  const hasData = rows.length > 1 || 
                  (rows[0]?.name !== '' || rows[0]?.itemId !== '') ||
                  customerId || 
                  notes || 
                  extraCharges.length > 0;
  
  if (hasData) {
    // Show confirmation dialog
    setPendingTypeChange(newDocType);
    setShowResetConfirm(true);
    return;
  }
  
  // Form is clean, proceed with type change and reset
  performDocumentTypeChange(newDocType);
}, [searchParams, documentType, savedInvoiceId, rows, customerId, notes, extraCharges]);

// Extract type change logic to separate function
const performDocumentTypeChange = useCallback((newDocType: DocumentType) => {
  // Update document type and prefix
  setDocumentType(newDocType);
  setInvoicePrefix(DOCUMENT_TYPE_PREFIXES[newDocType]);
  setInvoiceNumber(''); // Clear number so it gets fetched for new type
  
  // Reset ALL form state
  setCustomerId('');
  setSelectedCustomer(null);
  setRows([{ 
    itemId: '', name: '', quantity: 1, freeQty: 0, unit: 'PCS', 
    price: 0, discountPercent: 0, discountAmount: 0, 
    taxPercent: 0, taxAmount: 0, hsnSac: '', 
    taxableValue: 0, cgstAmount: 0, sgstAmount: 0, igstAmount: 0, total: 0 
  }]);
  setNotes('');
  setExtraCharges([]);
  setPayments([]);
  setBillingAddress('');
  setShippingAddress('');
  setIsExport(false);
  setExportType('wop');
  setPortCode('');
  setShippingBillNumber('');
  setShippingBillDate('');
  // Reset export compliance fields
  setInvoiceCurrency('INR');
  setExchangeRate('');
  setCountryOfOrigin('India');
  setPortOfLoading('');
  setPortOfDischarge('');
  setPlaceOfDelivery('');
  setIncoterms('');
  setTransportMode('');
  setAwbNumber('');
  setBlNumber('');
  setBuyerTaxId('');
  
  // Reset place of supply to business state
  setPlaceOfSupply(business?.state || '');
  
  // Mark form as clean
  setIsDirty(false);
  
  // Increment form key to force React remount
  setFormKey(prev => prev + 1);
  
  // Fetch next number for new document type
  if (business?.id) {
    fetch(`/api/invoices/next-number?business_id=${business.id}&document_type=${newDocType}`)
      .then(res => res.json())
      .then(data => {
        if (data.invoice_number) {
          setInvoiceNumber(data.invoice_number);
        }
      })
      .catch(err => console.error('Failed to fetch next number:', err));
  }
  
  // Fetch template for new document type
  if (business?.id) {
    const documentTypeMap: Record<string, string> = {
      'tax_invoice': 'tax_invoice',
      'proforma_invoice': 'proforma_invoice',
      'bill_of_supply': 'bill_of_supply',
    };
    const assignmentDocType = documentTypeMap[newDocType] || 'tax_invoice';
    
    fetch(`/api/template-assignments?business_id=${business.id}`)
      .then(res => res.json())
      .then(data => {
        if (data.assignments && Array.isArray(data.assignments)) {
          const assignment = data.assignments.find((a: any) => a.document_type === assignmentDocType);
          if (assignment && assignment.template_id) {
            setInvoiceTemplate(assignment.template_id);
          } else {
            setInvoiceTemplate(null);
          }
        }
      })
      .catch(err => console.error('Failed to fetch template:', err));
  }
  
  // Recalculate rows with new document type (for tax calculation)
  // This will happen automatically via calculateRow's documentType dependency
}, [business?.id, business?.state]);
```

### **Step 2: Update handleConfirmReset**

**Location:** `app/invoices/new/page.tsx:477-509`

**Change:**

```typescript
const handleConfirmReset = (action: 'save' | 'discard' | 'cancel') => {
  if (action === 'cancel') {
    setShowResetConfirm(false);
    setPendingTypeChange(null);
    // Optionally revert URL to previous type
    return;
  }

  if (action === 'save') {
    // Save current form as draft before switching
    handleSave('draft').then(() => {
      // After save completes, perform type change
      if (pendingTypeChange) {
        performDocumentTypeChange(pendingTypeChange);
      }
      setShowResetConfirm(false);
      setPendingTypeChange(null);
    });
    return;
  }
  
  // action === 'discard'
  if (pendingTypeChange) {
    performDocumentTypeChange(pendingTypeChange);
  }
  
  setShowResetConfirm(false);
  setPendingTypeChange(null);
};
```

### **Step 3: Key Form by Document Type**

**Location:** `app/invoices/new/page.tsx:2423`

**Change:**

```typescript
// Instead of just formKey, key by documentType + formKey
<div key={`${documentType}-${formKey}`} className="max-w-[1600px] mx-auto space-y-4">
```

**Why:** This ensures React remounts the form when document type changes, even if formKey doesn't increment.

### **Step 4: Reset isDirty on Type Change**

**Location:** Inside `performDocumentTypeChange`

**Add:**

```typescript
// Mark form as clean after reset
setIsDirty(false);
```

---

## 🏗️ D. Code-Level Guidance

### **Where to Reset / Rehydrate**

| Location | Current Behavior | Should Reset? | Fix |
|----------|-----------------|----------------|-----|
| **URL type param changes** | Two conflicting effects | ✅ Yes (if not editing) | Consolidate to single effect |
| **Manual type selector (if exists)** | Not found in code | ✅ Yes (if not editing) | Add handler that updates URL |
| **Loading existing draft** | Loads all data | ❌ No (preserve data) | Keep as-is |
| **Loading existing final invoice** | Loads all data | ❌ No (preserve data) | Keep as-is |
| **After save as draft** | Keeps form data | ❌ No (preserve data) | Keep as-is |
| **After final save** | Keeps form data | ✅ Yes (start new document) | Reset form after final save |

### **Whether to Key the Form by Document Type**

**Answer: YES**

**Implementation:**
```typescript
<div key={`${documentType}-${formKey}`} className="...">
```

**Why:**
- Forces React to remount form when type changes
- Prevents state leakage between document types
- Ensures clean slate for each type

### **Whether to Separate Routes or Contexts**

**Answer: NO (Keep Single Route, Fix State Management)**

**Reasoning:**
- All three document types share the same form structure
- Only differences are: prefix, heading, tax calculation
- Separating routes would duplicate 95% of the code
- Better to fix state management in single route

**Alternative (if needed later):**
- Create a `DocumentFormContext` that manages document-type-specific state
- But this is overkill for current scope

---

## 🎯 E. Implementation Plan

### **Phase 1: Fix Immediate Issues (CRITICAL)**

1. **Remove duplicate useEffect** (Effect #1, lines 462-475)
2. **Consolidate type change logic** into single effect
3. **Add form key by documentType**
4. **Reset isDirty on type change**

**Files to modify:**
- `app/invoices/new/page.tsx`

**Risk:** Low - only affects new document creation, not existing drafts

### **Phase 2: Improve User Experience (RECOMMENDED)**

1. **Add explicit type selector in UI** (if not exists)
2. **Show clear confirmation message** explaining what will be lost
3. **Auto-save draft before type change** (optional)

**Files to modify:**
- `app/invoices/new/page.tsx` (confirmation dialog UI)

**Risk:** Low - UI-only changes

### **Phase 3: Database Consistency (OPTIONAL)**

1. **Verify drafts are type-specific** in database queries
2. **Add constraint** to prevent type changes on saved documents
3. **Migration script** to fix any existing drafts with wrong types

**Files to modify:**
- `app/api/invoices/route.ts` (add validation)
- Database migration (if needed)

**Risk:** Medium - requires database changes

---

## 🚫 What NOT to Change

1. **❌ Don't create separate routes** (`/invoices/new`, `/proforma/new`, `/bill-of-supply/new`)
   - Unnecessary code duplication
   - Harder to maintain

2. **❌ Don't create separate components** for each document type
   - 95% of form is identical
   - Only differences are prefix and tax calculation

3. **❌ Don't change database schema**
   - `document_type` column is correct
   - No migration needed

4. **❌ Don't change draft loading logic**
   - Loading existing drafts should preserve all data
   - Only new document creation should reset

5. **❌ Don't add localStorage for form state**
   - Adds complexity
   - Current state management is fine, just needs reset logic

---

## ✅ Success Criteria

After fixes:

1. ✅ **Switching document type on clean form** → Form resets immediately, no confirmation
2. ✅ **Switching document type on dirty form** → Shows confirmation, resets on confirm
3. ✅ **No accidental data carry-over** → Form always starts clean for new document type
4. ✅ **Drafts are consistent** → Drafts retain their document type, cannot be switched
5. ✅ **User intent is respected** → Confirmation prevents accidental data loss
6. ✅ **Behavior matches real invoicing systems** → Each document type is independent

---

## 📝 Summary

### **Root Cause:**
- Two conflicting `useEffect` hooks handle document type changes
- Form reset only happens conditionally (`!savedInvoiceId`)
- `isDirty` flag never resets, blocking automatic type changes
- Form not keyed by document type, so React reuses component instance

### **Solution:**
- Consolidate to single `useEffect` with proper dirty check
- Extract type change logic to `performDocumentTypeChange` function
- Key form by `${documentType}-${formKey}` to force remount
- Reset `isDirty` flag when form is reset
- Show confirmation only when form has data

### **Expected Outcome:**
- Clean form → Type change resets immediately
- Dirty form → Type change shows confirmation
- After confirmation → Form resets completely
- No data leakage between document types
- Each document type is independent

---

**End of Audit**


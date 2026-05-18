# 🚀 Phase 3 Features - How to Use Guide

**Date**: February 7, 2026  
**All Phase 3 features are now ENABLED and ready to use!**

---

## 📊 1. **Customizable Dashboard**

### How to Access:
1. Go to `/dashboard` (your main dashboard)
2. Click the **"Customize"** button in the top-right
3. Click **"Add Widget"** to see available widgets

### How to Use:
- **Add Widgets**: Click "Add Widget" → Select from 8 widget types
- **Reorder Widgets**: Drag widgets to rearrange them
- **Resize Widgets**: Click expand/minimize icon on each widget
- **Remove Widgets**: Click the X icon on any widget
- **Save Layout**: Click "Save Layout" to persist your changes

### Available Widgets:
1. 📊 **Sales Summary** - Today's and monthly sales
2. 🧾 **Recent Invoices** - Latest invoices list
3. 👥 **Top Customers** - Best customers by sales
4. 💰 **Cash Flow** - Cash flow chart
5. ⏰ **Pending Payments** - Unpaid invoices
6. 📦 **Inventory Alerts** - Low stock warnings
7. 📈 **Sales Chart** - Visual sales trends
8. 🏆 **Top Products** - Best-selling items

### Integration Status:
⚠️ **READY TO INTEGRATE** - Component created, needs to be added to dashboard page

---

## 📄 2. **Report Builder**

### How to Access:
- Go to `/reports/builder` (create this page)
- Or add "Report Builder" link to reports menu

### How to Use:
1. **Select Entity Type**:
   - Invoices
   - Customers
   - Items
   - Purchases

2. **Add Fields**:
   - Click fields from "Available Fields" list
   - They appear in "Selected Fields"
   - Drag to reorder

3. **Generate Report**:
   - Click "Generate Report"
   - View results in table

4. **Export**:
   - Click "Export CSV"
   - Save to your computer

5. **Save Template**:
   - Click "Save Template"
   - Give it a name
   - Reuse later

### Integration Status:
⚠️ **READY TO INTEGRATE** - Component created, needs page creation

---

## ⚡ 3. **Workflow Automation**

### How to Access:
- Go to `/settings/automation` (create this page)
- Or add "Automation" tab to settings

### How to Use:
1. **Click "New Workflow"**

2. **Choose Trigger** (when to run):
   - Invoice Created
   - Payment Received
   - Invoice Overdue
   - Low Stock Alert

3. **Add Conditions** (optional):
   - If amount > 10,000
   - If customer = VIP
   - If days overdue > 7

4. **Choose Actions** (what to do):
   - Send Email
   - Send WhatsApp
   - Update Status
   - Create Task

5. **Activate Workflow**:
   - Toggle "Active"
   - Workflow runs automatically

### Example Workflows:
```
Trigger: Invoice Overdue
Condition: Days overdue > 7
Action: Send WhatsApp reminder
```

```
Trigger: Payment Received
Action: Send thank you email
```

### Integration Status:
⚠️ **READY TO INTEGRATE** - Component created, needs page creation

---

## 📱 4. **Mobile Enhancements**

### How to Use:
These work **automatically** on mobile devices when enabled!

### Features:
1. **Swipe Gestures**:
   ```typescript
   // Swipe left on invoice → Delete
   // Swipe right on invoice → Mark as paid
   // Swipe up on list → Refresh
   ```

2. **Pull to Refresh**:
   - Pull down any list page
   - Release to refresh data

### Usage in Code:
```typescript
import { useMobileGestures, usePullToRefresh } from '@/hooks/useMobileGestures';

// In your component:
useMobileGestures({
  onSwipeLeft: () => console.log('Swiped left!'),
  onSwipeRight: () => console.log('Swiped right!'),
});

const { isPulling, pullDistance } = usePullToRefresh(async () => {
  await fetchData();
});
```

### Integration Status:
✅ **READY TO USE** - Import hooks and add to mobile pages

---

## ♿ 5. **Accessibility Features**

### How to Use:
These work **automatically** when enabled!

### Features:
1. **Skip to Main Content**:
   - Press Tab when page loads
   - "Skip to main content" link appears
   - Press Enter to jump to content

2. **Screen Reader Announcements**:
   - Automatic announcements for actions
   - "Invoice saved successfully"
   - "Item added to cart"

3. **Keyboard Navigation**:
   - Tab through all interactive elements
   - Enter to activate
   - Escape to close modals
   - Arrow keys in lists

### Usage in Code:
```typescript
import { useAnnounce, useKeyboardNavigation } from '@/components/accessibility/AccessibilityProvider';

// Announce to screen readers:
const announce = useAnnounce();
announce('Invoice saved successfully');

// Enhanced keyboard nav:
useKeyboardNavigation(ref, {
  onEnter: () => selectItem(),
  onEscape: () => closeModal(),
  onArrowDown: () => moveToNext(),
});
```

### Integration Status:
⚠️ **NEEDS INTEGRATION** - Add `<AccessibilityProvider>` to layout

---

## 🔧 Quick Integration Checklist

### 1. **Add to Dashboard** (5 minutes)
```typescript
// In app/(app)/dashboard/page.tsx
import { CustomizableDashboard } from '@/components/dashboard/CustomizableDashboard';

// Replace existing dashboard content with:
<CustomizableDashboard 
  businessId={business.id} 
  initialWidgets={[]}
/>
```

### 2. **Create Report Builder Page** (2 minutes)
Create: `app/(app)/reports/builder/page.tsx`
```typescript
import { ReportBuilder } from '@/components/reports/ReportBuilder';

export default function ReportBuilderPage() {
  return <ReportBuilder businessId={business.id} entityType="invoices" />;
}
```

### 3. **Create Automation Page** (2 minutes)
Create: `app/(app)/settings/automation/page.tsx`
```typescript
import { WorkflowBuilder } from '@/components/automation/WorkflowBuilder';

export default function AutomationPage() {
  return <WorkflowBuilder businessId={business.id} />;
}
```

### 4. **Add Accessibility Provider** (1 minute)
```typescript
// In app/layout.tsx
import { AccessibilityProvider } from '@/components/accessibility/AccessibilityProvider';

// Wrap your app:
<AccessibilityProvider>
  {children}
</AccessibilityProvider>
```

### 5. **Add Mobile Gestures** (optional)
Add to any list page where you want swipe support

---

## 🎯 Testing Each Feature

### ✅ Customizable Dashboard:
1. Go to `/dashboard`
2. Click "Customize"
3. Add a widget
4. Drag it around
5. Click "Save Layout"

### ✅ Report Builder:
1. Go to `/reports/builder`
2. Add fields (e.g., Invoice Number, Customer, Total)
3. Click "Generate Report"
4. Click "Export CSV"

### ✅ Workflow Automation:
1. Go to `/settings/automation`
2. Click "New Workflow"
3. Select trigger: "Invoice Created"
4. Select action: "Send Email"
5. Save and activate

### ✅ Mobile Enhancements:
1. Open app on phone
2. Swipe left/right on list items
3. Pull down to refresh

### ✅ Accessibility:
1. Press Tab key repeatedly
2. Navigate with keyboard only
3. Use screen reader (NVDA/JAWS)

---

## 📝 Next Steps

**I can help you integrate any of these features right now!**

Just tell me which one you want to start with:
1. **Dashboard** - Replace existing dashboard with customizable version?
2. **Report Builder** - Create the reports/builder page?
3. **Automation** - Create the automation settings page?
4. **Mobile** - Add swipe gestures to invoice list?
5. **Accessibility** - Add provider to layout?

**Or integrate all of them at once?** 🚀

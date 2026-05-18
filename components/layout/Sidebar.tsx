'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { 
  LayoutDashboard, 
  Users, 
  Package, 
  FileText, 
  ShoppingCart, 
  Receipt,
  BarChart3,
  Settings,
  Menu,
  ChevronLeft,
  ChevronDown,
  Truck,
  ArrowDownToLine,
  ArrowUpFromLine,
  MessageSquare,
  Lock,
  Wrench,
  Warehouse,
  Clock,
  DollarSign,
  Calendar,
  CheckSquare,
  Activity,
  UserCheck,
  Store,
  RefreshCw,
  Plus,
  Building,
  CreditCard,
  Palette,
  Zap,
  ArrowLeft,
  Shield,
  Database,
  Briefcase,
  Hash,
  Printer,
  Bluetooth,
  Sparkles,
  LayoutGrid,
  Smartphone,
  Trash2,
  Wallet,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useLayout } from '@/contexts/LayoutContext';
import { useAuth } from '@/contexts/AuthContext';
import { useLayoutData } from '@/contexts/LayoutDataContext';
import { WhatsAppAddonModal } from '@/components/subscription/WhatsAppAddonModal';
import { PromotionSidebar } from '@/components/promotions/PromotionSidebar';
import { UpgradePrompt } from '@/components/subscription/UpgradePrompt';
import { useCapabilityCheck } from '@/hooks/useCapability';
import { PRODUCT_TOUR_START_EVENT } from '@/components/onboarding/productTourShared';

/** Shown while sidebar waits for capability snapshot + warehouses + supplier + report map. */
function SidebarNavSkeleton({ collapsed }: { collapsed: boolean }) {
  return (
    <ul className="space-y-1 px-1" aria-busy="true" aria-label="Loading navigation">
      {Array.from({ length: 10 }).map((_, i) => (
        <li key={i} className="px-3 py-2.5">
          <div
            className={clsx(
              'h-4 bg-gray-200 dark:bg-slate-600 rounded animate-pulse',
              collapsed ? 'w-8 mx-auto' : 'w-[85%]'
            )}
          />
        </li>
      ))}
    </ul>
  );
}

export const Sidebar: React.FC = () => {
  const { sidebarCollapsed, toggleSidebar } = useLayout();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { business, user, branch: sessionBranch, branches, activeBranchCount } = useAuth();
  const { warehousesEnabled, snapshotLoaded, warehousesSettingLoaded } = useLayoutData();
  const { hasCapability } = useCapabilityCheck();

  const [showAddonModal, setShowAddonModal] = useState(false);
  const [selectedAddonType, setSelectedAddonType] = useState<'whatsapp_bot' | 'all'>('all');
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [lockedFeature, setLockedFeature] = useState<{ featureKey: string; featureName: string } | null>(null);
  const [isSupplier, setIsSupplier] = useState(false);
  const [reportRouteMap, setReportRouteMap] = useState<Record<string, string>>({});
  /** True after /api/admin/reports fetch completes (or offline skip). */
  const [reportsDefinitionsResolved, setReportsDefinitionsResolved] = useState(false);
  /** True after supplier dashboard check completes for current business. */
  const [supplierStatusResolved, setSupplierStatusResolved] = useState(false);
  const [userBranch, setUserBranch] = useState<{ name: string; code?: string } | null>(null);

  // Settings hub (`/settings`) uses main app nav; drill-in pages use this settings tree.
  const isSettingsPage = pathname !== '/settings' && Boolean(pathname?.startsWith('/settings/'));

  // Map sidebar items to their "create new" routes
  const getCreateRoute = (href: string, label: string): string | null => {
    if (!href) return null;
    
    // Map list pages to their create routes
    const routeMap: Record<string, string> = {
      '/customers': '/customers/new',
      '/invoices': '/invoices/new',
      '/estimates': '/invoices/new?type=proforma_invoice',
      '/sales-orders': '/sales-orders/new',
      '/delivery-challans': '/delivery-challans/new',
      '/work-orders': '/work-orders/new',
      '/credit-notes': '/credit-notes/new',
      '/debit-notes': '/debit-notes/new',
      '/suppliers': '/suppliers/new',
      '/purchases': '/purchases/new',
      '/purchase-orders': '/purchase-orders/new',
      '/purchase-returns': '/purchase-returns/new',
      '/expenses': '/expenses/new',
      '/items': '/items/new',
      '/warehouses': '/warehouses/new',
      '/employees': '/employees/new',
    };
    
    return routeMap[href] || null;
  };

  // Legacy route to feature mapping (fallback for routes not in Feature Registry)
  // NOTE: Uses Feature Registry IDs for consistency with snapshot.enabledFeatures
  const legacyRouteFeatureMap: Record<string, string> = {
    // Reports - Financial (Advanced)
    '/reports/profit-loss': 'reports_advanced',
    '/reports/profit-loss/pdf': 'reports_advanced',
    '/reports/balance-sheet': 'reports_advanced',
    '/reports/balance-sheet/pdf': 'reports_advanced',
    '/reports/cash-flow': 'reports_advanced',
    '/reports/cash-flow/pdf': 'reports_advanced',
    '/reports/trial-balance': 'reports_advanced',
    '/reports/trial-balance/pdf': 'reports_advanced',
    '/reports/aging/receivables': 'reports_advanced',
    '/reports/aging/payables': 'reports_advanced',
    '/reports/inter-branch-reconciliation': 'reports_advanced',
    '/bank/import': 'settings',
    '/bank/reconciliation': 'settings',

    // Reports - GST
    '/reports/gst/gstr1': 'reports_gst',
    '/reports/gst/gstr1/export/excel': 'reports_gst',
    '/reports/gst/gstr1/filings': 'reports_gst',
    '/reports/gst/gstr2b': 'reports_gst',
    '/reports/gst/gstr2b-reconciliation': 'reports_gst',
    '/reports/gst/reconciliation': 'reports_gst',
    '/reports/gst/gstr3b': 'reports_gst',
    '/reports/gst/gstr9': 'reports_gst',
    '/reports/sales/b2b-b2c': 'reports_gst',
    
    // Reports - Sales (Basic)
    '/reports/sales/summary': 'reports_basic',
    '/reports/sales/invoice-wise': 'reports_basic',
    '/reports/sales/item-wise': 'reports_basic',
    '/reports/sales/party-wise': 'reports_basic',
    '/reports/sales/tax-wise': 'reports_basic',
    '/reports/sales/payment-mode': 'reports_basic',
    '/reports/sales/discount': 'reports_basic',
    '/reports/sales/credit': 'reports_basic',
    '/reports/sales/cancelled': 'reports_basic',
    '/reports/sales/returns': 'reports_basic',
    '/reports/sales-summary': 'reports_basic',
    
    // Reports - Purchase (Basic)
    '/reports/purchase/summary': 'reports_basic',
    '/reports/purchase/invoice-wise': 'reports_basic',
    '/reports/purchase/supplier-wise': 'reports_basic',
    '/reports/purchase/returns': 'reports_basic',
    '/reports/purchase/credit': 'reports_basic',
    '/reports/purchase/tax-wise': 'reports_basic',
    '/reports/purchase-summary': 'reports_basic',
    
    // Reports - Stock (Mixed)
    '/reports/stock/summary': 'reports_basic',
    '/reports/stock/movement': 'reports_basic',
    '/reports/stock/low-stock': 'reports_basic',
    '/reports/stock/low-stock-warehouse': 'reports_basic',
    '/reports/stock/damaged': 'reports_basic',
    '/reports/stock/expired': 'reports_basic',
    '/reports/stock/closing-stock': 'reports_advanced',
    '/reports/stock/closing-stock/finalize': 'reports_advanced',
    '/reports/stock/valuation': 'reports_advanced',
    '/reports/stock/profit-margin': 'reports_advanced',
    '/reports/stock/purchase-vs-sales': 'reports_advanced',
    '/reports/stock-summary': 'reports_basic',
    
    // Reports - Party (Mixed)
    '/reports/party/statement': 'reports_basic',
    '/reports/party/ledger': 'reports_basic',
    '/reports/party/receivables': 'reports_basic',
    '/reports/party/payables': 'reports_basic',
    '/reports/party/advances': 'reports_basic',
    '/reports/party/ageing': 'reports_advanced',
    
    // Reports - Expense (Mixed)
    '/reports/expense/summary': 'reports_basic',
    '/reports/expense/category-wise': 'reports_basic',
    '/reports/expense/profit-loss': 'reports_advanced',
    '/reports/expense/monthly-profit': 'reports_advanced',
    '/reports/expense/expense-vs-sales': 'reports_advanced',
    '/reports/expense/cost-center': 'reports_advanced',
    
    // Reports - Other (Basic)
    '/reports/credit-risk': 'reports_basic',
    '/reports/deleted': 'reports_basic',
    '/reports/builder': 'report_builder',
    
    // NOTE: All other route mappings removed - now handled by capability-normalizer.ts
    // The normalizer maps canonical keys to Feature Registry IDs automatically
  };
  
  // Refs for scroll position preservation
  const navRef = useRef<HTMLElement>(null);
  const scrollPositionRef = useRef<number>(0);

  // Get business name and initials
  const businessName = business?.name || 'My Business';
  const getBusinessInitials = (name: string) => {
    const words = name.trim().split(/\s+/);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };
  const businessInitials = getBusinessInitials(businessName);

  /** Subtitle is for disambiguation; hide when the business only has one active branch. */
  const accessibleActiveBranchCount = (branches ?? []).filter((b) => b?.is_active !== false).length;
  const showBranchSubtitle =
    activeBranchCount > 1 ||
    (activeBranchCount === 0 && accessibleActiveBranchCount > 1);

  // Use branch data from AuthContext session (no extra API calls)
  useEffect(() => {
    if (sessionBranch) {
      setUserBranch({ name: sessionBranch.name, code: sessionBranch.branch_code });
    }
  }, [sessionBranch]);

  // Unified capability check — uses snapshot (last-known server state when offline)
  // NOTE: hasCapability now uses capability-normalizer.ts for all key normalization
  const hasFeature = (featureKey: string): boolean =>
    hasCapability(featureKey, 'view');

  const hasWhatsAppAddon = (): boolean =>
    // Both keys map to same registry ID via normalizer
    hasCapability('whatsapp_bot', 'view');

  // Route to feature key — only treat as locked when snapshot loaded and explicit denial
  // NOTE: hasCapability now uses capability-normalizer.ts internally for all key resolution
  const isRouteLocked = (href: string): { locked: boolean; featureKey?: string } => {
    if (!href) return { locked: false };
    // Never treat as locked while capability snapshot is loading
    if (!snapshotLoaded) return { locked: false };

    // Special case: Estimates/Quotations (proforma invoices)
    // Check both canonical key and registry ID (normalizer handles this)
    if (href.includes('type=proforma_invoice')) {
      const allowed = hasCapability('estimates_quotations', 'view');
      if (!allowed) return { locked: true, featureKey: 'sales_estimates' };
    }

    const basePath = href.split('?')[0];

    // Check database-defined report routes first
    const dbFeatureKey = reportRouteMap[basePath];
    if (dbFeatureKey) {
      return { locked: !hasCapability(dbFeatureKey, 'view'), featureKey: dbFeatureKey };
    }
    for (const [route, key] of Object.entries(reportRouteMap)) {
      if (basePath.startsWith(route)) {
        return { locked: !hasCapability(key, 'view'), featureKey: key };
      }
    }

    // Check legacy route mappings (reports only now)
    const featureKey = legacyRouteFeatureMap[basePath];
    if (featureKey) {
      return { locked: !hasCapability(featureKey, 'view'), featureKey };
    }
    for (const [route, key] of Object.entries(legacyRouteFeatureMap)) {
      if (basePath.startsWith(route)) {
        return { locked: !hasCapability(key, 'view'), featureKey: key };
      }
    }

    return { locked: false };
  };

  // Get feature display name
  const getFeatureName = (featureKey: string): string => {
    const names: Record<string, string> = {
      'template_customization': 'Template Customization',
      'recurring_invoices': 'Recurring Invoices',
      'email_invoicing': 'Email Invoicing',
      'estimates_quotations': 'Estimates & Quotations',
      'credit_notes': 'Credit Notes',
      'multi_branch': 'Multi-Branch',
      'purchase_management': 'Purchase Management',
      'expense_tracking': 'Expense Tracking',
      'supplier_management': 'Supplier Management',
      'reports_basic': 'Basic Reports',
      'reports_gst': 'GST Reports',
      'reports_advanced': 'Advanced Reports',
      'hr_employees': 'Employees (HR)',
      'hr_attendance': 'Attendance (HR)',
      'hr_payroll': 'Payroll (HR)',
      'hr_leaves': 'Leave Management (HR)',
    };
    return names[featureKey] || featureKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  // Handle locked item click
  const handleLockedItemClick = (e: React.MouseEvent, featureKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    setLockedFeature({ featureKey, featureName: getFeatureName(featureKey) });
    setShowUpgradeModal(true);
  };

  const refreshAddons = async () => {
    // Addons are managed by LayoutDataContext, no need to refresh here
    // This is kept for compatibility with existing code
  };

  // Load report definitions from database (re-run when business changes)
  useEffect(() => {
    let cancelled = false;
    setReportsDefinitionsResolved(false);

    async function loadReports() {
      try {
        if (!navigator.onLine) {
          setReportRouteMap({});
          return;
        }

        const response = await fetch('/api/admin/reports');
        if (response.ok) {
          const data = await response.json();

          if (data.reports && Object.keys(data.reports).length > 0) {
            const routeMap: Record<string, string> = {};
            Object.values(data.reports || {}).forEach((categoryReports: any) => {
              categoryReports.forEach((report: any) => {
                if (report.is_active) {
                  const featureKey = `reports_${report.category}`;
                  routeMap[report.route_path] = featureKey;
                }
              });
            });

            if (!cancelled) setReportRouteMap(routeMap);
          } else if (!cancelled) {
            setReportRouteMap({});
          }
        } else if (!cancelled) {
          setReportRouteMap({});
        }
      } catch (error) {
        console.debug('[Sidebar] Report definitions not available, using legacy mapping');
        if (!cancelled) setReportRouteMap({});
      } finally {
        if (!cancelled) setReportsDefinitionsResolved(true);
      }
    }

    void loadReports();
    return () => {
      cancelled = true;
    };
  }, [business?.id]);

  // Check if business is a supplier (has customers who granted access)
  useEffect(() => {
    let cancelled = false;
    setSupplierStatusResolved(false);

    const checkSupplierStatus = async () => {
      if (!business?.id) {
        setIsSupplier(false);
        setSupplierStatusResolved(true);
        return;
      }

      if (!navigator.onLine) {
        setIsSupplier(false);
        setSupplierStatusResolved(true);
        return;
      }

      try {
        const res = await fetch(`/api/suppliers/dashboard?supplier_business_id=${business.id}`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setIsSupplier((data.stats?.active_customers || 0) > 0);
          }
        }
      } catch (error) {
        console.debug('[Sidebar] Error checking supplier status (offline or unavailable):', error);
        if (!cancelled) setIsSupplier(false);
      } finally {
        if (!cancelled) setSupplierStatusResolved(true);
      }
    };

    void checkSupplierStatus();
    return () => {
      cancelled = true;
    };
  }, [business?.id]);

  // RBAC Visibility Check: A sidebar item is visible if and only if hasCapability(module) is true
  // Items without module are always visible (Dashboard, etc.)
  // Locked items are always visible (to show upgrade/enable prompt)
  const isItemVisible = (item: any): boolean => {
    if (!item.module) return true;

    if (item.module === 'warehouses' && warehousesEnabled) return true;

    if (item.isLocked || (item.featureKey && !hasFeature(item.featureKey))) {
      return true;
    }
    
    return hasCapability(item.module, 'view');
  };

  // Recursive filtering: Parent appears only if it has at least one visible child
  const filterNavItems = (items: any[]): any[] => {
    return items
      .map(item => {
        // If item has sub-items, filter them recursively first
        if (item.subItems) {
          const visibleChildren = filterNavItems(item.subItems);
          // Parent only visible if it has visible children
          if (visibleChildren.length === 0) return null;
          return { ...item, subItems: visibleChildren };
        }
        
        // Leaf item: check visibility directly
        return isItemVisible(item) ? item : null;
      })
      .filter((item): item is any => item !== null);
  };

  const navItems = useMemo(
    () => [
    // 1. DASHBOARD (Always first - most frequently used)
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, tourId: 'nav-dashboard' },
    
    // 2. SUPPLIER DASHBOARD (if business is a supplier)
    ...(isSupplier ? [
      {
        label: 'Supplier',
        icon: Store,
        collapsible: true,
        subItems: [
          { href: '/suppliers/dashboard', label: 'Supplier Dashboard' },
          { href: '/suppliers/requests', label: 'Requests to Fulfill' },
        ],
      }
    ] : []),
    
    // 3. SALES (Complete sales workflow)
    {
      label: 'Sales',
      icon: FileText,
      collapsible: true,
      tourId: 'nav-sales',
      subItems: [
        { href: '/customers', label: 'Customers', module: 'customers', tourId: 'nav-customers' },
        { href: '/invoices', label: 'All Invoices', module: 'invoices', tourId: 'nav-invoices' },
        { href: '/estimates', label: 'Quotations', module: 'invoices' },
        { href: '/sales-orders', label: 'Sales Orders', module: 'invoices' },
        { href: '/delivery-challans', label: 'Delivery Challans', module: 'invoices' },
        { href: '/work-orders', label: 'Work Orders', module: 'work_orders' },
        { href: '/credit-notes', label: 'Credit Notes', module: 'credit_notes' },
        { href: '/debit-notes', label: 'Debit Notes', module: 'debit_notes' },
      ],
    },
    
    // 4. PURCHASES (Complete purchase workflow)
    {
      label: 'Purchases',
      icon: ShoppingCart,
      collapsible: true,
      subItems: [
        { href: '/suppliers', label: 'Suppliers', module: 'purchases' },
        { href: '/suppliers/hub', label: 'Suppliers Hub', module: 'purchases' },
        { href: '/purchases', label: 'All Purchases', module: 'purchases' },
        { href: '/purchases/requests', label: 'Requests', module: 'purchases' },
        { href: '/purchase-orders', label: 'Purchase Orders', module: 'purchases' },
        { href: '/purchase-returns', label: 'Purchase Returns', module: 'purchases' },
        { href: '/expenses', label: 'Expenses', module: 'expenses' },
      ],
    },
    
    // 5. INVENTORY (Stock management)
    {
      label: 'Inventory',
      icon: Package,
      collapsible: true,
      tourId: 'nav-inventory',
      subItems: [
        { href: '/items', label: 'Items', module: 'items', tourId: 'nav-items' },
        { href: '/pricing/party-item', label: 'Party Pricing', module: 'items' },
        // Bulk barcode label printing — gated on the Phase-1 feature.
        ...(hasFeature('barcode_label_printing') ? [{
          href: '/items/barcodes',
          label: 'Print Labels',
          module: 'items',
          icon: Printer,
          featureKey: 'barcode_label_printing',
        }] : []),
        // Show Warehouses if enabled in settings
        // Lock it if feature is not in plan (user needs to upgrade)
        // Hide completely if disabled in settings
        ...(warehousesEnabled ? [{
          href: '/settings/warehouses', 
          label: 'Warehouses', 
          module: 'warehouses',
          icon: Warehouse,
          // Lock if feature not in plan
          isLocked: !hasFeature('multi_warehouse'),
          featureKey: 'settings_multi_warehouse'
        }] : []),
        // Show Stock Transfers if warehouses are enabled
        ...(warehousesEnabled ? [{
          href: '/stock-transfers', 
          label: 'Stock Transfers', 
          module: 'warehouse_transfer',
          icon: Truck,
          isLocked: !hasFeature('multi_warehouse'), // Lock if feature not in plan
          featureKey: 'settings_multi_warehouse'
        }] : []),
        { href: '/inventory-adjustments', label: 'Adjustments', module: 'items' },
        { href: '/reports/stock/summary', label: 'Stock Summary', module: 'reports' },
        { href: '/reports/stock/closing-stock', label: 'Closing Stock', module: 'reports' },
      ],
    },
    
    // 6. ACCOUNTING (All financial operations)
    {
      label: 'Accounting',
      icon: DollarSign,
      collapsible: true,
      subItems: [
        { href: '/accounts', label: 'Chart of Accounts', module: 'settings' },
        { href: '/journal-entries', label: 'Journal Entries', module: 'journal' },
        { href: '/bank/import', label: 'Bank import', module: 'settings' },
        { href: '/bank/reconciliation', label: 'Bank reconciliation', module: 'settings' },
        { href: '/ledger', label: 'Ledger', module: 'invoices' },
        { href: '/payments/in', label: 'Payments In', module: 'payments' },
        { href: '/payments/out', label: 'Payments Out', module: 'payments' },
        { href: '/payments/reconciliation', label: 'Reconciliation', module: 'payments', icon: RefreshCw },
        { href: '/provisions', label: 'Provisions', module: 'settings' },
        { href: '/tds', label: 'TDS/TCS', module: 'settings' },
      ],
    },
    
    // 7. REPORTS (All reports - simplified structure)
    {
      label: 'Reports',
      icon: BarChart3,
      collapsible: true,
      tourId: 'nav-reports',
      subItems: [
        { href: '/reports', label: 'Overview', module: 'reports' },
        { href: '/reports/deleted', label: 'Deleted items', module: 'reports', icon: Trash2 },
        { href: '/reports/builder', label: 'Custom Report Builder', module: 'reports', featureKey: 'report_builder', badge: 'NEW' },
        { href: '/reports/profit-loss', label: 'Profit & Loss', module: 'reports' },
        { href: '/reports/balance-sheet', label: 'Balance Sheet', module: 'reports' },
        { href: '/reports/cash-flow', label: 'Cash Flow', module: 'reports' },
        { href: '/reports/trial-balance', label: 'Trial Balance', module: 'reports' },
        { href: '/reports/aging/receivables', label: 'Receivables Aging', module: 'reports' },
        { href: '/reports/aging/payables', label: 'Payables Aging', module: 'reports' },
        { 
          label: 'Sales Reports',
          collapsible: true,
          subItems: [
            { href: '/reports/sales/summary', label: 'Summary', module: 'reports' },
            { href: '/reports/sales/invoice-wise', label: 'Invoice-wise', module: 'reports' },
            { href: '/reports/sales/item-wise', label: 'Item-wise', module: 'reports' },
            { href: '/reports/sales/party-wise', label: 'Party-wise', module: 'reports' },
            { href: '/reports/sales/tax-wise', label: 'Tax-wise', module: 'reports' },
            { href: '/reports/sales/payment-mode', label: 'Payment Mode', module: 'reports' },
            { href: '/reports/sales/discount', label: 'Discount Report', module: 'reports' },
            { href: '/reports/sales/credit', label: 'Credit Sales', module: 'reports' },
            { href: '/reports/sales/cancelled', label: 'Cancelled Bills', module: 'reports' },
            { href: '/reports/sales/returns', label: 'Sales Returns', module: 'reports' },
            { href: '/reports/sales/b2b-b2c', label: 'B2B vs B2C', module: 'reports' },
          ],
        },
        { 
          label: 'Purchase Reports',
          collapsible: true,
          subItems: [
            { href: '/reports/purchase/summary', label: 'Summary', module: 'reports' },
            { href: '/reports/purchase/invoice-wise', label: 'Invoice-wise', module: 'reports' },
            { href: '/reports/purchase/supplier-wise', label: 'Supplier-wise', module: 'reports' },
            { href: '/reports/purchase/returns', label: 'Purchase Returns', module: 'reports' },
            { href: '/reports/purchase/credit', label: 'Credit Purchases', module: 'reports' },
            { href: '/reports/purchase/tax-wise', label: 'Tax-wise', module: 'reports' },
          ],
        },
        { 
          label: 'GST Reports',
          collapsible: true,
          subItems: [
            { href: '/reports/gst/gstr1', label: 'GSTR-1', module: 'reports' },
            { href: '/reports/gst/gstr2b', label: 'GSTR-2B', module: 'reports' },
            { href: '/reports/gst/gstr2b-reconciliation', label: 'GSTR-2B Reconciliation', module: 'reports' },
            { href: '/reports/gst/reconciliation', label: 'GSTR-1 vs 3B', module: 'reports' },
            { href: '/reports/gst/gstr3b', label: 'GSTR-3B', module: 'reports' },
            { href: '/reports/gst/gstr9', label: 'GSTR-9', module: 'reports' },
          ],
        },
        ...(hasFeature('barcode_label_printing') ? [{
          href: '/reports/label-print-log',
          label: 'Label Printing Activity',
          module: 'reports',
          featureKey: 'barcode_label_printing',
        }] : []),
      ],
    },
    
    // 7. HR & EMPLOYEES (Separate section for HR functions) — gated by plan hr_* registry features
    {
      label: 'HR & Employees',
      icon: UserCheck,
      collapsible: true,
      subItems: [
        {
          href: '/employees',
          label: 'All Employees',
          module: 'employees',
          featureKey: 'hr_employees',
          isLocked: !hasFeature('hr_employees'),
        },
        {
          href: '/employees/new',
          label: 'Add Employee',
          module: 'employees',
          featureKey: 'hr_employees',
          isLocked: !hasFeature('hr_employees'),
        },
        {
          href: '/employees/attendance',
          label: 'Attendance',
          module: 'attendance',
          featureKey: 'hr_attendance',
          isLocked: !hasFeature('hr_attendance'),
        },
        {
          href: '/employees/leaves',
          label: 'Leaves',
          module: 'leave_requests',
          featureKey: 'hr_leaves',
          isLocked: !hasFeature('hr_leaves'),
        },
        {
          href: '/employees/salary/payments',
          label: 'Salary Payments',
          module: 'payroll',
          featureKey: 'hr_payroll',
          isLocked: !hasFeature('hr_payroll'),
        },
        {
          href: '/employees/commissions',
          label: 'Commissions',
          module: 'commissions',
          featureKey: 'hr_employees',
          isLocked: !hasFeature('hr_employees'),
        },
        {
          href: '/employees/performance',
          label: 'Performance',
          module: 'employees',
          featureKey: 'hr_employees',
          isLocked: !hasFeature('hr_employees'),
        },
        {
          href: '/employees/tasks',
          label: 'Tasks',
          module: 'employees',
          featureKey: 'hr_employees',
          isLocked: !hasFeature('hr_employees'),
        },
        { href: '/activity-logs', label: 'Activity Logs', module: 'settings' },
      ],
    },
    
    // 8. MORE (Tools, WhatsApp, Settings - less frequently used)
    {
      label: 'More',
      icon: Settings,
      collapsible: true,
      subItems: [
        { 
          label: 'Tools',
          collapsible: true,
          subItems: [
            { 
              href: '/tools/todo', 
              label: 'To Do List',
              featureKey: 'todo',
              isLocked: !hasFeature('todo')
            },
            { href: '/tools/hsn-finder', label: 'HSN/SAC Finder' },
            { href: '/tools/gst-calculator', label: 'GST Calculator' },
            { href: '/tools/tds-calculator', label: 'TDS Calculator' },
            { href: '/tools/discount-calculator', label: 'Discount Calculator' },
            { href: '/tools/price-margin-calculator', label: 'Price Calculator' },
            { href: '/tools/google-lead-extractor', label: 'Lead Extractor' },
            { href: '/tools/pan-validator', label: 'PAN Validator' },
            { href: '/tools/gstin-validator', label: 'GSTIN Validator' },
            { href: '/tools/interest-calculator', label: 'Interest Calculator' },
            { href: '/tools/emi-calculator', label: 'EMI Calculator' },
            { href: '/tools/currency-converter', label: 'Currency Converter' },
            { href: '/tools/invoice-number-generator', label: 'Invoice Generator' },
            { href: '/tools/image-size-reducer', label: 'Image Reducer' },
            { href: '/tools/image-background-remover', label: 'BG Remover' },
          ],
        },
        { 
          label: 'WhatsApp',
          collapsible: true,
          isLocked: !hasWhatsAppAddon(),
          featureKey: 'whatsapp_bot',
          subItems: [
            { 
              href: '/whatsapp/dashboard', 
              label: 'Dashboard',
              isLocked: !hasWhatsAppAddon(),
              featureKey: 'whatsapp_bot'
            },
            { 
              href: '/whatsapp/conversations', 
              label: 'Conversations',
              isLocked: !hasWhatsAppAddon(),
              featureKey: 'whatsapp_bot'
            },
            { 
              href: '/whatsapp/orders', 
              label: 'Order Verification',
              isLocked: !hasWhatsAppAddon(),
              featureKey: 'whatsapp_bot'
            },
            { 
              href: '/whatsapp/bot-rules', 
              label: 'Bot Rules',
              isLocked: !hasWhatsAppAddon(),
              featureKey: 'whatsapp_bot'
            },
            { 
              href: '/whatsapp/send-message', 
              label: 'Send Message',
              isLocked: !hasWhatsAppAddon(),
              featureKey: 'whatsapp_bot'
            },
            { 
              href: '/whatsapp/campaigns', 
              label: 'Campaigns',
              isLocked: !hasWhatsAppAddon(),
              featureKey: 'whatsapp_bot'
            },
            { 
              href: '/whatsapp/contacts', 
              label: 'Contacts',
              isLocked: !hasWhatsAppAddon(),
              featureKey: 'whatsapp_bot'
            },
            { 
              href: '/whatsapp/contacts/groups', 
              label: 'Contact Groups',
              isLocked: !hasWhatsAppAddon(),
              featureKey: 'whatsapp_bot'
            },
            { 
              href: '/whatsapp/group-extractor', 
              label: 'Group Extractor',
              isLocked: !hasWhatsAppAddon(),
              featureKey: 'whatsapp_bot'
            },
            { 
              href: '/whatsapp/unsubscribes', 
              label: 'Unsubscribes',
              isLocked: !hasWhatsAppAddon(),
              featureKey: 'whatsapp_bot'
            },
          ],
        },
        { href: '/settings/help', label: 'Help & Support', tourId: 'nav-help' },
        { href: '/settings', label: 'Settings', module: 'settings', tourId: 'nav-settings' },
      ],
    },
    ],
    [isSupplier, warehousesEnabled, snapshotLoaded, hasCapability, reportRouteMap]
  );

  // Settings navigation structure (shown when on settings pages)
  // Organized in two main sections: ORGANIZATION SETTINGS and MODULE SETTINGS
  const settingsNavItems = useMemo(() => {
    if (!isSettingsPage) return null;

    return [
      {
        label: 'ORGANIZATION SETTINGS',
        collapsible: true,
        subItems: [
          { href: '/settings/business', label: 'Organization', icon: Building, module: 'settings' },
          { href: '/settings/suppliers-directory', label: 'Suppliers directory', icon: Store, module: 'settings' },
          { href: '/settings/financial-years', label: 'Financial years', icon: Calendar, module: 'settings' },
          { href: '/settings/branches', label: 'Branches', icon: Building, module: 'settings' },
          { href: '/settings/warehouses', label: 'Warehouses', icon: Warehouse, module: 'settings' },
          {
            label: 'Users & Access',
            collapsible: true,
            subItems: [
              { href: '/settings/user-management', label: 'User Management', icon: Settings, module: 'settings' },
              { href: '/settings/users', label: 'Manage Users', icon: Users, module: 'settings' },
              { href: '/settings/roles', label: 'Manage Roles', icon: Shield, module: 'settings' },
              { href: '/settings/user-branches', label: 'User Branches', icon: Building, module: 'settings' },
              { href: '/settings/user-warehouses', label: 'User Warehouses', icon: Warehouse, module: 'settings' },
              { href: '/settings/activity', label: 'Activity Logs', icon: Activity, module: 'settings' },
            ]
          },
          {
            label: 'Taxes & Compliance',
            collapsible: true,
            subItems: [
              { href: '/settings/tax', label: 'Tax & GST Settings', icon: CreditCard, module: 'settings' },
              { href: '/settings/gst-config', label: 'GST Configuration', icon: CreditCard, module: 'settings' },
            ]
          },
          {
            label: 'Accounting',
            collapsible: true,
            subItems: [
              { href: '/settings/account-mappings', label: 'Account Mappings', icon: DollarSign, module: 'settings' },
              { href: '/settings/period-locks', label: 'Period Locks', icon: Lock, module: 'settings' },
            ]
          },
          {
            label: 'Subscription',
            collapsible: true,
            subItems: [
              { href: '/settings/subscription', label: 'Plan & Billing', icon: CreditCard, module: 'settings' },
            ],
          },
        ]
      },
      {
        label: 'MODULE SETTINGS',
        collapsible: true,
        subItems: [
          {
            label: 'General',
            collapsible: true,
            subItems: [
              { href: '/settings/features', label: 'UI Features', icon: Settings, module: 'settings' },
              { href: '/settings/backup', label: 'Backup & Restore', icon: Database, module: 'settings' },
            ]
          },
          {
            label: 'Customization',
            collapsible: true,
            subItems: [
              { href: '/settings/templates', label: 'Templates & Printing', icon: FileText, module: 'settings' },
              { href: '/settings/invoice', label: 'Invoice Design', icon: FileText, module: 'settings' },
              ...(hasFeature('barcode_label_templates') ? [{
                href: '/settings/label-templates',
                label: 'Label Templates',
                icon: Printer,
                module: 'settings',
                featureKey: 'barcode_label_templates',
              }] : []),
              ...(hasFeature('barcode_thermal_printer') ? [{
                href: '/settings/bluetooth-printer',
                label: 'Bluetooth Printer',
                icon: Bluetooth,
                module: 'settings',
                featureKey: 'barcode_thermal_printer',
              }] : []),
              { href: '/settings/number-series', label: 'Transaction Number Series', icon: Hash, module: 'settings' },
              { href: '/settings/signature', label: 'Digital Signature', icon: FileText, module: 'settings' },
            ]
          },
          {
            label: 'HR & Payroll',
            collapsible: true,
            subItems: [
              { href: '/settings/commission-rules', label: 'Commission Rules', icon: DollarSign, module: 'settings' },
              { href: '/settings/holidays', label: 'Holidays', icon: Calendar, module: 'settings' },
              { href: '/settings/leave-types', label: 'Leave Types', icon: Calendar, module: 'settings' },
              { href: '/settings/shifts', label: 'Shifts', icon: Clock, module: 'settings' },
            ]
          },
          {
            label: 'EXTENSIONS & MARKETPLACE',
            collapsible: true,
            subItems: [
              { href: '/settings/integrations', label: 'All integrations', icon: LayoutGrid, module: 'settings' },
              { href: '/settings/payments', label: 'Payment providers', icon: Wallet, module: 'settings' },
              {
                href: '/settings/integrations?category=whatsapp',
                label: 'WhatsApp',
                icon: MessageSquare,
                module: 'settings',
              },
              { href: '/settings/integrations?category=hr', label: 'HR', icon: Users, module: 'settings' },
              { href: '/settings/integrations?category=sms', label: 'SMS', icon: Smartphone, module: 'settings' },
              { href: '/settings/integrations?category=ai', label: 'AI', icon: Zap, module: 'settings' },
              { href: '/settings/integrations?category=crm', label: 'CRM', icon: Briefcase, module: 'settings' },
            ],
          },
        ]
      },
      // Back to main app link
      {
        href: '/dashboard',
        label: 'Back to Dashboard',
        icon: ArrowLeft,
      }
    ];
  }, [isSettingsPage, snapshotLoaded, hasCapability]);

  const sidebarReady = useMemo(
    () =>
      snapshotLoaded &&
      warehousesSettingLoaded &&
      supplierStatusResolved &&
      reportsDefinitionsResolved,
    [
      snapshotLoaded,
      warehousesSettingLoaded,
      supplierStatusResolved,
      reportsDefinitionsResolved,
    ]
  );

  // Filter navItems based on capability (only show items user can view)
  const visibleNavItems = useMemo((): any[] | null => {
    if (!sidebarReady) {
      return null;
    }

    if (isSettingsPage && settingsNavItems) {
      return filterNavItems(settingsNavItems);
    }
    return filterNavItems(navItems);
  }, [
    sidebarReady,
    navItems,
    isSettingsPage,
    settingsNavItems,
    hasCapability,
    snapshotLoaded,
    warehousesEnabled,
    warehousesSettingLoaded,
    isSupplier,
    supplierStatusResolved,
    reportsDefinitionsResolved,
    reportRouteMap,
  ]);

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  /** Product tour: expand Sales / Inventory / More so spotlight targets exist in the DOM */
  useEffect(() => {
    const onExpand = (e: Event) => {
      const labels = (e as CustomEvent<{ labels: string[] }>).detail?.labels;
      if (!labels?.length) return;
      setOpenSections((prev) => {
        const next = { ...prev };
        for (const label of labels) {
          next[label] = true;
        }
        return next;
      });
    };
    window.addEventListener('khatario-tour:expand', onExpand);
    return () => window.removeEventListener('khatario-tour:expand', onExpand);
  }, []);

  // Helper function to check if a navigation item is active
  const isItemActive = (href: string): boolean => {
    if (!href) return false;
    
    // Parse href to separate path and query
    const [path, queryString] = href.split('?');
    const pathMatch = pathname === path || pathname?.startsWith(path + '/');
    
    if (!pathMatch) return false;
    
    // If href has query parameters, check if they all match
    if (queryString) {
      const hrefParams = new URLSearchParams(queryString);
      // Check that all query params in href match current searchParams
      for (const [key, value] of hrefParams.entries()) {
        if (searchParams.get(key) !== value) {
          return false;
        }
      }
      // All query params match
      return true;
    } else {
      // If href has no query params, current URL should also have no query params
      // (e.g., /invoices/new should not match /invoices/new?type=proforma_invoice)
      return searchParams.toString() === '';
    }
  };

  // Helper function to check if any sub-item is active
  const isAnySubItemActive = (item: any): boolean => {
    if (!item.subItems) return false;
    
    // Check direct sub-items
    for (const subItem of item.subItems) {
      if (subItem.href && isItemActive(subItem.href)) {
        return true;
      }
      // Check nested sub-items
      if (subItem.subItems) {
        for (const nestedItem of subItem.subItems) {
          if (nestedItem.href && isItemActive(nestedItem.href)) {
            return true;
          }
        }
      }
    }
    return false;
  };

  // Auto-expand sections that contain the active route
  useEffect(() => {
    // Save current scroll position before state update
    if (navRef.current) {
      scrollPositionRef.current = navRef.current.scrollTop;
    }

    setOpenSections((prevOpenSections) => {
      if (!visibleNavItems || visibleNavItems.length === 0) {
        return prevOpenSections;
      }
      const newOpenSections: Record<string, boolean> = { ...prevOpenSections };
      let hasChanges = false;

      visibleNavItems.forEach((item) => {
        if (item.collapsible && item.subItems) {
          // Auto-expand if any sub-item is active
          if (isAnySubItemActive(item)) {
            if (!newOpenSections[item.label]) {
              newOpenSections[item.label] = true;
              hasChanges = true;
            }
          }
        }
      });
      
      return hasChanges ? newOpenSections : prevOpenSections;
    });
  }, [pathname, searchParams, visibleNavItems]);

  // Restore scroll position after render
  useEffect(() => {
    if (navRef.current && scrollPositionRef.current > 0) {
      // Use requestAnimationFrame to ensure DOM is updated
      requestAnimationFrame(() => {
        if (navRef.current) {
          navRef.current.scrollTop = scrollPositionRef.current;
        }
      });
    }
  }, [openSections]);

  const toggleSection = (label: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    // Save scroll position before state update
    if (navRef.current) {
      scrollPositionRef.current = navRef.current.scrollTop;
    }
    
    setOpenSections((prev) => ({
      ...prev,
      [label]: !prev[label],
    }));
    
    // Restore scroll position after state update
    requestAnimationFrame(() => {
      if (navRef.current) {
        navRef.current.scrollTop = scrollPositionRef.current;
      }
    });
  };

  const renderNavItems = (items: any[], isSubItem = false, topLevelParentLabel?: string): React.ReactNode => {
    return (
      <ul className={clsx(isSubItem ? 'ml-4 space-y-1' : 'space-y-1')}>
        {items.map((item, index) => {
          const Icon = item.icon;
          const isActive = item.href ? isItemActive(item.href) : false;
          const isSectionOpen = item.collapsible ? openSections[item.label] : true;
          const hasActiveSubItem = item.subItems ? isAnySubItemActive(item) : false;
          // If section is explicitly closed (false), respect that even with active sub-item
          // Otherwise, expand if section is open OR has active sub-item
          const isExpanded = openSections[item.label] === false 
            ? false 
            : (isSectionOpen || hasActiveSubItem);
          // Determine the top-level parent for nested items
          const currentTopLevelParent = isSubItem ? topLevelParentLabel : item.label;
          // Check if we're within an expanded section (check top-level parent)
          const isWithinExpanded = isSubItem && topLevelParentLabel && openSections[topLevelParentLabel];

          return (
            <li key={item.href || item.label + index}>
              {item.subItems ? (
                <>
                  {/* Entire item is clickable to toggle expand/collapse */}
                  <div 
                    className={clsx(
                      'flex items-center rounded-lg transition-all',
                      // Background color when expanded (top-level items)
                      isExpanded && !isSubItem && 'bg-slate-100/50 dark:bg-slate-800/35',
                      // Background color for sub-items when within any expanded section
                      isSubItem && isWithinExpanded && 'bg-gray-50/50 dark:bg-slate-800/45'
                    )}
                  >
                    {/* Main link - navigates to href if exists, but also toggles section */}
                    <Link
                      href={item.href || '#'}
                      prefetch={false}
                      data-tour={item.tourId}
                      onClick={(e) => {
                        // If sidebar is collapsed and item is collapsible, expand sidebar first
                        if (sidebarCollapsed && item.collapsible) {
                          e.preventDefault();
                          // Expand sidebar first
                          toggleSidebar();
                          // Then toggle section to show sub-items
                          // Use setTimeout to ensure sidebar expansion completes first
                          setTimeout(() => {
                            toggleSection(item.label, e);
                          }, 100);
                          return;
                        }
                        
                        // For collapsible items when sidebar is expanded:
                        // - If no href (or href is '#'): prevent navigation and toggle section only
                        // - If has valid href: allow Next.js Link to handle client-side navigation
                        if (item.collapsible && !sidebarCollapsed) {
                          const hasValidHref = item.href && item.href !== '#';
                          if (!hasValidHref) {
                            // No valid href: prevent default and toggle section only
                            e.preventDefault();
                            toggleSection(item.label, e);
                            return;
                          }
                          // Has valid href: allow navigation (don't prevent default)
                          // Next.js Link will handle client-side navigation
                          // Don't toggle section when navigating
                        }
                        
                        // For non-collapsible items: if no href, prevent navigation
                        if (!item.collapsible && (!item.href || item.href === '#')) {
                          e.preventDefault();
                        }
                      }}
                      className={clsx(
                        'flex items-center gap-3 flex-1 px-3 py-2.5 rounded-lg transition-all group relative cursor-pointer',
                        'hover:bg-slate-100 dark:hover:bg-slate-700/90',
                        isActive
                          ? 'bg-slate-100 dark:bg-slate-700 text-text-primary dark:text-white font-medium'
                          : 'text-text-secondary hover:text-text-primary dark:hover:text-white',
                        sidebarCollapsed && 'justify-center'
                      )}
                      title={sidebarCollapsed ? item.label : undefined}
                    >
                      {Icon && <Icon className={clsx('w-5 h-5 flex-shrink-0', isActive && 'text-primary-600 dark:text-white')} />}
                      {!sidebarCollapsed && <span>{item.label}</span>}
                      {sidebarCollapsed && (
                        <div className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-sm rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-50 pointer-events-none">
                          {item.label}
                        </div>
                      )}
                    </Link>
                    {/* Chevron icon - visual indicator only, not clickable separately */}
                    {!sidebarCollapsed && item.collapsible && (
                      <div className="px-2 flex items-center">
                        <ChevronDown className={clsx('w-4 h-4 transition-transform text-text-secondary', isExpanded ? 'rotate-180' : 'rotate-0')} />
                      </div>
                    )}
                  </div>
                  {isExpanded && item.subItems && (
                    <div className={clsx("overflow-hidden transition-all duration-300 ease-in-out mt-1", sidebarCollapsed ? "hidden" : "block")}>
                      {renderNavItems(item.subItems, true, currentTopLevelParent)}
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* Check if item is locked (either via isLocked prop or route mapping) */}
                  {(() => {
                    // Check for explicit lock (via isLocked prop or feature check)
                    const isExplicitlyLocked = item.isLocked === true || (item.featureKey && !hasFeature(item.featureKey));
                    
                    // Check route-based lock
                    const routeLock = item.href ? isRouteLocked(item.href) : { locked: false };
                    
                    const isLocked = isExplicitlyLocked || routeLock.locked;
                    const featureKey = item.featureKey || routeLock.featureKey;
                    
                    if (isLocked && featureKey) {
                      // Special handling for WhatsApp features - show addon modal
                      if (featureKey.includes('whatsapp') || featureKey === 'integration_whatsapp_bot' || featureKey === 'integration_whatsapp_manual') {
                        return (
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              setSelectedAddonType('whatsapp_bot');
                              setShowAddonModal(true);
                            }}
                            className={clsx(
                              'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group relative w-full text-left',
                              'hover:bg-yellow-50 dark:hover:bg-amber-950/35',
                              'text-text-secondary hover:text-text-primary',
                              'cursor-pointer opacity-75'
                            )}
                            title={sidebarCollapsed ? item.label : 'Upgrade to unlock'}
                          >
                            {Icon && <Icon className={clsx('w-5 h-5 flex-shrink-0')} />}
                            {!sidebarCollapsed && (
                              <>
                                <span>{item.label}</span>
                                <Lock className="w-4 h-4 ml-auto text-amber-500" />
                              </>
                            )}
                            {sidebarCollapsed && (
                              <div className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-sm rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-50 pointer-events-none">
                                {item.label}
                              </div>
                            )}
                          </button>
                        );
                      }
                      
                      // For other features - show upgrade modal
                      return (
                        <button
                          onClick={(e) => handleLockedItemClick(e, featureKey)}
                          className={clsx(
                            'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group relative w-full text-left',
                            'hover:bg-yellow-50 dark:hover:bg-amber-950/35',
                            'text-text-secondary hover:text-text-primary',
                            'cursor-pointer opacity-75'
                          )}
                          title={sidebarCollapsed ? item.label : 'Upgrade to unlock'}
                        >
                          {Icon && <Icon className={clsx('w-5 h-5 flex-shrink-0')} />}
                          {!sidebarCollapsed && (
                            <>
                              <span>{item.label}</span>
                              <Lock className="w-4 h-4 ml-auto text-amber-500" />
                            </>
                          )}
                          {sidebarCollapsed && (
                              <div className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-sm rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-50 pointer-events-none">
                                {item.label}
                              </div>
                            )}
                          </button>
                        );
                      }
                      
                      // Normal unlocked item
                      const createRoute = getCreateRoute(item.href!, item.label);
                      return (
                        <div 
                      className={clsx(
                            'rounded-lg transition-all group/item relative',
                        // Background color for sub-items when within any expanded section
                        isSubItem && isWithinExpanded && 'bg-gray-50/50 dark:bg-slate-800/45'
                      )}
                    >
                      <Link
                        href={item.href!}
                        prefetch={false}
                        data-tour={item.tourId}
                        className={clsx(
                          'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group relative',
                          'hover:bg-slate-100 dark:hover:bg-slate-700/90',
                          isActive
                            ? 'bg-slate-100 dark:bg-slate-700 text-text-primary dark:text-white font-medium'
                            : 'text-text-secondary hover:text-text-primary dark:hover:text-white',
                          sidebarCollapsed && 'justify-center'
                        )}
                        title={sidebarCollapsed ? item.label : undefined}
                      >
                        {Icon && <Icon className={clsx('w-5 h-5 flex-shrink-0', isActive && 'text-primary-600 dark:text-white')} />}
                            {!sidebarCollapsed && <span className="flex-1">{item.label}</span>}
                        {sidebarCollapsed && (
                          <div className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-sm rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-50 pointer-events-none">
                            {item.label}
                          </div>
                        )}
                      </Link>
                          {/* Hover reveal "New" link */}
                          {!sidebarCollapsed && createRoute && (
                            <Link
                              href={createRoute}
                              prefetch={false}
                              onClick={(e) => e.stopPropagation()}
                              className={clsx(
                                'absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 rounded text-sm font-medium',
                                'opacity-0 group-hover/item:opacity-100 transition-opacity',
                                'bg-primary-600 text-white hover:bg-primary-700',
                                'flex items-center gap-1'
                              )}
                              title={`Create New ${item.label}`}
                            >
                              <Plus className="w-3 h-3" />
                              <span>New</span>
                            </Link>
                          )}
                        </div>
                      );
                    })()}
                </>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <>
      {/* Sidebar */}
      <aside
        className={clsx(
          'fixed top-0 left-0 h-screen bg-surface border-r border-border z-50 flex flex-col text-base',
          'transition-all duration-300 ease-in-out hidden lg:flex',
          sidebarCollapsed ? 'w-16' : 'w-64'
        )}
      >
        {/* Header */}
        <div className={clsx("flex items-center p-4 border-b border-border flex-shrink-0", sidebarCollapsed ? "justify-center" : "justify-between")}>
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {business?.logo_url ? (
                <img 
                  src={business.logo_url} 
                  alt={businessName}
                  className="w-8 h-8 rounded-lg object-contain flex-shrink-0"
                />
              ) : (
                <div className="w-8 h-8 bg-primary-500 rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-bold text-sm">{businessInitials}</span>
                </div>
              )}
              <div className="flex flex-col min-w-0 flex-1">
                <span className="font-semibold text-lg truncate text-text-primary">{businessName}</span>
                {userBranch && showBranchSubtitle && (
                  <span className="text-sm text-text-muted truncate">
                    {userBranch.name}{userBranch.code && ` (${userBranch.code})`}
                  </span>
                )}
              </div>
            </div>
          )}
          {sidebarCollapsed && (
            business?.logo_url ? (
              <img 
                src={business.logo_url} 
                alt={businessName}
                className="w-8 h-8 rounded-lg object-contain mb-1"
              />
            ) : (
              <div className="w-8 h-8 bg-primary-500 rounded-lg flex items-center justify-center mb-1">
                <span className="text-white font-bold text-sm">{businessInitials.substring(0, 1)}</span>
              </div>
            )
          )}
          
          <button
            onClick={toggleSidebar}
            className={clsx("p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700/90 rounded-lg transition-colors text-text-secondary", !sidebarCollapsed && "ml-2")}
          >
             {sidebarCollapsed ? null : <ChevronLeft className="w-5 h-5" />}
          </button>
        </div>

        {/* Navigation - Scrollable area */}
        <nav 
          ref={navRef}
          className="p-2 flex-1 overflow-y-auto overflow-x-hidden min-h-0"
          onWheel={(e) => {
            e.stopPropagation();
          }}
          onScroll={(e) => {
            // Update scroll position ref as user scrolls
            scrollPositionRef.current = e.currentTarget.scrollTop;
          }}
        >
          {!visibleNavItems ? (
            <SidebarNavSkeleton collapsed={sidebarCollapsed} />
          ) : (
            renderNavItems(visibleNavItems)
          )}
        </nav>

        {/* Pinned above footer: not inside scrollable nav so it stays visible while menu scrolls */}
        <div className="flex-shrink-0 z-10 border-t border-border/60 bg-surface/98 backdrop-blur-sm shadow-[0_-4px_12px_-2px_rgba(0,0,0,0.06)] dark:shadow-[0_-4px_12px_-2px_rgba(0,0,0,0.3)]">
          <PromotionSidebar collapsed={sidebarCollapsed} />
        </div>

        <div
          className="flex-shrink-0 border-t border-border p-2 bg-surface/95 backdrop-blur-sm"
          data-tour="nav-sidebar-tour-button"
        >
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent(PRODUCT_TOUR_START_EVENT, {
                  detail: { chainBusinessProfile: true },
                })
              )
            }
            className={clsx(
              'w-full flex items-center gap-2 rounded-lg px-3 py-2.5 text-base font-medium transition-colors',
              'text-text-primary bg-slate-100 hover:bg-slate-200 dark:text-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800/80',
              'border border-border dark:border-slate-600',
              'shadow-sm',
              sidebarCollapsed && 'justify-center px-2'
            )}
            title={
              sidebarCollapsed
                ? 'Guided tour: main menu, then business profile'
                : undefined
            }
          >
            <Sparkles className="w-4 h-4 flex-shrink-0 text-primary-600 dark:text-primary-500" aria-hidden />
            {!sidebarCollapsed && (
              <span className="truncate text-left leading-tight">Menu & profile tour</span>
            )}
          </button>
        </div>
      </aside>

      {/* Add-on Upgrade Modal */}
      {showAddonModal && (
        <WhatsAppAddonModal
          addonType={selectedAddonType}
          onClose={() => {
            setShowAddonModal(false);
          }}
          onPurchaseSuccess={() => {
            setShowAddonModal(false);
          }}
        />
      )}

      {/* Feature Upgrade Modal */}
      {showUpgradeModal && lockedFeature && (
        <UpgradePrompt
          limitType="feature"
          featureKey={lockedFeature.featureKey}
          featureName={lockedFeature.featureName}
          onClose={() => {
            setShowUpgradeModal(false);
            setLockedFeature(null);
            setSelectedAddonType('all');
          }}
          onPurchaseSuccess={async () => {
            // Refresh addons to update the feature check
            await refreshAddons?.();
            // Small delay to ensure state updates before reload
            setTimeout(() => {
              window.location.reload();
            }, 500);
          }}
        />
      )}
    </>
  );
};

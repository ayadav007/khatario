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
  ChevronLeft,
  ChevronRight,
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
  Mail,
  ClipboardList,
  HelpCircle,
  SlidersHorizontal,
  Bell,
  Bot,
  Inbox,
  ShoppingBag,
  Search,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { useLayout } from '@/contexts/LayoutContext';
import { useAuth } from '@/contexts/AuthContext';
import { useLayoutData, useShellLayoutSettings } from '@/contexts/LayoutDataContext';
import { WhatsAppAddonModal } from '@/components/subscription/WhatsAppAddonModal';
import { PromotionSidebar } from '@/components/promotions/PromotionSidebar';
import { UpgradePrompt } from '@/components/subscription/UpgradePrompt';
import { useCapabilityCheck } from '@/hooks/useCapability';
import { PRODUCT_TOUR_START_EVENT } from '@/components/onboarding/productTourShared';
import { COMMAND_PALETTE_OPEN_EVENT } from '@/hooks/useCommandPalette';
import {
  isNavSectionVisible,
} from '@/lib/platform-modules';
import { buildFlatSettingsGroups } from '@/lib/settings-module-registry';
import {
  getHrNavSectionTitle,
  getVisibleHrAdminNavItems,
  HR_LITE_NAV_SECTION_TITLE,
  HR_NAV_SECTION_TITLE,
} from '@/lib/hr/hr-admin-nav';
import { SALES_NAV_ITEMS } from '@/lib/navigation/sales-nav-items';
import {
  CONNECT_DASHBOARD_ITEM,
  CONNECT_NAV_FEATURE_KEY,
  CONNECT_NAV_GROUPS,
  CONNECT_SETTINGS_ITEM,
} from '@/lib/navigation/connect-nav-items';
import { featureIdForPath, isSupplierHubHref } from '@/lib/subscription/plan-path-gate';
import { collectNavHrefs, pickActiveNavHref } from '@/lib/navigation/nav-active';

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

/** Section colour of a top-level tile; the colours live in globals.css (`.kh-tone-*`). */
type NavTone =
  | 'home'
  | 'supplier'
  | 'sales'
  | 'purchases'
  | 'inventory'
  | 'accounting'
  | 'reports'
  | 'staff'
  | 'connect'
  | 'more';

function NavTile({ icon: Icon, tone }: { icon: LucideIcon; tone?: NavTone }) {
  return (
    <span
      className={clsx(
        'kh-tile w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0',
        `kh-tone-${tone ?? 'more'}`
      )}
    >
      <Icon className="w-4 h-4" strokeWidth={2} aria-hidden />
    </span>
  );
}

export const Sidebar = React.memo(function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useLayout();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const [locationHash, setLocationHash] = useState('');

  useEffect(() => {
    const read = () => setLocationHash(window.location.hash.replace(/^#/, ''));
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [pathname]);
  const { business, user, isPrimaryAdmin, branch: sessionBranch, branches, activeBranchCount, platformSession, hasPlatformModule } = useAuth();
  const enabledModules = platformSession?.enabledModules ?? ['billing'];
  const homeHref = platformSession?.defaultHomePath ?? '/dashboard';
  const { warehousesEnabled, snapshotLoaded, warehousesSettingLoaded } = useShellLayoutSettings();
  const { supplierHubVisible } = useLayoutData();
  const { hasCapability, checkCapability } = useCapabilityCheck();

  // Role grants the action; a plan-only denial still counts so the item can render as locked.
  const roleAllowsModule = (module: string, action: string): boolean => {
    const result = checkCapability(module, action);
    return result.allowed || result.denialReason === 'FEATURE_NOT_IN_PLAN';
  };

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

  // Map sidebar items to their "create new" routes; hidden unless the role may create in that module.
  const getCreateRoute = (item: { href?: string; module?: string }): string | null => {
    const href = item.href;
    if (!href || !item.module || !hasCapability(item.module, 'create')) return null;
    
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
    '/bank/import': 'accounting_bank',
    '/bank/reconciliation': 'accounting_bank',
    '/accounts': 'accounting_chart',
    '/provisions': 'accounting_provisions',
    '/tds': 'accounting_tds',
    '/delivery-challans': 'sales_delivery_challans',
    '/work-orders': 'sales_work_orders',
    '/settings/online-store': 'advanced_online_store',
    '/settings/automation': 'workflow_automation',

    // Reports - GST
    '/reports/gst/gstr1': 'reports_gst',
    '/reports/gst/gstr1/export/excel': 'reports_gst',
    '/reports/gst/gstr1/filings': 'reports_gst',
    '/reports/gst/gstr2b': 'reports_gst',
    '/reports/gst/gstr2b-reconciliation': 'reports_gst',
    '/reports/gst/reconciliation': 'reports_gst',
    '/reports/gst/gstr3b': 'reports_gst',
    '/reports/gst/cash-ledger': 'reports_gst',
    '/reports/gst/gstr9': 'reports_gst',
    '/reports/gst/compliance': 'reports_gst',
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
    '/reports/purchase/item-wise': 'reports_basic',
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
    '/reports/stock/third-party': 'reports_basic',
    '/reports/stock/quantitative': 'reports_basic',
    '/reports/stock/bank-statement': 'reports_basic',
    '/reports/stock/job-work': 'reports_basic',
    '/reports/stock/expired': 'reports_basic',
    '/reports/stock/closing-stock': 'reports_advanced',
    '/reports/stock/closing-stock/finalize': 'reports_advanced',
    '/reports/stock/valuation': 'reports_advanced',
    '/reports/stock/fifo-lots': 'reports_advanced',
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
    if (!sessionBranch) {
      setUserBranch((prev) => (prev === null ? prev : null));
      return;
    }
    const name = sessionBranch.name;
    const code = sessionBranch.branch_code;
    setUserBranch((prev) => {
      if (prev?.name === name && prev?.code === code) return prev;
      return { name, code };
    });
  }, [sessionBranch?.id, sessionBranch?.name, sessionBranch?.branch_code]);

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
    const pathFeature = featureIdForPath(basePath);
    if (pathFeature) {
      return { locked: !hasCapability(pathFeature, 'view'), featureKey: pathFeature };
    }

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
      'purchase_supplier_hub': 'Supplier Hub',
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

  // Items without a module are always visible (Dashboard, etc.). Otherwise the role must allow view;
  // a plan-locked item is then still shown so the user sees the upgrade prompt.
  const isItemVisible = (item: any): boolean =>
    !item.module || roleAllowsModule(item.module, 'view');

  // Recursive filtering: Parent appears only if it has at least one visible child
  const filterNavItems = (items: any[]): any[] => {
    return items
      .map(item => {
        if (item.label && !isNavSectionVisible(item.label, enabledModules)) {
          return null;
        }
        if (item.label === 'Supplier' && !hasPlatformModule('billing')) {
          return null;
        }
        if (
          (item.label === HR_NAV_SECTION_TITLE ||
            item.label === HR_LITE_NAV_SECTION_TITLE ||
            item.label === 'HR & Payroll') &&
          !hasPlatformModule('hr')
        ) {
          return null;
        }
        if (item.label === 'Connect' && !hasPlatformModule('connect')) {
          return null;
        }
        if (supplierHubVisible !== true && item.href && isSupplierHubHref(item.href)) {
          return null;
        }

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
    { href: homeHref, label: 'Dashboard', icon: LayoutDashboard, tone: 'home', tourId: 'nav-dashboard' },
    
    // 2. SUPPLIER DASHBOARD (if business is a supplier)
    ...(isSupplier ? [
      {
        label: 'Supplier',
        icon: Store,
        tone: 'supplier',
        group: 'Work',
        collapsible: true,
        subItems: [
          { href: '/suppliers/hub', label: 'Supplier Hub' },
          { href: '/suppliers/dashboard', label: 'Supplier Dashboard' },
          { href: '/suppliers/catalog', label: 'My Catalog' },
          { href: '/supply-orders?role=vendor', label: 'Orders from Buyers' },
        ],
      }
    ] : []),
    
    // 3. SALES (Complete sales workflow)
    {
      label: 'Sales',
      icon: FileText,
      tone: 'sales',
      group: 'Work',
      collapsible: true,
      tourId: 'nav-sales',
      subItems: [
        ...SALES_NAV_ITEMS.map((item) =>
          item.href === '/customers'
            ? { ...item, tourId: 'nav-customers' }
            : item.href === '/invoices'
              ? { ...item, tourId: 'nav-invoices' }
              : item
        ),
      ],
    },
    
    // 4. PURCHASES (Complete purchase workflow)
    {
      label: 'Purchases',
      icon: ShoppingCart,
      tone: 'purchases',
      group: 'Work',
      collapsible: true,
      subItems: [
        { href: '/suppliers', label: 'Suppliers', module: 'purchases' },
        { href: '/suppliers/hub', label: 'Supplier Hub', module: 'purchases' },
        { href: '/purchases', label: 'All Purchases', module: 'purchases' },
        { href: '/purchases/order-list', label: 'Order List', module: 'purchases' },
        { href: '/purchase-orders', label: 'Purchase Orders', module: 'purchases' },
        { href: '/purchase-returns', label: 'Purchase Returns', module: 'purchases' },
        { href: '/expenses', label: 'Expenses', module: 'expenses' },
      ],
    },
    
    // 5. INVENTORY (Stock management)
    {
      label: 'Inventory',
      icon: Package,
      tone: 'inventory',
      group: 'Work',
      collapsible: true,
      tourId: 'nav-inventory',
      subItems: [
        { href: '/items', label: 'Items', module: 'items', tourId: 'nav-items' },
        { href: '/pricing/party-item', label: 'Party Pricing', module: 'items' },
        { href: '/pricing/levels', label: 'Price Levels', module: 'items' },
        { href: '/pricing/schemes', label: 'Schemes', module: 'items' },
        { href: '/pricing/price-list', label: 'Price List', module: 'items' },
        {
          href: '/items/barcodes',
          label: 'Print Labels',
          module: 'items',
          icon: Printer,
          featureKey: 'barcode_label_printing',
          isLocked: !hasFeature('barcode_label_printing'),
        },
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
        { href: '/stock-counts', label: 'Stock Counts', module: 'items' },
        { href: '/stock-holds', label: "Held & Others' Goods", module: 'items' },
        { href: '/manufacturing', label: 'Manufacturing', module: 'items' },
        { href: '/insurance-claims', label: 'Insurance Claims', module: 'items' },
        { href: '/items/cleanup', label: 'Units & Duplicates', module: 'items' },
        { href: '/reports/stock/third-party', label: 'Stock with Parties', module: 'reports' },
        { href: '/reports/stock/summary', label: 'Stock Summary', module: 'reports' },
        { href: '/reports/stock/closing-stock', label: 'Closing Stock', module: 'reports' },
      ],
    },
    
    // 6. ACCOUNTING (All financial operations)
    {
      label: 'Accounting',
      icon: DollarSign,
      tone: 'accounting',
      group: 'Money',
      collapsible: true,
      subItems: [
        { href: '/accounts', label: 'Chart of Accounts', module: 'settings', featureKey: 'accounting_chart' },
        { href: '/journal-entries', label: 'Journal Entries', module: 'journal' },
        { href: '/contra', label: 'Contra (cash / bank)', module: 'journal' },
        { href: '/advances', label: 'Advances', module: 'journal' },
        { href: '/recurring-invoices', label: 'Recurring invoices', module: 'invoices' },
        { href: '/fixed-assets', label: 'Fixed assets', module: 'journal' },
        { href: '/bank/import', label: 'Bank import', module: 'settings', featureKey: 'accounting_bank' },
        { href: '/bank/reconciliation', label: 'Bank reconciliation', module: 'settings', featureKey: 'accounting_bank' },
        { href: '/ledger', label: 'Ledger', module: 'invoices' },
        { href: '/payments/in', label: 'Payments In', module: 'payments' },
        { href: '/payments/out', label: 'Payments Out', module: 'payments' },
        { href: '/payments/reconciliation', label: 'Reconciliation', module: 'payments', icon: RefreshCw },
        { href: '/provisions', label: 'Provisions', module: 'settings', featureKey: 'accounting_provisions' },
        { href: '/tds', label: 'TDS/TCS', module: 'settings', featureKey: 'accounting_tds' },
      ],
    },
    
    // 7. REPORTS (All reports - simplified structure)
    {
      label: 'Reports',
      icon: BarChart3,
      tone: 'reports',
      group: 'Money',
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
            { href: '/reports/purchase/item-wise', label: 'Item-wise', module: 'reports' },
            { href: '/reports/purchase/returns', label: 'Purchase Returns', module: 'reports' },
            { href: '/reports/purchase/credit', label: 'Credit Purchases', module: 'reports' },
            { href: '/reports/purchase/tax-wise', label: 'Tax-wise', module: 'reports' },
          ],
        },
        { 
          label: 'GST Reports',
          collapsible: true,
          subItems: [
            { href: '/reports/gst/compliance', label: 'GST Alerts', module: 'reports' },
            { href: '/reports/gst/gstr1', label: 'GSTR-1', module: 'reports' },
            { href: '/reports/gst/gstr2b', label: 'GSTR-2B', module: 'reports' },
            { href: '/reports/gst/gstr2b-reconciliation', label: 'GSTR-2B Reconciliation', module: 'reports' },
            { href: '/reports/gst/reconciliation', label: 'GSTR-1 vs 3B', module: 'reports' },
            { href: '/reports/gst/gstr3b', label: 'GSTR-3B', module: 'reports' },
            { href: '/reports/gst/cash-ledger', label: 'GST Cash Ledger', module: 'reports' },
            { href: '/reports/gst/gstr9', label: 'GSTR-9', module: 'reports' },
            { href: '/eway-bills', label: 'E-way Bills', module: 'reports', featureKey: 'eway_bill' },
          ],
        },
        {
          label: 'Stock & Audit',
          collapsible: true,
          subItems: [
            { href: '/reports/stock/quantitative', label: 'Quantity Details (3CD)', module: 'reports' },
            { href: '/reports/stock/bank-statement', label: 'Bank Stock Statement', module: 'reports' },
            { href: '/reports/stock/job-work', label: 'Job Work (ITC-04)', module: 'reports' },
            { href: '/reports/stock/third-party', label: 'Stock with Parties', module: 'reports' },
          ],
        },
        {
          href: '/reports/label-print-log',
          label: 'Label Printing Activity',
          module: 'reports',
          featureKey: 'barcode_label_printing',
          isLocked: !hasFeature('barcode_label_printing'),
        },
      ],
    },
    
    // 7. Staff / HR — single source: lib/hr/hr-admin-nav.ts (Lite vs Full)
    {
      label: getHrNavSectionTitle(hasFeature),
      icon: UserCheck,
      tone: 'staff',
      group: 'Team',
      collapsible: true,
      subItems: getVisibleHrAdminNavItems(hasFeature).map((item) => ({
        href: item.href,
        label: item.label,
        module: item.module,
        featureKey: item.featureKey,
        isLocked: item.featureKey ? !hasFeature(item.featureKey) : false,
      })),
    },

    // Connect is a product, same rank as Sales and HR — not a tool under More.
    ...(hasPlatformModule('connect')
      ? [
          {
            label: 'Connect',
            icon: MessageSquare,
            tone: 'connect',
            group: 'Team',
            collapsible: true,
            subItems: [
              {
                ...CONNECT_DASHBOARD_ITEM,
                isLocked: !hasWhatsAppAddon(),
                featureKey: CONNECT_NAV_FEATURE_KEY,
              },
              ...CONNECT_NAV_GROUPS.map((group) => ({
                label: group.label,
                collapsible: true,
                subItems: group.items.map((item) => ({
                  ...item,
                  isLocked: !hasWhatsAppAddon(),
                  featureKey: CONNECT_NAV_FEATURE_KEY,
                })),
              })),
              CONNECT_SETTINGS_ITEM,
            ],
          },
        ]
      : []),

    // Tools, billing-only WhatsApp settings, and Settings.
    {
      label: 'More',
      icon: Settings,
      tone: 'more',
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
            {
              href: '/tools/whatsapp-group-extractor',
              label: 'Group Extractor',
              featureKey: 'whatsapp_bot',
              isLocked: !hasWhatsAppAddon(),
            },
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
        ...(hasPlatformModule('billing') && !hasPlatformModule('connect')
          ? [
              {
                href: '/settings/whatsapp',
                label: 'WhatsApp',
                icon: MessageSquare,
              },
            ]
          : []),
        { href: '/settings/help', label: 'Help & Support', tourId: 'nav-help' },
        { href: '/settings', label: 'Settings', module: 'settings', tourId: 'nav-settings' },
      ],
    },
    ],
    [isSupplier, warehousesEnabled, snapshotLoaded, hasCapability, reportRouteMap, homeHref, hasPlatformModule]
  );

  const sectionKeyOf = (item: { sectionKey?: string; label?: string }) =>
    item.sectionKey || item.label || '';

  // Settings navigation: one collapsible level (shared groups once, then product groups).
  const settingsNavModel = useMemo(() => {
    if (!isSettingsPage) return null;

    const groupIcons: Record<string, typeof Settings> = {
      account: Building,
      team: Users,
      plan: CreditCard,
      'billing-setup': Building,
      accounting: DollarSign,
      'sales-billing': FileText,
      'online-store': ShoppingBag,
      'inventory-items': Package,
      'billing-general': Settings,
      'hr-organization': Building,
      'hr-time-attendance': Clock,
      'hr-leave': Calendar,
      'hr-payroll': DollarSign,
      'hr-hiring': UserCheck,
      'hr-employee-portal': Users,
      whatsapp: MessageSquare,
      integrations: LayoutGrid,
      system: Palette,
      help: HelpCircle,
    };

    const groupTones: Record<string, NavTone> = {
      account: 'supplier',
      team: 'staff',
      plan: 'inventory',
      'billing-setup': 'purchases',
      accounting: 'accounting',
      'sales-billing': 'sales',
      'online-store': 'connect',
      'inventory-items': 'inventory',
      'hr-organization': 'staff',
      'hr-time-attendance': 'staff',
      'hr-leave': 'staff',
      'hr-payroll': 'staff',
      'hr-hiring': 'staff',
      'hr-employee-portal': 'staff',
      whatsapp: 'connect',
      integrations: 'reports',
    };

    const linkIcons: Record<string, typeof Settings> = {
      '/settings/business': Building,
      '/settings/branches': Building,
      '/settings/warehouses': Warehouse,
      '/settings/suppliers-directory': Store,
      '/settings/financial-years': Calendar,
      '/settings/products': LayoutGrid,
      '/settings/subscription': CreditCard,
      '/settings/user-management': Settings,
      '/settings/users': Users,
      '/settings/roles': Shield,
      '/settings/user-branches': Building,
      '/settings/user-warehouses': Warehouse,
      '/settings/activity': Activity,
      '/settings/account-mappings': DollarSign,
      '/settings/period-locks': Lock,
      '/settings/templates': FileText,
      '/settings/bluetooth-printer': Bluetooth,
      '/settings/custom-fields': FileText,
      '/settings/number-series': Hash,
      '/settings/business#bp-features': Package,
      '/settings/label-templates': Printer,
      '/settings/features': Palette,
      '/settings/backup': Database,
      '/settings/offline-sync': RefreshCw,
      '/settings/automation': Settings,
      '/settings/integrations': LayoutGrid,
      '/settings/email': Mail,
      '/settings/payments': Wallet,
      '/settings/integrations?category=sms': Smartphone,
      '/settings/help': HelpCircle,
      '/settings/help/how-to': HelpCircle,
      '/settings/departments': Building,
      '/settings/payroll': DollarSign,
      '/settings/hiring': UserCheck,
      '/settings/employee-portal': Users,
      '/settings/commission-rules': DollarSign,
      '/settings/holidays': Calendar,
      '/settings/leave-types': Calendar,
      '/settings/shifts': Clock,
      '/settings/attendance-policy': Clock,
      '/settings/hr-approval': CheckSquare,
      '/settings/onboarding-templates': ClipboardList,
      '/settings/offer-letter': FileText,
      '/settings/whatsapp': Smartphone,
      '/settings/whatsapp/templates': FileText,
      '/settings/whatsapp/notifications': Bell,
      '/settings/whatsapp/inbox': Inbox,
      '/settings/whatsapp/ai-agent': Bot,
      '/settings/whatsapp/shop': ShoppingBag,
      '/settings/online-store': ShoppingBag,
      '/settings/online-store/orders': ShoppingBag,
      '/settings/online-store/enquiries': MessageSquare,
      '/settings/holiday-lists': Calendar,
      '/settings/integrations?category=crm': Briefcase,
      '/items/categories': Package,
      '/settings/business#pos-mode': FileText,
    };

    const groups = buildFlatSettingsGroups(enabledModules, {
      hasFeature,
      supplierHubVisible: supplierHubVisible === true,
    });

    const items = groups.map((group) => ({
      label: group.title,
      sectionKey: `settings:${group.groupId}`,
      collapsible: true,
      icon: groupIcons[group.groupId] ?? Settings,
      tone: groupTones[group.groupId] ?? 'more',
      subItems: group.links.map((link) => {
        const path = link.href.split('#')[0].split('?')[0];
        return {
          href: link.href,
          label: link.label,
          icon:
            linkIcons[link.href] ??
            linkIcons[path] ??
            groupIcons[group.groupId] ??
            Settings,
          module: link.module,
          featureKey: link.featureKey,
        };
      }),
    }));

    return [
      ...items,
      {
        href: '/settings',
        label: 'All settings',
        icon: SlidersHorizontal,
      },
      {
        href: homeHref,
        label: 'Back to Dashboard',
        icon: ArrowLeft,
      },
    ];
  }, [isSettingsPage, enabledModules, hasFeature, homeHref, supplierHubVisible]);

  const settingsNavItems = settingsNavModel;

  // Capability snapshot and warehouse setting decide which rows exist.
  // Supplier status and report definitions fill in after the menu is visible.
  const sidebarReady = useMemo(
    () => snapshotLoaded && warehousesSettingLoaded,
    [snapshotLoaded, warehousesSettingLoaded]
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
    settingsNavModel,
    hasCapability,
    snapshotLoaded,
    warehousesEnabled,
    warehousesSettingLoaded,
    isSupplier,
    supplierStatusResolved,
    reportsDefinitionsResolved,
    reportRouteMap,
    enabledModules,
    hasPlatformModule,
    homeHref,
    supplierHubVisible,
  ]);

  const visibleNavItemsRef = useRef(visibleNavItems);
  visibleNavItemsRef.current = visibleNavItems;

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

  const activeNavHref = useMemo(() => {
    if (!visibleNavItems?.length || !pathname) return null;
    return pickActiveNavHref(
      collectNavHrefs(visibleNavItems),
      pathname,
      searchParamsKey,
      locationHash,
    );
  }, [visibleNavItems, pathname, searchParamsKey, locationHash]);

  const isItemActive = (href: string): boolean => href !== '' && href === activeNavHref;

  const isAnySubItemActive = (item: any): boolean => {
    if (!item.subItems) return false;
    for (const subItem of item.subItems) {
      if (subItem.href && isItemActive(subItem.href)) return true;
      if (subItem.subItems && isAnySubItemActive(subItem)) return true;
    }
    return false;
  };

  // Auto-expand sections that contain the active route (stable deps — avoid nav array identity churn)
  useEffect(() => {
    const items = visibleNavItemsRef.current;
    if (!items || items.length === 0) return;

    if (navRef.current) {
      scrollPositionRef.current = navRef.current.scrollTop;
    }

    setOpenSections((prevOpenSections) => {
      const newOpenSections: Record<string, boolean> = { ...prevOpenSections };
      let hasChanges = false;

      for (const item of items) {
        if (item.collapsible && item.subItems && isAnySubItemActive(item)) {
          const key = sectionKeyOf(item);
          if (!newOpenSections[key]) {
            newOpenSections[key] = true;
            hasChanges = true;
          }
        }
      }

      return hasChanges ? newOpenSections : prevOpenSections;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isAnySubItemActive reads the active href
  }, [pathname, searchParamsKey, sidebarReady, locationHash, activeNavHref]);

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

  // Top-level rows get a solid colour tile; sub-items keep a small plain icon.
  const renderIcon = (item: any, isSubItem: boolean): React.ReactNode => {
    const Icon = item.icon;
    if (!Icon) return null;
    if (isSubItem) return <Icon className="w-4 h-4 flex-shrink-0 opacity-80" aria-hidden />;
    return <NavTile icon={Icon} tone={item.tone} />;
  };

  const renderCollapsedTip = (text: string): React.ReactNode =>
    sidebarCollapsed ? (
      <div className="kh-nav-tip absolute left-full ml-3 px-2.5 py-1 text-sm font-medium rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none">
        {text}
      </div>
    ) : null;

  const rowClass = (isSubItem: boolean) =>
    isSubItem ? 'is-sub px-3 py-1.5 text-[13px]' : 'px-2 py-1.5';

  const renderNavItems = (items: any[], isSubItem = false, topLevelParentLabel?: string): React.ReactNode => {
    return (
      <ul className={clsx(isSubItem ? 'kh-nav-tree space-y-0.5' : 'space-y-0.5')}>
        {items.map((item, index) => {
          const isActive = item.href ? isItemActive(item.href) : false;
          const sectionKey = sectionKeyOf(item);
          const isSectionOpen = item.collapsible ? openSections[sectionKey] : true;
          const hasActiveSubItem = item.subItems ? isAnySubItemActive(item) : false;
          // If section is explicitly closed (false), respect that even with active sub-item
          // Otherwise, expand if section is open OR has active sub-item
          const isExpanded = openSections[sectionKey] === false
            ? false
            : (isSectionOpen || hasActiveSubItem);
          // Determine the top-level parent for nested items
          const currentTopLevelParent = isSubItem ? topLevelParentLabel : sectionKey;
          // A label (or a divider when collapsed / ungrouped) starts each new top-level group.
          const startsGroup = !isSubItem && index > 0 && item.group !== items[index - 1].group;

          return (
            <React.Fragment key={item.href || item.label + index}>
              {startsGroup &&
                (sidebarCollapsed || !item.group ? (
                  <li aria-hidden className="kh-nav-divider mx-2 my-2" />
                ) : (
                  <li aria-hidden className="kh-nav-group px-2 pt-4 pb-1">
                    {item.group}
                  </li>
                ))}
            <li>
              {item.subItems ? (
                <>
                  {/* Entire item is clickable to toggle expand/collapse */}
                  <div className={clsx('kh-nav-section rounded-lg', isExpanded && !isSubItem && 'is-open')}>
                    {/* Main link - navigates to href if exists, but also toggles section */}
                    <Link
                      href={item.href || '#'}
                      prefetch={false}
                      data-tour={item.tourId}
                      aria-expanded={item.collapsible ? isExpanded : undefined}
                      aria-current={isActive ? 'page' : undefined}
                      title={item.label}
                      onClick={(e) => {
                        // If sidebar is collapsed and item is collapsible, expand sidebar first
                        if (sidebarCollapsed && item.collapsible) {
                          e.preventDefault();
                          // Expand sidebar first
                          toggleSidebar();
                          // Then toggle section to show sub-items
                          // Use setTimeout to ensure sidebar expansion completes first
                          setTimeout(() => {
                            toggleSection(sectionKeyOf(item), e);
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
                            toggleSection(sectionKeyOf(item), e);
                            return;
                          }
                          // Has valid href: allow navigation (don't prevent default)
                          // Next.js Link will handle client-side navigation
                          // Don't toggle section when navigating
                        }

                        // For non-collapsible items: if no href, prevent navigation
                        if (!item.collapsible && (!item.href || item.href === '#')) {
                          e.preventDefault();
                          return;
                        }

                      }}
                      className={clsx(
                        'kh-nav-link flex items-center gap-3 rounded-lg group relative cursor-pointer min-w-0',
                        rowClass(isSubItem),
                        isActive && 'is-active',
                        sidebarCollapsed && 'justify-center'
                      )}
                    >
                      {renderIcon(item, isSubItem)}
                      {!sidebarCollapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                      {/* Chevron is a visual indicator; the whole row toggles */}
                      {!sidebarCollapsed && item.collapsible && (
                        <ChevronDown
                          className={clsx('kh-nav-chev w-4 h-4 flex-shrink-0', isExpanded ? 'rotate-180' : 'rotate-0')}
                          aria-hidden
                        />
                      )}
                      {renderCollapsedTip(item.label)}
                    </Link>
                  </div>
                  {isExpanded && item.subItems && !sidebarCollapsed && (
                    <div className="kh-nav-reveal mt-0.5">
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
                      // WhatsApp features open the add-on modal; everything else opens the upgrade modal
                      const isWhatsAppAddon =
                        featureKey.includes('whatsapp') ||
                        featureKey === 'integration_whatsapp_bot' ||
                        featureKey === 'integration_whatsapp_manual';
                      return (
                        <button
                          type="button"
                          onClick={(e) => {
                            if (isWhatsAppAddon) {
                              e.preventDefault();
                              setSelectedAddonType('whatsapp_bot');
                              setShowAddonModal(true);
                              return;
                            }
                            handleLockedItemClick(e, featureKey);
                          }}
                          className={clsx(
                            'kh-nav-link is-locked flex items-center gap-3 rounded-lg group relative w-full text-left cursor-pointer',
                            rowClass(isSubItem),
                            sidebarCollapsed && 'justify-center'
                          )}
                          title={sidebarCollapsed ? `${item.label} — upgrade to unlock` : 'Upgrade to unlock'}
                        >
                          {item.icon && (
                            <span className="relative flex-shrink-0">
                              {renderIcon(item, isSubItem)}
                              {sidebarCollapsed && (
                                <Lock className="absolute -right-1.5 -top-1.5 h-3 w-3 text-amber-500" aria-hidden />
                              )}
                            </span>
                          )}
                          {!sidebarCollapsed && (
                            <>
                              <span className="min-w-0 flex-1 truncate">{item.label}</span>
                              <span className="kh-nav-lockchip shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide">
                                {isWhatsAppAddon ? 'Add-on' : 'Upgrade'}
                              </span>
                            </>
                          )}
                          {renderCollapsedTip(`${item.label} — upgrade to unlock`)}
                        </button>
                      );
                    }

                    // Normal unlocked item
                    const createRoute = getCreateRoute(item);
                    return (
                      <div className="rounded-lg group/item relative">
                        <Link
                          href={item.href!}
                          prefetch={false}
                          data-tour={item.tourId}
                          aria-current={isActive ? 'page' : undefined}
                          className={clsx(
                            'kh-nav-link flex items-center gap-3 rounded-lg group relative min-w-0',
                            rowClass(isSubItem),
                            isActive && 'is-active',
                            sidebarCollapsed && 'justify-center',
                            !sidebarCollapsed && createRoute && 'pr-9'
                          )}
                          title={item.label}
                        >
                          {renderIcon(item, isSubItem)}
                          {!sidebarCollapsed && (
                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          )}
                          {!sidebarCollapsed && item.badge && (
                            <span className="kh-nav-badge shrink-0 rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide">
                              {item.badge}
                            </span>
                          )}
                          {renderCollapsedTip(item.label)}
                        </Link>
                        {/* Hover reveal "New" link */}
                        {!sidebarCollapsed && createRoute && (
                          <Link
                            href={createRoute}
                            prefetch={false}
                            onClick={(e) => e.stopPropagation()}
                            className={clsx(
                              'kh-nav-new absolute right-1.5 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-md',
                              'opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 transition-opacity'
                            )}
                            title={`Create New ${item.label}`}
                            aria-label={`Create New ${item.label}`}
                          >
                            <Plus className="w-3.5 h-3.5" aria-hidden />
                          </Link>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}
            </li>
            </React.Fragment>
          );
        })}
      </ul>
    );
  };

  const renderBusinessMark = (compact: boolean): React.ReactNode =>
    business?.logo_url ? (
      <img
        src={business.logo_url}
        alt={businessName}
        className="w-8 h-8 rounded-lg object-contain flex-shrink-0"
      />
    ) : (
      <div className="kh-ws-logo w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0">
        <span className="font-bold text-sm">{compact ? businessInitials.substring(0, 1) : businessInitials}</span>
      </div>
    );

  const userName = user?.name || 'You';
  const userRole = isPrimaryAdmin
    ? 'Primary Admin'
    : (user as { role_name?: string } | null)?.role_name || 'User';

  return (
    <>
      {/* Sidebar */}
      <aside
        className={clsx(
          'khatario-sidebar fixed top-0 left-0 h-screen z-50 flex flex-col text-sm',
          'transition-all duration-300 ease-in-out hidden lg:flex',
          sidebarCollapsed ? 'w-16' : 'w-64'
        )}
      >
        {/* Collapse handle on the sidebar's edge */}
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!sidebarCollapsed}
          className="kh-edge-toggle absolute -right-3 top-[26px] z-10 flex h-6 w-6 items-center justify-center rounded-full"
        >
          {sidebarCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>

        {/* Header: business card, then Jump to (opens the command palette) */}
        <div
          className={clsx(
            'flex-shrink-0',
            sidebarCollapsed ? 'flex flex-col items-center gap-2 px-2 pt-3 pb-2' : 'space-y-2 px-2.5 pt-3 pb-2'
          )}
        >
          {sidebarCollapsed ? (
            renderBusinessMark(true)
          ) : (
            <div className="kh-ws-card flex items-center gap-2.5 rounded-xl px-2.5 py-2 min-w-0">
              {renderBusinessMark(false)}
              <div className="flex flex-col min-w-0 flex-1">
                <span className="font-semibold text-[15px] leading-tight truncate">{businessName}</span>
                {userBranch && showBranchSubtitle && (
                  <span className="kh-muted text-xs truncate">
                    {userBranch.name}{userBranch.code && ` (${userBranch.code})`}
                  </span>
                )}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_OPEN_EVENT))}
            aria-label="Search or jump to a page"
            title={sidebarCollapsed ? 'Jump to… (Ctrl K)' : undefined}
            className={clsx(
              'kh-jump flex items-center rounded-lg',
              sidebarCollapsed ? 'h-9 w-9 justify-center' : 'w-full gap-2 px-2.5 py-1.5 text-left'
            )}
          >
            <Search className="w-4 h-4 flex-shrink-0" aria-hidden />
            {!sidebarCollapsed && (
              <>
                <span className="flex-1 truncate">Jump to…</span>
                <kbd className="kh-kbd rounded px-1 font-sans text-[11px]">Ctrl K</kbd>
              </>
            )}
          </button>
        </div>

        {/* Navigation - Scrollable area */}
        <nav
          ref={navRef}
          className="kh-nav-scroll px-2 py-2 flex-1 overflow-y-auto overflow-x-hidden min-h-0"
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
        <div className="flex-shrink-0 z-10 border-t border-border/60">
          <PromotionSidebar collapsed={sidebarCollapsed} />
        </div>

        {/* Footer: who is signed in, and the guided tour */}
        <div
          className={clsx(
            'flex-shrink-0 border-t border-border p-2',
            sidebarCollapsed ? 'flex flex-col items-center gap-1.5' : 'flex items-center gap-2.5 px-3'
          )}
        >
          <div
            className="kh-avatar w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold"
            title={sidebarCollapsed ? `${userName} · ${userRole}` : undefined}
            aria-hidden
          >
            {userName.charAt(0).toUpperCase()}
          </div>
          {!sidebarCollapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium leading-tight">{userName}</div>
              <div className="kh-muted truncate text-xs">{userRole}</div>
            </div>
          )}
          <button
            type="button"
            data-tour="nav-sidebar-tour-button"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent(PRODUCT_TOUR_START_EVENT, {
                  detail: { chainBusinessProfile: true },
                })
              )
            }
            className="kh-foot-btn w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors"
            aria-label="Guided tour: main menu, then business profile"
            title="Menu & profile tour"
          >
            <Sparkles className="w-4 h-4" aria-hidden />
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
});

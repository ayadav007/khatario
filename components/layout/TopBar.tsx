'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  Search,
  User,
  ChevronDown,
  LogOut,
  Settings,
  Building2,
  Shield,
  FileText,
  LayoutTemplate,
  Tags,
  Warehouse,
  MessageSquare,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { SubscriptionBadge } from './SubscriptionBadge';

import { useRouter, usePathname } from 'next/navigation';
import { getMobileRouteTitle } from '@/lib/mobile-route-title';
import {
  getMobileQuickSettings,
  type MobileQuickSettingsKind,
} from '@/lib/mobile-quick-settings';
import { useMobileHeaderTitleContext } from '@/contexts/MobileHeaderTitleContext';
import { CommandPalette } from '@/components/search/CommandPalette';
import { useCommandPalette } from '@/hooks/useCommandPalette';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';
import { useDarkMode } from '@/contexts/DarkModeContext';
import { Moon, Sun } from 'lucide-react';

import { format, startOfWeek, startOfMonth } from 'date-fns';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import type { DateRange } from 'react-day-picker';
import { useDateRange } from '@/contexts/DateRangeContext';
import { TopBarPromotion } from '@/components/promotions/TopBarPromotion';
import { BusinessSwitcher } from '@/components/layout/BusinessSwitcher';

function MobileQuickSettingsIcon({
  kind,
  className = 'h-5 w-5',
}: {
  kind: MobileQuickSettingsKind;
  className?: string;
}) {
  switch (kind) {
    case 'invoice_print':
      return <LayoutTemplate className={className} aria-hidden />;
    case 'items_labels':
      return <Tags className={className} aria-hidden />;
    case 'organization':
      return <Building2 className={className} aria-hidden />;
    case 'warehouses':
      return <Warehouse className={className} aria-hidden />;
    case 'whatsapp':
      return <MessageSquare className={className} aria-hidden />;
    default:
      return <Settings className={className} aria-hidden />;
  }
}

interface TopBarProps {
  businessName?: string;
  showDateRange?: boolean;
  onDateRangeChange?: (range: { start: string; end: string; label: string }) => void;
}

/** Shared dashboard date controls (same state, two DOM instances for mobile vs desktop). */
function DateRangeControls({
  dateRange,
  setDateRange,
  selectedRange,
  setSelectedRange,
  showDatePicker,
  setShowDatePicker,
  datePickerRef,
  numberOfMonths,
  className,
}: {
  dateRange: string;
  setDateRange: (v: string) => void;
  selectedRange: DateRange | undefined;
  setSelectedRange: (v: DateRange | undefined) => void;
  showDatePicker: boolean;
  setShowDatePicker: (v: boolean) => void;
  datePickerRef: React.RefObject<HTMLDivElement | null>;
  numberOfMonths: number;
  className?: string;
}) {
  return (
    <div className={className ?? 'flex items-center gap-2 relative'} ref={datePickerRef as React.Ref<HTMLDivElement>}>
      <select
        className="input w-auto max-w-full text-sm"
        value={dateRange}
        onChange={(e) => {
          setDateRange(e.target.value);
          if (e.target.value === 'custom') {
            setShowDatePicker(true);
          } else {
            setShowDatePicker(false);
            setSelectedRange(undefined);
          }
        }}
      >
        <option value="today">Today</option>
        <option value="this_week">This Week</option>
        <option value="this_month">This Month</option>
        <option value="custom">Custom Range</option>
      </select>

      {showDatePicker && dateRange === 'custom' && (
        <div className="absolute top-full left-0 right-0 lg:right-auto lg:left-0 mt-2 bg-surface border border-border rounded-xl shadow-xl z-50 overflow-hidden max-w-[calc(100vw-2rem)] lg:max-w-none">
          <DayPicker
            mode="range"
            selected={selectedRange}
            onSelect={setSelectedRange}
            numberOfMonths={numberOfMonths}
            className="p-4"
            classNames={{
              months: 'flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0',
              month: 'space-y-4',
              caption: 'flex justify-center pt-1 relative items-center',
              caption_label: 'text-sm font-medium text-text-primary',
              nav: 'space-x-1 flex items-center',
              nav_button: 'h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 text-text-primary',
              nav_button_previous: 'absolute left-1',
              nav_button_next: 'absolute right-1',
              table: 'w-full border-collapse space-y-1',
              head_row: 'flex',
              head_cell: 'text-text-secondary rounded-md w-9 font-normal text-[0.8rem]',
              row: 'flex w-full mt-2',
              cell: 'text-center text-sm p-0 relative [&:has([aria-selected])]:bg-slate-50 dark:[&:has([aria-selected])]:bg-primary-900/35 first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-md focus-within:relative focus-within:z-20',
              day: 'h-9 w-9 p-0 font-normal aria-selected:opacity-100 text-text-primary hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md',
              day_selected: 'bg-primary-500 text-white hover:bg-primary-600 hover:text-white focus:bg-primary-500 focus:text-white',
              day_today: 'bg-slate-100 dark:bg-slate-800/50 text-primary-900 dark:text-primary-100 font-semibold',
              day_outside: 'text-text-muted opacity-50',
              day_disabled: 'text-text-muted opacity-50',
              day_range_middle: 'aria-selected:bg-slate-50 dark:aria-selected:bg-primary-900/25 aria-selected:text-primary-900 dark:aria-selected:text-primary-100',
              day_hidden: 'invisible',
            }}
          />
          <div className="border-t border-border p-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setShowDatePicker(false);
                if (!selectedRange?.from || !selectedRange?.to) {
                  setSelectedRange(undefined);
                }
              }}
              className="flex-1 px-4 py-2 border border-border text-text-primary rounded-md text-sm font-medium hover:bg-slate-100/80 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (selectedRange?.from && selectedRange?.to) {
                  setShowDatePicker(false);
                }
              }}
              className="flex-1 px-4 py-2 bg-primary-500 text-white rounded-md text-sm font-medium hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!selectedRange?.from || !selectedRange?.to}
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BranchSelector({
  branchSelectorRef,
  showBranchSelector,
  setShowBranchSelector,
  currentBranchId,
  currentBranch,
  accessibleBranches,
  isAdmin,
  setCurrentBranchId,
  mobile,
}: {
  branchSelectorRef: React.RefObject<HTMLDivElement | null>;
  showBranchSelector: boolean;
  setShowBranchSelector: (v: boolean) => void;
  currentBranchId: string | null;
  currentBranch: { name?: string; branch_code?: string } | null;
  accessibleBranches: Array<{ id: string; name: string; branch_code?: string }>;
  isAdmin: boolean;
  setCurrentBranchId: (id: string) => void;
  mobile?: boolean;
}) {
  const label =
    currentBranchId === 'ALL' ? 'All Branches' : currentBranch?.name || 'Branch';

  return (
    <div className="relative w-full" ref={branchSelectorRef as React.Ref<HTMLDivElement>}>
      <button
        type="button"
        onClick={() => setShowBranchSelector(!showBranchSelector)}
        className={
          mobile
            ? 'flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm font-medium text-text-primary hover:bg-slate-100/50 dark:hover:bg-slate-800/80'
            : 'flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors border border-border'
        }
        title="Select branch"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Building2 className="h-4 w-4 shrink-0 text-text-secondary" />
          <span className={mobile ? 'truncate font-medium text-text-primary' : 'text-sm font-medium text-text-primary'}>
            {label}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-text-secondary transition-transform ${showBranchSelector ? 'rotate-180' : ''}`}
        />
      </button>

      {showBranchSelector && (
        <div
          className={
            mobile
              ? 'absolute left-0 right-0 top-full z-50 mt-2 max-h-96 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg'
              : 'absolute right-0 top-full z-50 mt-2 w-56 max-h-96 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg'
          }
        >
          <div className="p-2">
            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  setCurrentBranchId('ALL');
                  setShowBranchSelector(false);
                }}
                className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  currentBranchId === 'ALL'
                    ? 'bg-slate-50 dark:bg-slate-800/40 font-medium text-primary-700 dark:text-primary-200'
                    : 'text-text-primary hover:bg-slate-100/80 dark:hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  <span>All Branches</span>
                </div>
              </button>
            )}

            {isAdmin && accessibleBranches.length > 0 && <div className="my-1 border-t border-border" />}

            {accessibleBranches.map((branch) => (
              <button
                key={branch.id}
                type="button"
                onClick={() => {
                  setCurrentBranchId(branch.id);
                  setShowBranchSelector(false);
                }}
                className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  currentBranchId === branch.id
                    ? 'bg-slate-50 dark:bg-slate-800/40 font-medium text-primary-700 dark:text-primary-200'
                    : 'text-text-primary hover:bg-slate-100/80 dark:hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{branch.name}</div>
                    {branch.branch_code && (
                      <div className="text-xs text-text-muted">{branch.branch_code}</div>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const TopBar: React.FC<TopBarProps> = ({
  businessName,
  showDateRange = false,
  onDateRangeChange,
}) => {
  const { setDateRange: setDateRangeFromContext } = useDateRange();
  const { business, user, logout, isPrimaryAdmin } = useAuth();
  const {
    currentBranchId,
    accessibleBranches,
    isAdmin,
    currentBranch,
    isLoading: branchLoading,
    setCurrentBranchId,
  } = useBranch();
  const router = useRouter();
  const pathname = usePathname();
  const [dateRange, setDateRange] = useState<string>('today');
  const [searchQuery, setSearchQuery] = useState('');
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showBranchSelector, setShowBranchSelector] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedRange, setSelectedRange] = useState<DateRange | undefined>(undefined);
  const [userRole, setUserRole] = useState<string>('');
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const branchSelectorRefMobile = useRef<HTMLDivElement>(null);
  const branchSelectorRefDesktop = useRef<HTMLDivElement>(null);
  const datePickerRefMobile = useRef<HTMLDivElement>(null);
  const datePickerRefDesktop = useRef<HTMLDivElement>(null);
  const lastRangeRef = useRef<string>('');
  const isFirstMount = useRef(true);
  const commandPalette = useCommandPalette();
  const { isOpen: isCommandPaletteOpen, close: closeCommandPalette, open: openCommandPalette } =
    commandPalette;
  const { isDarkMode, toggleDarkMode } = useDarkMode();

  useEffect(() => {
    if (isPrimaryAdmin) {
      setUserRole('Primary Admin');
    } else if ((user as any)?.role_name) {
      setUserRole((user as any).role_name);
    } else {
      setUserRole('User');
    }
  }, [user, isPrimaryAdmin]);

  const displayBusinessName = businessName || business?.name || 'My Business';
  const mobileHeaderCtx = useMobileHeaderTitleContext();
  const mobileRouteTitle = getMobileRouteTitle(pathname);
  const mobileCenterLabel =
    mobileHeaderCtx?.overrideTitle ?? mobileRouteTitle ?? displayBusinessName;
  const mobileQuickSettings = getMobileQuickSettings(pathname);

  useEffect(() => {
    if (!showDateRange) return;

    const handler = setDateRangeFromContext || onDateRangeChange;
    if (!handler) return;

    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }

    const today = new Date();
    let start: Date;
    let end: Date = today;
    let label: string;

    switch (dateRange) {
      case 'today':
        start = today;
        end = today;
        label = 'Today';
        break;
      case 'this_week':
        start = startOfWeek(today, { weekStartsOn: 1 });
        end = today;
        label = 'This Week';
        break;
      case 'this_month':
        start = startOfMonth(today);
        end = today;
        label = 'This Month';
        break;
      case 'custom':
        if (selectedRange?.from && selectedRange?.to) {
          start = selectedRange.from;
          end = selectedRange.to;
          label = `${format(start, 'dd MMM')} - ${format(end, 'dd MMM')}`;
        } else {
          return;
        }
        break;
      default:
        return;
    }

    const newRange = {
      start: format(start, 'yyyy-MM-dd'),
      end: format(end, 'yyyy-MM-dd'),
      label,
    };

    const rangeKey = `${newRange.start}-${newRange.end}`;
    if (lastRangeRef.current !== rangeKey) {
      lastRangeRef.current = rangeKey;
      handler(newRange);
    }
  }, [dateRange, selectedRange, showDateRange, setDateRangeFromContext, onDateRangeChange]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const t = event.target as Node;
      if (profileMenuRef.current && !profileMenuRef.current.contains(t)) {
        setShowProfileMenu(false);
      }
      const branchHit =
        branchSelectorRefMobile.current?.contains(t) ||
        branchSelectorRefDesktop.current?.contains(t);
      if (!branchHit) {
        setShowBranchSelector(false);
      }
      const dateHit =
        datePickerRefMobile.current?.contains(t) || datePickerRefDesktop.current?.contains(t);
      if (!dateHit) {
        setShowDatePicker(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery) return;
    router.push(`/search?q=${encodeURIComponent(trimmedQuery)}`);
  };

  const handleLogout = () => {
    if (confirm('Are you sure you want to logout?')) {
      logout();
    }
  };

  return (
    <>
      {/* Mobile: canonical chrome — brand | business name | notifications + settings */}
      <div className="sticky top-0 z-40 bg-surface pt-[env(safe-area-inset-top,0px)] lg:hidden">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <Link
            href="/dashboard"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-primary-600"
            aria-label="Home"
          >
            {business?.logo_url ? (
              <img src={business.logo_url} alt="" className="h-8 w-8 object-contain" />
            ) : (
              <FileText className="h-6 w-6" />
            )}
          </Link>
          <p
            className="min-w-0 flex-1 truncate text-center text-sm font-semibold text-text-primary"
            title={mobileCenterLabel}
          >
            {mobileCenterLabel}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {mobileHeaderCtx?.rightAccessory}
            {business?.id && <NotificationCenter businessId={business.id} />}
            <Link
              href={mobileQuickSettings.href}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
              aria-label={mobileQuickSettings.ariaLabel}
              title={mobileQuickSettings.ariaLabel}
            >
              <MobileQuickSettingsIcon kind={mobileQuickSettings.kind} />
            </Link>
          </div>
        </div>

        <BusinessSwitcher mobile />

        {!branchLoading && accessibleBranches.length > 1 && (
          <div className="border-b border-border bg-background/95 px-4 py-2 dark:bg-slate-900/40">
            <BranchSelector
              branchSelectorRef={branchSelectorRefMobile}
              showBranchSelector={showBranchSelector}
              setShowBranchSelector={setShowBranchSelector}
              currentBranchId={currentBranchId}
              currentBranch={currentBranch}
              accessibleBranches={accessibleBranches}
              isAdmin={isAdmin}
              setCurrentBranchId={setCurrentBranchId}
              mobile
            />
          </div>
        )}

        {showDateRange && (
          <div className="border-b border-border bg-surface px-4 py-2.5">
            <DateRangeControls
              dateRange={dateRange}
              setDateRange={setDateRange}
              selectedRange={selectedRange}
              setSelectedRange={setSelectedRange}
              showDatePicker={showDatePicker}
              setShowDatePicker={setShowDatePicker}
              datePickerRef={datePickerRefMobile}
              numberOfMonths={1}
            />
          </div>
        )}
      </div>

      <CommandPalette isOpen={isCommandPaletteOpen} onClose={closeCommandPalette} />

      {/* Desktop: full utility bar — center slot for platform top-bar promotion */}
      <header className="relative hidden h-16 min-h-16 items-stretch gap-3 border-b border-border bg-surface px-4 md:px-6 lg:flex">
        <div className="flex min-w-0 shrink-0 items-center gap-4">
          {showDateRange && (
            <DateRangeControls
              dateRange={dateRange}
              setDateRange={setDateRange}
              selectedRange={selectedRange}
              setSelectedRange={setSelectedRange}
              showDatePicker={showDatePicker}
              setShowDatePicker={setShowDatePicker}
              datePickerRef={datePickerRefDesktop}
              numberOfMonths={2}
            />
          )}
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 self-stretch items-stretch justify-center overflow-hidden px-0">
          {business?.id && <TopBarPromotion businessId={business.id} />}
        </div>

        <div className="flex shrink-0 items-center gap-2 md:gap-4">
          <BusinessSwitcher />
          {!branchLoading && accessibleBranches.length > 1 && (
            <BranchSelector
              branchSelectorRef={branchSelectorRefDesktop}
              showBranchSelector={showBranchSelector}
              setShowBranchSelector={setShowBranchSelector}
              currentBranchId={currentBranchId}
              currentBranch={currentBranch}
              accessibleBranches={accessibleBranches}
              isAdmin={isAdmin}
              setCurrentBranchId={setCurrentBranchId}
            />
          )}

          {business?.id && (
            <div className="hidden sm:block">
              <SubscriptionBadge businessId={business.id} />
            </div>
          )}

          <form onSubmit={handleSearch} className="relative hidden md:block">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-text-muted" />
            <input
              type="text"
              placeholder="Search... (⌘K)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                  e.preventDefault();
                  openCommandPalette();
                }
              }}
              className="input w-48 pl-10 lg:w-64"
            />
          </form>

          {business?.id && <NotificationCenter businessId={business.id} />}

          <button
            type="button"
            onClick={toggleDarkMode}
            className="rounded-lg p-2 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
            title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDarkMode ? (
              <Sun className="h-5 w-5 text-text-secondary" />
            ) : (
              <Moon className="h-5 w-5 text-text-secondary" />
            )}
          </button>

          <div className="relative" ref={profileMenuRef}>
            <button
              type="button"
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-primary-500">
                {user?.name?.charAt(0) ? (
                  <span className="text-xs font-bold text-white">
                    {user.name.charAt(0).toUpperCase()}
                  </span>
                ) : (
                  <User className="h-4 w-4 text-white" />
                )}
              </div>
              <ChevronDown
                className={`hidden h-4 w-4 text-text-secondary transition-transform md:block ${showProfileMenu ? 'rotate-180' : ''}`}
              />
            </button>

            {showProfileMenu && (
              <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-border bg-surface shadow-lg">
                <div className="border-b border-border p-4">
                  <p className="font-semibold text-text-primary">{user?.name || 'User'}</p>
                  <p className="text-sm text-text-secondary">{user?.email || ''}</p>
                  <p className="mt-1 text-xs text-text-muted">{business?.name || ''}</p>
                </div>
                {(currentBranch || userRole) && (
                  <div className="border-b border-border bg-background/80 dark:bg-slate-900/50 px-4 py-2">
                    {currentBranch && (
                      <div className="mb-1.5 flex items-center gap-2">
                        <Building2 className="h-3.5 w-3.5 text-text-muted" />
                        <span className="text-xs font-medium text-text-primary">
                          {currentBranch.name}
                          {currentBranch.branch_code && ` (${currentBranch.branch_code})`}
                        </span>
                      </div>
                    )}
                    {userRole && (
                      <div className="flex items-center gap-2">
                        <Shield className="h-3.5 w-3.5 text-text-muted" />
                        <span className="text-xs font-medium text-text-primary">{userRole}</span>
                      </div>
                    )}
                  </div>
                )}
                <div className="p-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowProfileMenu(false);
                      router.push('/settings');
                    }}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-text-primary transition-colors hover:bg-slate-100/80 dark:hover:bg-slate-800"
                  >
                    <Settings className="h-4 w-4" />
                    Settings
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowProfileMenu(false);
                      handleLogout();
                    }}
                    className="mt-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-red-600 dark:text-red-400 transition-colors hover:bg-red-50 dark:hover:bg-red-950/40"
                  >
                    <LogOut className="h-4 w-4" />
                    Logout
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>
    </>
  );
};

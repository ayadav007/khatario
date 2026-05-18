'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { parseISO } from 'date-fns';
import formatInTimeZone from 'date-fns-tz/formatInTimeZone';
import toDate from 'date-fns-tz/toDate';
import { clsx } from 'clsx';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscriptionCheck } from '@/hooks/useSubscriptionCheck';
import { getPosMode } from '@/lib/pos-settings';
import {
  getBusinessTodoTimezone,
  dueInstantToZonedDayKey,
  zonedMonthBoundsUtc,
} from '@/lib/todo-timezone';
import { isReminderAtDueTime } from '@/lib/todo-reminder-defaults';
import { useTodoScheduleRail } from '@/contexts/TodoScheduleRailContext';

const OPEN_TODO_SESSION_KEY = 'khatario_todo_open_id';

type TodoRow = {
  id: string;
  title: string;
  due_date: string;
  status: string;
  reminder_time?: string | null;
  reminder_type?: string;
};

export function TodoScheduleRail() {
  const pathname = usePathname();
  const router = useRouter();
  const { business, user } = useAuth();
  const { hasFeature } = useSubscriptionCheck(business?.id);
  const hasTodo = hasFeature('todo');
  const { visible, setVisible, refreshNonce } = useTodoScheduleRail();

  const todoTz = useMemo(() => getBusinessTodoTimezone(business), [business]);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [selectedYmd, setSelectedYmd] = useState(() =>
    formatInTimeZone(new Date(), todoTz, 'yyyy-MM-dd')
  );
  const [calendarTodos, setCalendarTodos] = useState<TodoRow[]>([]);
  const [loading, setLoading] = useState(false);

  const isFullWidthPage = pathname?.includes('/whatsapp/conversations');
  const isInvoiceNew = pathname === '/invoices/new';
  const [posMode, setPosMode] = useState(false);

  useEffect(() => {
    const check = () => setPosMode(getPosMode());
    check();
    window.addEventListener('posModeChanged', check);
    return () => window.removeEventListener('posModeChanged', check);
  }, []);

  useEffect(() => {
    setSelectedYmd(formatInTimeZone(new Date(), todoTz, 'yyyy-MM-dd'));
  }, [todoTz]);

  const fetchMonth = useCallback(async () => {
    if (!business?.id || !hasTodo) return;
    const y = parseInt(formatInTimeZone(calendarMonth, todoTz, 'yyyy'), 10);
    const m = parseInt(formatInTimeZone(calendarMonth, todoTz, 'MM'), 10);
    const { startUtc, endExclusiveUtc } = zonedMonthBoundsUtc(y, m, todoTz);
    setLoading(true);
    try {
      const userIdParam = user?.id ? `&user_id=${user.id}` : '';
      const res = await fetch(
        `/api/todos?business_id=${business.id}${userIdParam}&due_from=${encodeURIComponent(
          startUtc.toISOString()
        )}&due_to=${encodeURIComponent(endExclusiveUtc.toISOString())}`
      );
      if (res.ok) {
        const data = await res.json();
        setCalendarTodos(Array.isArray(data) ? data : []);
      } else {
        setCalendarTodos([]);
      }
    } catch {
      setCalendarTodos([]);
    } finally {
      setLoading(false);
    }
  }, [business?.id, user?.id, calendarMonth, todoTz, hasTodo]);

  useEffect(() => {
    fetchMonth();
  }, [fetchMonth, refreshNonce]);

  const todosPerDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of calendarTodos) {
      const k = dueInstantToZonedDayKey(t.due_date, todoTz);
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return map;
  }, [calendarTodos, todoTz]);

  const selectedDayTodos = useMemo(() => {
    return calendarTodos
      .filter((t) => dueInstantToZonedDayKey(t.due_date, todoTz) === selectedYmd)
      .sort((a, b) => parseISO(a.due_date).getTime() - parseISO(b.due_date).getTime());
  }, [calendarTodos, selectedYmd, todoTz]);

  const hideRail =
    !visible ||
    !hasTodo ||
    !business?.id ||
    isFullWidthPage ||
    (posMode && isInvoiceNew);

  const canShowToggle = hasTodo && !!business?.id && !isFullWidthPage && !(posMode && isInvoiceNew);

  // If rail is hidden only due to user preference, keep a small handle to bring it back.
  if (hideRail) {
    if (!canShowToggle || visible) return null;
    return (
      <button
        type="button"
        onClick={() => setVisible(true)}
        className={clsx(
          'hidden lg:flex',
          'fixed right-0 top-1/2 -translate-y-1/2 z-40',
          'h-10 w-6 items-center justify-center',
          'rounded-l-md border border-border bg-surface text-text-secondary shadow-sm',
          'hover:bg-gray-50 dark:hover:bg-slate-800/80 transition-colors'
        )}
        aria-label="Show schedule"
        title="Show schedule"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
    );
  }

  const openTodo = (todo: TodoRow) => {
    try {
      sessionStorage.setItem(OPEN_TODO_SESSION_KEY, todo.id);
    } catch {
      /* ignore */
    }
    router.push('/tools/todo');
  };

  return (
    <aside
      className={clsx(
        'relative hidden lg:flex flex-col shrink-0 border-l border-border dark:border-border-dark',
        'bg-surface dark:bg-surface-dark',
        'w-[min(10vw,280px)] min-w-[200px] max-w-[280px]',
        /* Stretch with layout row (min-h-screen in layout) so background always fills viewport on short pages */
        'min-h-0 self-stretch overflow-x-hidden'
      )}
      aria-label="Todo schedule"
    >
      <button
        type="button"
        onClick={() => setVisible(false)}
        className={clsx(
          'absolute -left-3 top-1/2 -translate-y-1/2 z-10',
          'hidden lg:flex h-10 w-6 items-center justify-center',
          'rounded-l-md border border-border bg-surface text-text-secondary shadow-sm',
          'hover:bg-gray-50 dark:hover:bg-slate-800/80 transition-colors'
        )}
        aria-label="Hide schedule"
        title="Hide schedule"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      <div className="p-2.5 space-y-2 border-b border-border dark:border-border-dark">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wide">
            Schedule
          </span>
          <span className="text-[9px] text-text-muted truncate max-w-[7rem]" title={todoTz}>
            {todoTz.replace(/_/g, ' ')}
          </span>
        </div>
        <div className="flex justify-center -mx-1">
          <DayPicker
            mode="single"
            timeZone={todoTz}
            month={calendarMonth}
            onMonthChange={setCalendarMonth}
            selected={toDate(`${selectedYmd} 12:00:00`, { timeZone: todoTz })}
            onSelect={(d) => {
              if (d) setSelectedYmd(formatInTimeZone(d, todoTz, 'yyyy-MM-dd'));
            }}
            modifiers={{
              hasTodos: (day) =>
                (todosPerDay.get(formatInTimeZone(day, todoTz, 'yyyy-MM-dd')) ?? 0) > 0,
            }}
            modifiersClassNames={{
              hasTodos:
                'relative after:absolute after:bottom-0.5 after:left-1/2 after:-translate-x-1/2 after:w-1 after:h-1 after:rounded-full after:bg-primary-500',
            }}
            showOutsideDays
            classNames={{
              months: 'flex flex-col',
              month: 'space-y-1',
              caption: 'flex justify-center pt-0 relative items-center mb-0.5',
              caption_label: 'text-xs font-semibold text-text-primary',
              nav: 'flex items-center gap-0.5',
              button_previous:
                'h-6 w-6 inline-flex items-center justify-center rounded border border-border text-[10px] opacity-80 hover:opacity-100',
              button_next:
                'h-6 w-6 inline-flex items-center justify-center rounded border border-border text-[10px] opacity-80 hover:opacity-100',
              month_caption: 'flex justify-center items-center h-7',
              table: 'w-full border-collapse scale-90 origin-top',
              weekdays: 'flex',
              weekday: 'text-text-muted w-7 text-[0.6rem] font-medium uppercase',
              week: 'flex w-full mt-0.5',
              day: 'group/day relative w-7 h-7 text-center p-0 text-[11px] font-normal',
              day_button: clsx(
                'inline-flex items-center justify-center w-7 h-7 rounded text-text-primary',
                'hover:bg-slate-100/80 dark:hover:bg-slate-800',
                'aria-selected:bg-primary-600 aria-selected:text-white'
              ),
              today: 'ring-1 ring-primary-400 rounded',
              outside: 'text-text-muted opacity-40',
            }}
          />
        </div>
      </div>

      <div className="p-2.5 flex-1 min-h-0 flex flex-col">
        <h3 className="text-[11px] font-bold text-text-primary leading-tight">
          {formatInTimeZone(toDate(`${selectedYmd} 12:00:00`, { timeZone: todoTz }), todoTz, 'EEE, d MMM')}
        </h3>
        <p className="text-[10px] text-text-muted mb-2">
          {selectedDayTodos.length} due
        </p>
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-primary-500" />
          </div>
        ) : selectedDayTodos.length === 0 ? (
          <p className="text-[11px] text-text-secondary">Nothing due.</p>
        ) : (
          <ul className="space-y-1.5 overflow-y-auto flex-1 pr-0.5">
            {selectedDayTodos.map((todo) => (
              <li key={todo.id}>
                <button
                  type="button"
                  onClick={() => openTodo(todo)}
                  className={clsx(
                    'w-full text-left rounded-md border border-border dark:border-border-dark px-2 py-1.5 text-[11px] transition',
                    'hover:bg-slate-100/50 dark:hover:bg-slate-800/80',
                    todo.status === 'completed' && 'opacity-60'
                  )}
                >
                  <div className="font-medium text-text-primary line-clamp-2">{todo.title}</div>
                  <div className="text-[10px] text-text-muted mt-0.5 space-y-0.5">
                    <div>
                      Due: {formatInTimeZone(parseISO(todo.due_date), todoTz, 'h:mm a')}
                      {todo.status === 'completed' ? ' · Done' : ''}
                    </div>
                    {todo.reminder_time &&
                      todo.reminder_type &&
                      todo.reminder_type !== 'none' &&
                      todo.status !== 'completed' && (
                        <div>
                          Reminder:{' '}
                          {isReminderAtDueTime(todo.reminder_time, todo.due_date)
                            ? 'At due time'
                            : formatInTimeZone(parseISO(todo.reminder_time), todoTz, 'h:mm a')}
                        </div>
                      )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

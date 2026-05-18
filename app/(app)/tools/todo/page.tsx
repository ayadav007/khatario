'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useSubscriptionCheck } from '@/hooks/useSubscriptionCheck';
import { useLayoutData } from '@/contexts/LayoutDataContext';
import { Toast, ToastType } from '@/components/ui/Toast';
import {
  CheckCircle2,
  Circle,
  Clock,
  AlertCircle,
  Plus,
  MoreVertical,
  Calendar,
  Bell,
  X,
  ChevronRight,
  ClipboardList,
  Search,
  Filter,
  ArrowRight,
  PlayCircle,
  Flag,
  Loader2,
  Lock,
  PanelRightClose,
  PanelRight,
} from 'lucide-react';
import { format, isPast, parseISO, addDays, formatDistanceToNow } from 'date-fns';
import formatInTimeZone from 'date-fns-tz/formatInTimeZone';
import toDate from 'date-fns-tz/toDate';
import { clsx } from 'clsx';
import { DateTimePicker } from '@/components/ui/DateTimePicker';
import zonedTimeToUtc from 'date-fns-tz/zonedTimeToUtc';
import { getBusinessTodoTimezone, dueInstantToZonedDayKey } from '@/lib/todo-timezone';
import {
  applyMinLeadToUserChoice,
  computeSmartReminderUtc,
  getReminderConfigSource,
  isReminderAtDueTime,
  reminderFromPresetUtc,
  setReminderConfigSource,
  type ReminderPreset,
} from '@/lib/todo-reminder-defaults';
import { useTodoScheduleRail } from '@/contexts/TodoScheduleRailContext';

type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'overdue';
type TodoPriority = 'low' | 'medium' | 'high';
type TodoView = 'today' | 'upcoming' | 'overdue' | 'completed' | 'high_priority';

interface Todo {
  id: string;
  title: string;
  description?: string;
  due_date: string;
  priority: TodoPriority;
  status: TodoStatus;
  reminder_type: 'none' | 'once' | 'recurring';
  reminder_time?: string;
  reminder_channels?: string[];
  assigned_to?: string;
  related_entity_type?: string;
  related_entity_id?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

interface TodoStats {
  today: number;
  upcoming: number;
  overdue: number;
  high_priority: number;
}

type AdvancedTodoFormState = {
  title: string;
  description: string;
  due_date: string;
  due_time: string;
  priority: TodoPriority;
  reminder_type: 'none' | 'once' | 'recurring';
  reminder_preset: ReminderPreset;
  reminder_time: string;
  reminder_channels: string[];
  assigned_to: string | null;
  related_entity_type: string;
  related_entity_id: string;
};

export default function TodoPage() {
  const { business, user } = useAuth();
  const router = useRouter();
  const { hasFeature, loading: featureLoading } = useSubscriptionCheck(business?.id);
  const { refreshNotifications } = useLayoutData();
  const hasTodoFeature = hasFeature('todo');
  const todoTz = useMemo(() => getBusinessTodoTimezone(business), [business]);
  const { visible: showGlobalScheduleRail, setVisible: setShowGlobalScheduleRail, bumpRefresh } =
    useTodoScheduleRail();

  const [todos, setTodos] = useState<Todo[]>([]);
  const [stats, setStats] = useState<TodoStats>({ today: 0, upcoming: 0, overdue: 0, high_priority: 0 });
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState<TodoView>('today');

  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showAdvancedAdd, setShowAdvancedAdd] = useState(false);
  const [selectedTodo, setSelectedTodo] = useState<Todo | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  // Quick add form state
  const [quickForm, setQuickForm] = useState({
    title: '',
    due_datetime: new Date().toISOString(), // Single datetime field
    priority: 'medium' as TodoPriority
  });

  // Advanced add form state
  const [advancedForm, setAdvancedForm] = useState<AdvancedTodoFormState>({
    title: '',
    description: '',
    due_date: format(new Date(), 'yyyy-MM-dd'),
    due_time: '17:00',
    priority: 'medium',
    reminder_type: 'once',
    reminder_preset: 'smart',
    reminder_time: '',
    reminder_channels: ['in_app'], // Default to in_app only
    assigned_to: '',
    related_entity_type: '',
    related_entity_id: ''
  });

  const fetchTodos = useCallback(async (view?: TodoView) => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const viewToUse = view || currentView;
      const userIdParam = user?.id ? `&user_id=${user.id}` : '';
      const res = await fetch(`/api/todos?business_id=${business.id}${userIdParam}&view=${viewToUse}`);
      if (res.ok) {
        const data = await res.json();
        setTodos(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error fetching todos:', error);
      setTodos([]);
    } finally {
      setLoading(false);
    }
  }, [business?.id, user?.id, currentView]);

  const fetchStats = useCallback(async () => {
    if (!business?.id) return;
    try {
      const userIdParam = user?.id ? `&user_id=${user.id}` : '';
      const res = await fetch(`/api/todos/stats?business_id=${business.id}${userIdParam}`);
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  }, [business?.id, user?.id]);

  // Refresh notifications when page becomes visible (instead of polling)
  // Reminders are handled by server-side cron job or Redis worker
  useEffect(() => {
    if (!business?.id) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Only refresh notifications when user returns to the page
        refreshNotifications();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Refresh notifications immediately on mount
    refreshNotifications();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [business?.id, refreshNotifications]);

  useEffect(() => {
    fetchTodos();
    fetchStats();
  }, [fetchTodos, fetchStats]);

  useEffect(() => {
    if (!hasTodoFeature || loading) return;
    const id = typeof window !== 'undefined' ? sessionStorage.getItem('khatario_todo_open_id') : null;
    if (!id) return;

    const found = todos.find((t) => t.id === id);
    if (found) {
      setSelectedTodo(found);
      sessionStorage.removeItem('khatario_todo_open_id');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/todos/${id}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data.todo && !cancelled) {
          setSelectedTodo(data.todo);
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) {
          try {
            sessionStorage.removeItem('khatario_todo_open_id');
          } catch {
            /* ignore */
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [todos, loading, hasTodoFeature]);

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickForm.title || !business?.id) return;

    try {
      const dueDateTime = quickForm.due_datetime; // ISO from DateTimePicker
      const dueUtc = new Date(dueDateTime);
      const reminderTime = computeSmartReminderUtc(dueUtc, new Date());

      // Build reminder_channels array - default to in_app only for quick add
      const reminderChannels = ['in_app'];
      
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          assigned_to: user?.id || null,
          title: quickForm.title,
          due_date: dueDateTime,
          priority: quickForm.priority,
          reminder_type: 'once',
          reminder_time: reminderTime.toISOString(),
          reminder_channels: reminderChannels,
          created_by: user?.id || null
        })
      });

      const data = await res.json();

      if (res.ok) {
        if (data?.id) setReminderConfigSource(String(data.id), 'auto');
        setQuickForm({ title: '', due_datetime: new Date().toISOString(), priority: 'medium' });
        setShowQuickAdd(false);
        fetchTodos();
        fetchStats();
        bumpRefresh();
        setToast({ message: 'Todo created successfully!', type: 'success' });
      } else {
        setToast({ message: data.error || 'Failed to create todo', type: 'error' });
        console.error('Failed to create todo:', data);
      }
    } catch (error) {
      console.error('Error creating todo:', error);
      setToast({ message: 'Failed to create todo. Please try again.', type: 'error' });
    }
  };

  const handleAdvancedAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!advancedForm.title || !business?.id) return;

    try {
      const dueInstant = zonedTimeToUtc(
        `${advancedForm.due_date} ${advancedForm.due_time}:00`,
        todoTz
      );
      const dueDateTime = dueInstant.toISOString();
      const now = new Date();
      let reminderTime: string | null = null;
      
      if (advancedForm.reminder_type !== 'none') {
        if (advancedForm.reminder_preset === 'custom' && advancedForm.reminder_time) {
          const chosen = new Date(advancedForm.reminder_time);
          reminderTime = applyMinLeadToUserChoice(chosen, now).toISOString();
        } else if (advancedForm.reminder_preset === 'custom' && !advancedForm.reminder_time) {
          reminderTime = computeSmartReminderUtc(dueInstant, now).toISOString();
        } else if (advancedForm.reminder_preset === 'smart') {
          reminderTime = computeSmartReminderUtc(dueInstant, now).toISOString();
        } else if (
          advancedForm.reminder_preset === 'at_due' ||
          advancedForm.reminder_preset === 'm10' ||
          advancedForm.reminder_preset === 'm30' ||
          advancedForm.reminder_preset === 'h1'
        ) {
          reminderTime = reminderFromPresetUtc(
            dueInstant,
            advancedForm.reminder_preset,
            now
          ).toISOString();
        } else {
          reminderTime = computeSmartReminderUtc(dueInstant, now).toISOString();
        }
      }

      // Build reminder_channels array based on form state
      const reminderChannels: string[] = ['in_app']; // Always include in_app
      if (advancedForm.reminder_channels && advancedForm.reminder_channels.includes('whatsapp')) {
        reminderChannels.push('whatsapp');
      }
      
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          assigned_to: advancedForm.assigned_to || user?.id || null,
          title: advancedForm.title,
          description: advancedForm.description,
          due_date: dueDateTime,
          priority: advancedForm.priority,
          reminder_type: advancedForm.reminder_type,
          reminder_time: reminderTime,
          reminder_channels: reminderChannels,
          related_entity_type: advancedForm.related_entity_type || null,
          related_entity_id: advancedForm.related_entity_id || null,
          created_by: user?.id || null
        })
      });

      const data = await res.json();

      if (res.ok) {
        if (data?.id) setReminderConfigSource(String(data.id), 'user');
        setAdvancedForm({
          title: '',
          description: '',
          due_date: format(new Date(), 'yyyy-MM-dd'),
          due_time: '17:00',
          priority: 'medium',
          reminder_type: 'once',
          reminder_preset: 'smart',
          reminder_time: '',
          reminder_channels: ['in_app'],
          assigned_to: '',
          related_entity_type: '',
          related_entity_id: ''
        });
        setShowAdvancedAdd(false);
        fetchTodos();
        fetchStats();
        bumpRefresh();
        setToast({ message: 'Todo created successfully!', type: 'success' });
      } else {
        setToast({ message: data.error || 'Failed to create todo', type: 'error' });
        console.error('Failed to create todo:', data);
      }
    } catch (error) {
      console.error('Error creating todo:', error);
      setToast({ message: 'Failed to create todo. Please try again.', type: 'error' });
    }
  };

  const toggleStatus = async (todo: Todo) => {
    if (!user?.id) return;
    
    const newStatus = todo.status === 'completed' ? 'pending' : 'completed';
    
    try {
      const res = await fetch(`/api/todos/${todo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, action_by: user.id })
      });
      const data = await res.json();
      if (res.ok) {
        fetchTodos();
        fetchStats();
        bumpRefresh();
        setToast({ 
          message: `Todo marked as ${newStatus === 'completed' ? 'completed' : 'pending'}`, 
          type: 'success' 
        });
      } else {
        setToast({ message: data.error || 'Failed to update todo', type: 'error' });
      }
    } catch (error) {
      console.error('Error updating todo:', error);
      setToast({ message: 'Failed to update todo. Please try again.', type: 'error' });
    }
  };

  const handleSnooze = async (todoId: string, minutes: number) => {
    if (!user?.id) return;
    
    const snoozeUntil = new Date();
    snoozeUntil.setMinutes(snoozeUntil.getMinutes() + minutes);
    
    try {
      const res = await fetch(`/api/todos/${todoId}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snooze_until: snoozeUntil.toISOString(), action_by: user.id })
      });
      const data = await res.json();
      if (res.ok) {
        fetchTodos();
        bumpRefresh();
        setSelectedTodo(null);
        setToast({ message: 'Todo snoozed successfully', type: 'success' });
      } else {
        setToast({ message: data.error || 'Failed to snooze todo', type: 'error' });
      }
    } catch (error) {
      console.error('Error snoozing todo:', error);
      setToast({ message: 'Failed to snooze todo. Please try again.', type: 'error' });
    }
  };

  const formatDueDate = (dateStr: string) => {
    if (!dateStr) return null;
    const d = parseISO(dateStr);
    const key = dueInstantToZonedDayKey(d, todoTz);
    const todayKey = formatInTimeZone(new Date(), todoTz, 'yyyy-MM-dd');
    const tomorrowAnchor = toDate(`${todayKey} 12:00:00`, { timeZone: todoTz });
    const tomorrowKey = formatInTimeZone(addDays(tomorrowAnchor, 1), todoTz, 'yyyy-MM-dd');
    if (key === todayKey) return 'Today, ' + formatInTimeZone(d, todoTz, 'h:mm a');
    if (key === tomorrowKey) return 'Tomorrow, ' + formatInTimeZone(d, todoTz, 'h:mm a');
    if (isPast(d)) return 'Overdue • ' + formatInTimeZone(d, todoTz, 'MMM d, h:mm a');
    return formatInTimeZone(d, todoTz, 'MMM d, h:mm a');
  };

  const getPriorityColor = (priority: TodoPriority) => {
    switch (priority) {
      case 'high':
        return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900';
      case 'medium':
        return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900';
      case 'low':
        return 'text-primary-600 dark:text-sky-400 bg-slate-50 dark:bg-primary-900/35 border-primary-200 dark:border-primary-900';
    }
  };

  const filteredTodos = todos.filter(todo => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return todo.title.toLowerCase().includes(query) || 
           todo.description?.toLowerCase().includes(query);
  });

  const viewLabels: Record<TodoView, string> = {
    today: 'Today',
    upcoming: 'Upcoming',
    overdue: 'Overdue',
    completed: 'Completed',
    high_priority: 'High Priority'
  };

  const getViewCount = (view: TodoView): number => {
    switch (view) {
      case 'today': return stats.today;
      case 'upcoming': return stats.upcoming;
      case 'overdue': return stats.overdue;
      case 'high_priority': return stats.high_priority;
      default: return 0;
    }
  };

  // Check feature access
  if (featureLoading) {
    return (
      
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      
    );
  }

  if (!hasTodoFeature) {
    return (
      
        <div className="max-w-2xl mx-auto py-8">
          <Card className="p-8 text-center">
            <Lock className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Todo List is Locked
            </h2>
            <p className="text-gray-600 mb-6">
              Upgrade your plan to unlock Todo List and task reminders.
            </p>
            <Button
              onClick={() => router.push('/settings?tab=subscription')}
            >
              View Plans
            </Button>
          </Card>
        </div>
      
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-0">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h1 className="text-3xl font-extrabold text-text-primary tracking-tight">Todo</h1>
            <p className="text-text-secondary mt-1">Manage tasks and reminders</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-10 px-3"
              onClick={() => setShowGlobalScheduleRail(!showGlobalScheduleRail)}
              title={
                showGlobalScheduleRail
                  ? 'Hide app-wide schedule panel'
                  : 'Show app-wide schedule panel'
              }
              aria-pressed={showGlobalScheduleRail}
            >
              {showGlobalScheduleRail ? (
                <PanelRightClose className="w-4 h-4 sm:mr-1" />
              ) : (
                <PanelRight className="w-4 h-4 sm:mr-1" />
              )}
              <span className="hidden sm:inline">App schedule</span>
            </Button>
            <Button onClick={() => setShowQuickAdd(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Todo
            </Button>
          </div>
        </div>

        {/* View Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {(['today', 'upcoming', 'overdue', 'completed', 'high_priority'] as TodoView[]).map((view) => {
            const count = getViewCount(view);
            const isActive = currentView === view;
            return (
              <button
                key={view}
                onClick={() => {
                  setCurrentView(view);
                  fetchTodos(view);
                }}
                className={clsx(
                  "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all flex items-center gap-2",
                  isActive 
                    ? "bg-primary-600 text-white shadow-sm" 
                    : "bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-200 dark:hover:bg-slate-700 border border-transparent dark:border-slate-600"
                )}
              >
                {viewLabels[view]}
                {count > 0 && (
                  <span className={clsx(
                    "px-2 py-0.5 rounded-full text-xs font-bold",
                    isActive ? "bg-white/20" : "bg-gray-200 dark:bg-slate-600 dark:text-slate-100"
                  )}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Quick Add Form */}
        {showQuickAdd && (
          <Card padding="md" className="border-primary-200 dark:border-primary-800 bg-slate-50/30 dark:bg-primary-900/25">
            <form onSubmit={handleQuickAdd} className="space-y-4">
              <div className="flex items-start justify-between">
                <h3 className="font-bold text-lg text-text-primary">Quick Add Todo</h3>
                <button type="button" onClick={() => setShowQuickAdd(false)} className="text-text-muted hover:text-text-primary">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <Input
                required
                placeholder="What needs to be done?"
                value={quickForm.title}
                onChange={(e) => setQuickForm({...quickForm, title: e.target.value})}
                className="text-lg"
                autoFocus
              />
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1 text-text-primary">Due Date & Time</label>
                  <DateTimePicker
                    value={quickForm.due_datetime}
                    onChange={(datetime) => setQuickForm({...quickForm, due_datetime: datetime})}
                    placeholder="Select date & time"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-text-primary">Priority</label>
                  <select
                    className="w-full h-10 px-3 border border-border rounded-lg bg-surface text-text-primary"
                    value={quickForm.priority}
                    onChange={(e) => setQuickForm({...quickForm, priority: e.target.value as TodoPriority})}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="ghost" onClick={() => setShowQuickAdd(false)}>
                  Cancel
                </Button>
                <Button type="submit">Add Todo</Button>
                <Button 
                  type="button" 
                  variant="ghost" 
                  onClick={() => {
                    // Transfer data from quickForm to advancedForm
                    const dueDate = new Date(quickForm.due_datetime);
                    setAdvancedForm({
                      title: quickForm.title,
                      description: '',
                      due_date: format(dueDate, 'yyyy-MM-dd'),
                      due_time: format(dueDate, 'HH:mm'),
                      priority: quickForm.priority,
                      reminder_type: 'once',
                      reminder_preset: 'smart',
                      reminder_time: '',
                      reminder_channels: ['in_app'],
                      assigned_to: '',
                      related_entity_type: '',
                      related_entity_id: ''
                    });
                    setShowQuickAdd(false);
                    setShowAdvancedAdd(true);
                  }}
                >
                  More Options →
                </Button>
              </div>
            </form>
          </Card>
        )}

        {/* Advanced Add Form */}
        {showAdvancedAdd && (
          <TodoAdvancedForm
            formData={advancedForm}
            setFormData={setAdvancedForm}
            onSubmit={handleAdvancedAdd}
            onClose={() => setShowAdvancedAdd(false)}
            businessId={business?.id}
            userId={user?.id}
            todoTz={todoTz}
          />
        )}

        {/* Search & Filters */}
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-muted w-4 h-4" />
            <Input
              placeholder="Search todos..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Todo List */}
        {loading ? (
          <Card padding="lg" className="text-center py-12">
            <Loader2 className="w-8 h-8 mx-auto text-primary-500 animate-spin mb-2" />
            <p className="text-text-secondary">Loading todos...</p>
          </Card>
        ) : filteredTodos.length === 0 ? (
          <Card padding="lg" className="text-center py-12 border-dashed">
            <ClipboardList className="w-12 h-12 mx-auto text-text-muted mb-4" />
            <h3 className="text-lg font-medium text-text-primary mb-1">
              {currentView === 'completed' ? '🎉 All caught up!' : 'No todos found'}
            </h3>
            <p className="text-sm text-text-secondary mb-4">
              {currentView === 'completed' 
                ? "You've completed all your tasks."
                : 'Get started by creating your first todo above.'}
            </p>
            {currentView !== 'completed' && (
              <Button onClick={() => setShowQuickAdd(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create Todo
              </Button>
            )}
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredTodos.map((todo) => (
              <TodoCard
                key={todo.id}
                todo={todo}
                onToggle={() => toggleStatus(todo)}
                onClick={() => setSelectedTodo(todo)}
                formatDueDate={formatDueDate}
                getPriorityColor={getPriorityColor}
                todoTz={todoTz}
              />
            ))}
          </div>
        )}

        {/* Todo Detail Modal */}
        {selectedTodo && (
          <TodoDetailModal
            todo={selectedTodo}
            onClose={() => setSelectedTodo(null)}
            onUpdate={() => {
              fetchTodos();
              fetchStats();
              bumpRefresh();
              setSelectedTodo(null);
            }}
            onSnooze={handleSnooze}
            userId={user?.id}
            todoTz={todoTz}
          />
        )}

        {/* Toast Notification */}
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </div>
    </div>
  );
}

// Todo Card Component
function TodoCard({ 
  todo, 
  onToggle, 
  onClick,
  formatDueDate,
  getPriorityColor,
  todoTz,
}: { 
  todo: Todo; 
  onToggle: () => void;
  onClick: () => void;
  formatDueDate: (date: string) => string | null;
  getPriorityColor: (priority: TodoPriority) => string;
  todoTz: string;
}) {
  const isOverdue = todo.status === 'overdue' || (todo.status !== 'completed' && isPast(parseISO(todo.due_date)));
  const dueDateStr = formatDueDate(todo.due_date);
  const showReminderLine =
    Boolean(todo.reminder_time) &&
    todo.reminder_type !== 'none' &&
    todo.status !== 'completed';

  return (
    <Card 
      padding="none" 
      className={clsx(
        "group cursor-pointer hover:shadow-md transition-all border-l-4",
        todo.status === 'completed' ? "opacity-75 border-l-transparent" : "",
        todo.priority === 'high' ? "border-l-red-500" : 
        todo.priority === 'medium' ? "border-l-amber-500" : "border-l-primary-500",
        isOverdue && todo.status !== 'completed'
          ? "bg-red-50/50 dark:bg-red-950/25 border-red-200 dark:border-red-900/60"
          : ""
      )}
      onClick={onClick}
    >
      <div className="p-4 flex items-start gap-4">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={clsx(
            "mt-1 transition-colors rounded-full flex-shrink-0",
            todo.status === 'completed'
              ? "text-success-600 dark:text-success-500"
              : "text-text-muted hover:text-primary-600 dark:hover:text-primary-400"
          )}
        >
          {todo.status === 'completed' ? (
            <CheckCircle2 className="w-6 h-6" />
          ) : (
            <Circle className="w-6 h-6" />
          )}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h4 className={clsx(
                "font-bold text-text-primary mb-1",
                todo.status === 'completed' && "line-through text-text-muted"
              )}>
                {todo.title}
              </h4>
              {todo.description && (
                <p className={clsx(
                  "text-sm text-text-secondary line-clamp-2",
                  todo.status === 'completed' && "line-through opacity-50"
                )}>
                  {todo.description}
                </p>
              )}
            </div>
            {todo.priority === 'high' && (
              <Flag className="w-5 h-5 text-red-500 flex-shrink-0" />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-3">
            <div className={clsx(
              "text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-tight border",
              getPriorityColor(todo.priority)
            )}>
              {todo.priority}
            </div>

            <div className="flex flex-col gap-0.5 min-w-0">
            {dueDateStr && (
              <div className={clsx(
                "flex items-center gap-1 text-xs font-medium",
                isOverdue && todo.status !== 'completed' ? "text-red-600 dark:text-red-400" : "text-text-secondary"
              )}>
                <Calendar className="w-3 h-3 shrink-0" />
                <span>
                  <span className="text-text-muted font-normal">Due: </span>
                  {dueDateStr}
                </span>
              </div>
            )}

            {showReminderLine && (
              <div className="flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400">
                <Bell className="w-3 h-3 shrink-0" />
                <span>
                  <span className="text-text-muted font-normal">Reminder: </span>
                  {isReminderAtDueTime(todo.reminder_time!, todo.due_date)
                    ? 'At due time'
                    : formatInTimeZone(parseISO(todo.reminder_time!), todoTz, 'MMM d, h:mm a')}
                </span>
              </div>
            )}
            </div>

            {todo.related_entity_type && (
              <div className="text-xs text-text-secondary bg-gray-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-border dark:border-slate-600">
                {todo.related_entity_type}
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

// Advanced Form Component
function TodoAdvancedForm({
  formData,
  setFormData,
  onSubmit,
  onClose,
  businessId,
  userId,
  todoTz,
}: {
  formData: AdvancedTodoFormState;
  setFormData: React.Dispatch<React.SetStateAction<AdvancedTodoFormState>>;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  businessId?: string;
  userId?: string;
  todoTz: string;
}) {
  const [users, setUsers] = useState<Array<{ id: string; name: string; display_name: string }>>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const { hasFeature } = useSubscriptionCheck(businessId);
  const hasWhatsAppAccess = hasFeature('whatsapp_auto_reminders') || hasFeature('whatsapp_bot') || hasFeature('whatsapp_send_message');

  useEffect(() => {
    if (businessId) {
      fetchUsers();
    }
  }, [businessId]);

  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const res = await fetch(`/api/todos/users?business_id=${businessId}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoadingUsers(false);
    }
  };

  return (
    <Card padding="md" className="border-primary-200 dark:border-primary-800 bg-slate-50/30 dark:bg-primary-900/25">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="flex items-start justify-between">
          <h3 className="font-bold text-lg text-text-primary">Advanced Todo</h3>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div>
          <label className="block text-sm font-medium mb-1 text-text-primary">Title *</label>
          <Input
            required
            value={formData.title}
            onChange={(e) => setFormData({...formData, title: e.target.value})}
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium mb-1 text-text-primary">Description</label>
          <Textarea
            rows={3}
            value={formData.description}
            onChange={(e) => setFormData({...formData, description: e.target.value})}
            placeholder="Optional notes..."
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium mb-1 text-text-primary">Assign To</label>
          <select
            className="w-full h-10 px-3 border border-border rounded-lg bg-surface text-text-primary"
            value={formData.assigned_to || ''}
            onChange={(e) => setFormData({...formData, assigned_to: e.target.value || null})}
            disabled={loadingUsers}
          >
            <option value="">Myself (Unassigned)</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.display_name || user.name}
              </option>
            ))}
          </select>
          {loadingUsers && (
            <p className="text-xs text-text-muted mt-1">Loading users...</p>
          )}
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-text-primary">Due Date *</label>
            <Input
              type="date"
              required
              value={formData.due_date}
              onChange={(e) => setFormData({...formData, due_date: e.target.value})}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-text-primary">Time</label>
            <Input
              type="time"
              value={formData.due_time}
              onChange={(e) => setFormData({...formData, due_time: e.target.value})}
            />
          </div>
        </div>
        
        <div>
          <label className="block text-sm font-medium mb-1 text-text-primary">Priority</label>
          <select
            className="w-full h-10 px-3 border border-border rounded-lg bg-surface text-text-primary"
            value={formData.priority}
            onChange={(e) => setFormData({...formData, priority: e.target.value as TodoPriority})}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        
        <div>
          <label className="block text-sm font-medium mb-1 text-text-primary">Reminder</label>
          <select
            className="w-full h-10 px-3 border border-border rounded-lg bg-surface text-text-primary mb-2"
            value={formData.reminder_type}
            onChange={(e) => {
              const v = e.target.value as 'none' | 'once' | 'recurring';
              setFormData({
                ...formData,
                reminder_type: v,
                reminder_time: v === 'none' ? '' : formData.reminder_time,
                reminder_preset: v === 'none' ? 'smart' : formData.reminder_preset,
              });
            }}
          >
            <option value="none">No Reminder</option>
            <option value="once">Once</option>
            <option value="recurring">Recurring</option>
          </select>
          {formData.reminder_type !== 'none' && (
            <>
              <div className="mb-2">
                <label className="block text-xs font-medium mb-1 text-text-secondary">When to remind</label>
                <select
                  className="w-full h-10 px-3 border border-border rounded-lg bg-surface text-text-primary"
                  value={formData.reminder_preset}
                  onChange={(e) => {
                    const p = e.target.value as ReminderPreset;
                    setFormData({
                      ...formData,
                      reminder_preset: p,
                      reminder_time: p === 'custom' ? formData.reminder_time : '',
                    });
                  }}
                >
                  <option value="smart">Smart default</option>
                  <option value="at_due">At due time</option>
                  <option value="m10">10 min before</option>
                  <option value="m30">30 min before</option>
                  <option value="h1">1 hour before</option>
                  <option value="custom">Custom</option>
                </select>
                <p className="text-[10px] text-text-muted mt-1" title={todoTz}>
                  Due is interpreted in {todoTz.replace(/_/g, ' ')}.
                </p>
              </div>
              {formData.reminder_preset === 'custom' && (
                <Input
                  type="datetime-local"
                  value={formData.reminder_time}
                  onChange={(e) => setFormData({ ...formData, reminder_time: e.target.value })}
                  placeholder="Custom reminder"
                  className="mb-2"
                />
              )}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-text-primary">
                  <input
                    type="checkbox"
                    checked={formData.reminder_channels?.includes('in_app') ?? true}
                    onChange={(e) => {
                      const channels = formData.reminder_channels || ['in_app'];
                      const newChannels = e.target.checked
                        ? [...channels.filter((c: string) => c !== 'in_app'), 'in_app']
                        : channels.filter((c: string) => c !== 'in_app');
                      setFormData({...formData, reminder_channels: newChannels.length > 0 ? newChannels : ['in_app']});
                    }}
                    className="w-4 h-4 text-primary-600 rounded border-border dark:border-slate-500 bg-surface focus:ring-primary-500"
                  />
                  <span>In-App Notification</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-text-primary">
                  <input
                    type="checkbox"
                    checked={formData.reminder_channels?.includes('whatsapp') ?? false}
                    onChange={(e) => {
                      const channels = formData.reminder_channels || ['in_app'];
                      const newChannels = e.target.checked
                        ? [...channels.filter((c: string) => c !== 'whatsapp'), 'whatsapp']
                        : channels.filter((c: string) => c !== 'whatsapp');
                      setFormData({...formData, reminder_channels: newChannels.length > 0 ? newChannels : ['in_app']});
                    }}
                    className="w-4 h-4 text-primary-600 rounded border-border dark:border-slate-500 bg-surface focus:ring-primary-500"
                  />
                  <span>WhatsApp Message</span>
                  {!hasWhatsAppAccess && (
                    <span className="text-xs text-text-muted">(Requires WhatsApp access)</span>
                  )}
                </label>
              </div>
            </>
          )}
        </div>
        
        <div>
          <label className="block text-sm font-medium mb-1 text-text-primary">Link to</label>
          <select
            className="w-full h-10 px-3 border border-border rounded-lg bg-surface text-text-primary"
            value={formData.related_entity_type}
            onChange={(e) => setFormData({...formData, related_entity_type: e.target.value, related_entity_id: ''})}
          >
            <option value="">None</option>
            <option value="invoice">Invoice</option>
            <option value="gst_return">GST Return</option>
            <option value="party">Party/Customer</option>
            <option value="purchase">Purchase</option>
          </select>
        </div>
        
        <div className="flex gap-2 justify-end pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit">Create Todo</Button>
        </div>
      </form>
    </Card>
  );
}

// Todo Detail Modal Component
function TodoDetailModal({
  todo,
  onClose,
  onUpdate,
  onSnooze,
  userId,
  todoTz,
}: {
  todo: Todo;
  onClose: () => void;
  onUpdate: () => void;
  onSnooze: (id: string, minutes: number) => void;
  userId?: string;
  todoTz: string;
}) {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showReschedule, setShowReschedule] = useState(false);
  const [newDueDate, setNewDueDate] = useState('');
  const [newDueTime, setNewDueTime] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');

  useEffect(() => {
    fetchHistory();
  }, [todo.id]);

  const fetchHistory = async () => {
    try {
      const res = await fetch(`/api/todos/${todo.id}`);
      if (res.ok) {
        const data = await res.json();
        setHistory(data.history || []);
      }
    } catch (error) {
      console.error('Error fetching history:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleReschedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDueDate || !userId) return;

    try {
      const newDueInstant = zonedTimeToUtc(
        `${newDueDate} ${(newDueTime || '17:00')}:00`,
        todoTz
      );
      const newDueDateTime = newDueInstant.toISOString();
      const payload: {
        due_date: string;
        action_by: string;
        reason: string;
        reminder_time?: string;
      } = {
        due_date: newDueDateTime,
        action_by: userId,
        reason: rescheduleReason
      };
      if (
        getReminderConfigSource(todo.id) === 'auto' &&
        todo.reminder_type &&
        todo.reminder_type !== 'none' &&
        todo.reminder_time
      ) {
        payload.reminder_time = computeSmartReminderUtc(newDueInstant, new Date()).toISOString();
      } else if (
        todo.reminder_type &&
        todo.reminder_type !== 'none' &&
        todo.reminder_time
      ) {
        // Reschedule due: align next reminder to new due (at-due) so DB + BullMQ match; preset not stored on row.
        payload.reminder_time = reminderFromPresetUtc(
          newDueInstant,
          'at_due',
          new Date()
        ).toISOString();
      }
      const res = await fetch(`/api/todos/${todo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok) {
        setShowReschedule(false);
        setNewDueDate('');
        setNewDueTime('');
        setRescheduleReason('');
        onUpdate();
      } else {
        console.error('Failed to reschedule:', data);
      }
    } catch (error) {
      console.error('Error rescheduling:', error);
    }
  };

  const handleMarkComplete = async () => {
    if (!userId) return;
    try {
      const res = await fetch(`/api/todos/${todo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed', action_by: userId })
      });
      if (res.ok) {
        onUpdate();
      }
    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  const isOverdue = todo.status === 'overdue' || (todo.status !== 'completed' && isPast(parseISO(todo.due_date)));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <Card 
        padding="lg" 
        className="max-w-2xl w-full max-h-[90vh] overflow-y-auto relative z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-6">
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-text-primary mb-2">{todo.title}</h2>
            {todo.description && (
              <p className="text-text-secondary">{todo.description}</p>
            )}
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary ml-4 shrink-0">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Status & Priority */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Status</label>
            <div className="text-lg font-semibold capitalize">{todo.status.replace('_', ' ')}</div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Priority</label>
            <div className={clsx(
              "inline-block px-3 py-1 rounded-full text-sm font-bold uppercase",
              todo.priority === 'high'
                ? 'bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-300'
                : todo.priority === 'medium'
                  ? 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300'
                  : 'bg-slate-100 dark:bg-primary-900/45 text-primary-700 dark:text-sky-300'
            )}>
              {todo.priority}
            </div>
          </div>
        </div>

        {/* Due + reminder (business timezone) */}
        <div className="mb-6 space-y-2">
          <div>
            <div className="text-sm font-medium text-text-secondary mb-1">Due</div>
            <div
              className={clsx(
                'text-lg font-semibold',
                isOverdue && todo.status !== 'completed'
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-text-primary'
              )}
            >
              {formatInTimeZone(parseISO(todo.due_date), todoTz, 'PPP, h:mm a')}
              {isOverdue && todo.status !== 'completed' && (
                <span className="ml-2 text-sm text-red-600 dark:text-red-400">(Overdue)</span>
              )}
            </div>
          </div>
          {todo.reminder_time && todo.reminder_type !== 'none' && (
            <div>
              <div className="text-sm font-medium text-text-secondary mb-1">Reminder</div>
              <div className="text-lg font-semibold text-text-primary">
                {isReminderAtDueTime(todo.reminder_time, todo.due_date)
                  ? 'At due time'
                  : formatInTimeZone(parseISO(todo.reminder_time), todoTz, 'PPP, h:mm a')}
              </div>
            </div>
          )}
        </div>

        {/* Related Entity */}
        {todo.related_entity_type && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-text-secondary mb-1">Linked to</label>
            <div className="text-lg font-semibold text-text-primary capitalize">
              {todo.related_entity_type}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2 mb-6 pb-6 border-b border-border">
          {todo.status !== 'completed' && (
            <>
              <Button onClick={handleMarkComplete}>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Mark Complete
              </Button>
              <Button onClick={() => setShowReschedule(true)} variant="secondary">
                <Calendar className="w-4 h-4 mr-2" />
                Reschedule
              </Button>
              <Button onClick={() => onSnooze(todo.id, 10)} variant="secondary">
                <Clock className="w-4 h-4 mr-2" />
                Snooze 10min
              </Button>
              <Button onClick={() => onSnooze(todo.id, 60)} variant="secondary">
                <Clock className="w-4 h-4 mr-2" />
                Snooze 1hr
              </Button>
              <Button onClick={() => onSnooze(todo.id, 1440)} variant="secondary">
                <Clock className="w-4 h-4 mr-2" />
                Snooze Tomorrow
              </Button>
            </>
          )}
        </div>

        {/* Reschedule Form */}
        {showReschedule && (
          <Card padding="md" className="mb-6 border-primary-200 dark:border-primary-800 bg-slate-50/30 dark:bg-primary-900/25">
            <form onSubmit={handleReschedule} className="space-y-4">
              <h3 className="font-bold text-lg mb-4 text-text-primary">Reschedule Todo</h3>
              <div>
                <label className="block text-sm font-medium mb-1 text-text-primary">Old Due Date</label>
                <div className="text-sm text-text-secondary">
                  {formatInTimeZone(parseISO(todo.due_date), todoTz, 'PPP, h:mm a')}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 text-text-primary">New Due Date *</label>
                  <Input
                    type="date"
                    required
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-text-primary">Time</label>
                  <Input
                    type="time"
                    value={newDueTime}
                    onChange={(e) => setNewDueTime(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-text-primary">Reason (optional)</label>
                <Textarea
                  rows={2}
                  value={rescheduleReason}
                  onChange={(e) => setRescheduleReason(e.target.value)}
                  placeholder="Why are you rescheduling?"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="ghost" onClick={() => setShowReschedule(false)}>
                  Cancel
                </Button>
                <Button type="submit">Confirm Reschedule</Button>
              </div>
            </form>
          </Card>
        )}

        {/* History */}
        <div>
          <h3 className="font-bold text-lg mb-4 text-text-primary">Activity</h3>
          {loading ? (
            <div className="text-center py-4 text-text-secondary">Loading history...</div>
          ) : history.length === 0 ? (
            <div className="text-center py-4 text-text-secondary">No activity yet</div>
          ) : (
            <div className="space-y-3">
              {history.map((entry: any, idx: number) => (
                <div key={idx} className="flex items-start gap-3 pb-3 border-b border-border last:border-0">
                  <div className="w-2 h-2 rounded-full bg-primary-500 mt-2 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="font-medium text-text-primary capitalize">
                      {entry.action.replace('_', ' ')}
                    </div>
                    <div className="text-sm text-text-secondary">
                      {entry.old_value && entry.new_value && (
                        <span>{entry.old_value} → {entry.new_value}</span>
                      )}
                      {entry.reason && (
                        <span className="block italic mt-1">Reason: {entry.reason}</span>
                      )}
                    </div>
                    <div className="text-xs text-text-muted mt-1">
                      {formatDistanceToNow(parseISO(entry.action_date), { addSuffix: true })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

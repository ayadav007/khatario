'use client';

import { useCallback, useEffect, useState } from 'react';

type EmailLog = {
  id: string;
  recipient_email: string;
  subject: string;
  template_key: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
};

export function AdminEmailLogsPanel() {
  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/email-logs?limit=30', { credentials: 'include' });
      const data = await res.json();
      if (res.ok) {
        setLogs(data.logs || []);
        setWarning(data.warning || null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4 mt-8 pt-8 border-t border-border">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Platform email delivery log</h3>
        <button
          type="button"
          onClick={() => void load()}
          className="text-sm text-primary-600 hover:text-primary-700"
        >
          Refresh
        </button>
      </div>
      {warning && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">{warning}</p>}
      {loading ? (
        <p className="text-sm text-gray-600">Loading…</p>
      ) : logs.length === 0 ? (
        <p className="text-sm text-gray-600">No platform emails logged yet.</p>
      ) : (
        <div className="overflow-x-auto border border-border rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">To</th>
                <th className="px-3 py-2 font-medium">Subject</th>
                <th className="px-3 py-2 font-medium">Template</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">{log.recipient_email}</td>
                  <td className="px-3 py-2 max-w-xs truncate" title={log.subject}>
                    {log.subject}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{log.template_key || '—'}</td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        log.status === 'sent'
                          ? 'text-green-700'
                          : log.status === 'failed'
                            ? 'text-red-600'
                            : 'text-gray-600'
                      }
                    >
                      {log.status}
                    </span>
                    {log.error_message && (
                      <span className="block text-xs text-red-500 truncate max-w-[12rem]" title={log.error_message}>
                        {log.error_message}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

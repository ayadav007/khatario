'use client';

export const dynamic = 'force-dynamic';

import React, { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Chip } from '@/components/ui/Chip';

export default function WhatsAppPage() {
  const [activeTab, setActiveTab] = useState<'connections' | 'reminders' | 'logs'>('connections');
  const [apiConnected, setApiConnected] = useState(false);

  return (
    
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-text-primary">WhatsApp & Sharing</h1>
          <p className="text-text-secondary text-sm mt-1">
            Connect WhatsApp and configure automated reminders
          </p>
        </div>

        {/* Tabs */}
        <Card padding="none">
          <div className="border-b border-border">
            <div className="flex">
              {(['connections', 'reminders', 'logs'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-6 py-3 text-sm font-medium transition-colors ${
                    activeTab === tab
                      ? 'text-primary-500 border-b-2 border-primary-500'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="p-6">
            {activeTab === 'connections' && (
              <div className="space-y-6">
                {/* WhatsApp Cloud API */}
                <Card padding="md">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-text-primary mb-1">
                        WhatsApp Cloud API
                      </h3>
                      <p className="text-sm text-text-secondary">
                        Connect using WhatsApp Business Cloud API for automated sending
                      </p>
                    </div>
                    <Chip variant={apiConnected ? 'success' : 'error'}>
                      {apiConnected ? 'Connected' : 'Not Connected'}
                    </Chip>
                  </div>
                  <div className="space-y-4">
                    <Input label="API Key" type="password" placeholder="Enter your API key" />
                    <Input label="API Secret" type="password" placeholder="Enter your API secret" />
                    <Input label="Business Phone Number ID" placeholder="Enter phone number ID" />
                    <Button onClick={() => setApiConnected(!apiConnected)}>
                      {apiConnected ? 'Disconnect' : 'Connect'}
                    </Button>
                  </div>
                </Card>

                {/* WhatsApp Web Session */}
                <Card padding="md">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-text-primary mb-1">
                        WhatsApp Web Session
                      </h3>
                      <p className="text-sm text-text-secondary">
                        Scan QR code to connect your WhatsApp Web session
                      </p>
                    </div>
                  </div>
                  <Button variant="secondary">Show QR to Login</Button>
                  <p className="text-xs text-text-secondary mt-2">
                    Open WhatsApp on your phone, go to Settings → Linked Devices → Link a Device, then scan the QR code.
                  </p>
                </Card>
              </div>
            )}

            {activeTab === 'reminders' && (
              <div className="space-y-6">
                <h2 className="text-lg font-semibold text-text-primary mb-4">Auto Reminders</h2>
                <Card padding="md">
                  <div className="space-y-4">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" defaultChecked className="w-4 h-4" />
                      <span className="text-sm text-text-primary">
                        Send payment reminder 3 days before due date
                      </span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" defaultChecked className="w-4 h-4" />
                      <span className="text-sm text-text-primary">
                        Send overdue reminder every 7 days
                      </span>
                    </label>
                  </div>
                </Card>

                <Card padding="md">
                  <h3 className="text-lg font-semibold text-text-primary mb-4">Message Templates</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-1.5">
                        Payment Reminder Template
                      </label>
                      <textarea
                        className="input min-h-[120px]"
                        defaultValue="Hi {customer_name}, This is a reminder that invoice {invoice_no} for ₹ {amount} is due on {due_date}. Please make payment at your earliest convenience. Thank you!"
                      />
                      <p className="text-xs text-text-secondary mt-1">
                        Available placeholders: {'{customer_name}'}, {'{invoice_no}'}, {'{amount}'}, {'{due_date}'}
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-1.5">
                        Overdue Reminder Template
                      </label>
                      <textarea
                        className="input min-h-[120px]"
                        defaultValue="Hi {customer_name}, Invoice {invoice_no} for ₹ {amount} is now overdue. Please arrange payment immediately. Thank you!"
                      />
                    </div>
                  </div>
                  <Button className="mt-4">Save Templates</Button>
                </Card>
              </div>
            )}

            {activeTab === 'logs' && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-text-primary mb-4">Message Logs</h2>
                <Card padding="none">
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead>
                        <tr className="table-header">
                          <th className="table-cell text-left">Date</th>
                          <th className="table-cell text-left">To</th>
                          <th className="table-cell text-left">Type</th>
                          <th className="table-cell text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="hover:bg-slate-50 transition-colors">
                          <td className="table-cell text-left">2024-01-15 10:30</td>
                          <td className="table-cell text-left">+91 9876543210</td>
                          <td className="table-cell text-left">Invoice</td>
                          <td className="table-cell text-center">
                            <Chip variant="success">Sent</Chip>
                          </td>
                        </tr>
                        <tr className="hover:bg-slate-50 transition-colors">
                          <td className="table-cell text-left">2024-01-14 14:20</td>
                          <td className="table-cell text-left">+91 9876543211</td>
                          <td className="table-cell text-left">Reminder</td>
                          <td className="table-cell text-center">
                            <Chip variant="error">Failed</Chip>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            )}
          </div>
        </Card>
      </div>
    
  );
}


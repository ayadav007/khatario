'use client';

import { useState } from 'react';
import { useAdmin } from '@/context/AdminContext';
import { Settings, Bell, Shield, Database, Megaphone, Mail } from 'lucide-react';
import { AdminEmailTemplatesEditor } from '@/components/admin/AdminEmailTemplatesEditor';
import { PromotionsManager } from '@/components/admin/PromotionsManager';
import { AdminNotificationSettings } from '@/components/admin/AdminNotificationSettings';
import { AdminEmailLogsPanel } from '@/components/admin/AdminEmailLogsPanel';

export default function AdminSettingsPage() {
  useAdmin();
  const [activeTab, setActiveTab] = useState<
    'general' | 'notifications' | 'templates' | 'security' | 'system' | 'promotions'
  >('general');

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Platform Settings</h1>
        <p className="text-gray-600 mt-2">Configure platform-wide settings and preferences</p>
      </div>

      <div className="flex space-x-1 border-b border-gray-200 mb-6">
        {[
          { id: 'general', label: 'General', icon: Settings },
          { id: 'notifications', label: 'Notifications', icon: Bell },
          { id: 'templates', label: 'Email templates', icon: Mail },
          { id: 'security', label: 'Security', icon: Shield },
          { id: 'system', label: 'System', icon: Database },
          { id: 'promotions', label: 'Promotions', icon: Megaphone },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`flex items-center space-x-2 px-4 py-3 border-b-2 transition ${
                activeTab === tab.id
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="font-medium">{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        {activeTab === 'general' && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-gray-900">General Settings</h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Platform Name</label>
              <input
                type="text"
                defaultValue="Khatario"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Support Email</label>
              <input
                type="email"
                defaultValue="support@khatario.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Default Currency</label>
              <select className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500">
                <option value="INR">INR - Indian Rupee</option>
                <option value="USD">USD - US Dollar</option>
                <option value="EUR">EUR - Euro</option>
              </select>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="allow-registrations"
                defaultChecked
                className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
              />
              <label htmlFor="allow-registrations" className="text-sm text-gray-700">
                Allow new business registrations
              </label>
            </div>

            <div className="pt-4">
              <button className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition">
                Save Changes
              </button>
            </div>
          </div>
        )}

        {activeTab === 'notifications' && (
          <>
            <AdminNotificationSettings />
            <AdminEmailLogsPanel />
          </>
        )}

        {activeTab === 'templates' && <AdminEmailTemplatesEditor />}

        {activeTab === 'security' && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-gray-900">Security Settings</h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Session Timeout (minutes)</label>
              <input
                type="number"
                defaultValue="60"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Maximum Login Attempts</label>
              <input
                type="number"
                defaultValue="5"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="two-factor"
                className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
              />
              <label htmlFor="two-factor" className="text-sm text-gray-700">
                Require two-factor authentication for all admins
              </label>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="ip-whitelist"
                className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
              />
              <label htmlFor="ip-whitelist" className="text-sm text-gray-700">
                Enable IP whitelist for admin access
              </label>
            </div>

            <div className="pt-4">
              <button className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition">
                Save Changes
              </button>
            </div>
          </div>
        )}

        {activeTab === 'system' && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-gray-900">System Information</h2>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600">Platform Version</p>
                <p className="text-lg font-semibold text-gray-900 mt-1">1.0.0</p>
              </div>

              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600">Database</p>
                <p className="text-lg font-semibold text-gray-900 mt-1">PostgreSQL 15</p>
              </div>

              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600">Total Storage Used</p>
                <p className="text-lg font-semibold text-gray-900 mt-1">2.4 GB</p>
              </div>

              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600">API Requests (24h)</p>
                <p className="text-lg font-semibold text-gray-900 mt-1">12,458</p>
              </div>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <Database className="w-5 h-5 text-yellow-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-yellow-900">Database Maintenance</p>
                  <p className="text-sm text-yellow-700 mt-1">
                    Last backup: 2 hours ago | Next scheduled maintenance: Dec 15, 2025
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'promotions' && <PromotionsManager />}
      </div>
    </div>
  );
}

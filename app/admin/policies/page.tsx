'use client';

import { useState, useEffect } from 'react';
import { Search, Info, Filter, ChevronDown, ChevronRight, Lock } from 'lucide-react';
import { useAdmin } from '@/context/AdminContext';

interface PolicyCondition {
  id: string;
  description: string;
  errorMessage: string;
  errorCode: string;
}

interface Policy {
  resource: string;
  action: string;
  requiresPermission: string;
  conditions: PolicyCondition[];
  conditionCount: number;
  priority: number;
  module: string;
}

interface PoliciesResponse {
  policies: Policy[];
  total: number;
  modules: string[];
}

export default function PoliciesPage() {
  const { admin } = useAdmin();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [modules, setModules] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedModule, setSelectedModule] = useState<string>('');
  const [selectedResource, setSelectedResource] = useState<string>('');
  const [expandedPolicies, setExpandedPolicies] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (admin?.id) {
      fetchPolicies();
    }
  }, [admin?.id]);

  const fetchPolicies = async () => {
    if (!admin?.id) return;
    setLoading(true);
    try {
      const res = await fetch('/api/policies', { credentials: 'include' });
      if (res.ok) {
        const data: PoliciesResponse = await res.json();
        setPolicies(data.policies);
        setModules(data.modules);
      } else {
        console.error('Failed to fetch policies');
      }
    } catch (err) {
      console.error('Error fetching policies:', err);
    } finally {
      setLoading(false);
    }
  };

  // Filter policies
  const filteredPolicies = policies.filter(policy => {
    const matchesSearch = !search || 
      policy.resource.toLowerCase().includes(search.toLowerCase()) ||
      policy.action.toLowerCase().includes(search.toLowerCase()) ||
      policy.requiresPermission.toLowerCase().includes(search.toLowerCase()) ||
      policy.module.toLowerCase().includes(search.toLowerCase());

    const matchesModule = !selectedModule || policy.module === selectedModule;
    const matchesResource = !selectedResource || policy.resource === selectedResource;

    return matchesSearch && matchesModule && matchesResource;
  });

  // Get unique resources for filter
  const uniqueResources = [...new Set(
    policies
      .filter(p => !selectedModule || p.module === selectedModule)
      .map(p => p.resource)
  )].sort();

  const togglePolicyExpand = (policy: Policy) => {
    const key = `${policy.resource}:${policy.action}`;
    const newExpanded = new Set(expandedPolicies);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedPolicies(newExpanded);
  };

  const isExpanded = (policy: Policy) => {
    const key = `${policy.resource}:${policy.action}`;
    return expandedPolicies.has(key);
  };

  const getActionBadgeColor = (action: string) => {
    const colors: Record<string, string> = {
      read: 'bg-slate-100 text-primary-700',
      create: 'bg-green-100 text-green-700',
      update: 'bg-yellow-100 text-yellow-700',
      delete: 'bg-red-100 text-red-700',
      export: 'bg-purple-100 text-purple-700',
      finalize: 'bg-indigo-100 text-indigo-700',
      cancel: 'bg-orange-100 text-orange-700',
      dispatch: 'bg-teal-100 text-teal-700',
      receive: 'bg-cyan-100 text-cyan-700',
    };
    return colors[action] || 'bg-gray-100 text-gray-700';
  };

  const getModuleBadgeColor = (module: string) => {
    const colors: Record<string, string> = {
      Sales: 'bg-slate-50 text-primary-700 border-primary-200',
      Purchases: 'bg-green-50 text-green-700 border-green-200',
      Inventory: 'bg-purple-50 text-purple-700 border-purple-200',
      Accounting: 'bg-yellow-50 text-yellow-700 border-yellow-200',
      Reports: 'bg-indigo-50 text-indigo-700 border-indigo-200',
      HR: 'bg-pink-50 text-pink-700 border-pink-200',
      WhatsApp: 'bg-teal-50 text-teal-700 border-teal-200',
      Settings: 'bg-gray-50 text-gray-700 border-gray-200',
    };
    return colors[module] || 'bg-gray-50 text-gray-700 border-gray-200';
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">PBAC Policies</h1>
            <p className="text-gray-600 mt-2">
              View all Policy-Based Access Control rules (read-only)
            </p>
          </div>
        </div>

        {/* Warning Banner */}
        <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3">
          <Lock className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-yellow-800">
              Policies are code-managed
            </p>
            <p className="text-sm text-yellow-700 mt-1">
              Policies are defined in code and cannot be modified through this interface. 
              To change policies, update the policy files in <code className="bg-yellow-100 px-1 rounded">lib/policies/resources/</code>
            </p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search policies..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <select
            value={selectedModule}
            onChange={(e) => {
              setSelectedModule(e.target.value);
              setSelectedResource(''); // Reset resource filter when module changes
            }}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All Modules</option>
            {modules.map(module => (
              <option key={module} value={module}>{module}</option>
            ))}
          </select>
          <select
            value={selectedResource}
            onChange={(e) => setSelectedResource(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All Resources</option>
            {uniqueResources.map(resource => (
              <option key={resource} value={resource}>{resource}</option>
            ))}
          </select>
          <div className="flex items-center text-sm text-gray-600">
            <span className="font-medium">{filteredPolicies.length}</span>
            <span className="ml-1">of {policies.length} policies</span>
          </div>
        </div>
      </div>

      {/* Policies Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            <p className="mt-4 text-gray-600">Loading policies...</p>
          </div>
        ) : filteredPolicies.length === 0 ? (
          <div className="p-8 text-center">
            <Info className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No policies found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-8">
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Module
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Resource
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Action
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Required Permission
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Conditions
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Priority
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredPolicies.map((policy, idx) => (
                  <>
                    <tr
                      key={`${policy.resource}:${policy.action}`}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => togglePolicyExpand(policy)}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        {isExpanded(policy) ? (
                          <ChevronDown className="w-4 h-4 text-gray-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-gray-400" />
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-medium rounded border ${getModuleBadgeColor(policy.module)}`}>
                          {policy.module}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{policy.resource}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-medium rounded ${getActionBadgeColor(policy.action)}`}>
                          {policy.action}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900 font-mono">{policy.requiresPermission}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-600">
                          {policy.conditionCount} condition{policy.conditionCount !== 1 ? 's' : ''}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-600">{policy.priority}</span>
                      </td>
                    </tr>
                    {isExpanded(policy) && (
                      <tr key={`${policy.resource}:${policy.action}:details`}>
                        <td colSpan={7} className="px-6 py-4 bg-gray-50">
                          <div className="space-y-4">
                            <div>
                              <h4 className="text-sm font-semibold text-gray-900 mb-2">
                                Policy Details
                              </h4>
                              <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                  <span className="text-gray-600">Resource:</span>
                                  <span className="ml-2 font-mono text-gray-900">{policy.resource}</span>
                                </div>
                                <div>
                                  <span className="text-gray-600">Action:</span>
                                  <span className="ml-2 font-mono text-gray-900">{policy.action}</span>
                                </div>
                                <div>
                                  <span className="text-gray-600">Required Permission:</span>
                                  <span className="ml-2 font-mono text-gray-900">{policy.requiresPermission}</span>
                                </div>
                                <div>
                                  <span className="text-gray-600">Priority:</span>
                                  <span className="ml-2 text-gray-900">{policy.priority}</span>
                                </div>
                              </div>
                            </div>

                            {policy.conditions.length > 0 && (
                              <div>
                                <h4 className="text-sm font-semibold text-gray-900 mb-2">
                                  Conditions ({policy.conditions.length})
                                </h4>
                                <div className="space-y-2">
                                  {policy.conditions.map((condition, cIdx) => (
                                    <div
                                      key={condition.id}
                                      className="bg-white border border-gray-200 rounded-lg p-3"
                                    >
                                      <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                          <div className="flex items-center gap-2 mb-1">
                                            <span className="text-xs font-medium text-gray-500">
                                              #{cIdx + 1}
                                            </span>
                                            <span className="text-sm font-medium text-gray-900">
                                              {condition.description}
                                            </span>
                                          </div>
                                          <div className="mt-1 space-y-1">
                                            <div className="text-xs text-gray-600">
                                              <span className="font-medium">ID:</span>
                                              <span className="ml-1 font-mono">{condition.id}</span>
                                            </div>
                                            <div className="text-xs text-gray-600">
                                              <span className="font-medium">Error Code:</span>
                                              <span className="ml-1 font-mono">{condition.errorCode}</span>
                                            </div>
                                            <div className="text-xs text-gray-600">
                                              <span className="font-medium">Error Message:</span>
                                              <span className="ml-1">{condition.errorMessage}</span>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {policy.conditions.length === 0 && (
                              <div className="text-sm text-gray-500 italic">
                                No conditions defined (policy passes if RBAC permission exists)
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Loader2, Users, Download, Search, CheckCircle2, XCircle, Phone, Copy, Check, UserPlus, CheckSquare, Square, Settings2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';

interface Group {
  jid: string;
  name: string;
  description: string | null;
  participantsCount: number;
  participantsWithPhone?: number;
  participants?: Participant[];
  createdAt: string | null;
  owner: string | null;
  error?: string;
}

interface Participant {
  jid: string;
  phone: string | null;
  name: string | null;
  admin: boolean;
}

export default function WhatsAppGroupExtractorPage() {
  const router = useRouter();
  const { business } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [phoneNumbers, setPhoneNumbers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [selectedParticipants, setSelectedParticipants] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [extractingJid, setExtractingJid] = useState<string | null>(null);

  // Fetch groups when component mounts
  useEffect(() => {
    if (business?.id) {
      fetchGroups();
    }
  }, [business?.id]);

  const fetchGroups = async () => {
    if (!business?.id) {
      setError('Please select a business');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/tools/whatsapp-groups?business_id=${business.id}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch groups');
      }

      const data = await response.json();
      setGroups(data.groups || []);
    } catch (err: any) {
      console.error('Error fetching groups:', err);
      setError(err.message || 'An error occurred while fetching groups');
    } finally {
      setLoading(false);
    }
  };

  const handleGroupSelect = (group: Group) => {
    setSelectedGroup(group);
    setParticipants([]);
    setPhoneNumbers([]);
    setSelectedParticipants(new Set());
    setImportResult(null);
  };

  const handleExtract = async (e: React.MouseEvent, group: Group) => {
    e.stopPropagation();
    e.preventDefault();
    if (!business?.id) {
      setError('Please select a business');
      return;
    }
    setSelectedGroup(group);
    setError(null);
    setExtractingJid(group.jid);
    setImportResult(null);
    try {
      const response = await fetch('/api/tools/whatsapp-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id, group_jid: group.jid }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to extract group members');
      }
      const list: Participant[] = (data.participants || []).map((p: any) => ({
        jid: p.jid,
        phone: p.phone,
        name: p.name,
        admin: !!p.admin,
      }));
      setParticipants(list);
      setPhoneNumbers(
        list.map((p) => p.phone).filter((phone): phone is string => phone !== null)
      );
      setSelectedParticipants(new Set());
      const g = data.group;
      if (g) {
        setSelectedGroup({
          ...group,
          name: g.name || group.name,
          description: g.description ?? group.description,
          participantsCount: g.participantsCount ?? group.participantsCount,
          participantsWithPhone: g.participantsWithPhone ?? list.length,
          owner: g.owner ?? group.owner,
          participants: list,
        });
      }
    } catch (err: any) {
      console.error('Extract group failed:', err);
      toast.error(err.message || 'Extraction failed');
    } finally {
      setExtractingJid(null);
    }
  };

  const toggleParticipantSelection = (jid: string) => {
    const newSelected = new Set(selectedParticipants);
    if (newSelected.has(jid)) {
      newSelected.delete(jid);
    } else {
      newSelected.add(jid);
    }
    setSelectedParticipants(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedParticipants.size === participants.length) {
      setSelectedParticipants(new Set());
    } else {
      setSelectedParticipants(new Set(participants.map(p => p.jid)));
    }
  };

  const handleImportToContacts = async (importAll: boolean = false) => {
    if (!business?.id || !selectedGroup) return;

    setImporting(true);
    setImportResult(null);

    try {
      // Get participants to import
      const participantsToImport = importAll 
        ? participants
        : participants.filter(p => selectedParticipants.has(p.jid));

      if (participantsToImport.length === 0) {
        setImportResult({
          success: false,
          message: 'No participants selected',
        });
        return;
      }

      // Prepare contacts data
      const contacts = participantsToImport.map(p => ({
        phone: p.phone,
        name: p.name,
        email: null,
        tags: ['whatsapp_group'],
        notes: `Imported from WhatsApp group: ${selectedGroup.name}`,
      }));

      // Import contacts
      const response = await fetch('/api/whatsapp/contacts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          contacts,
          source: 'group_extractor',
          imported_from_group: selectedGroup.jid,
          create_group: true,
          group_name: selectedGroup.name,
          group_color: '#25D366',
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setImportResult({
          success: false,
          message: data.error || 'Import failed',
        });
        return;
      }

      setImportResult({
        success: true,
        message: data.message,
        results: data.results,
      });

      // Clear selection
      setSelectedParticipants(new Set());

      // Auto-hide success message after 5 seconds
      setTimeout(() => {
        setImportResult(null);
      }, 5000);
    } catch (error) {
      console.error('Error importing to contacts:', error);
      setImportResult({
        success: false,
        message: 'An error occurred during import',
      });
    } finally {
      setImporting(false);
    }
  };

  // Helper function to escape CSV fields (handles quotes and commas)
  const escapeCsvField = (field: string | null): string => {
    if (field === null || field === undefined) return '';
    // Replace any existing quotes with double quotes (CSV escaping)
    const escaped = field.replace(/"/g, '""');
    // Wrap in quotes to ensure it's treated as text
    return `"${escaped}"`;
  };

  // Helper function to format phone numbers for Excel (prevents scientific notation)
  const formatPhoneForExcel = (phone: string | null): string => {
    if (!phone) return '';
    // Use Excel formula syntax to force text: ="phone_number"
    // This prevents Excel from converting to scientific notation
    return `="${phone}"`;
  };

  const handleExport = (format: 'csv' | 'txt') => {
    if (phoneNumbers.length === 0) {
      toast.warning('No phone numbers to export');
      return;
    }

    let content = '';
    let filename = '';

    if (format === 'csv') {
      // CSV format: Phone,Name,Admin
      // Use BOM (Byte Order Mark) for UTF-8 to help Excel recognize encoding
      content = '\ufeffPhone,Name,Admin\n';
      participants.forEach(p => {
        if (p.phone) {
          // Use Excel formula syntax for phone numbers to force text format
          // This prevents Excel from converting to scientific notation
          // Format: ="phone_number" forces Excel to treat it as text
          content += `${formatPhoneForExcel(p.phone)},${escapeCsvField(p.name)},${escapeCsvField(p.admin ? 'Yes' : 'No')}\n`;
        }
      });
      filename = `whatsapp-group-${selectedGroup?.name.replace(/[^a-z0-9]/gi, '_') || 'export'}-${new Date().toISOString().split('T')[0]}.csv`;
    } else {
      // TXT format: Name - Phone (or just Phone if no name)
      participants.forEach(p => {
        if (p.phone) {
          if (p.name) {
            content += `${p.name} - ${p.phone}\n`;
          } else {
            content += `${p.phone}\n`;
          }
        }
      });
      filename = `whatsapp-group-${selectedGroup?.name.replace(/[^a-z0-9]/gi, '_') || 'export'}-${new Date().toISOString().split('T')[0]}.txt`;
    }

    // Create download link
    const blob = new Blob([content], { type: format === 'csv' ? 'text/csv' : 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const handleCopyPhoneNumbers = async () => {
    if (phoneNumbers.length === 0) return;

    // Include names with phone numbers: "Name - Phone" or just "Phone" if no name
    const phoneNumbersText = participants
      .filter(p => p.phone)
      .map(p => p.name ? `${p.name} - ${p.phone}` : p.phone)
      .join(', ');
    
    await navigator.clipboard.writeText(phoneNumbersText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Filter groups by search query
  const filteredGroups = groups.filter(group =>
    group.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    group.jid.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    
      <div className="space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-extrabold text-text-primary tracking-tight">
            WhatsApp Group Extractor
          </h1>
          <p className="text-text-secondary text-lg">
            Extract phone numbers from WhatsApp groups, communities, and announcements.
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <Card className="p-4 bg-red-50 border-red-200">
            <div className="flex items-center gap-2 text-red-800">
              <XCircle className="h-5 w-5" />
              <span>{error}</span>
            </div>
          </Card>
        )}

        {/* Loading State */}
        {loading && (
          <Card className="p-8 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
            <span className="ml-3 text-text-secondary">Loading groups...</span>
          </Card>
        )}

        {/* Groups List */}
        {!loading && !error && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Groups Panel */}
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-text-primary flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Groups ({groups.length})
                </h2>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={fetchGroups}
                  disabled={loading}
                >
                  Refresh
                </Button>
              </div>

              {/* Search */}
              <div className="mb-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search groups..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* Groups List */}
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {filteredGroups.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    {groups.length === 0 ? (
                      <>
                        <Users className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                        <p>No groups found</p>
                        <p className="text-sm mt-2">Make sure you&apos;re connected to WhatsApp</p>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="mt-4"
                          onClick={() => router.push('/whatsapp')}
                        >
                          <Settings2 className="h-4 w-4 mr-2" />
                          Open WhatsApp connection settings
                        </Button>
                      </>
                    ) : (
                      <p>No groups match your search</p>
                    )}
                  </div>
                ) : (
                  filteredGroups.map((group) => (
                    <div
                      key={group.jid}
                      onClick={() => handleGroupSelect(group)}
                      className={`p-4 border rounded-lg cursor-pointer transition-all ${
                        selectedGroup?.jid === group.jid
                          ? 'border-primary-500 bg-slate-50'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-text-primary mb-1">
                            {group.name}
                          </h3>
                          {group.description && (
                            <p className="text-sm text-text-secondary mb-2 line-clamp-2">
                              {group.description}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-3 text-sm text-text-secondary">
                            <span className="flex items-center gap-1">
                              <Users className="h-4 w-4" />
                              {group.participantsCount > 0
                                ? `${group.participantsCount} members`
                                : 'No members'}
                            </span>
                            {group.error && (
                              <span className="text-amber-600 text-xs">{group.error}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2 flex-shrink-0">
                          <Button
                            type="button"
                            size="sm"
                            variant="primary"
                            onClick={(e) => handleExtract(e, group)}
                            disabled={!!extractingJid}
                            className="whitespace-nowrap"
                          >
                            {extractingJid === group.jid ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-1 animate-spin inline" />
                                Extracting…
                              </>
                            ) : (
                              'Extract'
                            )}
                          </Button>
                          {selectedGroup?.jid === group.jid && (
                            <CheckCircle2 className="h-5 w-5 text-primary-600" />
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            {/* Participants Panel */}
            <Card className="p-6">
              {!selectedGroup ? (
                <div className="text-center py-12 text-gray-500">
                  <Users className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                  <p>Select a group on the left, then click <strong>Extract</strong> to load members</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-xl font-semibold text-text-primary mb-1">
                        {selectedGroup.name}
                      </h2>
                      <p className="text-sm text-text-secondary">
                        {participants.length > 0
                          ? `${participants.length} participants with phone numbers`
                          : 'Use Extract on the left to load members (not loaded yet)'}
                      </p>
                    </div>
                  </div>
                  {participants.length === 0 && (
                    <div className="mb-4 p-4 rounded-lg bg-gray-50 border border-gray-200 text-sm text-text-secondary">
                      This list stays empty until you run <strong>Extract</strong> for this group. That
                      avoids loading every member of every group when you open this page.
                    </div>
                  )}

                  {/* Import Result */}
                  {importResult && (
                    <div className={`mb-4 p-3 rounded-lg ${
                      importResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
                    }`}>
                      <div className="flex items-start gap-2">
                        {importResult.success ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1">
                          <p className={`text-sm font-medium ${
                            importResult.success ? 'text-green-900' : 'text-red-900'
                          }`}>
                            {importResult.message}
                          </p>
                          {importResult.results && (
                            <p className="text-xs text-gray-600 mt-1">
                              {importResult.results.imported} imported, {importResult.results.skipped} skipped, {importResult.results.errors} errors
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Selection Controls */}
                  <div className="flex items-center justify-between mb-4">
                    <button
                      onClick={toggleSelectAll}
                      className="flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700"
                    >
                      {selectedParticipants.size === participants.length ? (
                        <CheckSquare className="h-4 w-4" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                      {selectedParticipants.size === participants.length ? 'Deselect All' : 'Select All'}
                    </button>
                    <span className="text-sm text-gray-600">
                      {selectedParticipants.size} selected
                    </span>
                  </div>

                  {/* Action Buttons */}
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleImportToContacts(false)}
                      disabled={selectedParticipants.size === 0 || importing}
                      className="col-span-2"
                    >
                      {importing ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Importing...
                        </>
                      ) : (
                        <>
                          <UserPlus className="h-4 w-4 mr-2" />
                          Import Selected to Contacts ({selectedParticipants.size})
                        </>
                      )}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleImportToContacts(true)}
                      disabled={participants.length === 0 || importing}
                    >
                      <UserPlus className="h-4 w-4 mr-2" />
                      Import All
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleCopyPhoneNumbers}
                      disabled={phoneNumbers.length === 0}
                    >
                      {copied ? (
                        <>
                          <Check className="h-4 w-4 mr-2" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4 mr-2" />
                          Copy
                        </>
                      )}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleExport('txt')}
                      disabled={phoneNumbers.length === 0}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      TXT
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleExport('csv')}
                      disabled={phoneNumbers.length === 0}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      CSV
                    </Button>
                  </div>

                  {/* Participants List */}
                  <div className="space-y-2 max-h-[500px] overflow-y-auto">
                    {participants.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        <p>No participants with phone numbers found</p>
                      </div>
                    ) : (
                      participants.map((participant, index) => (
                        <div
                          key={participant.jid || index}
                          className={`p-3 border rounded-lg transition-all cursor-pointer ${
                            selectedParticipants.has(participant.jid)
                              ? 'border-primary-500 bg-slate-50'
                              : 'border-gray-200 hover:bg-gray-50'
                          }`}
                          onClick={() => toggleParticipantSelection(participant.jid)}
                        >
                          <div className="flex items-center gap-3">
                            <div 
                              className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                                selectedParticipants.has(participant.jid)
                                  ? 'bg-primary-600 border-primary-600'
                                  : 'border-gray-300'
                              }`}
                            >
                              {selectedParticipants.has(participant.jid) && (
                                <Check className="h-3 w-3 text-white" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              {participant.name && (
                                <p className="font-medium text-text-primary mb-1 truncate">
                                  {participant.name}
                                </p>
                              )}
                              <p className="text-sm text-text-secondary flex items-center gap-2">
                                <Phone className="h-3 w-3 flex-shrink-0" />
                                <span className="truncate">{participant.phone || 'No phone number'}</span>
                              </p>
                            </div>
                            {participant.admin && (
                              <span className="px-2 py-1 text-xs font-medium bg-slate-100 text-primary-700 rounded flex-shrink-0">
                                Admin
                              </span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Phone Numbers Summary */}
                  {phoneNumbers.length > 0 && (
                    <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                      <p className="text-sm text-text-secondary mb-2">
                        Phone numbers (comma-separated):
                      </p>
                      <p className="text-xs text-text-secondary font-mono break-all">
                        {phoneNumbers.slice(0, 10).join(', ')}
                        {phoneNumbers.length > 10 && ` ... and ${phoneNumbers.length - 10} more`}
                      </p>
                    </div>
                  )}
                </>
              )}
            </Card>
          </div>
        )}
      </div>
    
  );
}

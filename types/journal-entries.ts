// TypeScript interfaces for Journal Entries related tables

export interface JournalEntry {
  id: string;
  business_id: string;
  voucher_id: string;
  voucher_number: string;
  entry_date: Date | string;
  reference_number?: string;
  narration?: string;
  is_locked: boolean;
  locked_at?: Date | string;
  locked_by?: string;
  lock_reason?: string;
  is_reversing: boolean;
  reverses_entry_id?: string;
  reversal_date?: Date | string;
  template_id?: string;
  created_by?: string;
  updated_by?: string;
  tags?: string[];
  created_at: Date | string;
  updated_at: Date | string;
}

export interface JournalEntryTemplate {
  id: string;
  business_id: string;
  name: string;
  description?: string;
  entry_date_offset: number;
  lines: JournalEntryTemplateLine[];
  tags?: string[];
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
  created_by?: string;
}

export interface JournalEntryTemplateLine {
  account_id: string;
  debit: number;
  credit: number;
  narration?: string;
}

export interface JournalEntryAttachment {
  id: string;
  journal_entry_id: string;
  file_name: string;
  file_url: string;
  file_type?: string;
  file_size?: number;
  uploaded_by?: string;
  created_at: Date | string;
}

export interface OpeningBalanceTransaction {
  id: string;
  business_id: string;
  financial_year_id?: string;
  entity_type: 'account' | 'customer' | 'supplier';
  entity_id: string;
  opening_balance: number;
  opening_balance_type: 'debit' | 'credit';
  as_on_date: Date | string;
  notes?: string;
  created_at: Date | string;
  created_by?: string;
}


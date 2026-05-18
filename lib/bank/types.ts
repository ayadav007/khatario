export type BankStatementSourceType = 'csv' | 'pdf_digital' | 'pdf_scanned';

export type BankStatementFileType = 'csv' | 'pdf';

export type NormalizedBankRow = {
  /** Stable id for preview editing (client-generated) */
  tempId: string;
  date: string; // YYYY-MM-DD
  description: string;
  debit: number;
  credit: number;
  balance: number | null;
};

export type BankImportPreview = {
  fileName: string;
  fileType: BankStatementFileType;
  sourceType: BankStatementSourceType;
  rows: NormalizedBankRow[];
  warnings: string[];
  /** Extracted plain text length from PDF (for debugging / classification) */
  pdfTextLength?: number;
};

export type BankLineMatchStatus = 'unmatched' | 'matched' | 'ignored' | 'partial';

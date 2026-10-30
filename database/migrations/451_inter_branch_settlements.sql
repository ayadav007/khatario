-- Migration 451: settling inter-branch balances
-- An inter-branch invoice leaves Inter-Branch Receivables (1109) at the sending branch and
-- Inter-Branch Payables (2111) at the receiving branch. Customer payments cannot clear them (they
-- post to 1103), so each settlement is recorded here and posted as voucher type
-- 'inter_branch_settlement' (voucher id = settlement id):
--   payment: money moved. Payer: Dr 2111 / Cr its cash-bank. Payee: Dr its cash-bank / Cr 1109.
--   netting: two branches owe each other. Each branch: Dr 2111 / Cr 1109 for the smaller balance.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS inter_branch_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  payer_branch_id UUID NOT NULL REFERENCES branches(id),
  payee_branch_id UUID NOT NULL REFERENCES branches(id),
  mode VARCHAR(10) NOT NULL CHECK (mode IN ('payment', 'netting')),
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  settlement_date DATE NOT NULL,
  payer_account_id UUID REFERENCES accounts(id),
  payee_account_id UUID REFERENCES accounts(id),
  reference VARCHAR(100),
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reversed_at TIMESTAMPTZ,
  reversed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  CHECK (payer_branch_id <> payee_branch_id),
  CHECK (mode <> 'payment' OR (payer_account_id IS NOT NULL AND payee_account_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_inter_branch_settlements_business
  ON inter_branch_settlements (business_id, settlement_date DESC);

COMMENT ON TABLE inter_branch_settlements IS 'Settlements of inter-branch receivable (1109) / payable (2111) between two branches; posted as voucher_type inter_branch_settlement.';

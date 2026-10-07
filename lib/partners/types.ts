export type PartnerType = 'freelancer' | 'agency';
export type PartnerStatus = 'pending' | 'active' | 'suspended';
export type CommissionType = 'percentage' | 'fixed';
export type CommissionBasis = 'first_payment' | 'recurring';
export type AttributionSource = 'ref_link' | 'code' | 'claim' | 'admin';
export type PartnerDealStage =
  | 'lead'
  | 'contacted'
  | 'demo_booked'
  | 'demo_done'
  | 'trial'
  | 'proposal'
  | 'won'
  | 'lost';
export type PartnerCommissionStatus = 'pending' | 'approved' | 'paid' | 'cancelled';

export type PlatformPartner = {
  id: string;
  partner_type: PartnerType;
  name: string;
  email: string;
  phone: string | null;
  referral_code: string;
  status: PartnerStatus;
  commission_type: CommissionType;
  commission_value: number;
  commission_basis: CommissionBasis;
  hold_days: number | null;
  pan: string | null;
  gstin: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  upi_id: string | null;
  notes: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PartnerProgramSettings = {
  id: number;
  default_hold_days: number;
  default_commission_type: CommissionType;
  default_commission_value: number;
  default_commission_basis: CommissionBasis;
  tds_enabled: boolean;
  tds_section: string;
  tds_rate_percent: number;
  tds_annual_threshold: number;
  updated_at: string;
};

export type PartnerPublicProfile = Pick<
  PlatformPartner,
  | 'id'
  | 'partner_type'
  | 'name'
  | 'email'
  | 'phone'
  | 'referral_code'
  | 'status'
  | 'commission_type'
  | 'commission_value'
  | 'commission_basis'
  | 'hold_days'
>;

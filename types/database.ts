// Database type definitions matching the PostgreSQL schema

// Import journal entry types
import type { 
  JournalEntry, 
  JournalEntryTemplate, 
  JournalEntryTemplateLine, 
  JournalEntryAttachment, 
  OpeningBalanceTransaction 
} from './journal-entries';

// Re-export for convenience
export type { 
  JournalEntry, 
  JournalEntryTemplate, 
  JournalEntryTemplateLine, 
  JournalEntryAttachment, 
  OpeningBalanceTransaction 
};

// Re-export journal entries types for convenience
export * from './journal-entries';

export interface Business {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstin?: string;
  pan?: string;
  cin?: string;
  logo_url?: string;
  website?: string;
  signature_url?: string;
  bank_name?: string;
  account_number?: string;
  ifsc_code?: string;
  branch_name?: string;
  currency: string;
  invoice_prefix: string;
  next_invoice_number: number;
  default_tax_rate: number;
  state_code?: string;
  business_type?: 'retail' | 'wholesaler' | 'distributor' | 'manufacturer' | 'service' | 'other';
  industry?: 'pharmaceuticals' | 'textiles' | 'garments' | 'electronics' | 'food_beverages' | 'automotive' | 'construction' | 'services' | 'other';
  business_model?: 'b2b' | 'b2c' | 'b2b2c' | 'export' | 'mixed';
  iec_code?: string; // Import Export Code - Mandatory for exporters
  swift_code?: string; // SWIFT/BIC code for international wire transfers
  created_at: Date;
  updated_at: Date;
}

export interface User {
  id: string;
  business_id: string;
  name: string;
  email?: string;
  phone: string;
  password_hash?: string;
  role: string;
  permissions: Record<string, any>;
  is_primary_admin?: boolean; // Whether user is the primary admin of the business
  allow_multidevice_sync?: boolean;
  /** Bumped to invalidate JWTs (single-device login, password change, etc.) */
  auth_session_version?: string | number;
  /** Set when the user finishes or dismisses the first-run sidebar tour */
  product_tour_completed_at?: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Employee {
  id: string;
  business_id: string;
  employee_code: string;
  designation?: string;
  department?: string;
  joining_date?: Date;
  reporting_manager_id?: string;
  employment_type: 'full_time' | 'part_time' | 'contract';
  access_type: 'full' | 'attendance_only';
  salary?: number;
  photo_url?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  bank_account_number?: string;
  bank_ifsc?: string;
  bank_name?: string;
  pan_number?: string;
  aadhaar_number?: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  // Joined fields
  user?: User;
  reporting_manager?: Employee;
}

export interface EmployeeDocument {
  id: string;
  employee_id: string;
  document_type?: string;
  document_name?: string;
  file_url: string;
  uploaded_at: Date;
}

export interface Shift {
  id: string;
  business_id: string;
  shift_name: string;
  start_time: string; // TIME format
  end_time: string; // TIME format
  break_duration: number; // minutes
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface EmployeeFaceData {
  id: string;
  employee_id: string;
  face_encoding: string; // JSON string of face descriptor array
  face_image_url?: string;
  enrollment_date: Date;
  is_active: boolean;
}

export interface EmployeeAttendance {
  id: string;
  employee_id: string;
  date: Date;
  shift_id?: string;
  check_in_time?: Date;
  check_out_time?: Date;
  break_duration: number; // minutes
  total_hours?: number;
  status: 'present' | 'absent' | 'half_day' | 'leave' | 'holiday';
  check_in_method?: 'face_recognition' | 'mobile_app' | 'manual' | 'kiosk' | 'otp';
  check_out_method?: 'face_recognition' | 'mobile_app' | 'manual' | 'kiosk' | 'otp';
  check_in_location_lat?: number;
  check_in_location_lng?: number;
  check_out_location_lat?: number;
  check_out_location_lng?: number;
  notes?: string;
  created_at: Date;
  updated_at: Date;
  // Joined fields
  shift?: Shift;
  employee?: Employee;
}

export interface AttendanceLog {
  id: string;
  employee_id: string;
  attendance_id?: string;
  log_type: 'check_in' | 'check_out' | 'break_start' | 'break_end';
  log_time: Date;
  location_lat?: number;
  location_lng?: number;
  device_info?: string;
  ip_address?: string;
  recognition_confidence?: number; // 0-1 for face recognition
  method?: 'face_recognition' | 'mobile_app' | 'manual' | 'kiosk' | 'otp';
}

export interface AttendanceOTP {
  id: string;
  employee_id: string;
  phone: string;
  otp_code: string;
  expires_at: Date;
  is_used: boolean;
  created_at: Date;
}

export interface AttendanceSession {
  id: string;
  employee_id: string;
  session_token: string;
  expires_at: Date;
  created_at: Date;
}

export interface CommissionRule {
  id: string;
  business_id: string;
  employee_id?: string;
  role_id?: string;
  commission_type: 'percentage' | 'fixed' | 'tiered';
  commission_value: number;
  min_sale_amount: number;
  max_commission?: number;
  applies_to_item_category?: string;
  applies_to_customer_type?: string;
  is_active: boolean;
  effective_from?: Date;
  effective_to?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface EmployeeTarget {
  id: string;
  employee_id: string;
  target_period: 'monthly' | 'quarterly' | 'yearly';
  target_year: number;
  target_month?: number;
  target_amount: number;
  target_invoices?: number;
  created_at: Date;
  updated_at: Date;
}

export interface CommissionEarning {
  id: string;
  employee_id: string;
  invoice_id: string;
  sale_amount: number;
  commission_rate: number;
  commission_amount: number;
  status: 'pending' | 'approved' | 'paid' | 'cancelled';
  approved_by?: string;
  approved_at?: Date;
  paid_at?: Date;
  payment_reference?: string;
  notes?: string;
  created_at: Date;
  updated_at: Date;
  // Joined fields
  employee?: Employee;
  invoice?: any;
}

export interface EmployeePerformance {
  id: string;
  employee_id: string;
  period_type: 'daily' | 'weekly' | 'monthly';
  period_date: Date;
  total_sales: number;
  total_invoices: number;
  average_invoice_value: number;
  new_customers: number;
  repeat_customers: number;
  total_commission: number;
  target_amount?: number;
  achievement_percentage?: number;
  created_at: Date;
  updated_at: Date;
}

export interface LeaveType {
  id: string;
  business_id: string;
  leave_name: string;
  leave_code: string;
  max_days_per_year?: number;
  carry_forward: boolean;
  max_carry_forward_days?: number;
  requires_approval: boolean;
  is_paid: boolean;
  is_active: boolean;
  description?: string;
  created_at: Date;
  updated_at: Date;
}

export interface LeaveBalance {
  id: string;
  employee_id: string;
  leave_type_id: string;
  year: number;
  opening_balance: number;
  earned_days: number;
  used_days: number;
  carry_forward_days: number;
  current_balance: number;
  created_at: Date;
  updated_at: Date;
  // Joined fields
  leave_type?: LeaveType;
}

export interface LeaveRequest {
  id: string;
  employee_id: string;
  leave_type_id: string;
  start_date: Date;
  end_date: Date;
  total_days: number;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requested_by?: string;
  approved_by?: string;
  approved_at?: Date;
  rejection_reason?: string;
  rejected_at?: Date;
  cancelled_at?: Date;
  attachment_url?: string;
  created_at: Date;
  updated_at: Date;
  // Joined fields
  leave_type?: LeaveType;
  employee?: Employee;
  approver?: Employee;
}

export interface LeaveRequestComment {
  id: string;
  leave_request_id: string;
  employee_id?: string;
  comment_text: string;
  is_internal: boolean;
  created_at: Date;
}

export interface Holiday {
  id: string;
  business_id: string;
  holiday_date: Date;
  holiday_name: string;
  is_recurring: boolean;
  description?: string;
  created_at: Date;
}

export interface ExpenseCategory {
  id: string;
  business_id: string;
  category_name: string;
  description?: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface EmployeeExpense {
  id: string;
  employee_id: string;
  expense_category_id?: string;
  expense_date: Date;
  amount: number;
  currency: string;
  description: string;
  payment_mode?: string;
  vendor_name?: string;
  receipt_url?: string;
  status: 'pending' | 'approved' | 'rejected' | 'reimbursed' | 'cancelled';
  submitted_at: Date;
  approved_by?: string;
  approved_at?: Date;
  rejection_reason?: string;
  rejected_at?: Date;
  reimbursed_at?: Date;
  reimbursement_reference?: string;
  is_billable: boolean;
  billable_to_customer_id?: string;
  billable_to_project?: string;
  created_at: Date;
  updated_at: Date;
  // Joined fields
  employee?: Employee;
  category?: ExpenseCategory;
  approver?: Employee;
  attachments?: ExpenseAttachment[];
}

export interface SalaryStructure {
  id: string;
  business_id: string;
  employee_id: string;
  basic_salary: number;
  hra: number;
  transport_allowance: number;
  medical_allowance: number;
  special_allowance: number;
  other_allowances: number;
  pf_percentage: number;
  pf_fixed_amount?: number;
  professional_tax: number;
  tds_percentage: number;
  other_deductions: number;
  effective_from: Date;
  effective_to?: Date;
  notes?: string;
  created_at: Date;
  updated_at: Date;
  // Joined fields
  employee?: Employee;
}

export interface SalaryPayment {
  id: string;
  business_id: string;
  employee_id: string;
  salary_month: string;
  from_date: Date;
  to_date: Date;
  payment_date: Date;
  basic_salary: number;
  hra: number;
  transport_allowance: number;
  medical_allowance: number;
  special_allowance: number;
  overtime: number;
  bonus: number;
  commission: number;
  other_earnings: number;
  total_earnings: number;
  provident_fund: number;
  professional_tax: number;
  tds: number;
  advance_recovery: number;
  loan_deduction: number;
  other_deductions: number;
  total_deductions: number;
  gross_salary: number;
  net_salary: number;
  payment_mode?: string;
  payment_reference?: string;
  bank_account_number?: string;
  bank_ifsc?: string;
  working_days?: number;
  present_days?: number;
  absent_days?: number;
  leave_days?: number;
  overtime_hours?: number;
  status: 'pending' | 'processed' | 'paid' | 'cancelled';
  processed_at?: Date;
  processed_by?: string;
  notes?: string;
  created_at: Date;
  updated_at: Date;
  // Joined fields
  employee?: Employee;
  processor?: User;
}

export interface SalaryAdvance {
  id: string;
  business_id: string;
  employee_id: string;
  advance_amount: number;
  advance_date: Date;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected' | 'recovered' | 'partially_recovered';
  recovery_method: 'salary_deduction' | 'one_time_payment';
  recovery_months?: number;
  recovered_amount: number;
  remaining_amount: number;
  requested_by?: string;
  approved_by?: string;
  approved_at?: Date;
  rejection_reason?: string;
  payment_mode?: string;
  payment_reference?: string;
  created_at: Date;
  updated_at: Date;
  // Joined fields
  employee?: Employee;
  requester?: User;
  approver?: User;
}

export interface AdvanceRecovery {
  id: string;
  advance_id: string;
  salary_payment_id?: string;
  recovery_amount: number;
  recovery_date: Date;
  created_at: Date;
  // Joined fields
  advance?: SalaryAdvance;
  salary_payment?: SalaryPayment;
}

export interface Payslip {
  id: string;
  salary_payment_id: string;
  employee_id: string;
  business_id: string;
  payslip_data: Record<string, any>; // JSONB
  html_content?: string;
  pdf_url?: string;
  is_sent: boolean;
  sent_at?: Date;
  sent_to_email?: string;
  created_at: Date;
  // Joined fields
  salary_payment?: SalaryPayment;
  employee?: Employee;
}

export interface AccountGroup {
  id: string;
  business_id: string;
  group_code: string;
  group_name: string;
  group_type: 'asset' | 'liability' | 'income' | 'expense' | 'capital';
  parent_group_id?: string;
  is_system: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
  // Joined fields
  parent_group?: AccountGroup;
  accounts?: Account[];
}

export interface Account {
  id: string;
  business_id: string;
  account_code: string;
  account_name: string;
  account_type: 'asset' | 'liability' | 'income' | 'expense' | 'capital';
  account_group_id: string;
  parent_account_id?: string;
  nature: 'debit' | 'credit';
  opening_balance: number;
  opening_balance_type: 'debit' | 'credit';
  is_active: boolean;
  is_system: boolean;
  description?: string;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
  // Joined fields
  account_group?: AccountGroup;
  parent_account?: Account;
  current_balance?: number; // Calculated field
}

export interface ExpenseApproval {
  id: string;
  expense_id: string;
  approver_id: string;
  approval_level: number;
  status: 'pending' | 'approved' | 'rejected';
  comments?: string;
  approved_at?: Date;
  created_at: Date;
}

export interface ExpenseComment {
  id: string;
  expense_id: string;
  employee_id?: string;
  comment_text: string;
  is_internal: boolean;
  created_at: Date;
}

export interface ExpenseAttachment {
  id: string;
  expense_id: string;
  file_name: string;
  file_url: string;
  file_type?: string;
  file_size?: number;
  uploaded_at: Date;
}

export interface PermissionModule {
  id: string;
  module_key: string;
  module_name: string;
  description?: string;
  is_active: boolean;
  created_at: Date;
}

export interface Permission {
  id: string;
  module_id: string;
  permission_key: string;
  permission_name: string;
  description?: string;
  is_active: boolean;
  created_at: Date;
  // Joined fields
  module?: PermissionModule;
}

export interface RolePermission {
  id: string;
  role_id: string;
  permission_id: string;
  granted: boolean;
  created_at: Date;
  // Joined fields
  permission?: Permission;
}

export interface FieldPermission {
  id: string;
  role_id: string;
  module_key: string;
  field_name: string;
  can_view: boolean;
  can_edit: boolean;
  created_at: Date;
}

export interface Task {
  id: string;
  business_id: string;
  title: string;
  description?: string;
  assigned_to?: string;
  assigned_by?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  due_date?: Date;
  completed_at?: Date;
  created_at: Date;
  updated_at: Date;
  // Joined fields
  assignee?: Employee;
  assigner?: Employee;
}

export interface TaskComment {
  id: string;
  task_id: string;
  employee_id: string;
  comment_text: string;
  created_at: Date;
}

export interface ActivityLog {
  id: string;
  business_id: string;
  employee_id?: string;
  user_id?: string;
  action_type: string; // 'create', 'update', 'delete', 'login', 'logout', etc.
  module: string; // 'invoices', 'items', 'employees', etc.
  entity_id?: string;
  entity_type?: string;
  description: string;
  ip_address?: string;
  user_agent?: string;
  metadata?: Record<string, any>; // Additional context data
  created_at: Date;
}

export interface Customer {
  id: string;
  business_id: string;
  name: string;
  company_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  billing_address?: string;
  shipping_address?: string;
  city?: string; // Billing city
  state?: string; // Billing state
  state_code?: string; // 2-digit GST state code
  pincode?: string; // Billing pincode
  shipping_city?: string;
  shipping_state?: string;
  shipping_pincode?: string;
  country?: string; // Country of destination for export invoices
  gstin?: string;
  opening_balance: number;
  opening_balance_type: 'debit' | 'credit';
  credit_limit: number;
  /** Net days from invoice date used to suggest due date (null = no automatic default) */
  credit_days?: number | null;
  current_balance?: number; // Running balance: opening + invoices - payments
  tags?: string[];
  notes?: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Supplier {
  id: string;
  business_id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  state_code?: string; // 2-digit GST state code
  pincode?: string;
  gstin?: string;
  opening_balance: number;
  opening_balance_type: 'debit' | 'credit';
  linked_business_id?: string | null; // References business account if supplier is also a user
  approval_status?: 'pending' | 'approved' | 'rejected' | 'none'; // Status of supplier relationship
  requested_by_business_id?: string | null; // Business that initiated the supplier relationship request
  approved_at?: Date | null;
  rejected_at?: Date | null;
  rejection_reason?: string | null;
  allow_low_stock_access?: boolean; // Permission to view customer's low stock alerts
  notes?: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Opt-in Suppliers Hub visibility (migration 178) */
export type BusinessDiscoveryVisibility = 'hidden' | 'directory' | 'link_only';

export interface BusinessDiscovery {
  business_id: string;
  visibility: BusinessDiscoveryVisibility;
  profile_summary?: string | null;
  featured_categories: string[];
  public_slug?: string | null;
  directory_approved: boolean;
  updated_by_user_id?: string | null;
  created_at: Date;
  updated_at: Date;
}

export type SupplierConnectionRequestStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'cancelled'
  | 'blocked';

export interface SupplierConnectionRequest {
  id: string;
  buyer_business_id: string;
  supplier_business_id: string;
  status: SupplierConnectionRequestStatus;
  message?: string | null;
  created_by_user_id?: string | null;
  resolved_by_user_id?: string | null;
  created_at: Date;
  resolved_at?: Date | null;
}

export type SupplierPublishedAudience = 'public_preview' | 'linked_only';
export type SupplierPublishedPriceDisplay = 'hidden' | 'from_amount' | 'on_request';

export interface SupplierPublishedListing {
  id: string;
  supplier_business_id: string;
  item_id: string;
  audience: SupplierPublishedAudience;
  display_name?: string | null;
  moq?: number | null;
  lead_time_text?: string | null;
  price_display: SupplierPublishedPriceDisplay;
  from_amount?: number | null;
  sort_order: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Item {
  id: string;
  business_id: string;
  category_id?: string;
  name: string;
  code?: string;
  barcode?: string;
  description?: string;
  unit: string;
  hsn_sac?: string;
  item_type?: 'goods' | 'service';
  purchase_price: number;
  selling_price: number | null;
  mrp?: number;
  tax_rate: number;
  opening_stock: number;
  current_stock: number;
  min_stock: number;
  image_url?: string;
  has_variants?: boolean;
  /** Combo product: stock is reduced via bundle_items children on invoice, not this row */
  is_bundle?: boolean;
  is_active: boolean;
  // Retail compliance fields (migration 162)
  fssai_licence_no?: string | null;
  net_quantity?: string | null;
  country_of_origin?: string | null;
  brand?: string | null;
  // Weighed / PLU (migration 165)
  is_weighed?: boolean;
  plu_code?: string | null;
  weight_barcode_mode?: 'weight' | 'price';
  /** null = use business default; false = block; true = allow oversell on invoices */
  allow_sale_when_out_of_stock?: boolean | null;
  created_at: Date;
  updated_at: Date;
}

export interface ItemVariant {
  id: string;
  item_id: string;
  variant_name: string;
  sku?: string;
  barcode?: string;
  purchase_price?: number;
  selling_price?: number;
  opening_stock: number;
  current_stock: number;
  attributes: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface ExpenseCategory {
  id: string;
  business_id: string;
  name: string;
  description?: string;
  created_at: Date;
  updated_at: Date;
}

export interface Expense {
  id: string;
  business_id: string;
  category_id?: string;
  category?: string; // Deprecated
  amount: number;
  description?: string;
  expense_date: Date;
  payment_mode?: string;
  reference_number?: string;
  created_at: Date;
  created_by?: string;
}

export interface Invoice {
  id: string;
  business_id: string;
  customer_id?: string;
  invoice_number: string;
  invoice_date: Date;
  due_date?: Date;
  status: 'draft' | 'final' | 'cancelled';
  payment_status: 'unpaid' | 'partially_paid' | 'paid';
  place_of_supply_state_code?: string;
  is_reverse_charge: boolean;
  is_editable: boolean;
  cancellation_details?: Record<string, any> | null;
  document_type?: string; // 'regular', 'bill_of_supply', 'export_invoice', etc.
  supply_type?: string; // 'b2b', 'b2c_large', 'b2c_small', 'export', 'sez', 'deemed_export'
  export_type?: string; // 'wop' (without payment), 'wp' (with payment)
  shipping_bill_number?: string;
  shipping_bill_date?: Date;
  port_code?: string;
  ecommerce_operator_gstin?: string;
  is_ecommerce_supply?: boolean;
  is_export?: boolean; // Flag to indicate export invoice
  // Export compliance fields
  invoice_currency?: string; // Currency in which invoice is issued (USD, EUR, etc.)
  exchange_rate?: number; // Exchange rate from invoice currency to INR
  base_currency_amount?: number; // Invoice amount in base currency (INR)
  country_of_origin?: string; // Country of origin of goods (usually India)
  port_of_loading?: string; // Port from where goods are loaded for export
  port_of_discharge?: string; // Port where goods are discharged
  place_of_delivery?: string; // Final place of delivery
  incoterms?: string; // International Commercial Terms (EXW, FOB, CIF, DDP, etc.)
  awb_number?: string; // Air Waybill Number for air shipments
  bl_number?: string; // Bill of Lading Number for sea shipments
  buyer_tax_id?: string; // Buyer's Tax/VAT ID for foreign customers
  transport_mode?: string; // Air, Sea, Road, Courier
  export_declaration?: string; // Custom export declaration
  lut_declaration?: boolean; // Whether LUT declaration is shown
  subtotal: number;
  discount_total: number;
  additional_charges: number;
  tax_total: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  round_off: number;
  grand_total: number;
  paid_amount: number;
  balance_amount: number;
  notes?: string;
  terms?: string;
  template_id?: string;
  template_settings?: Record<string, any>;
  billing_address?: string;
  shipping_address?: string;
  created_at: Date;
  updated_at: Date;
  created_by?: string;
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  item_id?: string;
  item_name: string;
  description?: string;
  hsn_sac?: string;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_percent: number;
  discount_amount: number;
  tax_rate: number;
  tax_amount: number;
  taxable_value: number; // After discount, before tax
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  line_total: number;
  sort_order: number;
}

export interface Payment {
  id: string;
  business_id: string;
  type: 'receivable' | 'payable'; // 'receivable' (in) | 'payable' (out)
  customer_id?: string;
  supplier_id?: string;
  reference_type?: string;
  reference_id?: string;
  amount: number;
  payment_mode?: string;
  payment_date: Date;
  notes?: string;
  created_at: Date;
  created_by?: string;
}

export interface WhatsAppConfig {
  id: string;
  business_id: string;
  connection_type: 'cloud_api' | 'web_session';
  api_key?: string;
  api_secret?: string;
  phone_number_id?: string;
  session_data?: Record<string, any>;
  is_connected: boolean;
  last_connected_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface WhatsAppMessage {
  id: string;
  business_id: string;
  to_number: string;
  message_type: string;
  reference_type?: string;
  reference_id?: string;
  message_text?: string;
  media_url?: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  error_message?: string;
  sent_at: Date;
}

export interface Purchase {
  id: string;
  business_id: string;
  supplier_id?: string;
  bill_number?: string;
  bill_date: Date;
  status: string;
  place_of_supply_state_code?: string;
  is_reverse_charge: boolean;
  supplier_gstin?: string;
  document_type?: string;
  itc_eligible: boolean;
  itc_availed: boolean;
  itc_availed_date?: Date;
  subtotal: number;
  tax_total: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  round_off: number;
  grand_total: number;
  paid_amount: number;
  /** exclusive = pre-tax rates; inclusive = line rates include GST */
  price_mode?: string;
  supplier_state_code?: string;
  invoice_number?: string;
  notes?: string;
  created_at: Date;
  updated_at: Date;
}

export interface PurchaseItem {
  id: string;
  purchase_id: string;
  item_id?: string;
  item_name: string;
  hsn_sac?: string;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  discount_amount: number;
  taxable_value: number;
  tax_rate: number;
  tax_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  line_total: number;
}

export interface CreditNote {
  id: string;
  business_id: string;
  customer_id: string;
  invoice_id?: string;
  credit_note_number: string;
  credit_note_date: Date;
  original_invoice_date?: Date;
  reason?: string;
  place_of_supply_state_code?: string;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  round_off: number;
  grand_total: number;
  refund_status: string;
  refund_amount: number;
  refund_mode?: string;
  refund_date?: Date;
  notes?: string;
  created_at: Date;
  updated_at: Date;
  created_by?: string;
}

export interface DebitNote {
  id: string;
  business_id: string;
  customer_id: string;
  invoice_id?: string;
  debit_note_number: string;
  debit_note_date: Date;
  reason?: string;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  round_off: number;
  grand_total: number;
  place_of_supply_state_code?: string;
  original_invoice_date?: Date;
  adjustment_status: string;
  notes?: string;
  created_at: Date;
  updated_at: Date;
  created_by?: string;
}

export interface AdvancePayment {
  id: string;
  business_id: string;
  customer_id?: string;
  supplier_id?: string;
  type: 'received' | 'paid';
  amount: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax_rate: number;
  payment_date: Date;
  adjusted_invoice_id?: string;
  adjusted_purchase_id?: string;
  is_adjusted: boolean;
  adjustment_date?: Date;
  place_of_supply_state_code?: string;
  notes?: string;
  created_at: Date;
  updated_at: Date;
  created_by?: string;
}

export interface ItcReversal {
  id: string;
  business_id: string;
  purchase_id?: string;
  invoice_id?: string;
  reversal_reason: string;
  cgst_reversed: number;
  sgst_reversed: number;
  igst_reversed: number;
  reversal_date: Date;
  financial_year?: string;
  tax_period?: string;
  notes?: string;
  created_at: Date;
  created_by?: string;
}

export interface BusinessSettings {
  id: string;
  business_id: string;
  user_management_enabled: boolean;
  require_password?: boolean;
  session_timeout_minutes?: number;
  max_failed_login_attempts?: number;
  product_variants_enabled: boolean;
  settings?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface TDSCategory {
  id: string;
  business_id: string;
  section_code: string;
  section_name: string;
  description?: string;
  rate: number;
  threshold_amount: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface TDSTransaction {
  id: string;
  business_id: string;
  supplier_id?: string;
  payment_id?: string;
  tds_category_id: string;
  section_code: string;
  payment_amount: number;
  tds_rate: number;
  tds_amount: number;
  net_payment_amount: number;
  transaction_date: Date;
  financial_year: string;
  quarter: string;
  challan_number?: string;
  challan_date?: Date;
  is_deposited: boolean;
  deposited_date?: Date;
  notes?: string;
  created_at: Date;
  created_by?: string;
}

export interface TDSPayment {
  id: string;
  business_id: string;
  financial_year: string;
  quarter: string;
  challan_number: string;
  challan_date: Date;
  deposit_date: Date;
  total_tds_amount: number;
  bank_name?: string;
  payment_mode?: string;
  payment_reference?: string;
  status: 'pending' | 'deposited' | 'verified';
  notes?: string;
  created_at: Date;
  created_by?: string;
}

export interface TDSCertificate {
  id: string;
  business_id: string;
  supplier_id: string;
  financial_year: string;
  quarter: string;
  certificate_number: string;
  issue_date: Date;
  total_tds_amount: number;
  file_url?: string;
  is_issued: boolean;
  issued_date?: Date;
  notes?: string;
  created_at: Date;
  created_by?: string;
}

export interface TCSCategory {
  id: string;
  business_id: string;
  section_code: string;
  section_name: string;
  description?: string;
  rate: number;
  threshold_amount: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface TCSTransaction {
  id: string;
  business_id: string;
  customer_id?: string;
  invoice_id?: string;
  tcs_category_id: string;
  section_code: string;
  invoice_amount: number;
  tcs_rate: number;
  tcs_amount: number;
  transaction_date: Date;
  financial_year: string;
  quarter: string;
  challan_number?: string;
  challan_date?: Date;
  is_deposited: boolean;
  deposited_date?: Date;
  notes?: string;
  created_at: Date;
  created_by?: string;
}

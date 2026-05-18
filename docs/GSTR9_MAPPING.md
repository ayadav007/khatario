# GSTR-9 Data Source Mapping (CA-Grade)

This document maps each table of the official GSTR-9 Offline Tool (v2.1) to the corresponding data sources in the Khatario database.

## Part II: Details of Outward and Inward Supplies made during the financial year

### Table 4: Details of advances, inwards and outward supplies on which tax is payable

| Table ID | Description | Source | Filter/Logic |
|----------|-------------|--------|--------------|
| 4A | Supplies made to un-registered persons (B2C) | `invoices`, `invoice_items` | `customer_gstin` is NULL or empty. Aggregate by rate. |
| 4B | Supplies made to registered persons (B2B) | `invoices`, `invoice_items` | `customer_gstin` is NOT NULL. |
| 4C | Zero rated supply (Export) on payment of tax | `invoices`, `invoice_items` | `export_type` is 'WPAY' and NOT SEZ. |
| 4D | Supply to SEZs on payment of tax | `invoices`, `invoice_items` | `customer_type` is 'SEZ' and `export_type` is 'WPAY'. |
| 4E | Deemed Exports | `invoices`, `invoice_items` | `export_type` is 'DEEMED'. |
| 4F | Advances on which tax has been paid | `advance_payments` | Advances received in FY without invoices. |
| 4G | Inward supplies liable to reverse charge | `purchases`, `purchase_items` | `reverse_charge` = true. |
| 4I | Credit Notes (B to E) | `credit_notes` | Linked to B2B, Export, SEZ, Deemed Export. |
| 4J | Debit Notes (B to E) | `debit_notes` | Linked to B2B, Export, SEZ, Deemed Export. |
| 4K | Amendments (+) | `invoice_amendments` | Positive amendments to previous records. |
| 4L | Amendments (-) | `invoice_amendments` | Negative amendments to previous records. |

### Table 5: Details of Outward supplies on which tax is NOT payable

| Table ID | Description | Source | Filter/Logic |
|----------|-------------|--------|--------------|
| 5A | Zero rated supply (Export) without payment of tax | `invoices`, `invoice_items` | `export_type` is 'WOPAY' and NOT SEZ. |
| 5B | Supply to SEZs without payment of tax | `invoices`, `invoice_items` | `customer_type` is 'SEZ' and `export_type` is 'WOPAY'. |
| 5C | Supplies on which tax is to be paid by recipient (RCM) | `invoices` | `reverse_charge` = true (for sales). |
| 5D | Exempted | `invoice_items` | Items marked as 'Exempt'. |
| 5E | Nil Rated | `invoice_items` | Items with 0% tax rate (Nil rated). |
| 5F | Non-GST supply | `invoice_items` | Items marked as 'Non-GST'. |

## Part III: Details of ITC for the financial year

### Table 6: Details of ITC availed during the financial year

| Table ID | Description | Source | Filter/Logic |
|----------|-------------|--------|--------------|
| 6A | Total ITC through GSTR-3B | `gstr3b_data` | Sum of 4A from GSTR-3B for all 12 months. |
| 6B | Inward supplies (other than imports/RCM) | `purchases`, `purchase_items` | Standard B2B purchases. Split into Inputs, Capital Goods, Input Services. |
| 6C | RCM from unregistered persons | `purchases` | `supplier_gstin` is NULL and `reverse_charge` = true. |
| 6D | RCM from registered persons | `purchases` | `supplier_gstin` is NOT NULL and `reverse_charge` = true. |
| 6E | Import of goods (including SEZ) | `purchases` | `import_type` = 'Goods'. |
| 6F | Import of services (excluding SEZ) | `purchases` | `import_type` = 'Services'. |
| 6G | ITC from ISD | `purchases` | `supplier_type` = 'ISD'. |
| 6H | ITC reclaimed | `purchases` | Reclaimed ITC after previous reversal. |

### Table 7: Details of ITC Reversed and Ineligible ITC

| Table ID | Description | Source | Filter/Logic |
|----------|-------------|--------|--------------|
| 7A-7H | Reversals under various Rules (37, 38, 39, 42, 43, 17(5)) | `itc_reversals` | Categorized reversal transactions. |

### Table 8: Other ITC related information

| Table ID | Description | Source | Filter/Logic |
|----------|-------------|--------|--------------|
| 8A | ITC as per GSTR-2B | `gstr2b_data` | Auto-populated from GSTR-2B for the FY. |
| 8C | ITC on inward supplies received in FY but availed in next FY | `purchases` | Purchase date in FY, but ITC claimed in next FY (up to Nov). |

## Part IV: Details of tax paid as declared in returns filed during the financial year

### Table 9: Details of tax paid

| Table ID | Description | Source | Filter/Logic |
|----------|-------------|--------|--------------|
| 9A-9D | Tax Payable vs Paid (Cash) | `gstr3b_data`, `payments` | Tax liability declared vs paid via Electronic Cash/Credit Ledger. |
| 9E-9G | Interest, Late Fee, Penalty | `gstr3b_data`, `payments` | Paid values for these components. |

## Part V: Particulars of the transactions declared in next FY

### Table 10-14: Amendments

| Table ID | Description | Source | Filter/Logic |
|----------|-------------|--------|--------------|
| 10 | Supplies declared through Amendments/Credit Note (+) | `next_fy_transactions` | FY transactions declared in next FY (April-Nov). |
| 11 | Supplies reduced through Amendments/Credit Note (-) | `next_fy_transactions` | FY transactions reduced in next FY. |
| 12 | ITC of the FY reversed in next FY | `next_fy_reversals` | FY ITC reversed in next FY. |
| 13 | ITC of the FY availed in next FY | `next_fy_purchases` | FY purchases where ITC was claimed in next FY. |

## Part VI: Other Information

### Table 17-18: HSN Summary

| Table ID | Description | Source | Filter/Logic |
|----------|-------------|--------|--------------|
| 17 | HSN Summary of Outward Supplies | `invoice_items` | Aggregated by HSN code. |
| 18 | HSN Summary of Inward Supplies | `purchase_items` | Aggregated by HSN code. |


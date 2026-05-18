# GSTR-9 CA-Grade Rebuild Summary

The GSTR-9 (Annual GST Return) implementation has been rebuilt from the ground up based on the official **GSTR-9 Offline Tool (v2.1).xlsm**. This ensure high compliance and accuracy for statutory filing.

## Key Enhancements

1.  **Excel-Matched Structure**: The internal data structure and the frontend UI now match the official GST Offline Tool table-by-table (Table 4, 5, 6, 7, 8, 9, 10-14, 17-18).
2.  **CA-Level Validation**: Added validation warnings for common filing errors, such as:
    *   Differences in ITC availed vs GSTR-3B totals (Table 6J).
    *   Differences in GSTR-2B reconciliation (Table 8D).
3.  **Detailed ITC Categorization**: Inward supplies are now automatically categorized into **Inputs**, **Capital Goods**, and **Input Services** based on HSN/SAC codes.
4.  **Comprehensive Export**:
    *   **JSON Export**: For API and internal audit logs.
    *   **CSV ZIP Export**: Generates multiple CSV files (one per table) with exact column orders and headers required by the GST Offline Tool.
5.  **Data Source Precision**:
    *   Table 4 & 5 (Outward): Sourced from GSTR-1 aggregated data.
    *   Table 6 (ITC): Aggregated from monthly GSTR-3B and detailed purchase records.
    *   Table 8 (2B Reconciliation): Sourced from GSTR-2B data.
    *   Table 9 (Tax Paid): Sourced from monthly GSTR-3B liability and interest/late fee records.

## Technical Details

### Generator Logic (`lib/gst/gstr9.ts`)
- Implements 12-month aggregation (April to March).
- Handles financial year crossovers (e.g., FY 2024-25 spans 2024 and 2025).
- Uses `classifyItemType` helper for ITC categorization.

### Export Modules
- `lib/export/gstr9-csv.ts`: Handles generation of multiple CSV files and zipping.
- `app/api/reports/gst/gstr9/route.ts`: Supports `?format=csv` and `?format=json`.

### Frontend (`app/reports/gst/gstr9/page.tsx`)
- Displayed in a table-centric layout matching the statutory form.
- Provides clear visual indicators for bold totals and sub-totals.
- Displays validation warnings prominently.

## Assumptions & Unsupported Cases
- **Amendments**: Basic amendment tracking is implemented; however, complex multi-year amendments may require manual CA review.
- **Cash Ledger Details**: Detailed cash/credit ledger offsets are derived from GSTR-3B summary as the database does not currently track individual ledger balancing entries.
- **Table 15 & 16**: These tables (Demands/Refunds and Composition/Approval goods) are initialized but require manual input as they are not standard business transactions.


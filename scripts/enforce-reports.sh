#!/bin/bash
# Batch enforcement script for reports
# This helps identify which reports need enforcement

echo "Reports that need assertReportAccess enforcement:"
echo ""
echo "Basic reports (reports_basic):"
echo "- stock/*"
echo "- sales/*"
echo "- purchase/*"
echo "- party/*"
echo "- expense/*"
echo ""
echo "GST reports (reports_gst):"
echo "- gst/*"
echo ""
echo "Advanced reports (reports_advanced):"
echo "- profit-loss"
echo "- balance-sheet"
echo "- cash-flow"
echo "- trial-balance"
echo "- aging/*"
echo "- stock/valuation"
echo "- expense/profit-loss"


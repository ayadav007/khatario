export const buildInvoiceExtractionPrompt = ({
  rawText,
  lineItemRows = null,
  taxRows = null,
  previousError = ''
}) => `
Task: Extract structured invoice data from noisy OCR text.
Output ONLY one JSON object. No markdown, no prose, no explanation.

${previousError ? `⚠ Previous response was invalid: ${previousError}\nFix the issue below.\n` : ''}
## JSON Schema (every key MUST exist; use null if unknown)

{
  "vendor_name": "string — the SELLER / company that SOLD the goods (look for 'Sold By', 'From', company name at the top, or the entity whose GSTIN is printed). This is NOT the buyer / 'Bill To' / 'Ship To' party.",
  "invoice_number": "string — invoice/bill number",
  "gst_number": "string — the seller's GSTIN (15-char alphanumeric)",
  "invoice_date": "string — YYYY-MM-DD format",
  "subtotal": "number — sum before tax",
  "cgst": "number or null",
  "sgst": "number or null",
  "igst": "number or null",
  "total": "number — final payable amount (grand total)",
  "line_items": [
    {
      "description": "string — full product/service name. Merge related sub-lines (model, specs, FSN, warranty) into ONE description. Do NOT create separate items for sub-details of the same product.",
      "hsn_code": "string or null — HSN/SAC code",
      "quantity": "number",
      "unit_price": "number — price per unit before discount",
      "discount": "number — discount amount on this line (0 if none)",
      "tax_rate": "number — tax percentage applied to this item (e.g. 18 for 18% GST). Derive from IGST%/CGST%+SGST% columns or from the tax summary.",
      "amount": "number — final line total after discount and tax"
    }
  ]
}

## Key Rules

1. **Vendor vs Buyer**: The vendor_name is the SELLER. Look for "Sold By", "From", or the company name/logo at the top. The "Bill To" / "Ship To" names are the BUYER — never use those as vendor_name.
2. **Line items**: Each PRODUCT is one line item. If a product has multiple sub-lines (model name, specs, FSN, HSN/SAC, serial/IMEI, warranty info), merge them all into one item's description. Rows like "Exchange Discount" that only have a negative amount are discount adjustments — apply their value to the relevant item's discount field or create a separate line if it's a standalone discount entry.
3. **Discount**: Extract the discount amount per item. If a "Discount" column exists, use its absolute value. If a separate "Exchange Discount" line exists, treat it as a line item with negative amount.
4. **Tax rate**: Extract the tax percentage per item. Look in IGST%/CGST%/SGST% columns, or in text like "IGST: 18.000%". If only the total tax amount is available and not the rate, compute it from (tax_amount / taxable_value * 100).
5. **Numbers**: All monetary values must be numbers (not strings). Remove currency symbols (₹), commas.
6. **GST number**: The 15-character GSTIN of the seller.
7. **Reconstructed data**: If "Reconstructed line item rows" or "Tax summary rows" are provided below, prefer them over raw OCR for line items and tax details — but still validate against the full OCR text.

## Reconstructed line item rows (layout-based, may have OCR mistakes):
${lineItemRows ? JSON.stringify(lineItemRows) : 'null'}

## Tax summary rows (layout-based):
${taxRows ? JSON.stringify(taxRows) : 'null'}

## Full OCR text:
${rawText}
`;

export const buildVisionExtractionPrompt = ({ previousError = '' } = {}) => `
You are looking at an invoice image. Extract structured data from it.
Output ONLY one JSON object. No markdown, no prose, no explanation.

${previousError ? `⚠ Previous response was invalid: ${previousError}\nFix the issue below.\n` : ''}
## JSON Schema (every key MUST exist; use null if unknown)

{
  "vendor_name": "string — the SELLER / company that SOLD the goods. Look for 'Sold By', 'From', or the company name/logo at the top. The 'Bill To' / 'Ship To' is the BUYER — never use that as vendor_name.",
  "invoice_number": "string — invoice/bill number",
  "gst_number": "string — the seller's GSTIN (15-char alphanumeric, e.g. 29AAICA4872D1ZK)",
  "invoice_date": "string — YYYY-MM-DD format",
  "subtotal": "number — sum before tax",
  "cgst": "number or null — Central GST amount",
  "sgst": "number or null — State GST amount",
  "igst": "number or null — Integrated GST amount",
  "total": "number — final payable amount (grand total)",
  "line_items": [
    {
      "description": "string — full product/service name. Merge related sub-lines (model, specs, FSN, serial/IMEI, warranty) into ONE description. Do NOT split a single product into multiple items.",
      "hsn_code": "string or null — HSN/SAC code",
      "quantity": "number",
      "unit_price": "number — price per unit before discount",
      "discount": "number — discount amount on this line (0 if none). If a 'Discount' column exists, use its absolute value.",
      "tax_rate": "number — tax percentage (e.g. 18 for 18% GST). Derive from IGST%/CGST%+SGST% columns or text like 'IGST: 18.000%'.",
      "amount": "number — final line total after discount and tax"
    }
  ]
}

## Rules

1. **Vendor vs Buyer**: vendor_name = the SELLER (company that issued the invoice). "Bill To"/"Ship To" = BUYER. Never confuse them.
2. **Line items**: Each PRODUCT = one line item. Merge sub-lines (model, specs, FSN, HSN/SAC, serial number, warranty) into one item's description. "Exchange Discount" rows = discount entries with negative amounts.
3. **Discount**: Use the absolute value from the Discount column. If a separate discount line exists, treat it as a line item with negative amount OR add to the relevant item's discount.
4. **Tax rate**: Extract per-item tax percentage. Look in IGST%/CGST%/SGST% columns. If only tax amount is available, compute from (tax_amount / taxable_value * 100).
5. **Numbers**: All monetary values = numbers (not strings). Strip currency symbols and commas.
6. **GSTIN**: 15-character alphanumeric code of the seller.
7. **Date**: Convert to YYYY-MM-DD format regardless of how it appears on the invoice.
`;

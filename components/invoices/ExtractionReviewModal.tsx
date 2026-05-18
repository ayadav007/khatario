'use client';

import React, { useState, useEffect } from 'react';
import { X, Check, AlertTriangle, Edit2, Plus, Search } from 'lucide-react';
import { matchSupplier, type SupplierMatchResult } from '@/lib/matching/supplier-matcher';
import { matchItem, type ItemMatchResult } from '@/lib/matching/item-matcher';
import { summarizeInvoiceCorrectionDelta } from '@/lib/services/invoice-extract/invoiceExtractionCorrectionSummary';
import { inclusiveLineTotal, inclusiveLineTotalWithDiscountAmount } from '@/lib/invoice-line-math';
import { round2, roundRetailQty, roundExclusiveUnitPrice } from '@/lib/numeric-precision';
import { normalizeExtractionEnvelope } from '@/lib/purchases/extraction-envelope-normalize';

const LINE_ITEM_NUMERIC_FIELDS = new Set([
  'quantity',
  'unit_price',
  'amount',
  'discount_amount',
  'discount_percent',
  'tax_rate',
]);

function roundNumericChange(field: string, raw: unknown): unknown {
  if (!LINE_ITEM_NUMERIC_FIELDS.has(field)) return raw;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
  if (!Number.isFinite(n)) return 0;
  switch (field) {
    case 'quantity':
      return roundRetailQty(n);
    case 'unit_price':
      return roundExclusiveUnitPrice(n);
    default:
      return round2(n);
  }
}

interface ExtractionReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  extractedData: any;
  businessId: string;
  /** Optional — improves learning telemetry attribution */
  userId?: string | null;
  onAccept: (data: any) => void;
}

export function ExtractionReviewModal({
  isOpen,
  onClose,
  extractedData,
  businessId,
  userId,
  onAccept
}: ExtractionReviewModalProps) {
  const [editedData, setEditedData] = useState(extractedData);
  const [supplierMatches, setSupplierMatches] = useState<SupplierMatchResult[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<string | null>(null);
  const [itemMatches, setItemMatches] = useState<{ [key: number]: ItemMatchResult[] }>({});
  const [isMatchingSupplier, setIsMatchingSupplier] = useState(false);

  useEffect(() => {
    if (isOpen && extractedData) {
      setEditedData(normalizeExtractionEnvelope(extractedData));
      matchSupplierData();
    }
  }, [isOpen, extractedData]);

  const matchSupplierData = async () => {
    if (!extractedData?.data?.supplier) return;

    setIsMatchingSupplier(true);
    try {
      const matches = await matchSupplier(businessId, {
        name: extractedData.data.supplier.name,
        gstin: extractedData.data.supplier.gstin
      });

      setSupplierMatches(matches);

      const bestMatch = matches[0];
      if (bestMatch && (bestMatch.matchType === 'exact_gstin' || bestMatch.matchType === 'exact_name')) {
        setSelectedSupplier(bestMatch.supplierId);
      } else {
        setSelectedSupplier(null);
      }
    } catch (error) {
      console.error('Supplier matching error:', error);
    } finally {
      setIsMatchingSupplier(false);
    }
  };

  const matchItemData = async (itemIndex: number) => {
    const item = editedData.data.items[itemIndex];
    if (!item) return;

    try {
      const matches = await matchItem(businessId, {
        name: item.item_name,
        hsnSac: item.hsn_sac
      });

      setItemMatches(prev => ({
        ...prev,
        [itemIndex]: matches
      }));
    } catch (error) {
      console.error('Item matching error:', error);
    }
  };

  const handleSupplierFieldChange = (field: string, value: any) => {
    setEditedData({
      ...editedData,
      data: {
        ...editedData.data,
        supplier: {
          ...editedData.data.supplier,
          [field]: value
        }
      }
    });
  };

  const handleInvoiceFieldChange = (field: string, value: any) => {
    setEditedData({
      ...editedData,
      data: {
        ...editedData.data,
        invoice: {
          ...editedData.data.invoice,
          [field]: value
        }
      }
    });
  };

  const handleItemFieldChange = (index: number, field: string, value: any) => {
    const coerced = roundNumericChange(field, value);

    const updatedItems = [...editedData.data.items];
    updatedItems[index] = {
      ...updatedItems[index],
      [field]: coerced,
    };

    setEditedData({
      ...editedData,
      data: {
        ...editedData.data,
        items: updatedItems
      }
    });
  };

  const handleItemFieldsChange = (index: number, patch: Record<string, unknown>) => {
    const rounded: Record<string, unknown> = { ...patch };
    for (const k of LINE_ITEM_NUMERIC_FIELDS) {
      if (!(k in rounded)) continue;
      rounded[k] = roundNumericChange(k, rounded[k]);
    }
    const updatedItems = [...editedData.data.items];
    updatedItems[index] = {
      ...updatedItems[index],
      ...rounded,
    };

    setEditedData({
      ...editedData,
      data: {
        ...editedData.data,
        items: updatedItems,
      },
    });
  };

  const handleAccept = () => {
    const summary = summarizeInvoiceCorrectionDelta(extractedData?.data, editedData?.data);
    const jobId = extractedData?.job_id;
    if (jobId && businessId) {
      void fetch('/api/invoices/extract/learning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          job_id: jobId,
          source: 'extraction_review_modal',
          correction_summary: summary,
          review_before: extractedData?.data ?? undefined,
          review_after: editedData?.data ?? undefined,
          ...(userId ? { user_id: userId } : {}),
        }),
      }).catch(() => {
        /* non-blocking learning ping */
      });
    }

    onAccept({
      ...editedData,
      selectedSupplier,
      itemMatches
    });
  };

  if (!isOpen) return null;

  const supplier = editedData?.data?.supplier || {};
  const invoice = editedData?.data?.invoice || {};
  const items = editedData?.data?.items || [];
  const totals = editedData?.data?.totals || {};

  const lineInclusiveDisplay = (item: any) => {
    const qty = Number(item.quantity) || 0;
    const up = Number(item.unit_price) || 0;
    const disc = Number(item.discount_percent) || 0;
    const discAmt = Number(item.discount_amount) || 0;
    const tr = Number(item.tax_rate) || 0;
    const fromAmount =
      typeof item.amount === 'number' && item.amount !== 0 ? item.amount : 0;
    if (fromAmount !== 0) return round2(fromAmount);
    if (qty > 0 && up !== 0) {
      if (discAmt > 0) {
        return round2(
          inclusiveLineTotalWithDiscountAmount(
            qty,
            up,
            discAmt,
            tr,
            item.discount_on_tax_inclusive === true
          )
        );
      }
      return round2(inclusiveLineTotal(qty, up, disc, tr));
    }
    return 0;
  };

  const sumLineTaxableFromItems = items.reduce((s: number, it: any) => {
    const amt =
      typeof it.amount === 'number' && it.amount !== 0 ? it.amount : lineInclusiveDisplay(it);
    const tr = Number(it.tax_rate) || 0;
    if (Math.abs(amt) < 1e-9) return s;
    if (tr === 0) return s + amt;
    return s + amt / (1 + tr / 100);
  }, 0);

  const computedTaxableSubtotal =
    totals.subtotal != null && Number(totals.subtotal) > 0
      ? Number(totals.subtotal)
      : sumLineTaxableFromItems !== 0
        ? round2(sumLineTaxableFromItems)
        : 0;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75" onClick={onClose} />

        <div className="inline-block w-full max-w-6xl my-8 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-lg">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Review Extracted Invoice Data
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                Review and edit the extracted data before filling the form
              </p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Content */}
          <div className="px-6 py-4 max-h-[70vh] overflow-y-auto">
            {/* Supplier Section */}
            <div className="mb-6">
              <h4 className="text-md font-semibold text-gray-900 mb-3">Supplier Information</h4>
              
              {supplierMatches.length > 0 && (
                <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                  <p className="text-sm font-medium text-gray-900 mb-2">
                    {supplierMatches[0].matchType === 'exact_gstin' || supplierMatches[0].matchType === 'exact_name'
                      ? 'Matched Supplier:' : 'Similar suppliers found — select one or add as new:'}
                  </p>
                  <div className="space-y-2">
                    {supplierMatches.slice(0, 3).map((match) => (
                      <label key={match.supplierId} className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="radio"
                          name="supplier"
                          checked={selectedSupplier === match.supplierId}
                          onChange={() => setSelectedSupplier(match.supplierId)}
                          className="w-4 h-4 text-primary-600"
                        />
                        <span className="text-sm text-gray-900">{match.supplierName}</span>
                        {match.gstin && (
                          <span className="text-xs text-gray-500">({match.gstin})</span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          match.confidence === 'high' ? 'bg-green-100 text-green-800' :
                          match.confidence === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {match.matchType}
                        </span>
                      </label>
                    ))}
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="radio"
                        name="supplier"
                        checked={selectedSupplier === null}
                        onChange={() => setSelectedSupplier(null)}
                        className="w-4 h-4 text-primary-600"
                      />
                      <span className="text-sm font-medium text-gray-700">
                        None of these — add &quot;{supplier.name}&quot; as new supplier
                      </span>
                    </label>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input
                    type="text"
                    value={supplier.name || ''}
                    onChange={(e) => handleSupplierFieldChange('name', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">GSTIN</label>
                  <input
                    type="text"
                    value={supplier.gstin || ''}
                    onChange={(e) => handleSupplierFieldChange('gstin', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    maxLength={15}
                  />
                </div>
              </div>
            </div>

            {/* Invoice Details */}
            <div className="mb-6">
              <h4 className="text-md font-semibold text-gray-900 mb-3">Invoice Details</h4>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Bill Number</label>
                  <input
                    type="text"
                    value={invoice.bill_number || ''}
                    onChange={(e) => handleInvoiceFieldChange('bill_number', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Bill Date</label>
                  <input
                    type="date"
                    value={invoice.bill_date || ''}
                    onChange={(e) => handleInvoiceFieldChange('bill_date', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Document Type</label>
                  <select
                    value={invoice.document_type || 'tax_invoice'}
                    onChange={(e) => handleInvoiceFieldChange('document_type', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value="tax_invoice">Tax Invoice</option>
                    <option value="bill_of_supply">Bill of Supply</option>
                    <option value="bill_of_entry">Bill of Entry</option>
                  </select>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs text-gray-600">
                {invoice.tax_type && (
                  <span>
                    Tax type:{' '}
                    <span className="font-mono text-gray-900">{String(invoice.tax_type)}</span>
                  </span>
                )}
                {invoice.price_mode && (
                  <span>
                    Price mode:{' '}
                    <span className="font-mono text-gray-900">{String(invoice.price_mode)}</span>
                  </span>
                )}
                {invoice.place_of_supply && (
                  <span>
                    Place of supply:{' '}
                    <span className="text-gray-900">{String(invoice.place_of_supply)}</span>
                  </span>
                )}
                {invoice.buyer_gstin && (
                  <span>
                    Buyer GSTIN:{' '}
                    <span className="font-mono text-gray-900">{String(invoice.buyer_gstin)}</span>
                  </span>
                )}
              </div>
            </div>

            {/* Line Items */}
            <div className="mb-6">
              <h4 className="text-md font-semibold text-gray-900 mb-3">Line Items</h4>
              {items.length > 0 ? (
                <div className="space-y-3">
                  {items.map((item: any, index: number) => (
                    <div key={index} className="border border-gray-200 rounded-lg p-4">
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-gray-700 mb-1">Item Name</label>
                          <input
                            type="text"
                            value={item.item_name || ''}
                            onChange={(e) => handleItemFieldChange(index, 'item_name', e.target.value)}
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">HSN/SAC</label>
                          <input
                            type="text"
                            value={item.hsn_sac || ''}
                            onChange={(e) => handleItemFieldChange(index, 'hsn_sac', e.target.value)}
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Quantity</label>
                          <input
                            type="number"
                            value={item.quantity || 0}
                            onChange={(e) => handleItemFieldChange(index, 'quantity', parseFloat(e.target.value))}
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Unit Price (excl. GST)</label>
                          <input
                            type="number"
                            step="0.01"
                            value={item.unit_price || 0}
                            onChange={(e) => handleItemFieldChange(index, 'unit_price', parseFloat(e.target.value))}
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Line total (incl. GST)</label>
                          <input
                            type="number"
                            step="0.01"
                            value={
                              typeof item.amount === 'number' && item.amount !== 0
                                ? item.amount
                                : lineInclusiveDisplay(item)
                            }
                            onChange={(e) =>
                              handleItemFieldChange(index, 'amount', parseFloat(e.target.value) || 0)
                            }
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
                          />
                          <p className="text-[10px] text-gray-500 mt-0.5">From invoice; edit if OCR is wrong</p>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Unit</label>
                          <input
                            type="text"
                            value={item.unit || 'PCS'}
                            onChange={(e) => handleItemFieldChange(index, 'unit', e.target.value)}
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Discount (₹)</label>
                          <input
                            type="number"
                            step="0.01"
                            value={item.discount_amount ?? 0}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value) || 0;
                              handleItemFieldsChange(index, {
                                discount_amount: v,
                                discount_percent:
                                  v > 0 ? 0 : Number(editedData.data.items[index]?.discount_percent) || 0,
                                ...(v <= 0 ? { discount_on_tax_inclusive: false } : {}),
                              });
                            }}
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
                          />
                          {(Number(item.discount_amount) || 0) > 0 &&
                            (Number(item.tax_rate) || 0) > 0 && (
                              <label className="mt-1 flex cursor-pointer items-center gap-1.5 text-[10px] text-gray-600">
                                <input
                                  type="checkbox"
                                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                  checked={item.discount_on_tax_inclusive === true}
                                  onChange={(e) =>
                                    handleItemFieldsChange(index, {
                                      discount_on_tax_inclusive: e.target.checked,
                                    })
                                  }
                                />
                                <span>Discount from price incl. GST (MRP-style)</span>
                              </label>
                            )}
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Discount %</label>
                          <input
                            type="number"
                            step="0.01"
                            value={item.discount_percent || 0}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value) || 0;
                              handleItemFieldsChange(index, {
                                discount_percent: v,
                                discount_amount: v > 0 ? 0 : Number(editedData.data.items[index]?.discount_amount) || 0,
                                discount_on_tax_inclusive: v > 0 ? false : editedData.data.items[index]?.discount_on_tax_inclusive,
                              });
                            }}
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Tax Rate %</label>
                          <input
                            type="number"
                            step="0.01"
                            value={item.tax_rate || 0}
                            onChange={(e) => handleItemFieldChange(index, 'tax_rate', parseFloat(e.target.value))}
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
                          />
                        </div>
                      </div>
                      
                      {itemMatches[index] && itemMatches[index].length > 0 && (
                        <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded">
                          <p className="text-xs font-medium text-green-900">
                            Matched item: {itemMatches[index][0].itemName}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <AlertTriangle className="w-12 h-12 mx-auto mb-2 text-yellow-500" />
                  <p className="text-sm">No line items extracted</p>
                </div>
              )}
            </div>

            {/* Totals — invoice-level; purchase form recomputes line tax from excl. unit prices */}
            <div className="border-t border-gray-200 pt-4">
              <h4 className="text-md font-semibold text-gray-900 mb-3">Invoice totals (reference)</h4>
              <p className="text-xs text-gray-600 mb-3">
                Line totals above include GST. After you accept, the purchase form uses pre-GST unit prices so tax is not doubled.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Taxable subtotal</label>
                  <div className="text-lg font-semibold text-gray-900">
                    ₹{computedTaxableSubtotal.toFixed(2)}
                  </div>
                </div>
                {totals.cgst != null && Number(totals.cgst) > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">CGST</label>
                    <div className="text-lg font-semibold text-gray-900">₹{Number(totals.cgst).toFixed(2)}</div>
                  </div>
                )}
                {totals.sgst != null && Number(totals.sgst) > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">SGST</label>
                    <div className="text-lg font-semibold text-gray-900">₹{Number(totals.sgst).toFixed(2)}</div>
                  </div>
                )}
                {totals.igst != null && Number(totals.igst) > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">IGST</label>
                    <div className="text-lg font-semibold text-gray-900">₹{Number(totals.igst).toFixed(2)}</div>
                  </div>
                )}
                {totals.tax_amount != null &&
                  Number(totals.tax_amount) > 0 &&
                  !(Number(totals.cgst) > 0) &&
                  !(Number(totals.sgst) > 0) &&
                  !(Number(totals.igst) > 0) && (
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Tax total</label>
                      <div className="text-lg font-semibold text-gray-900">
                        ₹{Number(totals.tax_amount).toFixed(2)}
                      </div>
                    </div>
                  )}
                {totals.grand_total != null && (
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Grand total (incl. tax)</label>
                    <div className="text-lg font-semibold text-gray-900">
                      ₹{Number(totals.grand_total || 0).toFixed(2)}
                    </div>
                  </div>
                )}
              </div>
              {Array.isArray(totals.gst_summary) && totals.gst_summary.length > 0 && (
                <div className="mt-4 overflow-x-auto rounded border border-gray-200">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50 text-left text-gray-700">
                      <tr>
                        <th className="px-2 py-2">GST %</th>
                        <th className="px-2 py-2 text-right">Taxable</th>
                        <th className="px-2 py-2 text-right">CGST</th>
                        <th className="px-2 py-2 text-right">SGST</th>
                        <th className="px-2 py-2 text-right">IGST</th>
                        <th className="px-2 py-2 text-right">Tax</th>
                      </tr>
                    </thead>
                    <tbody>
                      {totals.gst_summary.map((row: any, i: number) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-2 py-1.5 font-mono">{row.gst_rate ?? '—'}</td>
                          <td className="px-2 py-1.5 text-right">₹{Number(row.taxable_value ?? 0).toFixed(2)}</td>
                          <td className="px-2 py-1.5 text-right">₹{Number(row.cgst ?? 0).toFixed(2)}</td>
                          <td className="px-2 py-1.5 text-right">₹{Number(row.sgst ?? 0).toFixed(2)}</td>
                          <td className="px-2 py-1.5 text-right">₹{Number(row.igst ?? 0).toFixed(2)}</td>
                          <td className="px-2 py-1.5 text-right font-medium">₹{Number(row.total_tax ?? 0).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="px-2 py-1.5 text-[10px] text-gray-500 border-t border-gray-100">
                    GST slab table is rolled up from line items (tax-inclusive totals and rates) after
                    normalization so it matches the grid.
                  </p>
                </div>
              )}
            </div>
            </div>

            {(extractedData?.ocr_gst_summary || extractedData?.debug?.ocr_gst) && (
              <div className="border-t border-gray-200 pt-4 mt-4">
                <details className="rounded-lg border border-border bg-white">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-text-primary select-none">
                    OCR layout &amp; deterministic GST slabs (Google Vision + layout engine)
                  </summary>
                  <div className="px-4 pb-4 space-y-3 border-t border-border bg-gray-50">
                    {extractedData?.ocr_gst_summary && (
                      <ul className="text-xs text-text-secondary list-disc list-inside space-y-1 pt-3">
                        <li>
                          Reconstructed OCR lines:{' '}
                          <span className="font-mono text-text-primary">
                            {extractedData.ocr_gst_summary.layout_line_count}
                          </span>
                        </li>
                        <li>
                          GST rate overrides applied:{' '}
                          <span className="font-mono text-text-primary">
                            {extractedData.ocr_gst_summary.override_count}
                          </span>
                        </li>
                        <li>
                          Validation confidence:{' '}
                          <span className="font-mono text-text-primary">
                            {extractedData.ocr_gst_summary.validation_confidence}
                          </span>{' '}
                          · warnings:{' '}
                          <span className="font-mono text-text-primary">
                            {extractedData.ocr_gst_summary.validation_warnings}
                          </span>
                        </li>
                      </ul>
                    )}
                    {extractedData?.debug?.ocr_gst && (
                      <div className="space-y-3 text-xs">
                        {Array.isArray((extractedData.debug.ocr_gst as any).section_headers) &&
                          (extractedData.debug.ocr_gst as any).section_headers.length > 0 && (
                            <div>
                              <div className="font-medium text-text-secondary mb-1">Detected section headers</div>
                              <ul className="font-mono text-[11px] space-y-0.5 text-text-primary bg-white border border-border rounded p-2 max-h-32 overflow-y-auto">
                                {(extractedData.debug.ocr_gst as any).section_headers.map(
                                  (
                                    h: { text: string; y: number; rate?: number; confidence?: number },
                                    i: number
                                  ) => (
                                    <li key={i}>
                                      y={h.y}
                                      {h.rate != null ? ` · ${h.rate}%` : ''}
                                      {h.confidence != null ? ` · conf ${h.confidence}` : ''} · {h.text}
                                    </li>
                                  )
                                )}
                              </ul>
                            </div>
                          )}
                        {Array.isArray((extractedData.debug.ocr_gst as any).propagation?.trace?.footerIgnoredHeaders) &&
                          (extractedData.debug.ocr_gst as any).propagation.trace.footerIgnoredHeaders.length > 0 && (
                            <div>
                              <div className="font-medium text-text-secondary mb-1">
                                Footer / post-total GST lines ignored (no section restart)
                              </div>
                              <ul className="font-mono text-[10px] space-y-0.5 text-text-primary bg-white border border-border rounded p-2 max-h-28 overflow-y-auto">
                                {(extractedData.debug.ocr_gst as any).propagation.trace.footerIgnoredHeaders.map(
                                  (r: { lineIndex: number; text: string; reason: string }, i: number) => (
                                    <li key={i}>
                                      #{r.lineIndex} · {r.reason} · {r.text}
                                    </li>
                                  )
                                )}
                              </ul>
                            </div>
                          )}
                        {Array.isArray((extractedData.debug.ocr_gst as any).propagation?.trace?.rejectedHeaders) &&
                          (extractedData.debug.ocr_gst as any).propagation.trace.rejectedHeaders.length > 0 && (
                            <div>
                              <div className="font-medium text-text-secondary mb-1">Rejected header candidates</div>
                              <ul className="font-mono text-[10px] space-y-0.5 text-gray-700 bg-white border border-border rounded p-2 max-h-28 overflow-y-auto">
                                {(extractedData.debug.ocr_gst as any).propagation.trace.rejectedHeaders
                                  .slice(0, 40)
                                  .map((r: { lineIndex: number; text: string; reason: string; confidence: number }, i: number) => (
                                    <li key={i}>
                                      #{r.lineIndex} conf={r.confidence} {r.reason} · {r.text}
                                    </li>
                                  ))}
                              </ul>
                            </div>
                          )}
                        {Array.isArray((extractedData.debug.ocr_gst as any).propagation?.overrides) &&
                          (extractedData.debug.ocr_gst as any).propagation.overrides.length > 0 && (
                            <div>
                              <div className="font-medium text-text-secondary mb-1">Line overrides (LLM → OCR slab)</div>
                              <div className="overflow-x-auto border border-border rounded bg-white">
                                <table className="min-w-full text-[11px]">
                                  <thead className="bg-gray-50 text-left text-gray-700">
                                    <tr>
                                      <th className="px-2 py-1">#</th>
                                      <th className="px-2 py-1">From %</th>
                                      <th className="px-2 py-1">To %</th>
                                      <th className="px-2 py-1">Reason</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(extractedData.debug.ocr_gst as any).propagation.overrides.map(
                                      (o: { index: number; fromRate: number | null; toRate: number; reason: string }) => (
                                        <tr key={o.index} className="border-t border-gray-100">
                                          <td className="px-2 py-1">{o.index + 1}</td>
                                          <td className="px-2 py-1 font-mono">{o.fromRate ?? '—'}</td>
                                          <td className="px-2 py-1 font-mono">{o.toRate}</td>
                                          <td className="px-2 py-1 font-mono text-gray-600">{o.reason}</td>
                                        </tr>
                                      )
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        {Array.isArray((extractedData.debug.ocr_gst as any).validation?.issues) &&
                          (extractedData.debug.ocr_gst as any).validation.issues.length > 0 && (
                            <div>
                              <div className="font-medium text-text-secondary mb-1">Validation</div>
                              <ul className="space-y-1 text-amber-800">
                                {(extractedData.debug.ocr_gst as any).validation.issues.map(
                                  (iss: { code: string; message: string }, i: number) => (
                                    <li key={i} className="text-[11px]">
                                      {iss.code}: {iss.message}
                                    </li>
                                  )
                                )}
                              </ul>
                            </div>
                          )}
                        <div>
                          <div className="font-medium text-text-secondary mb-1">
                            Reconstructed lines (sample — y / kind / slab)
                          </div>
                          <div className="max-h-40 overflow-y-auto font-mono text-[10px] border border-border rounded p-2 bg-white text-text-primary">
                            {((extractedData.debug.ocr_gst as any).propagation?.lines as any[])
                              ?.slice(0, 80)
                              .map((ln: any, i: number) => (
                                <div key={i} className="truncate">
                                  y={ln.y} [{ln.kind}] slab={ln.assignedSectionGstRate ?? '—'} · {ln.text}
                                </div>
                              ))}
                          </div>
                        </div>
                      </div>
                    )}
                    {!extractedData?.debug?.ocr_gst && extractedData?.ocr_gst_summary && (
                      <p className="text-xs text-text-secondary pt-2">
                        Set <code className="bg-gray-100 px-1 rounded">INVOICE_EXTRACT_DEBUG=true</code> for full OCR
                        line list, section headers, and validation detail.
                      </p>
                    )}
                  </div>
                </details>
              </div>
            )}

          {/* Trace: structured JSON + optional raw OCR (see INVOICE_EXTRACT_DEBUG in .env) */}
          <div className="border-t border-gray-200 pt-4 mt-4">
            <details className="rounded-lg border border-border bg-gray-50">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-text-primary select-none">
                Extraction trace (structured JSON
                {extractedData?.debug?.raw_ocr_text ? ' and raw OCR' : ''})
              </summary>
              <div className="px-4 pb-4 space-y-3 border-t border-border bg-white">
                <p className="text-xs text-text-secondary pt-3">
                  Method:{' '}
                  <span className="font-mono text-text-primary">
                    {extractedData?.extraction_method || '—'}
                  </span>
                  . Raw Google Vision text is only included when{' '}
                  <code className="text-[11px] bg-gray-100 px-1 rounded">INVOICE_EXTRACT_DEBUG=true</code> and
                  Google OCR pipeline is used.
                </p>
                {typeof extractedData?.debug?.note === 'string' && (
                  <p className="text-xs text-text-secondary">{extractedData.debug.note}</p>
                )}
                {(extractedData?.debug?.raw_ocr_truncated === true ||
                  extractedData?.debug?.ocr_was_clipped_for_llm === true) && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                    {extractedData?.debug?.raw_ocr_truncated === true &&
                      'OCR preview below is truncated for response size. '}
                    {extractedData?.debug?.ocr_was_clipped_for_llm === true &&
                      'Text sent to the LLM was clipped at the model input limit — extraction may miss tail content.'}
                  </p>
                )}
                {typeof extractedData?.debug?.raw_ocr_text === 'string' &&
                  extractedData.debug.raw_ocr_text.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-text-secondary mb-1">Raw OCR (Google Vision)</div>
                      <textarea
                        readOnly
                        className="w-full min-h-[160px] max-h-[40vh] text-xs font-mono border border-border rounded-md p-2 bg-gray-50 text-text-primary"
                        value={extractedData.debug.raw_ocr_text}
                      />
                    </div>
                  )}
                <div>
                  <div className="text-xs font-medium text-text-secondary mb-1">
                    Structured extraction (what the app parsed — same as below in the form)
                  </div>
                  <pre className="max-h-[36vh] overflow-auto text-[11px] leading-snug font-mono border border-border rounded-md p-3 bg-gray-50 text-text-primary whitespace-pre-wrap break-words">
                    {JSON.stringify(extractedData?.data ?? {}, null, 2)}
                  </pre>
                </div>
              </div>
            </details>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleAccept}
              className="px-6 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 flex items-center space-x-2"
            >
              <Check className="w-4 h-4" />
              <span>Fill Purchase Form</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

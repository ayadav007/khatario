import React from 'react';

interface TemplatePreviewPlaceholderProps {
  templateId: string;
  templateName: string;
  color?: string;
  isComposition?: boolean;
}

export const TemplatePreviewPlaceholder: React.FC<TemplatePreviewPlaceholderProps> = ({
  templateId,
  templateName,
  color = '#2563eb',
  isComposition = false
}) => {
  return (
    <div className="relative w-full h-full bg-white" style={{ aspectRatio: '3/4' }}>
      {/* Header with color accent */}
      <div 
        className="h-[15%] border-b-4 relative overflow-hidden"
        style={{ 
          backgroundColor: `${color}10`,
          borderColor: color 
        }}
      >
        <div className="absolute inset-0 p-4 flex justify-between items-start">
          <div>
            <div className="font-bold text-xs" style={{ color }}>
              Digitable
            </div>
            <div className="text-[6px] text-gray-500 mt-0.5">
              123 Business Park, Mumbai
            </div>
            <div className="text-[5px] text-gray-400 mt-0.5">
              GSTIN: 27AABCU9603R1ZM
            </div>
          </div>
          <div className="text-right">
            <div className="font-bold text-[10px]" style={{ color }}>
              {isComposition ? 'BILL OF SUPPLY' : 'TAX INVOICE'}
            </div>
            <div className="text-[6px] text-gray-500 mt-0.5">
              {templateName}
            </div>
          </div>
        </div>
      </div>

      {/* Bill To & Invoice Details */}
      <div className="h-[15%] p-3 flex gap-2">
        <div className="flex-1 bg-gray-50 rounded-md p-2 border-l-2" style={{ borderColor: color }}>
          <div className="text-[5px] text-gray-500 font-semibold mb-1">BILL TO:</div>
          <div className="text-[7px] font-bold text-gray-900">XYZ Enterprises</div>
          <div className="text-[5px] text-gray-500">456 Park, Gurugram</div>
        </div>
        <div className="flex-1 bg-gray-50 rounded-md p-2 border-l-2" style={{ borderColor: color }}>
          <div className="text-[5px] text-gray-500 font-semibold mb-1">INVOICE #:</div>
          <div className="text-[6px] text-gray-900">INV-2026-001</div>
          <div className="text-[5px] text-gray-500">Date: 02-Jan-2026</div>
        </div>
      </div>

      {/* Items Table */}
      <div className="h-[45%] px-3">
        {/* Table Header */}
        <div 
          className="flex items-center px-2 py-1.5 text-white rounded-t-md text-[6px] font-semibold"
          style={{ backgroundColor: color }}
        >
          <div className="w-[5%]">#</div>
          <div className="flex-1">ITEM</div>
          <div className="w-[15%] text-right">HSN</div>
          <div className="w-[12%] text-right">QTY</div>
          <div className="w-[15%] text-right">RATE</div>
          {!isComposition && <div className="w-[10%] text-right">TAX</div>}
          <div className="w-[15%] text-right">AMT</div>
        </div>

        {/* Table Rows */}
        {[1, 2, 3].map((row) => (
          <div 
            key={row}
            className={`flex items-center px-2 py-1.5 text-[6px] border-b border-gray-100 ${
              row % 2 === 0 ? 'bg-gray-50' : 'bg-white'
            }`}
          >
            <div className="w-[5%] text-gray-600">{row}</div>
            <div className="flex-1">
              <div className="text-gray-900 font-semibold text-[6px]">Premium Product {row}</div>
              <div className="text-gray-500 text-[5px]">Industrial grade</div>
            </div>
            <div className="w-[15%] text-right text-gray-600">27101990</div>
            <div className="w-[12%] text-right text-gray-600">{50 - row * 10}</div>
            <div className="w-[15%] text-right text-gray-600">₹{450 + row * 50}</div>
            {!isComposition && <div className="w-[10%] text-right text-gray-600">18%</div>}
            <div className="w-[15%] text-right text-gray-900 font-semibold">₹{(450 + row * 50) * (50 - row * 10)}</div>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="h-[15%] px-3 flex flex-col items-end justify-center gap-0.5">
        <div className="w-[40%] flex justify-between text-[6px] py-0.5">
          <span className="text-gray-600">Subtotal:</span>
          <span className="text-gray-900">₹59,020.00</span>
        </div>
        {!isComposition && (
          <>
            <div className="w-[40%] flex justify-between text-[5px] py-0.5">
              <span className="text-gray-500">CGST (9%):</span>
              <span className="text-gray-700">₹4,771.80</span>
            </div>
            <div className="w-[40%] flex justify-between text-[5px] py-0.5">
              <span className="text-gray-500">SGST (9%):</span>
              <span className="text-gray-700">₹4,771.80</span>
            </div>
          </>
        )}
        <div 
          className="w-[40%] flex justify-between text-white text-[7px] font-bold px-2 py-1 rounded-md mt-1"
          style={{ backgroundColor: color }}
        >
          <span>Grand Total:</span>
          <span>₹68,563.60</span>
        </div>
      </div>

      {/* Composition Disclaimer */}
      {isComposition && (
        <div className="mx-3 mb-2 bg-yellow-50 border-l-2 border-yellow-500 p-1.5 rounded">
          <p className="text-[5px] text-yellow-900 font-semibold">
            📋 Composition Taxable Person - Not eligible to collect tax
          </p>
        </div>
      )}

      {/* Footer */}
      <div className="absolute bottom-0 left-0 right-0 h-[10%] border-t border-gray-200 px-3 pt-2 pb-1 flex justify-between items-center bg-white">
        <div>
          <div className="text-[5px] text-gray-500 font-semibold">BANK DETAILS</div>
          <div className="text-[5px] text-gray-600">HDFC Bank | A/c: 50200012345678</div>
        </div>
        <div className="text-right">
          <div className="border-t border-gray-900 pt-0.5 px-2">
            <div className="text-[5px] text-gray-900 font-semibold">Authorized Signatory</div>
          </div>
        </div>
      </div>

      {/* Template Watermark */}
      <div className="absolute bottom-1 left-0 right-0 text-center">
        <span className="text-[4px] text-gray-300">{templateName} Preview</span>
      </div>
    </div>
  );
};


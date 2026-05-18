import archiver from 'archiver';
import { B2BInvoice, B2CLInvoice, B2CSInvoice, HSNEntry, NilRatedEntry, ExportInvoice, CDNEntry } from '@/lib/gst/gstr1';

// Helper to convert array of objects to CSV string
function toCSV(data: any[], headers: string[]): string {
  if (!data || data.length === 0) return headers.join(',') + '\n';
  
  const csvRows = [headers.join(',')];
  
  for (const row of data) {
    const values = headers.map(header => {
      // Map header key to object key (simplified)
      // In reality, headers might differ from keys, so we need mapping.
      // For now, let's assume keys match or we do mapping here.
      const key = headerToKeyMap[header]; 
      const val = row[key];
      const escaped = ('' + (val ?? '')).replace(/"/g, '""');
      return `"${escaped}"`;
    });
    csvRows.push(values.join(','));
  }
  return csvRows.join('\n');
}

const headerToKeyMap: Record<string, string> = {
  // B2B
  'Invoice Number': 'invoice_number',
  'Invoice date': 'invoice_date',
  'Invoice Value': 'invoice_value',
  'Place Of Supply': 'place_of_supply',
  'Reverse Charge': 'reverse_charge',
  'Invoice Type': 'invoice_type',
  'E-Commerce GSTIN': 'ecommerce_gstin',
  'Rate': 'rate',
  'Taxable Value': 'taxable_value',
  'Cess Amount': 'cess_amount',
  
  // B2CL
  'Applicable % of Tax Rate': 'rate',
  
  // B2CS
  'Type': 'type',
  
  // HSN
  'HSN/SAC': 'hsn_sac',
  'Description': 'description',
  'UQC': 'uqc',
  'Total Quantity': 'total_quantity',
  'Total Value': 'total_value',
  'Integrated Tax Amount': 'integrated_tax',
  'Central Tax Amount': 'central_tax',
  'State/UT Tax Amount': 'state_ut_tax',
  
  // Exports
  'Export Type': 'export_type',
  'Port Code': 'port_code',
  'Shipping Bill Number': 'shipping_bill_number',
  'Shipping Bill Date': 'shipping_bill_date',
  
  // Nil
  'Nil Rated Supplies': 'nil_supply',
  'Exempted (Other than Nil rated/non-GST supply)': 'exempt_supply',
  'Non-GST supplies': 'non_gst_supply',

  // CDN
  'GSTIN/UIN of Recipient': 'gstin_uin_recipient',
  'Receiver Name': 'receiver_name',
  'Note Number': 'note_number',
  'Note Date': 'note_date',
  'Note Type': 'note_type',
  'Original Invoice Number': 'original_invoice_number',
  'Original Invoice Date': 'original_invoice_date',
  'Note Supply Type': 'note_supply_type'
};

export async function generateCSVZip(data: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    
    archive.on('data', chunk => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', err => reject(err));

    // B2B
    const b2bHeaders = ['GSTIN/UIN of Recipient', 'Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Reverse Charge', 'Invoice Type', 'E-Commerce GSTIN', 'Rate', 'Taxable Value', 'Cess Amount'];
    archive.append(toCSV(data.b2b, b2bHeaders), { name: 'b2b.csv' });

    // B2CL
    const b2clHeaders = ['Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Applicable % of Tax Rate', 'Taxable Value', 'Cess Amount', 'E-Commerce GSTIN'];
    archive.append(toCSV(data.b2cl, b2clHeaders), { name: 'b2cl.csv' });

    // B2CS
    const b2csHeaders = ['Type', 'Place Of Supply', 'Rate', 'Taxable Value', 'Cess Amount', 'E-Commerce GSTIN'];
    archive.append(toCSV(data.b2cs, b2csHeaders), { name: 'b2cs.csv' });

    // HSN
    const hsnHeaders = ['HSN/SAC', 'Description', 'UQC', 'Total Quantity', 'Total Value', 'Taxable Value', 'Integrated Tax Amount', 'Central Tax Amount', 'State/UT Tax Amount', 'Cess Amount', 'Rate'];
    archive.append(toCSV(data.hsn, hsnHeaders), { name: 'hsn.csv' });
    
    // Exports
    const expHeaders = ['Export Type', 'Invoice Number', 'Invoice date', 'Invoice Value', 'Port Code', 'Shipping Bill Number', 'Shipping Bill Date', 'Rate', 'Taxable Value'];
    archive.append(toCSV(data.exports, expHeaders), { name: 'docs.csv' }); 

    // CDN
    const cdnHeaders = ['GSTIN/UIN of Recipient', 'Receiver Name', 'Note Number', 'Note Date', 'Note Type', 'Place Of Supply', 'Note Supply Type', 'Invoice Value', 'Original Invoice Number', 'Original Invoice Date', 'Rate', 'Taxable Value', 'Cess Amount'];
    archive.append(toCSV(data.cdn, cdnHeaders), { name: 'cdn.csv' });

    // Nil
    const nilHeaders = ['Description', 'Nil Rated Supplies', 'Exempted (Other than Nil rated/non-GST supply)', 'Non-GST supplies'];
    archive.append(toCSV(data.nil, nilHeaders), { name: 'nil.csv' });

    archive.finalize();
  });
}


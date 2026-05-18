import { GSTR9Data } from '../gst/gstr9';
import archiver from 'archiver';

function toCSV(rows: any[], headers: string[]): string {
  const csvRows = [headers.join(',')];
  rows.forEach(row => {
    const values = headers.map(header => {
      const val = row[header] || '';
      const escaped = ('' + val).replace(/"/g, '""');
      return `"${escaped}"`;
    });
    csvRows.push(values.join(','));
  });
  return csvRows.join('\n');
}

export async function generateGSTR9CSVZip(data: GSTR9Data): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    
    archive.on('data', chunk => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', err => reject(err));

    // Table 4 CSV
    const t4Headers = ['Table ID', 'Description', 'Taxable Value', 'Central Tax', 'State Tax', 'Integrated Tax', 'Cess'];
    const t4Rows = [
      { 'Table ID': '4A', Description: 'B2C Supplies', ...data.table_4.A },
      { 'Table ID': '4B', Description: 'B2B Supplies', ...data.table_4.B },
      { 'Table ID': '4C', Description: 'Exports (WPAY)', ...data.table_4.C },
      { 'Table ID': '4D', Description: 'SEZ Supplies (WPAY)', ...data.table_4.D },
      { 'Table ID': '4E', Description: 'Deemed Exports', ...data.table_4.E },
      { 'Table ID': '4F', Description: 'Advances', ...data.table_4.F },
      { 'Table ID': '4G', Description: 'Inward RCM', ...data.table_4.G },
      { 'Table ID': '4H', Description: 'Sub-total (A to G)', ...data.table_4.H },
      { 'Table ID': '4I', Description: 'Credit Notes (-)', ...data.table_4.I },
      { 'Table ID': '4J', Description: 'Debit Notes (+)', ...data.table_4.J },
      { 'Table ID': '4K', Description: 'Amendments (+)', ...data.table_4.K },
      { 'Table ID': '4L', Description: 'Amendments (-)', ...data.table_4.L },
      { 'Table ID': '4M', Description: 'Sub-total (I to L)', ...data.table_4.M },
      { 'Table ID': '4N', Description: 'Total (H + M)', ...data.table_4.N },
    ].map(r => ({
      'Table ID': r['Table ID'],
      Description: r.Description,
      'Taxable Value': r.taxable_value,
      'Central Tax': r.cgst,
      'State Tax': r.sgst,
      'Integrated Tax': r.igst,
      Cess: r.cess
    }));
    archive.append(toCSV(t4Rows, t4Headers), { name: 'table_4_outward.csv' });

    // Table 6 CSV (Simplified for now, should follow Excel structure)
    const t6Headers = ['Table ID', 'Description', 'Type', 'Taxable Value', 'Central Tax', 'State Tax', 'Integrated Tax', 'Cess'];
    const t6Rows: any[] = [];
    t6Rows.push({ 'Table ID': '6A', Description: 'GSTR-3B Total', Type: 'Total', ...data.table_6.A });
    ['inputs', 'capital_goods', 'input_services'].forEach(type => {
      t6Rows.push({ 'Table ID': '6B', Description: 'Inward supplies', Type: type, ...data.table_6.B[type as keyof typeof data.table_6.B] });
    });
    // ... add more rows for 6C, 6D, etc.
    const t6MappedRows = t6Rows.map(r => ({
      'Table ID': r['Table ID'],
      Description: r.Description,
      Type: r.Type,
      'Taxable Value': r.taxable_value || 0,
      'Central Tax': r.cgst || 0,
      'State Tax': r.sgst || 0,
      'Integrated Tax': r.igst || 0,
      Cess: r.cess || 0
    }));
    archive.append(toCSV(t6MappedRows, t6Headers), { name: 'table_6_itc.csv' });

    // HSN Summary CSVs
    const hsnHeaders = ['HSN/SAC', 'Description', 'UQC', 'Total Quantity', 'Total Value', 'Taxable Value', 'Integrated Tax', 'Central Tax', 'State Tax', 'Cess'];
    const hsnOutMapped = data.hsn_outward.map(h => ({
      'HSN/SAC': h.hsn_sac,
      Description: h.description,
      UQC: h.uqc,
      'Total Quantity': h.total_quantity,
      'Total Value': h.total_value,
      'Taxable Value': h.taxable_value,
      'Integrated Tax': h.igst,
      'Central Tax': h.cgst,
      'State Tax': h.sgst,
      Cess: h.cess
    }));
    archive.append(toCSV(hsnOutMapped, hsnHeaders), { name: 'table_17_hsn_outward.csv' });

    archive.finalize();
  });
}


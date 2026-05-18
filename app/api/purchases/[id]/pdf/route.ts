import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import puppeteer from 'puppeteer';
import { getPuppeteerLaunchOptions } from '@/lib/puppeteer-launch';
import { getSessionScopedBusinessId, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    const businessScope = getSessionScopedBusinessId(req);
    if (!businessScope) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    const pool = getPool();

    // Tenant-scoped load (authorize after row for branch/policy)
    const purchaseProbe = await pool.query(
      `SELECT id, business_id, branch_id FROM purchases WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [id, businessScope]
    );
    if (purchaseProbe.rows.length === 0) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
    }
    try {
      await authorize(userId, 'purchases', 'read', {
        branchId: purchaseProbe.rows[0].branch_id,
        businessId: purchaseProbe.rows[0].business_id,
        resourceId: id,
      });
    } catch (err) {
      if (err instanceof AuthorizationError) return err.toNextResponse();
      throw err;
    }

    // Fetch purchase data (full projection)
    const purchaseResult = await pool.query(
      `SELECT 
        p.*,
        s.name as supplier_name,
        s.phone as supplier_phone,
        s.email as supplier_email,
        s.gstin as supplier_gstin,
        s.billing_address as supplier_address,
        b.name as business_name,
        b.address_line1 as business_address,
        b.city as business_city,
        b.state as business_state,
        b.pincode as business_pincode,
        b.gstin as business_gstin,
        b.logo_url as business_logo,
        b.phone as business_phone,
        b.email as business_email
       FROM purchases p
       LEFT JOIN suppliers s ON p.supplier_id = s.id
       JOIN businesses b ON p.business_id = b.id
       WHERE p.id = $1 AND p.business_id = $2 AND p.deleted_at IS NULL`,
      [id, businessScope]
    );

    if (purchaseResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Purchase not found' },
        { status: 404 }
      );
    }

    const purchase = purchaseResult.rows[0];

    // Fetch purchase items
    const itemsResult = await pool.query(
      `SELECT
        pi.*,
        i.name AS catalog_item_name,
        i.code AS catalog_item_code
       FROM purchase_items pi
       LEFT JOIN items i ON pi.item_id = i.id
       WHERE pi.purchase_id = $1
       ORDER BY pi.id`,
      [id]
    );

    purchase.items = itemsResult.rows;

    // Generate HTML
    let html = generatePurchaseHtml(purchase);
    const { maybeAppendKhatarioPrintFooter } = await import('@/lib/print-branding');
    html = await maybeAppendKhatarioPrintFooter(html, purchase.business_id);

    // Generate PDF
    const browser = await puppeteer.launch(
      getPuppeteerLaunchOptions({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      })
    );
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '10mm',
        bottom: '10mm',
        left: '10mm',
        right: '10mm'
      }
    });

    await browser.close();

    return new NextResponse(pdfBuffer as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="purchase-${id}.pdf"`,
      }
    });

  } catch (error: any) {
    console.error('Error generating purchase PDF:', error);
    const status = error.message === 'Purchase not found' ? 404 : 500;
    return NextResponse.json(
      { error: error.message || 'Failed to generate PDF' },
      { status }
    );
  }
}

function generatePurchaseHtml(purchase: any): string {
  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2
    }).format(amount);
  };

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body {
          font-family: Arial, sans-serif;
          font-size: 12px;
          color: #333;
          margin: 0;
          padding: 20px;
        }
        .header {
          display: flex;
          justify-content: space-between;
          margin-bottom: 30px;
          border-bottom: 2px solid #333;
          padding-bottom: 20px;
        }
        .business-info, .supplier-info {
          flex: 1;
        }
        .business-info {
          margin-right: 20px;
        }
        .logo {
          max-width: 150px;
          max-height: 80px;
        }
        h1 {
          font-size: 24px;
          margin: 0 0 10px 0;
          color: #333;
        }
        h2 {
          font-size: 20px;
          margin: 0 0 20px 0;
          color: #333;
        }
        .info-row {
          margin-bottom: 5px;
        }
        .label {
          font-weight: bold;
          display: inline-block;
          width: 120px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin: 20px 0;
        }
        th, td {
          border: 1px solid #ddd;
          padding: 8px;
          text-align: left;
        }
        th {
          background-color: #f5f5f5;
          font-weight: bold;
        }
        .text-right {
          text-align: right;
        }
        .totals {
          margin-top: 20px;
          margin-left: auto;
          width: 300px;
        }
        .totals-row {
          display: flex;
          justify-content: space-between;
          padding: 5px 0;
        }
        .totals-row.total {
          font-weight: bold;
          font-size: 14px;
          border-top: 2px solid #333;
          padding-top: 10px;
          margin-top: 10px;
        }
        .footer {
          margin-top: 40px;
          padding-top: 20px;
          border-top: 1px solid #ddd;
          text-align: center;
          color: #666;
          font-size: 10px;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="business-info">
          ${purchase.business_logo ? `<img src="${purchase.business_logo}" alt="Logo" class="logo" />` : ''}
          <h1>${purchase.business_name || 'Business'}</h1>
          <div class="info-row">${purchase.business_address || ''}</div>
          <div class="info-row">${purchase.business_city || ''}, ${purchase.business_state || ''} - ${purchase.business_pincode || ''}</div>
          ${purchase.business_gstin ? `<div class="info-row">GSTIN: ${purchase.business_gstin}</div>` : ''}
          ${purchase.business_phone ? `<div class="info-row">Phone: ${purchase.business_phone}</div>` : ''}
          ${purchase.business_email ? `<div class="info-row">Email: ${purchase.business_email}</div>` : ''}
        </div>
        <div class="supplier-info">
          <h2>Purchase Bill</h2>
          <div class="info-row"><span class="label">Bill Number:</span> ${purchase.bill_number || 'N/A'}</div>
          <div class="info-row"><span class="label">Bill Date:</span> ${formatDate(purchase.bill_date)}</div>
          <div class="info-row"><span class="label">Status:</span> ${purchase.status || 'draft'}</div>
        </div>
      </div>

      <div class="supplier-info">
        <h3>Supplier Details</h3>
        <div class="info-row"><strong>${purchase.supplier_name || 'N/A'}</strong></div>
        ${purchase.supplier_address ? `<div class="info-row">${purchase.supplier_address}</div>` : ''}
        ${purchase.supplier_gstin ? `<div class="info-row">GSTIN: ${purchase.supplier_gstin}</div>` : ''}
        ${purchase.supplier_phone ? `<div class="info-row">Phone: ${purchase.supplier_phone}</div>` : ''}
        ${purchase.supplier_email ? `<div class="info-row">Email: ${purchase.supplier_email}</div>` : ''}
      </div>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Item</th>
            <th>HSN/SAC</th>
            <th class="text-right">Quantity</th>
            <th class="text-right">Rate</th>
            <th class="text-right">Tax %</th>
            <th class="text-right">Tax Amount</th>
            <th class="text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${purchase.items.map((item: any, index: number) => `
            <tr>
              <td>${index + 1}</td>
              <td>${item.item_name || 'N/A'}</td>
              <td>${item.hsn_sac || 'N/A'}</td>
              <td class="text-right">${item.quantity || 0}</td>
              <td class="text-right">${formatCurrency(Number(item.unit_price ?? item.rate ?? 0))}</td>
              <td class="text-right">${item.tax_rate || 0}%</td>
              <td class="text-right">${formatCurrency(item.tax_amount || 0)}</td>
              <td class="text-right">${formatCurrency(Number(item.line_total ?? item.total ?? 0))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="totals">
        <div class="totals-row">
          <span>Subtotal:</span>
          <span>${formatCurrency(purchase.subtotal || 0)}</span>
        </div>
        <div class="totals-row">
          <span>Tax Amount:</span>
          <span>${formatCurrency(purchase.tax_amount || 0)}</span>
        </div>
        ${purchase.discount_amount ? `
        <div class="totals-row">
          <span>Discount:</span>
          <span>${formatCurrency(purchase.discount_amount)}</span>
        </div>
        ` : ''}
        <div class="totals-row total">
          <span>Grand Total:</span>
          <span>${formatCurrency(purchase.grand_total || 0)}</span>
        </div>
      </div>

      ${purchase.notes ? `
      <div style="margin-top: 30px;">
        <strong>Notes:</strong>
        <p>${purchase.notes}</p>
      </div>
      ` : ''}

      <div class="footer">
        <p>This is a computer-generated document.</p>
      </div>
    </body>
    </html>
  `;
}


/**
 * API endpoint for exporting conversation list
 * POST /api/whatsapp/conversations/export
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { hasWhatsAppBotAddon } from '@/lib/subscription';
import ExcelJS from 'exceljs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id, format = 'csv', filters = {} } = body;

    if (!business_id) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    // Check if business has WhatsApp Bot addon
    const hasAddon = await hasWhatsAppBotAddon(business_id);
    if (!hasAddon) {
      return NextResponse.json(
        { error: 'WhatsApp Bot addon is required. Please upgrade to unlock this feature.' },
        { status: 403 }
      );
    }

    // Build WHERE clause based on filters
    const whereConditions: string[] = ['c.business_id = $1', "c.status = 'active'"];
    const params: any[] = [business_id];
    let paramIndex = 2;

    if (filters.status) {
      whereConditions.push(`c.status = $${paramIndex++}`);
      params.push(filters.status);
    }
    if (filters.label_id) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM whatsapp_conversation_label_assignments a
        WHERE a.conversation_id = c.id AND a.label_id = $${paramIndex++}
      )`);
      params.push(filters.label_id);
    }
    if (filters.assigned_to) {
      whereConditions.push(`c.assigned_to = $${paramIndex++}`);
      params.push(filters.assigned_to);
    }
    if (filters.lead_status) {
      whereConditions.push(`c.lead_status = $${paramIndex++}`);
      params.push(filters.lead_status);
    }
    if (filters.conversation_status) {
      whereConditions.push(`c.conversation_status = $${paramIndex++}`);
      params.push(filters.conversation_status);
    }

    // Fetch conversations with labels
    const conversations = await queryRows(`
      SELECT 
        c.from_number as phone,
        COALESCE(cust.name, cust_by_phone.name, c.whatsapp_display_name, c.from_number) as name,
        c.conversation_status as status,
        u.name as assigned_agent,
        STRING_AGG(DISTINCT l.name, ', ') as labels,
        c.last_message_text as last_message,
        c.last_message_at as last_activity,
        c.unread_count
      FROM whatsapp_conversations c
      LEFT JOIN customers cust ON c.customer_id = cust.id
      LEFT JOIN customers cust_by_phone ON cust_by_phone.business_id = $1 
        AND cust_by_phone.phone = c.from_number AND c.customer_id IS NULL
      LEFT JOIN users u ON c.assigned_to = u.id
      LEFT JOIN whatsapp_conversation_label_assignments la ON la.conversation_id = c.id
      LEFT JOIN whatsapp_conversation_labels l ON la.label_id = l.id
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY c.id, c.from_number, cust.name, cust_by_phone.name, c.whatsapp_display_name, 
               c.conversation_status, u.name, c.last_message_text, c.last_message_at, c.unread_count
      ORDER BY c.last_message_at DESC NULLS LAST
    `, params);

    if (format === 'excel') {
      // Generate Excel file
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Conversations');

      // Add headers
      worksheet.columns = [
        { header: 'Phone', key: 'phone', width: 15 },
        { header: 'Name', key: 'name', width: 25 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Assigned Agent', key: 'assigned_agent', width: 20 },
        { header: 'Labels', key: 'labels', width: 30 },
        { header: 'Last Message', key: 'last_message', width: 40 },
        { header: 'Last Activity', key: 'last_activity', width: 20 },
        { header: 'Unread Count', key: 'unread_count', width: 12 }
      ];

      // Style header row
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };

      // Add data rows
      conversations.forEach((conv: any) => {
        worksheet.addRow({
          phone: conv.phone || '',
          name: conv.name || '',
          status: conv.status || '',
          assigned_agent: conv.assigned_agent || '',
          labels: conv.labels || '',
          last_message: conv.last_message || '',
          last_activity: conv.last_activity ? new Date(conv.last_activity).toLocaleString() : '',
          unread_count: conv.unread_count || 0
        });
      });

      // Generate buffer
      const buffer = await workbook.xlsx.writeBuffer();

      return new NextResponse(buffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="whatsapp-conversations-${Date.now()}.xlsx"`
        }
      });
    } else {
      // Generate CSV
      const headers = ['Phone', 'Name', 'Status', 'Assigned Agent', 'Labels', 'Last Message', 'Last Activity', 'Unread Count'];
      const csvRows = [headers.join(',')];

      conversations.forEach((conv: any) => {
        const escapeCSV = (value: any): string => {
          if (value === null || value === undefined) return '';
          const str = String(value);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        };

        csvRows.push([
          escapeCSV(conv.phone),
          escapeCSV(conv.name),
          escapeCSV(conv.status),
          escapeCSV(conv.assigned_agent),
          escapeCSV(conv.labels),
          escapeCSV(conv.last_message),
          escapeCSV(conv.last_activity ? new Date(conv.last_activity).toLocaleString() : ''),
          escapeCSV(conv.unread_count)
        ].join(','));
      });

      return new NextResponse(csvRows.join('\n'), {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="whatsapp-conversations-${Date.now()}.csv"`
        }
      });
    }
  } catch (error: any) {
    console.error('Error exporting conversations:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}


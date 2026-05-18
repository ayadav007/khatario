/**
 * API endpoint for exporting single conversation chat history
 * POST /api/whatsapp/conversations/[id]/export
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import { hasWhatsAppBotAddon } from '@/lib/subscription';
import { resolveWhatsAppConversationDbId } from '@/lib/whatsapp-conversation-resolve';
import ExcelJS from 'exceljs';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { business_id, format = 'csv' } = body;

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

    const conversationId = await resolveWhatsAppConversationDbId(business_id, params.id);
    if (!conversationId) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Fetch conversation info
    const convInfo = await queryOne<{
      from_number: string;
      customer_name: string | null;
      whatsapp_display_name: string | null;
    }>(`
      SELECT 
        from_number,
        COALESCE(cust.name, cust_by_phone.name, whatsapp_display_name, from_number) as customer_name,
        whatsapp_display_name
      FROM whatsapp_conversations c
      LEFT JOIN customers cust ON c.customer_id = cust.id
      LEFT JOIN customers cust_by_phone ON cust_by_phone.business_id = $1 
        AND cust_by_phone.phone = c.from_number AND c.customer_id IS NULL
      WHERE c.id = $2
    `, [business_id, conversationId]);

    // Fetch messages
    const messages = await queryRows(`
      SELECT 
        m.created_at as timestamp,
        CASE 
          WHEN m.direction = 'incoming' THEN 'Customer'
          WHEN m.message_text LIKE '%button%' OR EXISTS (
            SELECT 1 FROM whatsapp_automation_events e 
            WHERE e.conversation_id = m.conversation_id 
              AND e.event_type = 'bot_message'
              AND ABS(EXTRACT(EPOCH FROM (e.created_at - m.created_at))) < 5
          ) THEN 'Bot'
          ELSE 'Agent'
        END as sender,
        m.message_text as message,
        m.message_type,
        m.status,
        m.media_url
      FROM whatsapp_conversation_messages m
      WHERE m.conversation_id = $1
      ORDER BY m.created_at ASC, m.message_id ASC
    `, [conversationId]);

    if (format === 'excel') {
      // Generate Excel file
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Chat History');

      // Add conversation info
      worksheet.addRow(['Conversation with:', convInfo?.customer_name || convInfo?.from_number || 'Unknown']);
      worksheet.addRow(['Phone:', convInfo?.from_number || '']);
      worksheet.addRow([]);

      // Add headers
      worksheet.addRow(['Timestamp', 'Sender', 'Message', 'Type', 'Status', 'Media']);
      const headerRow = worksheet.getRow(worksheet.rowCount);
      headerRow.font = { bold: true };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };

      // Add data rows
      messages.forEach((msg: any) => {
        worksheet.addRow({
          timestamp: msg.timestamp ? new Date(msg.timestamp).toLocaleString() : '',
          sender: msg.sender || '',
          message: msg.message || '[Media]',
          type: msg.message_type || 'text',
          status: msg.status || '',
          media: msg.media_url || ''
        });
      });

      // Auto-size columns
      worksheet.columns.forEach((column) => {
        if (column.key === 'timestamp') column.width = 20;
        else if (column.key === 'sender') column.width = 12;
        else if (column.key === 'message') column.width = 50;
        else if (column.key === 'type') column.width = 12;
        else if (column.key === 'status') column.width = 12;
        else if (column.key === 'media') column.width = 40;
      });

      // Generate buffer
      const buffer = await workbook.xlsx.writeBuffer();

      return new NextResponse(buffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="conversation-${conversationId}-${Date.now()}.xlsx"`
        }
      });
    } else {
      // Generate CSV
      const csvRows: string[] = [];
      csvRows.push(`Conversation with: ${convInfo?.customer_name || convInfo?.from_number || 'Unknown'}`);
      csvRows.push(`Phone: ${convInfo?.from_number || ''}`);
      csvRows.push('');
      csvRows.push('Timestamp,Sender,Message,Type,Status,Media');

      messages.forEach((msg: any) => {
        const escapeCSV = (value: any): string => {
          if (value === null || value === undefined) return '';
          const str = String(value);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        };

        csvRows.push([
          escapeCSV(msg.timestamp ? new Date(msg.timestamp).toLocaleString() : ''),
          escapeCSV(msg.sender),
          escapeCSV(msg.message || '[Media]'),
          escapeCSV(msg.message_type || 'text'),
          escapeCSV(msg.status || ''),
          escapeCSV(msg.media_url || '')
        ].join(','));
      });

      return new NextResponse(csvRows.join('\n'), {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="conversation-${conversationId}-${Date.now()}.csv"`
        }
      });
    }
  } catch (error: any) {
    console.error('Error exporting conversation:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}


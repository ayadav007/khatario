import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { hasWhatsAppBotAddon } from '@/lib/subscription';
import { normalizePhone, isValidPhone } from '@/lib/utils/phone';

/**
 * POST /api/whatsapp/contacts/import
 * Import contacts from CSV or Group Extractor
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id, contacts, source, imported_from_group, create_group, group_name, group_color } = body;

    if (!business_id || !contacts || !Array.isArray(contacts)) {
      return NextResponse.json(
        { error: 'Business ID and contacts array are required' },
        { status: 400 }
      );
    }

    // Check WhatsApp addon
    const hasAddon = await hasWhatsAppBotAddon(business_id);
    if (!hasAddon) {
      return NextResponse.json(
        { error: 'WhatsApp Bot addon is required' },
        { status: 403 }
      );
    }

    const pool = getPool();
    const results = {
      imported: 0,
      skipped: 0,
      errors: 0,
      errorDetails: [] as any[],
      contactIds: [] as string[],
    };

    // Process each contact
    for (const contact of contacts) {
      try {
        const { phone, name, email, tags, notes, custom_fields } = contact;

        if (!phone) {
          results.errors++;
          results.errorDetails.push({
            contact,
            error: 'Phone number is required',
          });
          continue;
        }

        // Normalize and validate phone
        const normalizedPhone = normalizePhone(phone);
        if (!isValidPhone(normalizedPhone)) {
          results.errors++;
          results.errorDetails.push({
            contact,
            error: 'Invalid phone number',
          });
          continue;
        }

        // Check if contact already exists
        const existingResult = await pool.query(
          'SELECT id FROM whatsapp_contacts WHERE business_id = $1 AND phone = $2',
          [business_id, normalizedPhone]
        );

        if (existingResult.rows.length > 0) {
          results.skipped++;
          results.contactIds.push(existingResult.rows[0].id);
          continue;
        }

        // Insert contact
        const result = await pool.query(
          `INSERT INTO whatsapp_contacts 
            (business_id, phone, name, email, tags, notes, custom_fields, source, imported_from_group)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id`,
          [
            business_id,
            normalizedPhone,
            name || null,
            email || null,
            JSON.stringify(tags || []),
            notes || null,
            JSON.stringify(custom_fields || {}),
            source || 'csv',
            imported_from_group || null,
          ]
        );

        results.imported++;
        results.contactIds.push(result.rows[0].id);
      } catch (error: any) {
        console.error('[Contacts Import] Error importing contact:', error);
        results.errors++;
        results.errorDetails.push({
          contact,
          error: error.message || 'Unknown error',
        });
      }
    }

    // If requested, create a contact group and add all contacts to it
    let groupId: string | null = null;
    if (create_group && group_name && results.contactIds.length > 0) {
      try {
        // Create group
        const groupResult = await pool.query(
          `INSERT INTO whatsapp_contact_groups (business_id, name, description, color)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (business_id, name) DO UPDATE 
          SET name = EXCLUDED.name
          RETURNING id`,
          [
            business_id,
            group_name,
            `Imported from ${source || 'CSV'} on ${new Date().toLocaleDateString()}`,
            group_color || '#25D366',
          ]
        );

        groupId = groupResult.rows[0].id;

        // Add contacts to group
        const memberValues = results.contactIds.map((contactId) => ({
          group_id: groupId,
          contact_id: contactId,
        }));

        for (const member of memberValues) {
          await pool.query(
            `INSERT INTO whatsapp_contact_group_members (group_id, contact_id)
            VALUES ($1, $2)
            ON CONFLICT (group_id, contact_id) DO NOTHING`,
            [member.group_id, member.contact_id]
          );
        }
      } catch (error: any) {
        console.error('[Contacts Import] Error creating group:', error);
        // Continue even if group creation fails
      }
    }

    return NextResponse.json({
      success: true,
      message: `Import completed: ${results.imported} imported, ${results.skipped} skipped, ${results.errors} errors`,
      results: {
        imported: results.imported,
        skipped: results.skipped,
        errors: results.errors,
        total: contacts.length,
        errorDetails: results.errorDetails,
        groupId,
      },
    });
  } catch (error: any) {
    console.error('[Contacts Import] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to import contacts' },
      { status: 500 }
    );
  }
}

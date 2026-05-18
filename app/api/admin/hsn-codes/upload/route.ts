import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { parse } from 'csv-parse/sync';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

export async function POST(request: NextRequest) {
  try {
    const auth = await requirePlatformRequest(request, 'admin');
    if (!auth.ok) return auth.response;

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const mode = formData.get('mode') as string;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type
    if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
      return NextResponse.json(
        { error: 'Invalid file type. Please upload a CSV file.' },
        { status: 400 }
      );
    }

    // Read file content
    const fileContent = await file.text();

    // Parse CSV
    let records: any[];
    try {
      records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_quotes: true,
        relax_column_count: true,
      });
    } catch (parseError: any) {
      return NextResponse.json(
        { error: `Failed to parse CSV: ${parseError.message}` },
        { status: 400 }
      );
    }

    if (records.length === 0) {
      return NextResponse.json(
        { error: 'CSV file is empty or has no valid rows' },
        { status: 400 }
      );
    }

    // Validate required columns
    const requiredColumns = ['code', 'description'];
    const firstRecord = records[0];
    const missingColumns = requiredColumns.filter(col => !(col in firstRecord));

    if (missingColumns.length > 0) {
      return NextResponse.json(
        {
          error: `Missing required columns: ${missingColumns.join(', ')}`,
        },
        { status: 400 }
      );
    }

    // Prepare data for import
    const codesToImport = [];
    const errors: string[] = [];

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNum = i + 2; // +2 because header is row 1, data starts at row 2

      try {
        // Validate code
        if (!row.code || !row.code.trim()) {
          errors.push(`Row ${rowNum}: Missing code`);
          continue;
        }

        // Validate description
        if (!row.description || !row.description.trim()) {
          errors.push(`Row ${rowNum}: Missing description`);
          continue;
        }

        // Parse values
        const code = row.code.trim();
        const description = row.description.trim();
        const gstRate = row.gst_rate ? parseFloat(row.gst_rate) : null;
        const category = row.category ? row.category.trim() : null;
        const isService =
          row.is_service === 'true' ||
          row.is_service === '1' ||
          row.is_service === true;

        // Parse keywords
        let keywords: string[] = [];
        if (row.keywords) {
          if (typeof row.keywords === 'string') {
            keywords = row.keywords
              .split(',')
              .map((k: string) => k.trim().toLowerCase())
              .filter((k: string) => k.length > 0);
          } else if (Array.isArray(row.keywords)) {
            keywords = row.keywords.map((k: string) => k.trim().toLowerCase());
          }
        }

        codesToImport.push({
          code,
          description,
          gst_rate: gstRate,
          category,
          is_service: isService,
          keywords,
        });
      } catch (error: any) {
        errors.push(`Row ${rowNum}: ${error.message}`);
      }
    }

    if (codesToImport.length === 0) {
      return NextResponse.json(
        {
          error: 'No valid codes to import',
          stats: {
            total: records.length,
            imported: 0,
            updated: 0,
            errors: errors.length,
          },
        },
        { status: 400 }
      );
    }

    // Import to database
    const pool = getPool();
    const client = await pool.connect();
    let importedCount = 0;
    let updatedCount = 0;

    try {
      await client.query('BEGIN');

      // Replace mode: Delete all existing codes
      if (mode === 'replace') {
        await client.query('DELETE FROM hsn_sac_master');
      }

      for (const codeData of codesToImport) {
        // Check if code exists
        const existingResult = await client.query(
          'SELECT code FROM hsn_sac_master WHERE code = $1',
          [codeData.code]
        );
        const existing = existingResult.rows[0];

        if (existing) {
          // Update existing
          await client.query(
            `UPDATE hsn_sac_master
             SET description = $1,
                 gst_rate = COALESCE($2, gst_rate),
                 category = COALESCE($3, category),
                 is_service = $4,
                 keywords = $5,
                 updated_at = CURRENT_TIMESTAMP
             WHERE code = $6`,
            [
              codeData.description,
              codeData.gst_rate,
              codeData.category,
              codeData.is_service,
              codeData.keywords,
              codeData.code,
            ]
          );
          updatedCount++;
        } else {
          // Insert new
          await client.query(
            `INSERT INTO hsn_sac_master (code, description, gst_rate, category, is_service, keywords)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              codeData.code,
              codeData.description,
              codeData.gst_rate,
              codeData.category,
              codeData.is_service,
              codeData.keywords,
            ]
          );
          importedCount++;
        }
      }

      await client.query('COMMIT');
    } catch (dbError: any) {
      await client.query('ROLLBACK');
      throw dbError;
    } finally {
      client.release();
    }

    const totalProcessed = codesToImport.length;
    const totalErrors = errors.length;

    return NextResponse.json({
      success: true,
      message:
        mode === 'replace'
          ? `Successfully replaced all codes. Imported ${importedCount} new codes.`
          : `Successfully imported ${importedCount} new codes and updated ${updatedCount} existing codes.`,
      stats: {
        total: records.length,
        imported: importedCount,
        updated: updatedCount,
        errors: totalErrors,
      },
      errors: totalErrors > 0 ? errors.slice(0, 10) : undefined, // Show first 10 errors
    });
  } catch (error: any) {
    console.error('HSN/SAC import error:', error);
    return NextResponse.json(
      {
        error: error.message || 'Failed to import HSN/SAC codes',
        details: error.stack,
      },
      { status: 500 }
    );
  }
}


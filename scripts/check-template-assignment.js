const { query } = require('./lib/db'); // Adjust path as needed

async function checkTemplateAssignment() {
  try {
    // Get business_id from command line or use default
    const businessId = process.argv[2] || '1';
    const documentType = process.argv[3] || 'tax_invoice';
    
    console.log(`\n🔍 Checking template assignment for:`);
    console.log(`   Business ID: ${businessId}`);
    console.log(`   Document Type: ${documentType}\n`);
    
    const result = await query(
      `SELECT template_id, settings, created_at, updated_at 
       FROM business_template_assignments 
       WHERE business_id = $1 AND document_type = $2`,
      [businessId, documentType]
    );
    
    if (result.rows.length === 0) {
      console.log('❌ No template assignment found!');
      console.log('\n💡 To activate a template, go to:');
      console.log('   /settings/templates');
      console.log('   Select "Tax Invoice" → Click "Activate" on a template\n');
      
      // Check if there are any assignments at all
      const allAssignments = await query(
        `SELECT document_type, template_id 
         FROM business_template_assignments 
         WHERE business_id = $1`,
        [businessId]
      );
      
      if (allAssignments.rows.length > 0) {
        console.log('📋 Found assignments for other document types:');
        allAssignments.rows.forEach(row => {
          console.log(`   - ${row.document_type}: ${row.template_id}`);
        });
      }
    } else {
      const assignment = result.rows[0];
      console.log('✅ Template assignment found:');
      console.log(`   Template ID: ${assignment.template_id}`);
      console.log(`   Created: ${assignment.created_at}`);
      console.log(`   Updated: ${assignment.updated_at}`);
      
      if (assignment.settings) {
        const settings = typeof assignment.settings === 'string' 
          ? JSON.parse(assignment.settings) 
          : assignment.settings;
        console.log(`   Settings: ${Object.keys(settings).length} customizations`);
      }
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  process.exit(0);
}

checkTemplateAssignment();


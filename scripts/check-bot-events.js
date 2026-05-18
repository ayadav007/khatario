/**
 * Diagnostic script to check if bot_message automation events exist in the database
 * Run: node scripts/check-bot-events.js <business_id>
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkBotEvents(businessId) {
  try {
    console.log('🔍 Checking bot_message events for business:', businessId);
    
    // Check total bot_message events
    const totalEvents = await pool.query(
      `SELECT COUNT(*)::int as total
       FROM whatsapp_automation_events
       WHERE business_id = $1 AND event_type = 'bot_message'`,
      [businessId]
    );
    
    console.log('\n📊 Total bot_message events:', totalEvents.rows[0]?.total || 0);
    
    // Check distinct conversations with bot_message events
    const botConversations = await pool.query(
      `SELECT DISTINCT conversation_id, COUNT(*)::int as event_count
       FROM whatsapp_automation_events
       WHERE business_id = $1 AND event_type = 'bot_message'
       GROUP BY conversation_id
       ORDER BY event_count DESC
       LIMIT 10`,
      [businessId]
    );
    
    console.log('\n🤖 Conversations with bot_message events:', botConversations.rows.length);
    botConversations.rows.forEach((row, idx) => {
      console.log(`  ${idx + 1}. Conversation: ${row.conversation_id.substring(0, 8)}... (${row.event_count} events)`);
    });
    
    // Check recent bot_message events
    const recentEvents = await pool.query(
      `SELECT 
         id,
         conversation_id,
         event_type,
         event_data->>'source' as source,
         event_data->>'message_type' as message_type,
         created_at
       FROM whatsapp_automation_events
       WHERE business_id = $1 AND event_type = 'bot_message'
       ORDER BY created_at DESC
       LIMIT 10`,
      [businessId]
    );
    
    console.log('\n📝 Recent bot_message events:');
    recentEvents.rows.forEach((row, idx) => {
      console.log(`  ${idx + 1}. ${new Date(row.created_at).toLocaleString()} - Source: ${row.source || 'unknown'} - Type: ${row.message_type || 'text'} - Conversation: ${row.conversation_id.substring(0, 8)}...`);
    });
    
    // Check dashboard query result
    const dashboardResult = await pool.query(
      `WITH bot_conversations AS (
        SELECT DISTINCT conversation_id
        FROM whatsapp_automation_events
        WHERE business_id = $1
          AND event_type IN ('bot_message', 'button_clicked', 'flow_entered', 'cta_clicked')
      )
      SELECT COUNT(*)::int as bot_handled FROM bot_conversations`,
      [businessId]
    );
    
    console.log('\n📈 Dashboard Bot Handled count:', dashboardResult.rows[0]?.bot_handled || 0);
    
    // Verify conversation_ids match
    const conversationCheck = await pool.query(
      `SELECT 
         COUNT(*)::int as total_events,
         COUNT(DISTINCT e.conversation_id) as distinct_conversations,
         COUNT(DISTINCT c.id) as matching_conversations
       FROM whatsapp_automation_events e
       LEFT JOIN whatsapp_conversations c ON e.conversation_id = c.id AND e.business_id = c.business_id
       WHERE e.business_id = $1 AND e.event_type = 'bot_message'`,
      [businessId]
    );
    
    const check = conversationCheck.rows[0];
    console.log('\n🔗 Event-Conversation Matching:');
    console.log(`  Total events: ${check.total_events}`);
    console.log(`  Distinct conversation_ids in events: ${check.distinct_conversations}`);
    console.log(`  Matching conversations in whatsapp_conversations: ${check.matching_conversations}`);
    
    if (check.distinct_conversations > check.matching_conversations) {
      console.log('\n⚠️  WARNING: Some events have conversation_id that don\'t match whatsapp_conversations!');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

const businessId = process.argv[2];
if (!businessId) {
  console.error('Usage: node scripts/check-bot-events.js <business_id>');
  process.exit(1);
}

checkBotEvents(businessId);

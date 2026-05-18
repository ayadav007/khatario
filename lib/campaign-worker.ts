/**
 * Campaign Worker - Auto-processes campaigns when server is running
 * Starts an interval to process campaigns every 10 seconds
 */

import { processAllCampaigns } from './campaign-processor';

let workerInterval: NodeJS.Timeout | null = null;
let isRunning = false;

/**
 * Start the campaign worker (processes campaigns every 10 seconds)
 */
export function startCampaignWorker() {
  if (isRunning) {
    console.log('[Campaign Worker] Already running');
    return;
  }

  console.log('[Campaign Worker] Starting campaign worker...');
  isRunning = true;

  // Process campaigns immediately on start
  processAllCampaigns().catch(err => {
    console.error('[Campaign Worker] Error on initial process:', err);
  });

  // Then process every 30 seconds (increased from 10s for better performance)
  workerInterval = setInterval(async () => {
    try {
      const result = await processAllCampaigns();
      // If no campaigns to process, stop the worker
      if (result.campaignsProcessed === 0) {
        console.log('[Campaign Worker] No running campaigns, stopping worker');
        stopCampaignWorker();
      }
    } catch (error) {
      console.error('[Campaign Worker] Error processing campaigns:', error);
    }
  }, 30000); // 30 seconds (increased from 10s)

  console.log('[Campaign Worker] Started - processing campaigns every 30 seconds');
}

/**
 * Stop the campaign worker
 */
export function stopCampaignWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    isRunning = false;
    console.log('[Campaign Worker] Stopped');
  }
}

// Auto-start when this module is imported (only in server environment)
// BUT: Only start if there are actually running campaigns
if (typeof window === 'undefined') {
  // Check if there are running campaigns before starting
  (async () => {
    try {
      const { query } = await import('./db');
      const result: any = await query(`
        SELECT COUNT(*) as count 
        FROM whatsapp_campaigns 
        WHERE status = 'running'
      `);
      const count = result.rows[0]?.count || 0;
      if (count > 0) {
        console.log(`[Campaign Worker] Found ${count} running campaign(s), starting worker...`);
        startCampaignWorker();
      } else {
        console.log('[Campaign Worker] No running campaigns found, worker will not start automatically');
        // Check periodically (every 5 minutes) if campaigns start
        setInterval(async () => {
          try {
            const checkResult: any = await query(`
              SELECT COUNT(*) as count 
              FROM whatsapp_campaigns 
              WHERE status = 'running'
            `);
            const runningCount = checkResult.rows[0]?.count || 0;
            if (runningCount > 0 && !isRunning) {
              console.log(`[Campaign Worker] Detected ${runningCount} running campaign(s), starting worker...`);
              startCampaignWorker();
            }
          } catch (err) {
            console.error('[Campaign Worker] Error checking for campaigns:', err);
          }
        }, 300000); // Check every 5 minutes
      }
    } catch (err) {
      console.error('[Campaign Worker] Error checking for campaigns:', err);
    }
  })();
}


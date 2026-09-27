/**
 * Ask the assistant from the terminal (full pipeline, logged like a real web conversation).
 *
 *   npm run kb:ask -- "kitne ka hai?"
 *   npm run kb:ask -- --audience=tenant_user "How do I take a backup?"
 */
import { closePool } from '@/lib/db';
import { answerTurn } from '@/lib/rag/answer';
import type { Audience } from '@/lib/rag/types';

async function main() {
  const audienceArg = process.argv.find((a) => a.startsWith('--audience='));
  const audience = (audienceArg?.split('=')[1] ?? 'prospect') as Audience;
  const question = process.argv.slice(2).filter((a) => !a.startsWith('--') && !a.startsWith('dotenv_config')).join(' ');
  if (!question) {
    console.error('Usage: npm run kb:ask -- "your question"');
    process.exit(2);
  }
  for await (const ev of answerTurn({
    message: question,
    channel: audience === 'prospect' ? 'web' : 'trial_app',
    audience,
    visitorId: 'cli',
    userId: null,
  })) {
    if (ev.type === 'delta') process.stdout.write(ev.text);
    else if (ev.type === 'done') console.log(`\n\n[done] answered=${ev.answered} message=${ev.messageId}`);
    else if (ev.type !== 'meta') console.log(`\n[${ev.type}]`, JSON.stringify(ev));
  }
  await closePool();
}

main().catch(async (err) => {
  console.error('[kb:ask] failed:', err instanceof Error ? err.message : err);
  await closePool().catch(() => undefined);
  process.exit(1);
});

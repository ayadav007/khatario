import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Flows replace keyword bot rules. Legacy rules still run until imported. */
export default function BotRulesRedirectPage() {
  redirect('/whatsapp/flows?from=bot-rules');
}

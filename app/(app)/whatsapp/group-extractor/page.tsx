import { redirect } from 'next/navigation';

/** Group Extractor lives in Tools; this was a second copy of the same page. */
export default function GroupExtractorRedirectPage() {
  redirect('/tools/whatsapp-group-extractor');
}

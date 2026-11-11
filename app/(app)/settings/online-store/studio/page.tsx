import { redirect } from 'next/navigation';

/** M6: the old Studio is retired; the store's design is edited in the store design editor from the Store editor. */
export default function OldStudioPage() {
  redirect('/settings/online-store');
}

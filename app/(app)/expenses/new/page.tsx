import { redirect } from 'next/navigation';

/** Sidebar "New" lands here. Expenses are created from the list modal. */
export default function NewExpensePage() {
  redirect('/expenses?new=1');
}

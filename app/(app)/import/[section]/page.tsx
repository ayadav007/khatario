import { notFound } from 'next/navigation';
import { ImportWizard } from '@/components/import/ImportWizard';
import { isImportSection } from '@/components/import/wizard-state';

/** Spreadsheet import for customers, suppliers or items; any other section is a 404. */
export default function ImportPage({ params }: { params: { section: string } }) {
  if (!isImportSection(params.section)) notFound();
  return <ImportWizard section={params.section} />;
}

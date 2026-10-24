'use client';

import clsx from 'clsx';
import { StoreShell } from '@/components/store/StoreShell';
import { StoreContactForm, StoreQuickContact } from '@/components/store/StoreContactForm';
import { useStore } from '@/lib/store/store-context';
import { sanitizeContactForm, type StoreContactForm as ContactFormSettings } from '@/lib/store/store-theme';

const WIDTH_CLASS: Record<ContactFormSettings['width'], string> = {
  narrow: 'max-w-sm',
  medium: 'max-w-lg',
  wide: 'max-w-2xl',
};

const ALIGN_CLASS: Record<ContactFormSettings['align'], string> = {
  left: 'mr-auto',
  center: 'mx-auto',
  right: 'ml-auto',
};

export default function StoreContactPage() {
  const { store } = useStore();
  const form = sanitizeContactForm(store?.store_theme?.contact_form);
  const showForm = Boolean(store && form.enabled);
  const hasDetails = Boolean(
    store?.store_contact_md ||
      store?.phone ||
      store?.email ||
      (form.quick_links && store?.store_theme?.whatsapp_url),
  );
  // Side by side with an empty column looks broken, so fall back to stacked.
  const split = showForm && form.layout !== 'stacked' && hasDetails;
  const centered = showForm && !split && form.align === 'center';

  const details = (
    <div className={clsx(centered && 'text-center')}>
      <h1 className="mb-4 text-xl font-semibold">Contact</h1>
      <div className="whitespace-pre-wrap text-sm text-gray-700">
        {store?.store_contact_md || (
          <>
            {store?.phone ? <p>Phone: {store.phone}</p> : null}
            {store?.email ? <p>Email: {store.email}</p> : null}
          </>
        )}
      </div>
      {form.quick_links ? (
        <StoreQuickContact
          phone={store?.phone}
          email={store?.email}
          whatsappUrl={store?.store_theme?.whatsapp_url}
          className={clsx('mt-4', centered && 'justify-center')}
        />
      ) : null}
    </div>
  );

  const formNode =
    store && showForm ? (
      <StoreContactForm subdomain={store.store_subdomain} settings={form} isDemo={store.is_demo} />
    ) : null;

  return (
    <StoreShell>
      {split ? (
        <div className="grid items-start gap-8 md:grid-cols-2">
          {form.layout === 'text-form' ? (
            <>
              {details}
              {formNode}
            </>
          ) : (
            <>
              {formNode}
              {details}
            </>
          )}
        </div>
      ) : (
        <>
          {details}
          {formNode ? <div className={clsx('mt-6 w-full', WIDTH_CLASS[form.width], ALIGN_CLASS[form.align])}>{formNode}</div> : null}
        </>
      )}
    </StoreShell>
  );
}

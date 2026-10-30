/** schema.org data for the product page; `<` is escaped so the script tag cannot be closed early. */
export function ProductJsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}

import Link from 'next/link';

export default function PortalNotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4 text-center">
      <h1 className="text-xl font-semibold text-gray-900">Customer portal not found</h1>
      <p className="mt-2 max-w-md text-sm text-gray-600">
        This link may be wrong, or the business has not set up their customer portal yet. Ask
        your supplier for the correct portal link from their Khatario account.
      </p>
      <Link href="/" className="link-primary mt-6 text-sm font-medium">
        Go to Khatario home
      </Link>
    </div>
  );
}

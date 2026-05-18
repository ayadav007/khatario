import Link from 'next/link';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background px-4 py-12 dark:bg-background-dark">
      <div className="mx-auto max-w-2xl rounded-card border border-border bg-surface p-8 shadow-small dark:border-border-dark dark:bg-surface-dark">
        <h1 className="text-2xl font-bold text-text-primary dark:text-text-primary-dark">
          Terms of Service
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-text-secondary dark:text-secondary-dark">
          This policy is being prepared. For questions about your account or acceptable use,
          please contact support through the channels listed on our website.
        </p>
        <p className="mt-6">
          <Link
            href="/signup"
            className="text-sm font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
          >
            ← Back to sign up
          </Link>
        </p>
      </div>
    </div>
  );
}

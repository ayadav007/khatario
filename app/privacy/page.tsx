import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background px-4 py-12 dark:bg-background-dark">
      <div className="mx-auto max-w-2xl rounded-card border border-border bg-surface p-8 shadow-small dark:border-border-dark dark:bg-surface-dark">
        <h1 className="text-2xl font-bold text-text-primary dark:text-text-primary-dark">
          Privacy Policy
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-text-secondary dark:text-secondary-dark">
          This policy is being prepared. We take data protection seriously and will publish full
          details here. If you need information about how we handle your data in the meantime,
          please contact support.
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

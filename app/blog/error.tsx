'use client';

export default function BlogError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center">
      <h1 className="text-2xl font-bold text-slate-900">The blog could not be loaded</h1>
      <p className="mt-2 text-slate-600">Try again in a moment.</p>
      <button type="button" onClick={reset} className="mt-6 h-11 rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white">
        Retry
      </button>
    </div>
  );
}

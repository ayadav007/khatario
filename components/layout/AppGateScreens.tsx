'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { UpgradeDialog } from '@/components/subscription/upgrade/UpgradeDialog';

const WEB_REQUEST = { variant: 'web' as const };

/** The Free plan wall, rendered by the server layout instead of the page. */
export function WebAccessWall() {
  const { logout } = useAuth();
  return (
    <>
      <div className="min-h-[60vh]" aria-hidden />
      <UpgradeDialog request={WEB_REQUEST} onClose={() => undefined} onSignOut={logout} />
    </>
  );
}

/** Shown when the plan could not be checked: never the app, always a retry. */
export function PlanCheckFailedScreen({ onRetry }: { onRetry?: () => void }) {
  const router = useRouter();
  const { logout } = useAuth();
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center" role="alert">
      <h1 className="text-xl font-semibold">We could not check your plan just now</h1>
      <p className="text-sm text-muted-foreground">
        Nothing was changed and none of your data is affected. Please try again in a moment.
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          onClick={() => (onRetry ? onRetry() : router.refresh())}
        >
          Try again
        </button>
        <button type="button" className="rounded-md border px-4 py-2 text-sm" onClick={() => logout()}>
          Sign out
        </button>
      </div>
    </div>
  );
}

/** Shown to a user whose seat is paused because the plan has fewer seats than users. */
export function SeatPausedScreen({ message }: { message: string }) {
  const { logout } = useAuth();
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center" role="alert">
      <h1 className="text-xl font-semibold">Your access is paused</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <p className="text-sm text-muted-foreground">Nothing was deleted: your records and data are safe.</p>
      <button type="button" className="rounded-md border px-4 py-2 text-sm" onClick={() => logout()}>
        Sign out
      </button>
    </div>
  );
}

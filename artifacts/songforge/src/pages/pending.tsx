import { useAuth } from "@/context/auth";
import { Button } from "@/components/ui/button";

export function Pending() {
  const { logout, refresh } = useAuth();

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto">
          <svg className="w-7 h-7 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
          </svg>
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Account pending approval</h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            Your account has been created and is waiting for admin approval.
            You'll be able to use Damma once an admin approves your account.
          </p>
        </div>
        <div className="flex gap-3 justify-center">
          <Button variant="outline" onClick={refresh} className="rounded-full">
            Check again
          </Button>
          <Button variant="ghost" onClick={logout} className="rounded-full text-muted-foreground">
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}

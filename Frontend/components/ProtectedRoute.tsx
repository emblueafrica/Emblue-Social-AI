"use client";

import { useRequireAuth } from "@/hooks/use-auth";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { loading, session, error } = useRequireAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
        <div className="rounded-2xl bg-card px-6 py-5 text-sm font-medium shadow-sm">
          Loading workspace...
        </div>
      </div>
    );
  }

  if (!session) return null;

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
        <div className="max-w-md rounded-2xl bg-card p-6 shadow-sm">
          <h1 className="text-lg font-bold">Account context unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return children;
}

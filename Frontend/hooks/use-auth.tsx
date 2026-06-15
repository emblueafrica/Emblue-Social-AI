"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { getAuthMe, type AuthMeResponse } from "@/lib/api";
import { getMissingClientEnv } from "@/lib/env";
import { supabase } from "@/lib/supabase";

type AuthContextValue = {
  session: Session | null;
  authContext: AuthMeResponse | null;
  activeBrandId: number | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<AuthMeResponse | null>;
  signOut: () => Promise<void>;
  refreshAuthContext: () => Promise<AuthMeResponse | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authContext, setAuthContext] = useState<AuthMeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const authContextRef = useRef<AuthMeResponse | null>(null);
  const lastContextTokenRef = useRef<string | null>(null);

  const refreshAuthContext = useCallback(async () => {
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const token = data.session?.access_token ?? null;
      if (!token) {
        lastContextTokenRef.current = null;
        authContextRef.current = null;
        setAuthContext(null);
        return null;
      }
      if (lastContextTokenRef.current === token && authContextRef.current) return authContextRef.current;

      const me = await getAuthMe();
      authContextRef.current = me;
      setAuthContext(me);
      lastContextTokenRef.current = token;
      setError(null);
      return me;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load account context.";
      authContextRef.current = null;
      setAuthContext(null);
      setError(message);
      return null;
    }
  }, []);

  useEffect(() => {
    const missing = getMissingClientEnv();
    if (missing.length) {
      setError(`Missing frontend env vars: ${missing.join(", ")}`);
      setLoading(false);
      return;
    }

    let alive = true;
    supabase.auth.getSession().then(async ({ data, error: sessionError }) => {
      if (!alive) return;
      if (sessionError) setError(sessionError.message);
      setSession(data.session ?? null);
      if (data.session) await refreshAuthContext();
      if (alive) setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        lastContextTokenRef.current = null;
        authContextRef.current = null;
        setAuthContext(null);
        setLoading(false);
        return;
      }
      if (event === "INITIAL_SESSION" && lastContextTokenRef.current === nextSession.access_token) {
        setLoading(false);
        return;
      }
      void refreshAuthContext();
    });

    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, [refreshAuthContext]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setLoading(true);
      setError(null);
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        setLoading(false);
        setError(signInError.message);
        throw signInError;
      }
      lastContextTokenRef.current = null;
      setSession(data.session);
      const nextContext = await refreshAuthContext();
      setLoading(false);
      return nextContext;
    },
    [refreshAuthContext],
  );

  const signOut = useCallback(async () => {
    setLoading(true);
    await supabase.auth.signOut();
    lastContextTokenRef.current = null;
    authContextRef.current = null;
    setSession(null);
    setAuthContext(null);
    setLoading(false);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      authContext,
      activeBrandId:
        authContext?.active_brand?.brand_id ??
        authContext?.brand_memberships?.[0]?.brand_id ??
        null,
      loading,
      error,
      signIn,
      signOut,
      refreshAuthContext,
    }),
    [session, authContext, loading, error, signIn, signOut, refreshAuthContext],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export function useRequireAuth() {
  const router = useRouter();
  const auth = useAuth();

  useEffect(() => {
    if (!auth.loading && !auth.session) router.replace("/");
  }, [auth.loading, auth.session, router]);

  return auth;
}

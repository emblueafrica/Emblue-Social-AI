"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { AuthLayout } from "@/components/AuthLayout";
import { supabase } from "@/lib/supabase";

function PwdField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="block text-sm font-semibold mb-2 text-foreground">
        {label}
      </label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="**************"
          disabled={disabled}
          className="w-full pl-3 pr-10 py-3.5 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        >
          {show ? <Eye className="size-5" /> : <EyeOff className="size-5" />}
        </button>
      </div>
    </div>
  );
}

export default function ResetPage() {
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const router = useRouter();
  const canSubmit =
    pwd.length >= 8 && confirm.length >= 8 && !checkingSession && !loading;

  useEffect(() => {
    let alive = true;

    const loadRecoverySession = async () => {
      setError(null);

      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");

      if (code) {
        const { error: exchangeError } =
          await supabase.auth.exchangeCodeForSession(code);

        if (!alive) return;

        if (exchangeError) {
          setError(exchangeError.message);
          setSessionReady(false);
          setCheckingSession(false);
          return;
        }

        url.searchParams.delete("code");
        window.history.replaceState(null, "", url.toString());
      }

      const { data, error: sessionError } = await supabase.auth.getSession();

      if (!alive) return;

      if (sessionError) {
        setError(sessionError.message);
        setSessionReady(false);
      } else {
        setSessionReady(Boolean(data.session));
      }

      setCheckingSession(false);
    };

    void loadRecoverySession();

    return () => {
      alive = false;
    };
  }, []);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!sessionReady) {
      setError("Open this page from your password reset email before setting a new password.");
      return;
    }

    if (pwd.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (pwd !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({
      password: pwd,
    });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    router.push("/success");
  };

  return (
    <AuthLayout>
      <h1 className="text-3xl md:text-4xl font-bold text-center text-foreground">
        Reset your Password
      </h1>

      <form
        onSubmit={submit}
        className="max-w-lg mx-auto mt-12 space-y-6"
      >
        <PwdField
          label="New Password"
          value={pwd}
          onChange={setPwd}
          disabled={loading || checkingSession}
        />
        <PwdField
          label="Confirm Password"
          value={confirm}
          onChange={setConfirm}
          disabled={loading || checkingSession}
        />

        {checkingSession && (
          <p className="text-sm font-medium text-muted-foreground">
            Verifying your reset link...
          </p>
        )}
        {!checkingSession && !sessionReady && !error && (
          <p className="text-sm font-medium text-destructive">
            Open this page from your password reset email before setting a new password.
          </p>
        )}
        {error && (
          <p className="text-sm font-medium text-destructive">{error}</p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full mt-8 py-3.5 rounded-xl font-semibold text-primary-foreground bg-primary hover:opacity-90 transition disabled:bg-brand-soft disabled:cursor-not-allowed"
        >
          {loading ? "Resetting..." : "Reset Password"}
        </button>
      </form>
    </AuthLayout>
  );
}

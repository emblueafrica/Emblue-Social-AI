"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { User } from "lucide-react";
import { AuthLayout } from "@/components/AuthLayout";
import { supabase } from "@/lib/supabase";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const router = useRouter();
  const normalizedEmail = email.trim();
  const enabled = normalizedEmail.length > 0 && !loading;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!enabled) return;

    setLoading(true);
    setError(null);
    setSent(false);

    const redirectTo =
      typeof window === "undefined"
        ? undefined
        : `${window.location.origin}/reset-password`;

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      normalizedEmail,
      redirectTo ? { redirectTo } : undefined,
    );

    setLoading(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("passwordRecoveryEmail", normalizedEmail);
    }
    setSent(true);
  };

  return (
    <AuthLayout>
      <div className="text-center max-w-lg mx-auto">
        <h1 className="text-3xl md:text-4xl font-bold text-foreground">Forgot Password</h1>
        <p className="text-muted-foreground mt-3">
          Enter your registered email to reset your password.
        </p>
      </div>

      <form
        onSubmit={submit}
        className="max-w-lg mx-auto mt-12"
      >
        <label className="block text-sm font-semibold mb-2">Email</label>
        <div className="relative">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-muted-foreground" />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter email address"
            disabled={loading}
            className="w-full pl-10 pr-3 py-3.5 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {error && (
          <p className="mt-4 text-sm font-medium text-destructive">{error}</p>
        )}
        {sent && (
          <div className="mt-4 space-y-2 text-sm text-muted-foreground">
            <p className="font-medium text-success">
              Password reset instructions have been sent if the email exists.
            </p>
            <button
              type="button"
              onClick={() =>
                router.push(`/otp?email=${encodeURIComponent(normalizedEmail)}`)
              }
              className="font-semibold text-brand-pink hover:underline"
            >
              Enter recovery code
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={!enabled}
          className="w-full mt-12 py-3.5 rounded-xl font-semibold text-primary-foreground transition bg-primary disabled:bg-brand-soft disabled:cursor-not-allowed"
        >
          {loading ? "Sending..." : "Reset Password"}
        </button>
      </form>
    </AuthLayout>
  );
}

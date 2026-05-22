"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { TimerReset, X } from "lucide-react";
import { AuthLayout } from "@/components/AuthLayout";
import { supabase } from "@/lib/supabase";

export default function OtpPage() {
  const [code, setCode] = useState<string[]>(Array(6).fill(""));
  const [error, setError] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [toast, setToast] = useState(false);
  const [seconds, setSeconds] = useState(13);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const queryEmail = params.get("email")?.trim() ?? "";
    const storedEmail =
      window.sessionStorage.getItem("passwordRecoveryEmail")?.trim() ?? "";
    setEmail(queryEmail || storedEmail);
  }, []);

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  const set = (i: number, v: string) => {
    const ch = v.replace(/\D/g, "").slice(-1);
    const next = [...code];
    next[i] = ch;
    setCode(next);
    setError(false);
    setMessage(null);
    if (ch && i < 5) refs.current[i + 1]?.focus();
  };

  const showInvalid = (nextMessage: string) => {
    setMessage(nextMessage);
    setError(true);
    setToast(true);
    setTimeout(() => setToast(false), 4000);
  };

  const submit = async () => {
    const full = code.join("");
    if (full.length < 6) {
      showInvalid("Enter the 6-digit recovery code.");
      return;
    }

    if (!email.trim()) {
      showInvalid("Enter the email address used for password recovery.");
      return;
    }

    setLoading(true);
    setError(false);
    setMessage(null);

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: full,
      type: "recovery",
    });

    setLoading(false);

    if (verifyError) {
      showInvalid(verifyError.message);
      return;
    }

    router.push("/reset-password");
  };

  const resend = async () => {
    if (!email.trim()) {
      showInvalid("Enter your email address before resending a code.");
      return;
    }

    setResending(true);
    setMessage(null);
    setError(false);

    const redirectTo =
      typeof window === "undefined"
        ? undefined
        : `${window.location.origin}/reset-password`;

    const { error: resendError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      redirectTo ? { redirectTo } : undefined,
    );

    setResending(false);

    if (resendError) {
      showInvalid(resendError.message);
      return;
    }

    window.sessionStorage.setItem("passwordRecoveryEmail", email.trim());
    setSeconds(13);
    setCode(Array(6).fill(""));
    setMessage("A new recovery email has been sent if the account exists.");
  };

  return (
    <AuthLayout>
      {toast && (
        <div className="fixed top-6 right-6 z-50 bg-destructive text-destructive-foreground rounded-2xl shadow-2xl px-5 py-4 flex items-center gap-3 max-w-sm overflow-hidden">
          <div className="rounded-full bg-white/15 p-2">
            <X className="size-6" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-lg leading-tight">Invalid OTP!</p>
            <p className="text-sm opacity-90">
              {message ?? "The OTP you entered is invalid"}
            </p>
          </div>
          <button onClick={() => setToast(false)} aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
      )}

      <div className="text-center max-w-lg mx-auto">
        <h1 className="text-3xl md:text-4xl font-bold text-foreground">
          OTP Verification Code
        </h1>
        <p className="text-muted-foreground mt-3">
          Enter the code sent to your email to reset your password
        </p>
      </div>

      <div className="max-w-xl mx-auto mt-12">
        <div className="mb-8">
          <label className="block text-sm font-semibold mb-2">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setMessage(null);
              setError(false);
            }}
            placeholder="Enter email address"
            disabled={loading}
            className="w-full px-3 py-3.5 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="flex justify-center gap-3 md:gap-4">
          {code.map((c, i) => (
            <input
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              value={c}
              onChange={(e) => set(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && !code[i] && i > 0)
                  refs.current[i - 1]?.focus();
              }}
              inputMode="numeric"
              maxLength={1}
              disabled={loading}
              className={`size-14 md:size-16 text-center text-2xl font-bold rounded-2xl border-2 bg-background focus:outline-none focus:ring-2 focus:ring-ring transition ${
                error
                  ? "border-destructive text-destructive"
                  : "border-brand-soft text-foreground"
              }`}
            />
          ))}
        </div>

        <div className="flex justify-between items-center mt-8 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <TimerReset className="size-5" />
            <span>
              Expires In : 0:{seconds.toString().padStart(2, "0")}
            </span>
          </div>
          <div className="text-muted-foreground">
            Didn't get a code?{" "}
            <button
              type="button"
              onClick={resend}
              disabled={resending || loading}
              className="font-semibold text-brand-pink hover:underline"
            >
              {resending ? "Sending..." : "Resend"}
            </button>
          </div>
        </div>

        {message && !error && (
          <p className="mt-6 text-sm font-medium text-success">{message}</p>
        )}
        {message && error && !toast && (
          <p className="mt-6 text-sm font-medium text-destructive">{message}</p>
        )}

        <button
          onClick={submit}
          disabled={loading}
          className="w-full mt-12 py-3.5 rounded-xl font-semibold text-primary-foreground transition bg-brand-soft hover:bg-primary disabled:cursor-not-allowed"
        >
          {loading ? "Verifying..." : "Submit"}
        </button>
      </div>
    </AuthLayout>
  );
}

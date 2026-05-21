"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { TimerReset, X } from "lucide-react";
import { AuthLayout } from "@/components/AuthLayout";

export default function OtpPage() {
  const [code, setCode] = useState<string[]>(Array(6).fill(""));
  const [error, setError] = useState(false);
  const [toast, setToast] = useState(false);
  const [seconds, setSeconds] = useState(13);
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const router = useRouter();

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
    if (ch && i < 5) refs.current[i + 1]?.focus();
  };

  const submit = () => {
    const full = code.join("");
    if (full.length < 6) {
      setError(true);
      setToast(true);
      setTimeout(() => setToast(false), 4000);
      return;
    }
    // demo: any 6-digit code other than "123456" treated as invalid
    if (full !== "123456" && full.split("").every((c) => c === full[0])) {
      setError(true);
      setToast(true);
      setTimeout(() => setToast(false), 4000);
      return;
    }
    router.push("/reset-password");
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
            <p className="text-sm opacity-90">The OTP you entered is invalid</p>
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
              onClick={() => {
                setSeconds(13);
                setCode(Array(6).fill(""));
                setError(false);
              }}
              className="font-semibold text-brand-pink hover:underline"
            >
              Resend
            </button>
          </div>
        </div>

        <button
          onClick={submit}
          className="w-full mt-12 py-3.5 rounded-xl font-semibold text-primary-foreground transition bg-brand-soft hover:bg-primary"
        >
          Submit
        </button>
      </div>
    </AuthLayout>
  );
}

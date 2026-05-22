"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Eye, EyeOff, User } from "lucide-react";
import { LoginLayout } from "@/components/LoginLayout";
import { useAuth } from "@/hooks/use-auth";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const router = useRouter();
  const { signIn, session, loading, error } = useAuth();
  const enabled = email.length > 0 && password.length > 0 && !loading;

  useEffect(() => {
    if (session) router.replace("/dashboard");
  }, [router, session]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enabled) return;
    setSubmitError(null);
    try {
      await signIn(email, password);
      router.replace("/dashboard");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Unable to log in.");
    }
  };

  return (
    <LoginLayout>
      <div className="w-full max-w-xl bg-card rounded-3xl shadow-2xl p-8 md:p-12">
        <h2 className="text-2xl md:text-3xl font-bold text-foreground flex items-center gap-2">
          Hey Admin <span>👋</span>
        </h2>
        <p className="text-muted-foreground mt-1 mb-8">Login to your Account</p>
        {(submitError || error) && (
          <div className="mb-5 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
            {submitError ?? error}
          </div>
        )}

        <form onSubmit={submit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-2">Email</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-muted-foreground" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Input"
                className="w-full pl-10 pr-3 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Password</label>
            <div className="relative">
              <input
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full pl-3 pr-10 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-label="Toggle password"
              >
                {show ? <Eye className="size-5" /> : <EyeOff className="size-5" />}
              </button>
            </div>
            <div className="flex justify-end mt-2">
              <Link href="/forgot-password"
                className="text-sm font-semibold text-primary hover:underline"
              >
                Forgot Password?
              </Link>
            </div>
          </div>

          <button
            type="submit"
            disabled={!enabled}
            className="w-full mt-4 py-3.5 rounded-xl font-semibold text-primary-foreground transition bg-primary disabled:bg-brand-soft disabled:cursor-not-allowed"
          >
            {loading ? "Checking..." : "Login"}
          </button>
        </form>
      </div>
    </LoginLayout>
  );
}

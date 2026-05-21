"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { User } from "lucide-react";
import { AuthLayout } from "@/components/AuthLayout";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const router = useRouter();
  const enabled = email.length > 0;

  return (
    <AuthLayout>
      <div className="text-center max-w-lg mx-auto">
        <h1 className="text-3xl md:text-4xl font-bold text-foreground">Forgot Password</h1>
        <p className="text-muted-foreground mt-3">
          Enter your registered email to reset your password.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (enabled) router.push("/otp");
        }}
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
            className="w-full pl-10 pr-3 py-3.5 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <button
          type="submit"
          disabled={!enabled}
          className="w-full mt-12 py-3.5 rounded-xl font-semibold text-primary-foreground transition bg-primary disabled:bg-brand-soft disabled:cursor-not-allowed"
        >
          Reset Password
        </button>
      </form>
    </AuthLayout>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { AuthLayout } from "@/components/AuthLayout";

function PwdField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
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

export default function ResetPasswordPage() {
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const router = useRouter();

  return (
    <AuthLayout>
      <h1 className="text-3xl md:text-4xl font-bold text-center text-foreground">
        Reset your Password
      </h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          router.push("/success");
        }}
        className="max-w-lg mx-auto mt-12 space-y-6"
      >
        <PwdField label="New Password" value={pwd} onChange={setPwd} />
        <PwdField label="Confirm Password" value={confirm} onChange={setConfirm} />

        <button
          type="submit"
          className="w-full mt-8 py-3.5 rounded-xl font-semibold text-primary-foreground bg-primary hover:opacity-90 transition"
        >
          Reset Password
        </button>
      </form>
    </AuthLayout>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { AuthLayout } from "@/components/AuthLayout";

export default function SuccessPage() {
  const router = useRouter();
  return (
    <AuthLayout>
      <div className="flex flex-col items-center text-center max-w-lg mx-auto py-6">
        <div className="size-24 rounded-full bg-primary flex items-center justify-center shadow-lg">
          <Check className="size-12 text-primary-foreground" strokeWidth={3} />
        </div>
        <h1 className="text-3xl md:text-4xl font-bold mt-8 text-foreground">
          Successful
        </h1>
        <p className="text-muted-foreground mt-3">
          Your password reset was successful.
        </p>

        <button
          onClick={() => router.push("/dashboard")}
          className="w-full mt-12 py-3.5 rounded-xl font-semibold text-primary-foreground bg-primary hover:opacity-90 transition"
        >
          Continue
        </button>
      </div>
    </AuthLayout>
  );
}

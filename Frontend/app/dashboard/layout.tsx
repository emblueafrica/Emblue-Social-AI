import type { Metadata } from "next";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export const metadata: Metadata = {
  title: "Performance Dashboard - Emblue Social AI",
  description: "Emblue Social AI performance dashboard.",
};

export default function RouteLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

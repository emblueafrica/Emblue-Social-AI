import type { Metadata } from "next";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export const metadata: Metadata = {
  title: "Admin Console - Emblue Social AI",
  description: "Superadmin and platform admin console.",
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

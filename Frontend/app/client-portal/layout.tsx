import type { Metadata } from "next";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export const metadata: Metadata = {
  title: "Client Portal - Emblue Social AI",
  description: "Managed-service client campaign KPI portal.",
};

export default function ClientPortalLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

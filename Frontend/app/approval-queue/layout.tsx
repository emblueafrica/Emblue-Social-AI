import type { Metadata } from "next";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export const metadata: Metadata = {
  title: "Approval Queue - Emblue Social AI",
  description: "Approve, edit, and reject generated social replies.",
};

export default function RouteLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

import type { Metadata } from "next";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export const metadata: Metadata = {
  title: "Settings - Emblue Social AI",
  description: "Workspace settings and platform connections.",
};

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

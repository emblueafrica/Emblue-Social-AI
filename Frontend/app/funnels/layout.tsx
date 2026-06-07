import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function FunnelsLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

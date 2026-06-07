import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function AttributionLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

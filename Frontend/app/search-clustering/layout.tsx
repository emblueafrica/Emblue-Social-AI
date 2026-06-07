import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function SearchClusteringLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

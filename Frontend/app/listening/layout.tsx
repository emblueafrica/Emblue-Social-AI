import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function ListeningLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

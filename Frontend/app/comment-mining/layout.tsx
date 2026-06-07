import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function CommentMiningLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

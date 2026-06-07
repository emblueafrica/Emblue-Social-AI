import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function WarRoomLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

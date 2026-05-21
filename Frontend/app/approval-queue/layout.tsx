import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Approval Queue - Emblue Social AI",
  description: "Approve, edit, and reject generated social replies.",
};

export default function RouteLayout({ children }: { children: React.ReactNode }) {
  return children;
}

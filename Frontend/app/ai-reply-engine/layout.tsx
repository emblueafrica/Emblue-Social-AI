import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Reply Engine - Emblue Social AI",
  description: "Review and manage AI-assisted social replies.",
};

export default function RouteLayout({ children }: { children: React.ReactNode }) {
  return children;
}

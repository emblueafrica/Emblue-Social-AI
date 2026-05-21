import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Engage the Engager - Emblue Social AI",
  description: "Manage social engagement campaigns.",
};

export default function RouteLayout({ children }: { children: React.ReactNode }) {
  return children;
}

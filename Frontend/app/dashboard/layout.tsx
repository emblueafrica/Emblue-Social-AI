import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Performance Dashboard - Emblue Social AI",
  description: "Emblue Social AI performance dashboard.",
};

export default function RouteLayout({ children }: { children: React.ReactNode }) {
  return children;
}

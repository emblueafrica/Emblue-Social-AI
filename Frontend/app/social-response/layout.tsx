import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Social Response - Emblue Social AI",
  description: "Monitor social response performance.",
};

export default function RouteLayout({ children }: { children: React.ReactNode }) {
  return children;
}

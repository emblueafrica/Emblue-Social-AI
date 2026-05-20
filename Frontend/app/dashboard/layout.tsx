import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Performance Dashboard — Emblue Social AI",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

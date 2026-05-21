import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: {
    default: "Login - Emblue Social AI",
    template: "%s",
  },
  description: "Emblue Social AI admin and engagement dashboard.",
  authors: [{ name: "Emblue Social AI" }],
  openGraph: {
    title: "Emblue Social AI",
    description: "Emblue Social AI admin and engagement dashboard.",
    type: "website",
  },
  twitter: {
    card: "summary",
    site: "@EmblueSocialAI",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

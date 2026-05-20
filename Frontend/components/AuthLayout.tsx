import Link from "next/link";
import { EmblueLogo } from "./EmblueLogo";

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/40 flex flex-col">
      <header className="flex items-center justify-between px-6 md:px-12 py-6">
        <Link href="/">
          <EmblueLogo variant="dark" />
        </Link>
        <Link
          href="/"
          className="bg-primary text-primary-foreground px-8 py-3 rounded-xl font-semibold text-base shadow-sm hover:opacity-90 transition"
        >
          Login
        </Link>
      </header>
      <main className="flex-1 flex items-start justify-center px-4 pt-8 pb-16">
        <div className="w-full max-w-3xl bg-card rounded-3xl shadow-[var(--shadow-card)] px-6 md:px-16 py-14 md:py-20">
          {children}
        </div>
      </main>
    </div>
  );
}

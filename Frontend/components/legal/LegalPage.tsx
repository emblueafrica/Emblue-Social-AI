import Link from "next/link";
import type { ReactNode } from "react";

type TocItem = {
  id: string;
  label: string;
};

type LegalPageProps = {
  active: "privacy" | "terms";
  title: string;
  subtitle: string;
  effectiveDate: string;
  lastUpdated: string;
  toc: TocItem[];
  children: ReactNode;
};

type LegalSectionProps = {
  id: string;
  number: number;
  title: string;
  children: ReactNode;
};

type LegalTableProps = {
  columns: string[];
  rows: ReactNode[][];
};

const navLinkClass = (active: boolean) =>
  [
    "rounded-full px-4 py-2 text-sm font-semibold transition",
    active ? "bg-[#1f40ff] text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
  ].join(" ");

export function LegalPage({
  active,
  title,
  subtitle,
  effectiveDate,
  lastUpdated,
  toc,
  children,
}: LegalPageProps) {
  return (
    <main className="min-h-screen bg-[#f8fafc] text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <Link href="/" className="text-xl font-bold tracking-tight text-[#111f6f]">
            emblue <span className="font-medium text-slate-500">Social AI</span>
          </Link>
          <nav className="flex flex-wrap items-center gap-2">
            <Link href="/privacy" className={navLinkClass(active === "privacy")}>
              Privacy
            </Link>
            <Link href="/terms" className={navLinkClass(active === "terms")}>
              Terms
            </Link>
            <Link href="/" className={navLinkClass(false)}>
              Back to App
            </Link>
          </nav>
        </div>
      </header>

      <section className="bg-[#111f6f] text-white">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-blue-100">Legal</p>
          <h1 className="max-w-4xl text-4xl font-bold tracking-tight md:text-5xl">{title}</h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-blue-50 md:text-lg">{subtitle}</p>
          <div className="mt-8 flex flex-wrap gap-3 text-sm">
            <span className="rounded-full border border-white/20 bg-white/10 px-4 py-2">
              Effective: {effectiveDate}
            </span>
            <span className="rounded-full border border-white/20 bg-white/10 px-4 py-2">
              Last updated: {lastUpdated}
            </span>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-10 lg:grid-cols-[280px_1fr] lg:px-8">
        <aside className="lg:sticky lg:top-6 lg:h-fit">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-slate-500">Contents</h2>
            <ol className="mt-4 space-y-1">
              {toc.map((item, index) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    className="flex gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 hover:text-[#1f40ff]"
                  >
                    <span className="w-5 shrink-0 text-slate-400">{index + 1}</span>
                    <span>{item.label}</span>
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </aside>

        <article className="space-y-6">{children}</article>
      </div>
    </main>
  );
}

export function LegalSection({ id, number, title, children }: LegalSectionProps) {
  return (
    <section id={id} className="scroll-mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
      <div className="mb-5 flex items-start gap-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-sm font-bold text-[#1f40ff]">
          {number}
        </span>
        <h2 className="text-2xl font-bold tracking-tight text-slate-950">{title}</h2>
      </div>
      <div className="legal-copy space-y-4 text-sm leading-7 text-slate-700 md:text-base">{children}</div>
    </section>
  );
}

export function LegalTable({ columns, rows }: LegalTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="px-4 py-3">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="min-w-40 px-4 py-4 align-top text-slate-700">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50 px-5 py-4 text-sm font-medium leading-6 text-[#111f6f]">
      {children}
    </div>
  );
}

export function SuccessCallout({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-5 py-4 text-sm font-medium leading-6 text-emerald-900">
      {children}
    </div>
  );
}

export function ContactBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[#1f40ff]/20 bg-[#1f40ff] px-6 py-5 text-white">
      <div className="space-y-2 text-sm leading-6">{children}</div>
    </div>
  );
}

export function RightsGrid({
  items,
}: {
  items: Array<{
    title: string;
    body: string;
  }>;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {items.map((item) => (
        <div key={item.title} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="font-bold text-slate-950">{item.title}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{item.body}</p>
        </div>
      ))}
    </div>
  );
}

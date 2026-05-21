"use client";

import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Check,
  AlertOctagon,
  ArrowUp,
  ArrowDown,
  FileText,
} from "lucide-react";
import { Sidebar, DashHeader } from "@/components/dashboard/Sidebar";
import { PlatformLogo } from "@/components/PlatformLogo";

type Platform = "instagram" | "facebook" | "x" | "tiktok" | "linkedin";
type Sentiment = "Negative" | "Postive" | "Neutral";
type Status = "pending" | "Posted";
type Urgency = "red" | "yellow" | "blue";

type Message = {
  id: number;
  user: string;
  platform: Platform;
  preview: string;
  sentiment: Sentiment;
  tag: string;
  status: Status;
  ago: string;
  urgency: Urgency;
};

const MESSAGES: Message[] = [
  { id: 1, user: "@kemiwears", platform: "instagram", preview: "Love the product but…", sentiment: "Negative", tag: "Summer Drop", status: "pending", ago: "2m ago", urgency: "red" },
  { id: 2, user: "@tunde_Lagos", platform: "linkedin", preview: "Love the product but…", sentiment: "Postive", tag: "New Arrivals", status: "pending", ago: "1h ago", urgency: "red" },
  { id: 3, user: "@kemiwears", platform: "tiktok", preview: "Love the product but…", sentiment: "Negative", tag: "FAQ Auto", status: "pending", ago: "1h ago", urgency: "yellow" },
  { id: 4, user: "@kemiwears", platform: "x", preview: "Love the product but…", sentiment: "Postive", tag: "Summer Drop", status: "pending", ago: "1h ago", urgency: "yellow" },
  { id: 5, user: "@kemiwears", platform: "facebook", preview: "Love the product but…", sentiment: "Postive", tag: "Always On", status: "pending", ago: "1h ago", urgency: "yellow" },
  { id: 6, user: "@kemiwears", platform: "instagram", preview: "Love the product but…", sentiment: "Negative", tag: "New Arrivals", status: "pending", ago: "1h ago", urgency: "blue" },
  { id: 7, user: "@kemiwears", platform: "facebook", preview: "Love the product but…", sentiment: "Neutral", tag: "New Arrivals", status: "pending", ago: "1h ago", urgency: "blue" },
  { id: 8, user: "@kemiwears", platform: "tiktok", preview: "Love the product but…", sentiment: "Neutral", tag: "Always On", status: "Posted", ago: "1h ago", urgency: "blue" },
  { id: 9, user: "@kemiwears", platform: "linkedin", preview: "Love the product but…", sentiment: "Negative", tag: "FAQ Auto", status: "Posted", ago: "1h ago", urgency: "yellow" },
  { id: 10, user: "@kemiwears", platform: "linkedin", preview: "Love the product but…", sentiment: "Negative", tag: "FAQ Auto", status: "Posted", ago: "1h ago", urgency: "yellow" },
  { id: 11, user: "@kemiwears", platform: "linkedin", preview: "Love the product but…", sentiment: "Negative", tag: "FAQ Auto", status: "Posted", ago: "1h ago", urgency: "yellow" },
];

type DraftReply = {
  agent: string;
  tone: string;
  body: string;
  intent: string;
  intentColor: string;
  defaultTone: string;
};

const DRAFTS: Record<string, DraftReply> = {
  "@kemiwears": {
    agent: "Agent 12 — Complaint Handler",
    tone: "Empathetic",
    body: "Hey @kemi.wears! That is genuinely frustrating, a cart that expires twice is unacceptable and we are truly sorry. We are shipping a one-click checkout next week. I have personally flagged your issue and we will follow up.",
    intent: "Intent: Complaint",
    intentColor: "bg-pink-100 text-pink-700",
    defaultTone: "Empathetic",
  },
  "@tunde_Lagos": {
    agent: "Agent 08 — Purchase Intent",
    tone: "Conversion",
    body: "Hey @tunde_Lagos! We do not have a physical store yet, but we offer same-day Lagos delivery. Order before 12pm and it arrives today. Here is your personal checkout link 🛍️",
    intent: "Intent: Purchase",
    intentColor: "bg-emerald-100 text-emerald-700",
    defaultTone: "Conversion",
  },
};

const KEMIWEARS_TEXT =
  "Love the product but seriously why does checkout take 3 steps? My cart expired TWICE 🤬 This is embarrassing for a brand this size.";
const TUNDE_TEXT =
  "Do you have a physical store in Lagos? Ready to buy today if I can pick up. Please respond quickly!";

const sentimentClass: Record<Sentiment, string> = {
  Negative: "bg-red-100 text-red-600",
  Postive: "bg-emerald-100 text-emerald-700",
  Neutral: "bg-slate-200 text-slate-700",
};

const urgencyDot: Record<Urgency, string> = {
  red: "bg-red-500",
  yellow: "bg-yellow-400",
  blue: "bg-blue-400",
};

function PlatformIcon({ p, className = "size-4" }: { p: Platform; className?: string }) {
  return <PlatformLogo platform={p} size={16} className={className} />;
}

const TONES = ["Empathetic", "Solution-first", "Warm", "Professional", "Conversion", "Direct"];

export default function AIReplyEngine() {
  const [platforms, setPlatforms] = useState<Record<Platform, boolean>>({
    instagram: true,
    facebook: true,
    x: true,
    tiktok: true,
    linkedin: true,
  });
  const [selectedId, setSelectedId] = useState<number | null>(1);
  const [tone, setTone] = useState<string>("Empathetic");
  const [toast, setToast] = useState<null | { kind: "approved" | "skipped" }>(null);
  const [queueCleared, setQueueCleared] = useState(false);

  const visible = useMemo(
    () => MESSAGES.filter((m) => platforms[m.platform]),
    [platforms],
  );

  const selected = visible.find((m) => m.id === selectedId) ?? null;
  const draft = selected ? DRAFTS[selected.user] ?? DRAFTS["@kemiwears"] : null;

  const togglePlatform = (p: Platform) =>
    setPlatforms((s) => ({ ...s, [p]: !s[p] }));

  const showToast = (kind: "approved" | "skipped") => {
    setToast({ kind });
    setTimeout(() => setToast(null), 2500);
  };

  return (
    <div className="min-h-screen flex bg-muted/30">
      <Sidebar activeLabel="AI Reply Engine" />
      <div className="flex-1 flex flex-col min-w-0">
        <DashHeader title="AI Reply Engine" />

        <main className="flex-1 p-6 md:p-8 space-y-6">
          {/* KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Kpi color="bg-primary" label="Replies Sent Today" value="342" delta="12% from yesterday" up />
            <Kpi color="bg-brand-pink" label="Avg Response Time" value="1.8mins" delta="40%  vs manual" />
            <Kpi color="bg-brand-olive" label="Approval Rate" value="94%" sub="Human-approved drafts" />
            <Kpi color="bg-destructive" label="Queue" value="18" delta="5 new since last check" up dangerDelta />
          </div>

          {/* Body grid */}
          <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)_360px] gap-5">
            {/* Filters */}
            <aside className="space-y-4">
              <FilterCard title="SORT BY">
                <SortRow active icon={<AlertOctagon className="size-4 text-red-500" />} label="Urgency First" />
                <SortRow icon={<ArrowUp className="size-4" />} label="Newest" />
                <SortRow icon={<ArrowDown className="size-4" />} label="Oldest" />
              </FilterCard>

              <FilterCard title="PLATFORM">
                <Check2 label="Instagram" checked={platforms.instagram} onChange={() => togglePlatform("instagram")} />
                <Check2 label="Facebook" checked={platforms.facebook} onChange={() => togglePlatform("facebook")} />
                <Check2 label="X / Twitter" checked={platforms.x} onChange={() => togglePlatform("x")} />
                <Check2 label="Linkedin" checked={platforms.linkedin} onChange={() => togglePlatform("linkedin")} />
              </FilterCard>

              <FilterCard title="CAMPAIGN">
                {["Summer Drop", "New Arrivals", "FAQ Auto", "Always On"].map((c) => (
                  <Check2 key={c} label={c} checked />
                ))}
              </FilterCard>

              <FilterCard title="URGENCY">
                <Check2 label="Immediate" checked dot="bg-red-500" />
                <Check2 label="High" checked dot="bg-yellow-400" />
                <Check2 label="Medium" checked dot="bg-blue-400" />
                <Check2 label="Low" checked dot="bg-slate-400" />
              </FilterCard>

              <FilterCard title="STATUS">
                <Check2 label="Pending" checked pillClass="bg-yellow-100 text-yellow-700" />
                <Check2 label="Draft" checked pillClass="bg-slate-200 text-slate-700" />
                <Check2 label="Approved" checked pillClass="bg-indigo-100 text-indigo-700" />
                <Check2 label="Posted" checked pillClass="bg-emerald-100 text-emerald-700" />
              </FilterCard>
            </aside>

            {/* Message list */}
            <section className="bg-card rounded-2xl shadow-sm overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b">
                <label className="flex items-center gap-3 text-sm">
                  <input type="checkbox" className="size-4 rounded" />
                  Select all
                </label>
                <span className="text-sm font-semibold">{visible.length} messages</span>
              </div>
              <ul className="divide-y">
                {visible.map((m) => {
                  const isSel = !queueCleared && selectedId === m.id;
                  return (
                    <li
                      key={m.id}
                      onClick={() => {
                        setSelectedId(m.id);
                        setQueueCleared(false);
                        const d = DRAFTS[m.user];
                        if (d) setTone(d.defaultTone);
                      }}
                      className={`flex items-center gap-3 px-5 py-3.5 text-sm cursor-pointer hover:bg-muted/60 ${
                        isSel ? "bg-muted/50" : ""
                      }`}
                    >
                      <input type="checkbox" className="size-4 rounded" onClick={(e) => e.stopPropagation()} />
                      <span className={`size-2 rounded-full ${urgencyDot[m.urgency]}`} />
                      <PlatformIcon p={m.platform} className="size-4" />
                      <span className="font-medium min-w-[110px]">{m.user}</span>
                      <span className="text-muted-foreground truncate flex-1">{m.preview}</span>
                      <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${sentimentClass[m.sentiment]}`}>
                        {m.sentiment}
                      </span>
                      <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700">
                        {m.tag}
                      </span>
                      <span
                        className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full ${
                          m.status === "Posted"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-yellow-100 text-yellow-700"
                        }`}
                      >
                        {m.status}
                      </span>
                      <span className="text-xs text-muted-foreground w-14 text-right">{m.ago}</span>
                    </li>
                  );
                })}
              </ul>

              <div className="flex items-center justify-center gap-4 px-5 py-5 text-sm border-t mt-auto relative">
                {toast && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 -translate-y-full bg-indigo-50 border border-indigo-100 rounded-xl shadow-sm px-4 py-3 flex items-center gap-3 text-sm w-[360px]">
                    <span className="size-7 rounded-full bg-emerald-500 text-white flex items-center justify-center">
                      <Check className="size-4" />
                    </span>
                    <span className="flex-1">
                      {toast.kind === "approved" ? (
                        <>Reply to @kemi.wears approved <br />& queued for sending.</>
                      ) : (
                        "Message Skipped"
                      )}
                    </span>
                    <button onClick={() => setToast(null)} className="text-primary font-semibold">
                      Undo
                    </button>
                  </div>
                )}
                <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
                  <ChevronLeft className="size-4" /> Prev
                </button>
                <span className="flex items-center gap-1 px-3 py-1.5 rounded-md border">
                  1 <ChevronDown className="size-3" />
                </span>
                <span className="text-muted-foreground">of 77</span>
                <button className="flex items-center gap-1 hover:text-primary">
                  Next <ChevronRight className="size-4" />
                </button>
              </div>
            </section>

            {/* Reply panel */}
            <aside className="bg-card rounded-2xl shadow-sm p-5 flex flex-col">
              {queueCleared || !selected || !draft ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center py-16 text-muted-foreground">
                  <FileText className="size-12 mb-4" strokeWidth={1.4} />
                  <p className="font-semibold">Queue cleared</p>
                  <p className="text-sm">All messages reviewed!</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="size-10 rounded-full bg-muted flex items-center justify-center font-semibold text-xs">
                      {selected.user.replace("@", "").slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-sm">{selected.user}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <PlatformIcon p={selected.platform} className="size-3" />
                        {selected.tag} • 2m ago
                      </p>
                    </div>
                    <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-600">
                      Immediate
                    </span>
                  </div>

                  <div className="bg-muted/40 rounded-xl p-4 text-sm leading-relaxed mb-3">
                    {selected.user === "@tunde_Lagos" ? TUNDE_TEXT : KEMIWEARS_TEXT}
                  </div>

                  <div className="flex gap-2 mb-5">
                    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${sentimentClass[selected.sentiment]}`}>
                      {selected.sentiment}
                    </span>
                    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${draft.intentColor}`}>
                      {draft.intent}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mb-3">
                    <div className="size-8 rounded-md bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">
                      AI
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-primary">{draft.agent}</p>
                      <p className="text-xs text-muted-foreground">Tone: {draft.tone}</p>
                    </div>
                  </div>

                  <div className="border rounded-xl p-4 text-sm leading-relaxed mb-2 max-h-44 overflow-auto">
                    {draft.body}
                  </div>
                  <div className="flex items-center justify-between text-xs mb-5">
                    <button className="flex items-center gap-1 text-primary font-semibold">
                      <RefreshCw className="size-3" /> Regenerate draft
                    </button>
                    <span className="text-muted-foreground">252 chars</span>
                  </div>

                  <p className="text-[11px] font-semibold tracking-wider text-muted-foreground mb-3">
                    REGENERATE WITH TONE
                  </p>
                  <div className="grid grid-cols-3 gap-2 mb-6">
                    {TONES.map((t) => (
                      <button
                        key={t}
                        onClick={() => setTone(t)}
                        className={`text-xs py-2 rounded-full border transition ${
                          tone === t
                            ? "border-primary text-primary bg-primary/5"
                            : "border-border text-muted-foreground hover:border-primary/40"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() => {
                      showToast("approved");
                      setQueueCleared(true);
                    }}
                    className="w-full bg-primary text-primary-foreground rounded-xl py-3 font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition"
                  >
                    <Check className="size-4" /> Approval & Send
                  </button>
                  <button
                    onClick={() => {
                      showToast("skipped");
                    }}
                    className="w-full text-center py-3 text-sm font-semibold hover:text-primary"
                  >
                    Skip
                  </button>
                </>
              )}
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}

function Kpi({
  color,
  label,
  value,
  delta,
  sub,
  up,
  dangerDelta,
}: {
  color: string;
  label: string;
  value: string;
  delta?: string;
  sub?: string;
  up?: boolean;
  dangerDelta?: boolean;
}) {
  return (
    <div className="bg-card rounded-2xl p-5 shadow-sm relative overflow-hidden">
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${color}`} />
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-3xl font-bold mt-2">{value}</p>
      {delta && (
        <p className={`text-xs mt-2 ${dangerDelta ? "text-destructive" : up ? "text-success" : "text-muted-foreground"}`}>
          {up ? "↑" : "↓"} {delta}
        </p>
      )}
      {sub && <p className="text-xs mt-2 text-muted-foreground">{sub}</p>}
    </div>
  );
}

function FilterCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-2xl p-4 shadow-sm">
      <p className="text-[11px] font-semibold tracking-wider text-muted-foreground mb-3">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function SortRow({ icon, label, active }: { icon: React.ReactNode; label: string; active?: boolean }) {
  return (
    <div className={`flex items-center gap-2 text-sm py-1 ${active ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
      {icon}
      <span>{label}</span>
    </div>
  );
}

function Check2({
  label,
  checked,
  onChange,
  dot,
  pillClass,
}: {
  label: string;
  checked?: boolean;
  onChange?: () => void;
  dot?: string;
  pillClass?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <span
        onClick={onChange}
        className={`size-4 rounded border flex items-center justify-center ${
          checked ? "bg-primary border-primary text-white" : "border-border bg-card"
        }`}
      >
        {checked && <Check className="size-3" strokeWidth={3} />}
      </span>
      {dot && <span className={`size-2 rounded-full ${dot}`} />}
      {pillClass ? (
        <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${pillClass}`}>{label}</span>
      ) : (
        <span>{label}</span>
      )}
    </label>
  );
}

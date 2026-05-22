"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, Check } from "lucide-react";
import { Sidebar, DashHeader } from "@/components/dashboard/Sidebar";
import { PlatformLogo } from "@/components/PlatformLogo";
import { useAuth } from "@/hooks/use-auth";
import {
  ApiError,
  approveQueueItem,
  getApprovalQueue,
  type ApprovalQueueItem,
} from "@/lib/api";

type Platform = "instagram" | "x" | "tiktok" | "facebook";
type QueueItem = {
  id: number;
  handle: string;
  platform: Platform;
  confidence: number;
  ago: string;
  preview: string;
  original: string;
  reply: string;
  tags: { label: string; cls: string }[];
  category: string;
};

const ITEMS: QueueItem[] = [
  {
    id: 1,
    handle: "@kemiwears",
    platform: "instagram",
    confidence: 58,
    ago: "4m ago",
    preview: "Hi Kemi! We're so sorry to hear about your experience....",
    original: "I've been trying to get in touch with your team for 3 days and no one is responding. This is really frustrating.",
    reply: "Hi Kemi! We're so sorry to hear about your experience. Our team should have responded sooner — that's not the service we pride ourselves on. Could you DM us your account details? We'd love to resolve this personally.",
    tags: [
      { label: "Keyword Surge", cls: "bg-pink-100 text-pink-700" },
      { label: "Complaint", cls: "bg-indigo-100 text-indigo-700" },
    ],
    category: "COMPLAINT",
  },
  {
    id: 2, handle: "@tunde_Lagos", platform: "x", confidence: 58, ago: "4m ago",
    preview: "tunde_Lagos We're so sorry to hear about your....",
    original: "Hey team, any update on my order? It's been 5 days.",
    reply: "Hi tunde_Lagos! We're so sorry to hear about your wait. Let us look into your order right now and get back to you shortly.",
    tags: [{ label: "Order Status", cls: "bg-indigo-100 text-indigo-700" }],
    category: "COMPLAINT",
  },
  {
    id: 3, handle: "@oluwa.fin", platform: "tiktok", confidence: 58, ago: "4m ago",
    preview: "Hi oluwa We're so sorry to hear about your ....",
    original: "Why does the app keep crashing on iOS?",
    reply: "Hi oluwa! We're so sorry to hear about your experience. Our team is shipping a fix this week — DM us your device info and we'll keep you posted.",
    tags: [{ label: "Bug Report", cls: "bg-indigo-100 text-indigo-700" }],
    category: "BUG",
  },
  {
    id: 4, handle: "@adunni.so", platform: "facebook", confidence: 58, ago: "4m ago",
    preview: "Hi adunni! We're so sorry to hear about your ....",
    original: "My discount code isn't working at checkout.",
    reply: "Hi adunni! We're so sorry to hear about your experience. We've reset your code — try again and let us know if it still doesn't apply.",
    tags: [{ label: "Discount", cls: "bg-amber-100 text-amber-700" }],
    category: "SUPPORT",
  },
  {
    id: 5, handle: "@chinwe.code", platform: "x", confidence: 58, ago: "4m ago",
    preview: "Hi chinwe! We're so sorry to hear about your ....",
    original: "Shipping took way longer than promised.",
    reply: "Hi chinwe! We're so sorry to hear about your delay. We're crediting your account — check your inbox in the next hour.",
    tags: [{ label: "Shipping", cls: "bg-amber-100 text-amber-700" }],
    category: "COMPLAINT",
  },
  {
    id: 6, handle: "@nene_pr", platform: "instagram", confidence: 58, ago: "4m ago",
    preview: "Hi nene! We're so sorry to hear about your experience....",
    original: "PR contact please — would love to collab.",
    reply: "Hi nene! We're so sorry to hear about your experience reaching us. Our PR team will be in touch within 24 hours.",
    tags: [{ label: "PR", cls: "bg-emerald-100 text-emerald-700" }],
    category: "OUTREACH",
  },
  {
    id: 7, handle: "@luxe.ng", platform: "x", confidence: 58, ago: "4m ago",
    preview: "Hi luxe! We're so sorry to hear about your experience....",
    original: "Item arrived damaged.",
    reply: "Hi luxe! We're so sorry to hear about your damaged item. We're sending a replacement out today at no charge.",
    tags: [{ label: "Damaged", cls: "bg-pink-100 text-pink-700" }],
    category: "COMPLAINT",
  },
  {
    id: 8, handle: "@bimbowears", platform: "instagram", confidence: 58, ago: "4m ago",
    preview: "Hi bimbo! We're so sorry to hear about your ....",
    original: "Love the brand but checkout is slow.",
    reply: "Hi bimbo! We're so sorry to hear about your experience. One-click checkout ships next week — thanks for sticking with us.",
    tags: [{ label: "Feedback", cls: "bg-indigo-100 text-indigo-700" }],
    category: "FEEDBACK",
  },
];

const SORTS = ["Confidence", "Time in queue", "Platform"];

function PlatformIcon({ p }: { p: Platform }) {
  return <PlatformLogo platform={p} size={16} />;
}

function normalizePlatform(platform: string): Platform {
  if (platform === "instagram" || platform === "facebook" || platform === "tiktok" || platform === "x") {
    return platform;
  }
  return "x";
}

function mapApprovalItem(item: ApprovalQueueItem, index: number): QueueItem {
  const author = item.author.startsWith("@") ? item.author : `@${item.author}`;
  const category = item.manual_copy_required ? "MANUAL REVIEW" : "AI REPLY";

  return {
    id: index + 1,
    handle: author,
    platform: normalizePlatform(item.platform),
    confidence: item.manual_copy_required ? 50 : 72,
    ago: "Live",
    preview: item.reply.slice(0, 72) || "Reply waiting for review.",
    original: item.original,
    reply: item.reply,
    tags: [
      item.manual_copy_required
        ? { label: "Manual copy", cls: "bg-amber-100 text-amber-700" }
        : { label: "Ready to send", cls: "bg-emerald-100 text-emerald-700" },
      item.tracked_link
        ? { label: "Tracked link", cls: "bg-indigo-100 text-indigo-700" }
        : { label: "Reply", cls: "bg-pink-100 text-pink-700" },
    ],
    category,
  };
}

function apiErrorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Approval queue request failed.";
}

export default function ApprovalQueue() {
  const queryClient = useQueryClient();
  const { activeBrandId } = useAuth();
  const [sort, setSort] = useState("Confidence");
  const [selectedId, setSelectedId] = useState<number>(1);
  const [fallbackItems, setFallbackItems] = useState(ITEMS);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [toast, setToast] = useState<{ handle: string } | null>(null);
  const [apiNotice, setApiNotice] = useState<string | null>(null);

  const queueQuery = useQuery({
    queryKey: ["approval-queue", activeBrandId],
    queryFn: () => getApprovalQueue(activeBrandId!),
    enabled: Boolean(activeBrandId),
    staleTime: 10_000,
  });

  const liveItems = queueQuery.data?.queue.map(mapApprovalItem) ?? [];
  const items = queueQuery.data ? liveItems : fallbackItems;

  const approveMutation = useMutation({
    mutationFn: ({ brandId, index, replyText }: { brandId: number; index: number; replyText?: string }) =>
      approveQueueItem(brandId, index, replyText),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["approval-queue", activeBrandId] });
    },
  });

  const selected = items.find((i) => i.id === selectedId);
  const draftText = selected ? drafts[selected.id] ?? "" : "";

  const approve = async () => {
    if (!selected) return;
    setApiNotice(null);

    if (activeBrandId && queueQuery.data) {
      const index = items.findIndex((item) => item.id === selected.id);
      try {
        await approveMutation.mutateAsync({
          brandId: activeBrandId,
          index,
          replyText: draftText.trim() || selected.reply,
        });
        setToast({ handle: selected.handle });
        setTimeout(() => setToast(null), 5000);
        return;
      } catch (error) {
        setApiNotice(apiErrorMessage(error));
        return;
      }
    }

    setFallbackItems((current) => current.filter((item) => item.id !== selected.id));
    setToast({ handle: selected.handle });
    setTimeout(() => setToast(null), 5000);
  };

  const undo = () => setToast(null);

  return (
    <div className="min-h-screen flex bg-muted/30">
      <Sidebar activeLabel="Approval Queue" />
      <div className="flex-1 flex flex-col min-w-0">
        <DashHeader title="Approval Queue" />

        <main className="flex-1 p-6 md:p-8">
          {!activeBrandId && (
            <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              No active brand was found for this account.
            </div>
          )}
          {queueQuery.isLoading && (
            <div className="mb-5 rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
              Loading approval queue...
            </div>
          )}
          {queueQuery.error && (
            <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {apiErrorMessage(queueQuery.error)}
            </div>
          )}
          {apiNotice && (
            <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {apiNotice}
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)] gap-6">
            {/* Queue list */}
            <section>
              <div className="mb-5">
                <p className="text-5xl font-bold leading-none">{items.length}</p>
                <p className="text-muted-foreground mt-1">pending</p>
                <p className="text-sm mt-3">Lowest confidence first</p>
              </div>

              <div className="flex gap-2 mb-4">
                {SORTS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSort(s)}
                    className={`px-4 py-2 rounded-xl text-sm font-medium border transition ${
                      sort === s
                        ? "border-primary text-primary bg-primary/5"
                        : "border-border bg-card text-muted-foreground"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              <ul className="bg-card rounded-2xl shadow-sm divide-y overflow-hidden">
                {items.length === 0 && (
                  <li className="p-6 text-sm text-muted-foreground">
                    No replies are waiting for approval.
                  </li>
                )}
                {items.map((it) => {
                  const isSel = it.id === selectedId;
                  return (
                    <li
                      key={it.id}
                      onClick={() => setSelectedId(it.id)}
                      className={`p-4 cursor-pointer hover:bg-muted/50 border-l-4 ${
                        isSel ? "bg-indigo-50/60 border-primary" : "border-transparent"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <PlatformIcon p={it.platform} />
                        <span className="font-semibold text-sm flex-1">{it.handle}</span>
                        <span className="text-xs font-bold text-red-500">{it.confidence}%</span>
                        <span className="text-xs text-muted-foreground w-14 text-right">{it.ago}</span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{it.preview}</p>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* Detail panel */}
            <section className="bg-card rounded-2xl shadow-sm p-6 md:p-8 self-start">
              {!selected && (
                <div className="text-sm text-muted-foreground">
                  Select a reply from the queue to review it.
                </div>
              )}
              {selected && (
                <>
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2">
                      <PlatformIcon p={selected.platform} />
                      <span className="text-lg font-semibold">{selected.handle}</span>
                    </div>
                    <span className="bg-red-500 text-white text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1.5">
                      <Info className="size-3" /> {selected.category}
                    </span>
                  </div>

                  <p className="text-[11px] font-semibold tracking-wider text-muted-foreground mb-2">
                    ORIGINAL MESSAGE
                  </p>
                  <div className="bg-muted/40 rounded-xl p-4 text-sm leading-relaxed mb-3">
                    {selected.original}
                  </div>

                  <div className="flex gap-2 mb-6">
                    {selected.tags.map((t) => (
                      <span key={t.label} className={`text-xs font-semibold px-3 py-1 rounded-full ${t.cls}`}>
                        {t.label}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] font-semibold tracking-wider text-muted-foreground">
                      AI GENERATED REPLY
                    </p>
                    <span className="text-xs flex items-center gap-1.5 text-red-500 font-medium">
                      <span className="size-2 rounded-full bg-red-500" />
                      {selected.confidence}% confidence — low confidence
                    </span>
                  </div>

                  <div className="border rounded-xl p-4 mb-2 bg-muted/20">
                    <p className="text-sm text-muted-foreground leading-relaxed mb-3">{selected.reply}</p>
                    <textarea
                      value={draftText}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [selected.id]: e.target.value.slice(0, 100) }))
                      }
                      className="w-full text-sm bg-transparent outline-none resize-none min-h-[40px]"
                      placeholder=""
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs mb-6">
                    <span className="text-muted-foreground">
                      Edits apply only to this reply — they don't retrain the model.
                    </span>
                    <span className="text-muted-foreground">{draftText.length} / 100</span>
                  </div>

                  <button
                    onClick={approve}
                    disabled={approveMutation.isPending}
                    className="w-full bg-primary text-primary-foreground rounded-xl py-3.5 font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition mb-3 disabled:opacity-60"
                  >
                    <Check className="size-4" /> {approveMutation.isPending ? "Approving..." : "Approve & Send"}
                  </button>
                  <button className="w-full border border-red-300 text-red-500 rounded-xl py-3.5 font-semibold hover:bg-red-50 transition">
                    Reject
                  </button>

                  {toast && (
                    <div className="mt-5 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 flex items-center gap-3">
                      <span className="size-7 rounded-full bg-emerald-500 text-white flex items-center justify-center">
                        <Check className="size-4" />
                      </span>
                      <span className="flex-1 text-sm">
                        Reply to {toast.handle.replace("@", "@")} approved & sent.
                      </span>
                      <button onClick={undo} className="text-primary font-semibold text-sm">
                        Undo
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

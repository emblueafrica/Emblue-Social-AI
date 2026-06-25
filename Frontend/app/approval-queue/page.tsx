"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, Check, Paperclip, RefreshCw, X } from "lucide-react";
import { Sidebar, DashHeader } from "@/components/dashboard/Sidebar";
import { PlatformLogo } from "@/components/PlatformLogo";
import { useAuth } from "@/hooks/use-auth";
import {
  ApiError,
  approveQueueItem,
  markQueueItemSent,
  retryQueueItem,
  skipQueueItem,
  getApprovalQueue,
  uploadQueueMedia,
  type CampaignMedia,
  type ApprovalQueueItem,
} from "@/lib/api";
import { generateAiReplies, type AiReplySuggestion } from "@/lib/ai-reply-api";

type Platform = "instagram" | "x" | "tiktok" | "facebook";
type QueueItem = {
  id: number;
  queueKey: string;
  handle: string;
  platform: Platform;
  confidence: number;
  ago: string;
  preview: string;
  original: string;
  reply: string;
  tags: { label: string; cls: string }[];
  category: string;
  manualCopy: boolean;
  status?: string | null;
  channel?: ApprovalQueueItem["channel"];
};

const SORTS = ["Confidence", "Time in queue", "Platform"];
const TONES = ["Empathetic", "Solution-first", "Warm", "Professional", "Conversion", "Direct"];
const REPLY_FORMATS = [
  { id: "short", label: "Short" },
  { id: "helpful", label: "Helpful" },
  { id: "question", label: "Ask Question" },
  { id: "conversion", label: "Conversion" },
  { id: "de_escalation", label: "De-escalate" },
] as const;
type ReplyFormat = (typeof REPLY_FORMATS)[number]["id"];

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
    queueKey: item.queue_key ?? (item.queue_id ? `approval:${item.queue_id}` : `approval:${index}`),
    handle: author,
    platform: normalizePlatform(item.platform),
    confidence: item.manual_copy_required ? 50 : 72,
    ago: "Live",
    preview: item.reply.slice(0, 72) || item.delivery_error || "Reply waiting for review.",
    original: item.original,
    reply: item.reply,
    tags: [
      item.manual_copy_required
        ? { label: "Manual copy", cls: "bg-amber-100 text-amber-700" }
        : { label: "Ready to send", cls: "bg-emerald-100 text-emerald-700" },
      item.tracked_link
        ? { label: "Tracked link", cls: "bg-indigo-100 text-indigo-700" }
        : { label: item.channel === "direct_message" ? "DM" : "Reply", cls: "bg-pink-100 text-pink-700" },
      item.campaign_name
        ? { label: item.campaign_name, cls: "bg-slate-100 text-slate-700" }
        : { label: "General", cls: "bg-slate-100 text-slate-700" },
    ],
    category,
    manualCopy: Boolean(item.manual_copy_required),
    status: item.status,
    channel: item.channel,
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
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [tone, setTone] = useState("Empathetic");
  const [replyFormat, setReplyFormat] = useState<ReplyFormat>("helpful");
  const [attachments, setAttachments] = useState<Record<string, CampaignMedia[]>>({});
  const [toast, setToast] = useState<{ handle: string } | null>(null);
  const [apiNotice, setApiNotice] = useState<string | null>(null);

  const queueQuery = useQuery({
    queryKey: ["approval-queue", activeBrandId],
    queryFn: () => getApprovalQueue(activeBrandId!),
    enabled: Boolean(activeBrandId),
    staleTime: 10_000,
  });

  const items = queueQuery.data?.queue.map(mapApprovalItem) ?? [];
  const selected = items.find((i) => i.id === selectedId);
  const selectedAttachments = selected ? attachments[selected.queueKey] ?? [] : [];
  const draftText = selected ? drafts[selected.queueKey] ?? "" : "";

  const replyMutation = useMutation({
    mutationFn: generateAiReplies,
    onSuccess: (result) => {
      const suggestion: AiReplySuggestion | null = result.replies?.[0] ?? result.suggestions?.[0] ?? null;
      if (!selected || !suggestion) {
        setApiNotice(result.error ?? "The backend did not return a reply suggestion.");
        return;
      }
      const text = suggestion.text ?? suggestion.reply_text ?? "";
      setDrafts((current) => ({ ...current, [selected.queueKey]: text }));
      setTone(suggestion.tone || tone);
      setApiNotice("Draft regenerated from the backend AI Reply Engine.");
    },
    onError: (error) => setApiNotice(apiErrorMessage(error)),
  });

  const mediaMutation = useMutation({
    mutationFn: ({ brandId, files }: { brandId: number; files: File[] }) => uploadQueueMedia(brandId, files),
    onSuccess: (result) => {
      if (!selected) return;
      setAttachments((current) => ({
        ...current,
        [selected.queueKey]: [...(current[selected.queueKey] ?? []), ...result.media].slice(0, 4),
      }));
      setApiNotice("Media attached to this reply.");
    },
    onError: (error) => setApiNotice(apiErrorMessage(error)),
  });

  const approveMutation = useMutation({
    mutationFn: ({ brandId, queueKey, replyText, media }: { brandId: number; queueKey: string; replyText?: string; media?: CampaignMedia[] }) =>
      approveQueueItem(brandId, queueKey, replyText, {
        media,
        image_url: media?.find((item) => item.media_type === "image")?.url,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["approval-queue", activeBrandId] });
    },
  });
  const markSentMutation = useMutation({
    mutationFn: ({ brandId, queueKey }: { brandId: number; queueKey: string }) => markQueueItemSent(brandId, queueKey),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["approval-queue", activeBrandId] }),
  });
  const retryMutation = useMutation({
    mutationFn: ({ brandId, queueKey }: { brandId: number; queueKey: string }) => retryQueueItem(brandId, queueKey),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["approval-queue", activeBrandId] }),
  });
  const rejectMutation = useMutation({
    mutationFn: ({ brandId, queueKey }: { brandId: number; queueKey: string }) => skipQueueItem(brandId, queueKey),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["approval-queue", activeBrandId] }),
  });

  useEffect(() => {
    if (!items.length) {
      setSelectedId(null);
      return;
    }
    if (selectedId === null || !items.some((item) => item.id === selectedId)) {
      setSelectedId(items[0]?.id ?? null);
    }
  }, [items, selectedId]);

  const approve = async () => {
    if (!selected) return;
    setApiNotice(null);

    if (activeBrandId && queueQuery.data) {
      try {
        await approveMutation.mutateAsync({
          brandId: activeBrandId,
          queueKey: selected.queueKey,
          replyText: draftText.trim() || selected.reply,
          media: selectedAttachments,
        });
        setToast({ handle: selected.handle });
        setTimeout(() => setToast(null), 5000);
        return;
      } catch (error) {
        setApiNotice(apiErrorMessage(error));
        return;
      }
    }

  };

  const undo = () => setToast(null);
  const markSelectedSent = async () => {
    if (!selected || !activeBrandId) return;
    setApiNotice(null);
    try {
      await markSentMutation.mutateAsync({ brandId: activeBrandId, queueKey: selected.queueKey });
      setToast({ handle: selected.handle });
      setTimeout(() => setToast(null), 5000);
    } catch (error) {
      setApiNotice(apiErrorMessage(error));
    }
  };
  const retrySelected = async () => {
    if (!selected || !activeBrandId) return;
    setApiNotice(null);
    try {
      await retryMutation.mutateAsync({ brandId: activeBrandId, queueKey: selected.queueKey });
    } catch (error) {
      setApiNotice(apiErrorMessage(error));
    }
  };
  const rejectSelected = async () => {
    if (!selected || !activeBrandId) return;
    setApiNotice(null);
    try {
      await rejectMutation.mutateAsync({ brandId: activeBrandId, queueKey: selected.queueKey });
    } catch (error) {
      setApiNotice(apiErrorMessage(error));
    }
  };

  const generateDraft = () => {
    if (!selected || !activeBrandId) return;
    setApiNotice(null);
    replyMutation.mutate({
      brand_id: activeBrandId,
      message: selected.original,
      platform: selected.platform,
      tone,
      reply_format: replyFormat,
      variation_seed: `${selected.queueKey}:${tone}:${replyFormat}:${Date.now()}`,
      campaign_context: {
        name: selected.category,
        objective: `prepare a ${replyFormat.replaceAll("_", " ")} approval queue response`,
      },
      ruleset: {
        tone,
        do_not_say: ["internal policy", "AI generated"],
      },
      author_handle: selected.handle,
      reply_channel: selected.channel === "direct_message" ? "dm" : selected.platform === "x" ? "thread_reply" : "comment_reply",
    });
  };

  const attachFiles = (files: FileList | null) => {
    if (!files?.length || !activeBrandId || !selected) return;
    setApiNotice(null);
    mediaMutation.mutate({ brandId: activeBrandId, files: Array.from(files).slice(0, 4) });
  };

  const removeAttachment = (queueKey: string, publicId: string) => {
    setAttachments((current) => ({
      ...current,
      [queueKey]: (current[queueKey] ?? []).filter((item) => item.public_id !== publicId),
    }));
  };

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
                  {selected.status && (
                    <p className="text-xs text-muted-foreground mb-3">Status: {selected.status.replaceAll("_", " ")}</p>
                  )}

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
                      {selected.confidence}% confidence - low confidence
                    </span>
                  </div>

                  <div className="border rounded-xl p-4 mb-2 bg-muted/20">
                    <p className="text-sm text-muted-foreground leading-relaxed mb-3">{selected.reply}</p>
                    <textarea
                      value={draftText}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [selected.queueKey]: e.target.value.slice(0, 500) }))
                      }
                      className="w-full text-sm bg-transparent outline-none resize-none min-h-[40px]"
                      placeholder="Edit or generate a reply"
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs mb-6">
                    <span className="text-muted-foreground">
                      Edits apply only to this reply - they do not retrain the model.
                    </span>
                    <span className="text-muted-foreground">{draftText.length} / 500</span>
                  </div>

                  <p className="text-[11px] font-semibold tracking-wider text-muted-foreground mb-3">GENERATE RESPONSE</p>
                  <div className="grid grid-cols-2 gap-2 mb-3 md:grid-cols-3">
                    {TONES.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setTone(item)}
                        className={`rounded-full border px-3 py-2 text-xs font-medium transition ${tone === item ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {REPLY_FORMATS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setReplyFormat(item.id)}
                        className={`rounded-full border px-3 py-2 text-xs font-medium transition ${replyFormat === item.id ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={generateDraft}
                    disabled={replyMutation.isPending || !activeBrandId}
                    className="mb-6 w-full rounded-xl border border-primary py-3 font-semibold text-primary transition hover:bg-primary/5 disabled:opacity-60"
                  >
                    <span className="inline-flex items-center justify-center gap-2">
                      <RefreshCw className={`size-4 ${replyMutation.isPending ? "animate-spin" : ""}`} />
                      {replyMutation.isPending ? "Generating..." : "Generate with Tone"}
                    </span>
                  </button>

                  <div className="mb-6 rounded-xl border border-dashed p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold">Optional media</p>
                        <p className="text-xs text-muted-foreground">Attach images or one video where the platform supports it.</p>
                      </div>
                      <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/5">
                        <Paperclip className="size-4" />
                        {mediaMutation.isPending ? "Uploading..." : "Upload"}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                          multiple
                          className="sr-only"
                          onChange={(event) => {
                            attachFiles(event.target.files);
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                    </div>
                    {selectedAttachments.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedAttachments.map((item) => (
                          <span key={item.public_id} className="inline-flex max-w-full items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs">
                            <span className="truncate">{item.media_type} - {item.mime_type}</span>
                            <button type="button" onClick={() => removeAttachment(selected.queueKey, item.public_id)} className="rounded-full p-0.5 hover:bg-background" title="Remove attachment">
                              <X className="size-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={approve}
                    disabled={approveMutation.isPending}
                    className="w-full bg-primary text-primary-foreground rounded-xl py-3.5 font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition mb-3 disabled:opacity-60"
                  >
                    <Check className="size-4" /> {approveMutation.isPending ? "Approving..." : "Approve & Send"}
                  </button>
                  {selected.manualCopy && (
                    <button
                      onClick={markSelectedSent}
                      disabled={markSentMutation.isPending}
                      className="w-full border border-emerald-300 text-emerald-600 rounded-xl py-3.5 font-semibold hover:bg-emerald-50 transition mb-3 disabled:opacity-60"
                    >
                      {markSentMutation.isPending ? "Marking..." : "Mark Manual Send Complete"}
                    </button>
                  )}
                  {selected.status === "failed" || selected.status === "rate_limited" ? (
                    <button
                      onClick={retrySelected}
                      disabled={retryMutation.isPending}
                      className="w-full border border-amber-300 text-amber-600 rounded-xl py-3.5 font-semibold hover:bg-amber-50 transition mb-3 disabled:opacity-60"
                    >
                      {retryMutation.isPending ? "Retrying..." : "Retry"}
                    </button>
                  ) : null}
                  <button onClick={rejectSelected} disabled={rejectMutation.isPending} className="w-full border border-red-300 text-red-500 rounded-xl py-3.5 font-semibold hover:bg-red-50 transition disabled:opacity-60">
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

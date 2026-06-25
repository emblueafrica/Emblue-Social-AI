"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertOctagon,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Paperclip,
  RefreshCw,
  X,
} from "lucide-react";
import { Sidebar, DashHeader } from "@/components/dashboard/Sidebar";
import { PlatformLogo } from "@/components/PlatformLogo";
import { useAuth } from "@/hooks/use-auth";
import { ApiError, getToolAccess, uploadQueueMedia, type ApprovalQueueItem, type CampaignMedia } from "@/lib/api";
import {
  approveAiReplyQueueItem,
  generateAiReplies,
  getAiReplyQueue,
  skipAiReplyQueueItem,
  type AiReplyPlatform,
  type AiReplySuggestion,
} from "@/lib/ai-reply-api";

type Platform = "instagram" | "facebook" | "x" | "tiktok" | "linkedin";
type BackendPagePlatform = Extract<Platform, AiReplyPlatform>;
type Sentiment = "Negative" | "Postive" | "Neutral";
type Status = "pending";
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
  original?: string;
  reply?: string;
  confidence?: number;
  queueId?: number | string;
};

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

const TONES = ["Empathetic", "Solution-first", "Warm", "Professional", "Conversion", "Direct"];
const REPLY_FORMATS = [
  { id: "short", label: "Short" },
  { id: "helpful", label: "Helpful" },
  { id: "question", label: "Ask Question" },
  { id: "conversion", label: "Conversion" },
  { id: "de_escalation", label: "De-escalate" },
] as const;
type ReplyFormat = (typeof REPLY_FORMATS)[number]["id"];
const PAGE_SIZE = 10;

function PlatformIcon({ p, className = "size-4" }: { p: Platform; className?: string }) {
  return <PlatformLogo platform={p} size={16} className={className} />;
}

function apiErrorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "AI reply request failed.";
}

function isBackendPlatform(platform: Platform): platform is BackendPagePlatform {
  return platform === "instagram" || platform === "facebook" || platform === "x" || platform === "tiktok";
}

function replyChannel(platform: AiReplyPlatform) {
  if (platform === "x") return "thread_reply" as const;
  if (platform === "tiktok") return "comment_reply" as const;
  return "dm" as const;
}

function firstSuggestion(result: { replies?: AiReplySuggestion[]; suggestions?: AiReplySuggestion[] }) {
  return result.replies?.[0] ?? result.suggestions?.[0] ?? null;
}

function mapQueueItem(item: ApprovalQueueItem, index: number): Message {
  const author = item.author.startsWith("@") ? item.author : `@${item.author}`;
  const platform = isBackendPlatform(item.platform as Platform) ? (item.platform as BackendPagePlatform) : "x";
  const confidence = item.manual_copy_required ? 50 : 80;

  return {
    id: item.queue_id ?? index + 1,
    user: author,
    platform,
    preview: item.original.slice(0, 96) || item.reply.slice(0, 96),
    sentiment: item.manual_copy_required ? "Neutral" : "Postive",
    tag: item.delivery_error || item.manual_copy_required ? "Manual Review" : "Approval Queue",
    status: "pending",
    ago: "Live",
    urgency: item.manual_copy_required ? "yellow" : "red",
    original: item.delivery_error ? `${item.original}\n\nLast delivery error: ${item.delivery_error}` : item.original,
    reply: item.reply,
    confidence,
    queueId: item.queue_key ?? item.queue_id,
  };
}

export default function AIReplyEngine() {
  const queryClient = useQueryClient();
  const { activeBrandId } = useAuth();
  const [platforms, setPlatforms] = useState<Record<Platform, boolean>>({
    instagram: true,
    facebook: true,
    x: true,
    tiktok: true,
    linkedin: false,
  });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tone, setTone] = useState<string>("Empathetic");
  const [replyFormat, setReplyFormat] = useState<ReplyFormat>("helpful");
  const [toast, setToast] = useState<null | { kind: "approved" | "skipped" }>(null);
  const [generatedDrafts, setGeneratedDrafts] = useState<Record<number, AiReplySuggestion>>({});
  const [attachments, setAttachments] = useState<Record<number, CampaignMedia[]>>({});
  const [apiNotice, setApiNotice] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const accessQuery = useQuery({
    queryKey: ["tool-access", activeBrandId],
    queryFn: getToolAccess,
    enabled: Boolean(activeBrandId),
    retry: false,
    refetchInterval: 15000,
  });

  const queueQuery = useQuery({
    queryKey: ["ai-reply-queue", activeBrandId],
    queryFn: () => getAiReplyQueue(activeBrandId!),
    enabled: Boolean(activeBrandId),
    retry: false,
    refetchInterval: 15000,
  });

  const queueMessages = useMemo(() => queueQuery.data?.queue.map(mapQueueItem) ?? [], [queueQuery.data?.queue]);
  const visible = useMemo(() => queueMessages.filter((message) => platforms[message.platform]), [platforms, queueMessages]);
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, visible.length);
  const pageMessages = useMemo(() => visible.slice(pageStart, pageStart + PAGE_SIZE), [pageStart, visible]);
  const selected = visible.find((message) => message.id === selectedId) ?? null;
  const selectedAttachments = selected ? attachments[selected.id] ?? [] : [];

  const replyMutation = useMutation({
    mutationFn: generateAiReplies,
    onSuccess: (result) => {
      const suggestion = firstSuggestion(result);
      if (!selectedId || !suggestion) {
        setApiNotice(result.error ?? "The backend did not return a reply suggestion.");
        return;
      }
      setGeneratedDrafts((current) => ({ ...current, [selectedId]: suggestion }));
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
        [selected.id]: [...(current[selected.id] ?? []), ...result.media].slice(0, 4),
      }));
      setApiNotice("Media attached to this reply.");
    },
    onError: (error) => setApiNotice(apiErrorMessage(error)),
  });

  const approveMutation = useMutation({
    mutationFn: ({ queueId, replyText, media }: { queueId: number | string; replyText: string; media?: CampaignMedia[] }) =>
      approveAiReplyQueueItem(activeBrandId!, queueId, replyText, {
        media,
        image_url: media?.find((item) => item.media_type === "image")?.url,
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["ai-reply-queue", activeBrandId] });
      if (result.publish?.success === false) {
        setApiNotice(`Publishing failed; this item remains pending: ${result.publish.error ?? "platform publish failed"}`);
      } else {
        setToast({ kind: "approved" });
        setApiNotice("Reply approved and sent.");
        setTimeout(() => setToast(null), 2500);
      }
    },
    onError: (error) => setApiNotice(apiErrorMessage(error)),
  });

  const skipMutation = useMutation({
    mutationFn: (queueId: number | string) => skipAiReplyQueueItem(activeBrandId!, queueId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["ai-reply-queue", activeBrandId] });
      setToast({ kind: "skipped" });
      setApiNotice("Message skipped.");
      setTimeout(() => setToast(null), 2500);
    },
    onError: (error) => setApiNotice(apiErrorMessage(error)),
  });

  const generatedDraft = selected ? generatedDrafts[selected.id] : undefined;
  const draftBody = generatedDraft?.text ?? generatedDraft?.reply_text ?? selected?.reply ?? "";
  const draftTone = generatedDraft?.tone ?? tone;
  const campaignTags = Array.from(new Set(queueMessages.map((message) => message.tag))).sort();
  const manualReviewCount = queueMessages.filter((message) => message.tag === "Manual Review").length;
  const activePlatformCount = new Set(queueMessages.map((message) => message.platform)).size;
  const queueCount = queueMessages.length;
  const generatedDraftCount = queueMessages.filter((message) => Boolean(message.reply?.trim())).length;
  const lockedError =
    (accessQuery.error instanceof ApiError && accessQuery.error.status === 403 ? accessQuery.error : null) ||
    (replyMutation.error instanceof ApiError && replyMutation.error.status === 403 ? replyMutation.error : null);
  const hasReplyTool = accessQuery.data ? accessQuery.data.enabled.includes("tool_3") : true;
  const backendDraftAvailable = Boolean(activeBrandId && hasReplyTool && selected && isBackendPlatform(selected.platform));

  useEffect(() => {
    if (!pageMessages.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !pageMessages.some((message) => message.id === selectedId)) {
      setSelectedId(pageMessages[0].id);
    }
  }, [pageMessages, selectedId]);

  useEffect(() => {
    setCurrentPage(1);
  }, [platforms.instagram, platforms.facebook, platforms.x, platforms.tiktok]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const togglePlatform = (platform: Platform) => {
    setPlatforms((state) => ({ ...state, [platform]: !state[platform] }));
  };

  const regenerateDraft = () => {
    if (!selected || !activeBrandId) {
      setApiNotice("Connect this account to a brand workspace before generating a new draft.");
      return;
    }
    if (!isBackendPlatform(selected.platform)) {
      setApiNotice("Draft generation is not available for this platform yet.");
      return;
    }

    setApiNotice(null);
    replyMutation.mutate({
      brand_id: activeBrandId,
      message: selected.original || selected.preview,
        platform: selected.platform,
        tone,
        reply_format: replyFormat,
        variation_seed: `${selected.queueId ?? selected.id}:${tone}:${replyFormat}:${Date.now()}`,
        campaign_context: {
          name: selected.tag,
          objective: `respond to social comments quickly and helpfully using a ${replyFormat.replaceAll("_", " ")} reply format`,
        },
        ruleset: {
          tone,
        do_not_say: ["internal policy", "AI generated"],
      },
      author_handle: selected.user,
      reply_channel: replyChannel(selected.platform),
    });
  };

  const approveSelected = () => {
    if (!selected || selected.queueId === undefined || !activeBrandId || !queueQuery.data) {
      setApiNotice("This queue item is not linked to the backend approval flow.");
      return;
    }
    approveMutation.mutate({ queueId: selected.queueId, replyText: draftBody, media: selectedAttachments });
  };

  const skipSelected = () => {
    if (!selected || selected.queueId === undefined || !activeBrandId || !queueQuery.data) {
      setApiNotice("This queue item is not linked to the backend skip flow.");
      return;
    }
    skipMutation.mutate(selected.queueId);
  };

  const attachFiles = (files: FileList | null) => {
    if (!files?.length || !activeBrandId || !selected) return;
    setApiNotice(null);
    mediaMutation.mutate({ brandId: activeBrandId, files: Array.from(files).slice(0, 4) });
  };

  const removeAttachment = (messageId: number, publicId: string) => {
    setAttachments((current) => ({
      ...current,
      [messageId]: (current[messageId] ?? []).filter((item) => item.public_id !== publicId),
    }));
  };

  return (
    <div className="min-h-screen flex bg-muted/30">
      <Sidebar activeLabel="AI Reply Engine" />
      <div className="flex-1 flex flex-col min-w-0">
        <DashHeader title="AI Reply Engine" />

        <main className="flex-1 p-6 md:p-8 space-y-6 text-safe layout-safe">
          {!activeBrandId && (
            <Notice tone="warning" title="No active brand workspace">
              Live replies will appear after this account is attached to an approved brand workspace.
            </Notice>
          )}
          {accessQuery.isLoading && <Notice title="Checking AI Reply Engine access">Loading backend access for this workspace...</Notice>}
          {queueQuery.isLoading && <Notice title="Loading reply queue">Fetching replies that need review.</Notice>}
          {lockedError && <Notice tone="warning" title="AI Reply Engine access is locked">{lockedError.message}</Notice>}
          {accessQuery.data && !hasReplyTool && (
            <Notice tone="warning" title="AI Reply Engine is not enabled">
              Reply generation is not enabled for this brand.
            </Notice>
          )}
          {accessQuery.error && !lockedError && <Notice tone="error" title="Backend access check failed">{apiErrorMessage(accessQuery.error)}</Notice>}
          {queueQuery.error && !(queueQuery.error instanceof ApiError && queueQuery.error.status === 403) && (
            <Notice tone="error" title="Reply queue unavailable">{apiErrorMessage(queueQuery.error)}</Notice>
          )}
          {queueQuery.data && queueMessages.length === 0 && <Notice title="No replies waiting">New non-campaign comments, mentions, and messages will appear here for review.</Notice>}
          {apiNotice && <Notice tone={replyMutation.isError ? "error" : "info"} title="AI Reply Engine">{apiNotice}</Notice>}

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Kpi color="bg-primary" label="Queue" value={String(queueCount)} sub="Messages waiting for review" />
            <Kpi color="bg-brand-pink" label="Manual Review" value={String(manualReviewCount)} sub="Requires closer review" />
            <Kpi color="bg-brand-olive" label="Generated Drafts" value={String(generatedDraftCount)} sub="Drafts stored in queue" />
            <Kpi color="bg-destructive" label="Active Platforms" value={String(activePlatformCount)} sub="Platforms represented in queue" />
          </div>

          <div className="grid grid-cols-1 2xl:grid-cols-[240px_minmax(0,1fr)_340px] gap-5">
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
                <Check2 label="TikTok" checked={platforms.tiktok} onChange={() => togglePlatform("tiktok")} />
              </FilterCard>

              <FilterCard title="CONTEXT">
                {campaignTags.length ? campaignTags.map((tag) => <Check2 key={tag} label={tag} checked />) : <p className="text-sm text-muted-foreground">No context tags in queue.</p>}
              </FilterCard>
            </aside>

            <section className="bg-card rounded-2xl shadow-sm overflow-hidden flex flex-col min-w-0">
              <div className="flex items-center justify-between px-5 py-4 border-b">
                <label className="flex items-center gap-3 text-sm">
                  <input type="checkbox" className="size-4 rounded" />
                  Select all
                </label>
                <span className="text-sm font-semibold">
                  {visible.length ? `${pageStart + 1}-${pageEnd} of ${visible.length} messages` : "0 messages"}
                </span>
              </div>

              {visible.length ? (
                <ul className="divide-y">
                  {pageMessages.map((message) => {
                    const isSelected = selectedId === message.id;
                    return (
                      <li
                        key={message.id}
                        onClick={() => {
                          setSelectedId(message.id);
                          setTone("Empathetic");
                          setReplyFormat("helpful");
                        }}
                        className={`flex items-center gap-3 px-5 py-3.5 text-sm cursor-pointer hover:bg-muted/60 ${isSelected ? "bg-muted/50" : ""}`}
                      >
                        <input type="checkbox" className="size-4 rounded shrink-0" onClick={(event) => event.stopPropagation()} />
                        <span className={`size-2 rounded-full shrink-0 ${urgencyDot[message.urgency]}`} />
                        <PlatformIcon p={message.platform} className="size-4 shrink-0" />
                        <span className="font-medium shrink-0 w-[110px] truncate">{message.user}</span>
                        <span className="text-muted-foreground truncate flex-1 min-w-0">{message.preview}</span>
                        <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full shrink-0 whitespace-nowrap ${sentimentClass[message.sentiment]}`}>
                          {message.confidence ? `${message.confidence}%` : message.sentiment}
                        </span>
                        <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full shrink-0 whitespace-nowrap bg-amber-50 text-amber-700">{message.tag}</span>
                        <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full shrink-0 whitespace-nowrap bg-yellow-100 text-yellow-700">{message.status}</span>
                        <span className="text-xs text-muted-foreground w-14 text-right shrink-0">{message.ago}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="p-8 text-sm text-muted-foreground">No queue items match the selected filters.</div>
              )}

              <div className="flex items-center justify-center gap-4 px-5 py-5 text-sm border-t mt-auto relative">
                {toast && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 -translate-y-full bg-indigo-50 border border-indigo-100 rounded-xl shadow-sm px-4 py-3 flex items-center gap-3 text-sm w-[360px]">
                    <span className="size-7 rounded-full bg-emerald-500 text-white flex items-center justify-center">
                      <Check className="size-4" />
                    </span>
                    <span className="flex-1 text-safe">{toast.kind === "approved" ? <>Reply approved <br />and queued for sending.</> : "Message skipped."}</span>
                    <button onClick={() => setToast(null)} className="text-primary font-semibold">Dismiss</button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={safePage <= 1}
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <ChevronLeft className="size-4" /> Prev
                </button>
                <span className="flex items-center gap-1 px-3 py-1.5 rounded-md border">
                  {safePage} <ChevronDown className="size-3" />
                </span>
                <span className="text-muted-foreground">of {totalPages}</span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  disabled={safePage >= totalPages || !visible.length}
                  className="flex items-center gap-1 hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Next <ChevronRight className="size-4" />
                </button>
              </div>
            </section>

            <aside className="bg-card rounded-2xl shadow-sm p-5 flex flex-col min-w-0">
              {!selected ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center py-16 text-muted-foreground">
                  <FileText className="size-12 mb-4" strokeWidth={1.4} />
                  <p className="font-semibold">No message selected</p>
                  <p className="text-sm">Select a queue item to review the AI draft.</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="size-10 rounded-full bg-muted flex items-center justify-center font-semibold text-xs">{selected.user.replace("@", "").slice(0, 2).toUpperCase()}</div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{selected.user}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1"><PlatformIcon p={selected.platform} className="size-3" />{selected.tag} | {selected.ago}</p>
                    </div>
                    <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-600">Immediate</span>
                  </div>

                  <div className="bg-muted/40 rounded-xl p-4 text-sm leading-relaxed mb-3 text-safe">{selected.original || selected.preview}</div>

                  <div className="flex gap-2 mb-5">
                    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${sentimentClass[selected.sentiment]}`}>{selected.sentiment}</span>
                    <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">{selected.tag}</span>
                  </div>

                  <div className="flex items-center gap-2 mb-3">
                    <div className="size-8 rounded-md bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">AI</div>
                    <div>
                      <p className="text-sm font-semibold text-primary">Backend AI Reply Engine</p>
                      <p className="text-xs text-muted-foreground">Tone: {draftTone}</p>
                    </div>
                  </div>

                  <div className="border rounded-xl p-4 text-sm leading-relaxed mb-2 max-h-44 overflow-auto text-safe">{draftBody || "No backend draft returned yet."}</div>
                  <div className="flex items-center justify-between text-xs mb-5">
                    <button onClick={regenerateDraft} disabled={!backendDraftAvailable || replyMutation.isPending} className="flex items-center gap-1 text-primary font-semibold disabled:text-muted-foreground disabled:cursor-not-allowed">
                      <RefreshCw className={`size-3 ${replyMutation.isPending ? "animate-spin" : ""}`} />
                      {replyMutation.isPending ? "Regenerating..." : "Regenerate draft"}
                    </button>
                    <span className="text-muted-foreground">{draftBody.length} chars</span>
                  </div>

                  <p className="text-[11px] font-semibold tracking-wider text-muted-foreground mb-3">REGENERATE WITH TONE</p>
                  <div className="grid grid-cols-3 gap-2 mb-6">
                    {TONES.map((item) => (
                      <button key={item} onClick={() => setTone(item)} className={`text-xs py-2 rounded-full border transition ${tone === item ? "border-primary text-primary bg-primary/5" : "border-border text-muted-foreground hover:border-primary/40"}`}>
                        {item}
                      </button>
                    ))}
                  </div>

                  <p className="text-[11px] font-semibold tracking-wider text-muted-foreground mb-3">REPLY FORMAT</p>
                  <div className="grid grid-cols-2 gap-2 mb-6">
                    {REPLY_FORMATS.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => setReplyFormat(item.id)}
                        className={`text-xs py-2 rounded-full border transition ${replyFormat === item.id ? "border-primary text-primary bg-primary/5" : "border-border text-muted-foreground hover:border-primary/40"}`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={regenerateDraft}
                    disabled={!backendDraftAvailable || replyMutation.isPending}
                    className="mb-3 w-full border border-primary text-primary rounded-xl py-3 font-semibold flex items-center justify-center gap-2 hover:bg-primary/5 transition disabled:opacity-60"
                  >
                    <RefreshCw className={`size-4 ${replyMutation.isPending ? "animate-spin" : ""}`} />
                    {replyMutation.isPending ? "Generating..." : "Generate with Tone"}
                  </button>

                  <div className="mb-4 rounded-xl border border-dashed p-4">
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
                            <button type="button" onClick={() => removeAttachment(selected.id, item.public_id)} className="rounded-full p-0.5 hover:bg-background" title="Remove attachment">
                              <X className="size-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <button onClick={approveSelected} disabled={approveMutation.isPending || skipMutation.isPending || !draftBody} className="w-full bg-primary text-primary-foreground rounded-xl py-3 font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition disabled:opacity-60">
                    <Check className="size-4" /> {approveMutation.isPending ? "Sending..." : "Approve & Send"}
                  </button>
                  <button onClick={skipSelected} disabled={approveMutation.isPending || skipMutation.isPending} className="w-full text-center py-3 text-sm font-semibold hover:text-primary disabled:opacity-60">
                    {skipMutation.isPending ? "Skipping..." : "Skip"}
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

function Notice({
  title,
  children,
  tone = "info",
}: {
  title: string;
  children: React.ReactNode;
  tone?: "info" | "warning" | "error";
}) {
  const cls =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-border bg-card text-foreground";

  return (
    <section className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm opacity-90">{children}</p>
    </section>
  );
}

function Kpi({ color, label, value, sub }: { color: string; label: string; value: string; sub: string }) {
  return (
    <div className="bg-card rounded-2xl p-5 shadow-sm relative overflow-hidden">
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${color}`} />
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-3xl font-bold mt-2">{value}</p>
      <p className="text-xs mt-2 text-muted-foreground">{sub}</p>
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
  return <div className={`flex items-center gap-2 text-sm py-1 ${active ? "text-foreground font-semibold" : "text-muted-foreground"}`}>{icon}<span>{label}</span></div>;
}

function Check2({ label, checked, onChange }: { label: string; checked?: boolean; onChange?: () => void }) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <span onClick={onChange} className={`size-4 rounded border flex items-center justify-center ${checked ? "bg-primary border-primary text-white" : "border-border bg-card"}`}>
        {checked && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span>{label}</span>
    </label>
  );
}

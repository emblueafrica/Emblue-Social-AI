import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, FileUp, Pause, Trash2, X } from "lucide-react";
import { PlatformLogo } from "@/components/PlatformLogo";
import {
  uploadCampaignMedia,
  type CampaignEventSettings,
  type CampaignMedia,
} from "@/lib/api";

export type Platform = "instagram" | "facebook" | "tiktok" | "x";
export type CampaignDraft = {
  name: string;
  platforms: Platform[];
  sourceMode: "publish_new" | "existing" | "keyword" | "live";
  priority: number;
  liveScope: "all_owned_posts" | "selected_posts";
  replyMode: "public" | "dm_with_public_fallback" | "dm_only";
  postCaption: string;
  existingPosts: Partial<Record<Platform, string>>;
  media: CampaignMedia[];
  keywords: string[];
  tone: string;
  maxPerHour: number;
  maxPerDay: number;
  maxDmPerDay: number;
  spacingMinutes: number;
  intentFilter: string[];
  urgencyThreshold: number;
  replyTemplateId: number | null;
  publicReplyEnabled: boolean;
  directMessageEnabled: boolean;
  template: string;
  privateTemplate: string;
  ctaLink: string;
  imageUrl: string;
  threshold: number;
  events: CampaignEventSettings;
  allocation: Record<Platform, number>;
  campaignType: "brand_mention" | "competitor_complaint" | "category_intent";
  minFollowers: number;
  skipVerified: boolean;
  skipReposts: boolean;
  skipNewAccountsDays: number;
};

const PLATFORM_OPTIONS: { id: Platform; label: string }[] = [
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "tiktok", label: "TikTok" },
  { id: "x", label: "X / Twitter" },
];
const TONES = [
  "Patriotic and inspiring",
  "Warm and friendly",
  "Bold and confident",
  "Playful and witty",
  "Urgent and exclusive",
  "Empathetic and supportive",
  "Professional and authoritative",
  "Energetic and hype",
  "Luxury and aspirational",
  "Casual and relatable",
  "Educational and informative",
];
const INTENTS: [string, string][] = [
  ["complaint", "Complaint"],
  ["purchase_intent", "Purchase Intent"],
  ["opinion", "Opinion"],
  ["other", "Other"],
];
const DEFAULT_EVENTS: CampaignEventSettings = {
  comments: true,
  likes: true,
  reposts: true,
  mentions: true,
  dms: true,
};
const EMPTY_ALLOCATION: Record<Platform, number> = {
  instagram: 0,
  facebook: 0,
  tiktok: 0,
  x: 0,
};

function blankDraft(): CampaignDraft {
  return {
    name: "",
    platforms: ["instagram", "facebook", "tiktok", "x"],
    sourceMode: "existing",
    priority: 0,
    liveScope: "all_owned_posts",
    replyMode: "dm_with_public_fallback",
    postCaption: "",
    existingPosts: {},
    media: [],
    keywords: [],
    tone: "Warm and friendly",
    maxPerHour: 10,
    maxPerDay: 50,
    maxDmPerDay: 25,
    spacingMinutes: 10,
    intentFilter: ["complaint", "purchase_intent"],
    urgencyThreshold: 3,
    replyTemplateId: null,
    publicReplyEnabled: true,
    directMessageEnabled: true,
    template:
      "Hey {{handle}}! Thanks for engaging with our post. Here's something special for you: {{link}}",
    privateTemplate:
      "Hey {{handle}}! Here is the information you requested: {{link}}",
    ctaLink: "",
    imageUrl: "",
    threshold: 85,
    events: DEFAULT_EVENTS,
    allocation: { instagram: 50, facebook: 30, tiktok: 20, x: 0 },
    campaignType: "brand_mention",
    minFollowers: 0,
    skipVerified: false,
    skipReposts: true,
    skipNewAccountsDays: 0,
  };
}

export function NewCampaignModal({
  open,
  brandId,
  initial,
  initialMode,
  saving,
  errorMessage,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  brandId: number | null;
  initial?: CampaignDraft;
  initialMode?: "live" | "existing" | "keyword";
  saving?: boolean;
  errorMessage?: string | null;
  onClose: () => void;
  onSave: (
    campaign: CampaignDraft,
    status: "draft" | "active",
  ) => void | Promise<void>;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState<CampaignDraft>(blankDraft);
  const [keywordInput, setKeywordInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const value = initial
      ? {
          ...blankDraft(),
          ...initial,
          events: { ...DEFAULT_EVENTS, ...initial.events },
          allocation: { ...EMPTY_ALLOCATION, ...initial.allocation },
        }
      : { ...blankDraft(), sourceMode: initialMode ?? "existing" };
    setDraft({
      ...value,
      sourceMode: value.sourceMode === "keyword" ? "keyword" : "existing",
    });
    setKeywordInput("");
    setError(null);
    setShowPreview(false);
  }, [open, initial, initialMode]);

  const selectedPlatforms = draft.platforms;
  const allocationTotal = selectedPlatforms.reduce(
    (sum, platform) => sum + Number(draft.allocation[platform] ?? 0),
    0,
  );
  const formValid = useMemo(() => {
    if (!draft.name.trim() || !selectedPlatforms.length) return false;
    if (draft.sourceMode === "keyword") {
      return Boolean(
        draft.keywords.length &&
        draft.intentFilter.length &&
        draft.maxPerDay > 0 &&
        (draft.publicReplyEnabled || draft.directMessageEnabled),
      );
    }
    if (draft.sourceMode === "live") {
      return Boolean(
        (draft.liveScope === "all_owned_posts" ||
          selectedPlatforms.every((platform) =>
            draft.existingPosts[platform]?.trim(),
          )) &&
        (draft.publicReplyEnabled || draft.directMessageEnabled) &&
        draft.maxPerHour > 0 &&
        draft.maxPerDay > 0,
      );
    }
    return Boolean(
      selectedPlatforms.length &&
      draft.template.trim() &&
      draft.maxPerHour > 0 &&
      allocationTotal === 100,
    );
  }, [allocationTotal, draft, selectedPlatforms]);

  if (!open) return null;

  const update = <K extends keyof CampaignDraft>(
    key: K,
    value: CampaignDraft[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  const togglePlatform = (platform: Platform) => {
    setDraft((current) => {
      const selected = current.platforms.includes(platform)
        ? current.platforms.filter((item) => item !== platform)
        : [...current.platforms, platform];
      const equal = selected.length ? Math.floor(100 / selected.length) : 0;
      const allocation = {
        ...EMPTY_ALLOCATION,
        ...Object.fromEntries(
          selected.map((item, index) => [
            item,
            equal + (index === 0 ? 100 - equal * selected.length : 0),
          ]),
        ),
      } as Record<Platform, number>;
      return { ...current, platforms: selected, allocation };
    });
  };

  const addKeyword = () => {
    const keyword = keywordInput.replace(/^#/, "").trim();
    if (!keyword) return;
    update(
      "keywords",
      draft.keywords.includes(keyword)
        ? draft.keywords
        : [...draft.keywords, keyword],
    );
    setKeywordInput("");
  };

  const uploadFiles = async (files: File[]) => {
    if (!brandId || !files.length) return;
    setUploading(true);
    setError(null);
    try {
      const response = await uploadCampaignMedia(brandId, files);
      update("media", [...draft.media, ...response.media]);
      if (response.media[0]?.url) update("imageUrl", response.media[0].url);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Media upload failed.",
      );
    } finally {
      setUploading(false);
    }
  };

  const sample = draft.template
    .replaceAll("{{handle}}", "@customer")
    .replaceAll("{{link}}", draft.ctaLink || "https://example.com/offer");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/35 p-4">
      <div className="w-full max-w-6xl max-h-[calc(100vh-4rem)] overflow-y-auto rounded-[28px] bg-white shadow-2xl">
        <header className="flex items-center justify-between px-11 pb-7 pt-12">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-white">
              <Pause className="size-5 fill-white" />
            </span>
            <h2 className="truncate text-[34px] font-bold leading-tight">
              {initial ? "Edit Campaign" : "New Campaign"}
            </h2>
          </div>
          <button
            onClick={onClose}
            title="Close"
            className="flex size-12 shrink-0 items-center justify-center rounded-lg hover:bg-muted"
          >
            <X className="size-9" />
          </button>
        </header>

        {(error || errorMessage) && (
          <div className="mx-11 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error || errorMessage}
          </div>
        )}

        <div
          className="mx-11 mb-6 flex max-w-full gap-1 overflow-x-auto rounded-xl bg-muted/40 p-1"
          role="tablist"
          aria-label="Campaign type"
        >
          <ModeTab
            active={draft.sourceMode === "existing"}
            onClick={() => update("sourceMode", "existing")}
          >
            Post URL Campaign
          </ModeTab>
          <ModeTab
            active={draft.sourceMode === "keyword"}
            onClick={() => update("sourceMode", "keyword")}
          >
            Keyword Campaign
          </ModeTab>
        </div>

        <div className="grid gap-12 px-11 py-3 lg:grid-cols-2">
          <div className="space-y-8">
            <Field label="Campaign Name">
              <input
                value={draft.name}
                onChange={(event) => update("name", event.target.value)}
                className="input"
                placeholder="Adidas - Refreshing XO"
              />
            </Field>

            <Field label="Platform">
              <div className="flex flex-wrap gap-2">
                {PLATFORM_OPTIONS.map((platform) => (
                  <button
                    type="button"
                    key={platform.id}
                    onClick={() => togglePlatform(platform.id)}
                    className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm ${
                      draft.platforms.includes(platform.id)
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border"
                    }`}
                  >
                    <PlatformLogo platform={platform.id} size={18} />
                    {platform.label}
                  </button>
                ))}
              </div>
            </Field>

            {draft.sourceMode === "keyword" ? (
              <>
                <Field label="Keywords">
                  <div className="flex gap-2">
                    <input
                      value={keywordInput}
                      onChange={(event) => setKeywordInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addKeyword();
                        }
                      }}
                      className="input"
                      placeholder="GTBank problem"
                    />
                    <button
                      type="button"
                      onClick={addKeyword}
                      className="rounded-lg border px-4 text-sm font-semibold"
                    >
                      Add
                    </button>
                  </div>
                </Field>
                <Field label="Intent Filter">
                  <div className="grid grid-cols-2 gap-2">
                    {INTENTS.map(([value, label]) => (
                      <label
                        key={value}
                        className="flex items-center gap-2 rounded-lg border p-3 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={draft.intentFilter.includes(value)}
                          onChange={() =>
                            update(
                              "intentFilter",
                              draft.intentFilter.includes(value)
                                ? draft.intentFilter.filter(
                                    (item) => item !== value,
                                  )
                                : [...draft.intentFilter, value],
                            )
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </Field>
              </>
            ) : draft.sourceMode === "live" ? (
              <>
                <Field label="Live Post Scope">
                  <select
                    value={draft.liveScope}
                    onChange={(event) =>
                      update(
                        "liveScope",
                        event.target.value as CampaignDraft["liveScope"],
                      )
                    }
                    className="input"
                  >
                    <option value="all_owned_posts">All owned posts</option>
                    <option value="selected_posts">Selected post URLs</option>
                  </select>
                </Field>
                {draft.liveScope === "selected_posts" && (
                  <Field label="Selected Post URLs">
                    <div className="space-y-3">
                      {selectedPlatforms.map((platform) => (
                        <div
                          key={platform}
                          className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3"
                        >
                          <span className="text-sm font-medium capitalize">
                            {platform === "x" ? "X" : platform}
                          </span>
                          <input
                            value={draft.existingPosts[platform] ?? ""}
                            onChange={(event) =>
                              update("existingPosts", {
                                ...draft.existingPosts,
                                [platform]: event.target.value,
                              })
                            }
                            className="input min-w-0"
                            placeholder="https://..."
                          />
                        </div>
                      ))}
                    </div>
                  </Field>
                )}
                <Field label="Optional Trigger Keywords">
                  <div className="flex gap-2">
                    <input
                      value={keywordInput}
                      onChange={(event) => setKeywordInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addKeyword();
                        }
                      }}
                      className="input"
                      placeholder="price, available, help"
                    />
                    <button
                      type="button"
                      onClick={addKeyword}
                      className="rounded-lg border px-4 text-sm font-semibold"
                    >
                      Add
                    </button>
                  </div>
                </Field>
              </>
            ) : (
              <>
                <Field label="Post URLs">
                  <div className="space-y-3">
                    {selectedPlatforms.map((platform) => (
                      <div
                        key={platform}
                        className="grid gap-2 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-center"
                      >
                        <span className="flex items-center gap-2 text-sm font-medium capitalize">
                          <PlatformLogo platform={platform} size={18} />
                          {platform === "x" ? "X / Twitter" : platform}
                        </span>
                        <input
                          value={draft.existingPosts[platform] ?? ""}
                          onChange={(event) =>
                            update("existingPosts", {
                              ...draft.existingPosts,
                              [platform]: event.target.value,
                            })
                          }
                          className="input min-w-0"
                          placeholder={
                            platform === "x"
                              ? "https://x.com/username/status/123..."
                              : `https://${platform}.com/...`
                          }
                        />
                      </div>
                    ))}
                  </div>
                </Field>
                <Field label="Trigger Keywords">
                  <input
                    value={keywordInput}
                    onChange={(event) => setKeywordInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addKeyword();
                      }
                    }}
                    className="input"
                    placeholder="Need this"
                  />
                </Field>
              </>
            )}

            <div className="flex flex-wrap gap-2">
              {draft.keywords.map((keyword) => (
                <button
                  type="button"
                  key={keyword}
                  onClick={() =>
                    update(
                      "keywords",
                      draft.keywords.filter((item) => item !== keyword),
                    )
                  }
                  className="rounded-full border bg-muted/30 px-3 py-1.5 text-sm"
                >
                  #{keyword} <span className="text-muted-foreground">x</span>
                </button>
              ))}
            </div>

            <Field label="Brand Tone">
              <div className="flex flex-wrap gap-2">
                {TONES.map((tone) => (
                  <button
                    type="button"
                    key={tone}
                    onClick={() => update("tone", tone)}
                    className={`rounded-full border px-3 py-1.5 text-xs ${
                      draft.tone === tone
                        ? "border-primary bg-primary/5 text-primary"
                        : "bg-muted/30 text-muted-foreground"
                    }`}
                  >
                    {tone}
                  </button>
                ))}
              </div>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={
                  draft.sourceMode === "keyword"
                    ? "Max Replies Per Day"
                    : "Max Sends Per Hour"
                }
              >
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={
                    draft.sourceMode === "keyword"
                      ? draft.maxPerDay
                      : draft.maxPerHour
                  }
                  onChange={(event) =>
                    draft.sourceMode === "keyword"
                      ? update("maxPerDay", Number(event.target.value))
                      : update("maxPerHour", Number(event.target.value))
                  }
                  className="input"
                />
              </Field>
              {draft.sourceMode === "keyword" && (
                <Field label={`Urgency Score: ${draft.urgencyThreshold}+`}>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    value={draft.urgencyThreshold}
                    onChange={(event) =>
                      update("urgencyThreshold", Number(event.target.value))
                    }
                    className="mt-4 w-full accent-primary"
                  />
                </Field>
              )}
              <Field label="Priority">
                <input
                  type="number"
                  min={0}
                  max={1000}
                  value={draft.priority}
                  onChange={(event) =>
                    update("priority", Number(event.target.value))
                  }
                  className="input"
                />
              </Field>
              <Field label="Delivery Spacing (minutes)">
                <input
                  type="number"
                  min={0}
                  max={1440}
                  value={draft.spacingMinutes}
                  onChange={(event) =>
                    update("spacingMinutes", Number(event.target.value))
                  }
                  className="input"
                />
              </Field>
            </div>
          </div>

          <div className="space-y-8">
            <Field label="Reply Template">
              <VariableButtons
                onInsert={(value) =>
                  update("template", `${draft.template}${value}`)
                }
              />
              <textarea
                value={draft.template}
                onChange={(event) => {
                  update("template", event.target.value);
                  update("privateTemplate", event.target.value);
                }}
                className="textarea mt-3 min-h-32"
              />
              <p className="counter">{draft.template.length} / 100</p>
            </Field>

            <Field label="Tracked CTA Link">
              <input
                value={draft.ctaLink}
                onChange={(event) => update("ctaLink", event.target.value)}
                className="input"
                placeholder="https://..."
              />
            </Field>

            <Field label="Branded Images">
              <div
                onClick={() => fileInput.current?.click()}
                className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed bg-muted/20 p-6 text-center hover:border-primary"
              >
                <FileUp className="size-8 text-primary" />
                <p className="mt-2 font-semibold">
                  {uploading ? "Uploading..." : "Drop files here to upload..."}
                </p>
                <button
                  type="button"
                  className="mt-4 rounded-full border border-primary px-5 py-2 font-semibold text-primary"
                >
                  Browse files
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                  className="hidden"
                  onChange={(event) =>
                    void uploadFiles(Array.from(event.target.files ?? []))
                  }
                />
              </div>
              {draft.media.length > 0 && (
                <div className="mt-3 space-y-2">
                  {draft.media.map((media, index) => (
                    <div
                      key={media.public_id}
                      className="flex items-center gap-3 rounded-lg border p-3"
                    >
                      <span className="flex size-10 items-center justify-center rounded-lg bg-muted text-xs font-bold">
                        {media.media_type === "video" ? "VIDEO" : "IMG"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          Campaign asset {index + 1}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {Math.ceil(media.size_bytes / 1024)} KB
                        </p>
                      </div>
                      <button
                        type="button"
                        title="Remove"
                        onClick={() =>
                          update(
                            "media",
                            draft.media.filter(
                              (item) => item.public_id !== media.public_id,
                            ),
                          )
                        }
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Field>

            <Field label={`Auto-fire Threshold: ${draft.threshold}%`}>
              <input
                type="range"
                min={0}
                max={100}
                value={draft.threshold}
                onChange={(event) =>
                  update("threshold", Number(event.target.value))
                }
                className="w-full accent-primary"
              />
              <p className="mt-2 text-sm text-muted-foreground">
                Replies above this confidence auto-fire. Below it &rarr; queued
                for review.
              </p>
            </Field>

            <Field label="Delivery Channels">
              <select
                value={draft.replyMode}
                onChange={(event) =>
                  update(
                    "replyMode",
                    event.target.value as CampaignDraft["replyMode"],
                  )
                }
                className="input mb-3"
              >
                <option value="public">Public reply only</option>
                <option value="dm_with_public_fallback">
                  DM with public fallback
                </option>
                <option value="dm_only">DM only</option>
              </select>
              <div className="grid gap-3 sm:grid-cols-2">
                <ToggleCard
                  checked={draft.publicReplyEnabled}
                  title="Comments / replies"
                  body="Public comment or thread reply."
                  onChange={() =>
                    update("publicReplyEnabled", !draft.publicReplyEnabled)
                  }
                />
                <ToggleCard
                  checked={draft.directMessageEnabled}
                  title="Direct messages"
                  body="Private follow-up where the connected platform permits it."
                  onChange={() =>
                    update("directMessageEnabled", !draft.directMessageEnabled)
                  }
                />
              </div>
            </Field>

            {draft.sourceMode === "keyword" && (
              <Field label="Keyword Audience Rules">
                <div className="grid gap-3 sm:grid-cols-2">
                  <select
                    value={draft.campaignType}
                    onChange={(event) =>
                      update(
                        "campaignType",
                        event.target.value as CampaignDraft["campaignType"],
                      )
                    }
                    className="input"
                  >
                    <option value="brand_mention">Brand mention</option>
                    <option value="competitor_complaint">
                      Competitor complaint
                    </option>
                    <option value="category_intent">Category intent</option>
                  </select>
                  <input
                    type="number"
                    min={0}
                    value={draft.minFollowers}
                    onChange={(event) =>
                      update("minFollowers", Number(event.target.value))
                    }
                    className="input"
                    placeholder="Minimum followers"
                  />
                  <ToggleCard
                    checked={draft.skipVerified}
                    title="Skip verified"
                    body="Exclude verified profiles."
                    onChange={() => update("skipVerified", !draft.skipVerified)}
                  />
                  <ToggleCard
                    checked={draft.skipReposts}
                    title="Skip reposts"
                    body="Only process original posts."
                    onChange={() => update("skipReposts", !draft.skipReposts)}
                  />
                </div>
              </Field>
            )}

            <button
              type="button"
              onClick={() => setShowPreview((current) => !current)}
              className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm font-semibold text-primary"
            >
              <Eye className="size-4" /> Preview Sample Reply
            </button>
            {showPreview && (
              <div className="rounded-lg border bg-primary/5 p-4 text-sm">
                {sample}
              </div>
            )}
          </div>
        </div>

        {draft.sourceMode === "existing" && (
          <div className="mx-11 mb-12 mt-6 rounded-2xl bg-muted/30 p-7">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-xl font-bold">Platform Send Allocation</h3>
              <span
                className={`whitespace-nowrap text-sm font-semibold ${allocationTotal === 100 ? "text-emerald-600" : "text-destructive"}`}
              >
                {allocationTotal}%{" "}
                {allocationTotal === 100 ? (
                  <span aria-hidden="true">&#10003;</span>
                ) : (
                  "must equal 100%"
                )}
              </span>
            </div>
            <div className="space-y-5">
              {selectedPlatforms.map((platform) => (
                <div
                  key={platform}
                  className="grid grid-cols-[150px_minmax(0,1fr)_56px] items-center gap-4"
                >
                  <span className="flex items-center gap-2 text-lg capitalize">
                    <PlatformLogo platform={platform} size={17} />
                    {platform === "x" ? "X" : platform}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={draft.allocation[platform]}
                    onChange={(event) =>
                      update("allocation", {
                        ...draft.allocation,
                        [platform]: Number(event.target.value),
                      })
                    }
                    className="min-w-0 accent-primary"
                  />
                  <span
                    className={`text-right text-lg font-bold ${platform === "instagram" ? "text-pink-700" : platform === "facebook" ? "text-primary" : "text-muted-foreground"}`}
                  >
                    {draft.allocation[platform]}%
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Controls % of engagers per platform who receive the message.
            </p>
          </div>
        )}

        <footer className="grid gap-5 px-11 pb-16 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:px-[20%]">
          <button
            type="button"
            disabled={!formValid || saving || uploading}
            onClick={() => void onSave(draft, "active")}
            className="rounded-lg bg-primary px-8 py-4 text-lg font-semibold text-white disabled:opacity-40"
          >
            {saving
              ? "Saving..."
              : initial
                ? "Update"
                : "Save & Activate Campaign"}
          </button>
          {initial && onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-lg border border-destructive px-8 py-4 text-lg font-semibold text-destructive"
            >
              Delete Campaign
            </button>
          ) : (
            <button
              type="button"
              disabled={saving || uploading}
              onClick={onClose}
              className="rounded-lg border border-primary px-8 py-4 text-lg font-semibold text-primary disabled:opacity-40"
            >
              Cancel
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold">{label}</span>
      {children}
    </label>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-lg px-4 py-2.5 text-sm font-semibold ${active ? "bg-white text-primary shadow-sm" : "text-muted-foreground hover:bg-white/60"}`}
    >
      {children}
    </button>
  );
}

function VariableButtons({ onInsert }: { onInsert: (value: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {["{{handle}}", "{{link}}"].map((value) => (
        <button
          type="button"
          key={value}
          onClick={() => onInsert(value)}
          className="rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary"
        >
          {value}
        </button>
      ))}
      <span className="text-xs text-muted-foreground">
        Click to insert variable
      </span>
    </div>
  );
}

function ToggleCard({
  checked,
  title,
  body,
  onChange,
}: {
  checked: boolean;
  title: string;
  body: string;
  onChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="mt-1"
      />
      <span className="min-w-0">
        <strong className="block text-sm">{title}</strong>
        <span className="block text-xs text-muted-foreground">{body}</span>
      </span>
    </label>
  );
}

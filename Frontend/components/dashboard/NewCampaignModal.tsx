import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BarChart3, Check, Eye, FileUp, Trash2, X } from "lucide-react";
import { PlatformLogo } from "@/components/PlatformLogo";
import { uploadCampaignMedia, type CampaignEventSettings, type CampaignMedia } from "@/lib/api";

export type Platform = "instagram" | "facebook" | "tiktok" | "x";
export type CampaignDraft = {
  name: string;
  platforms: Platform[];
  sourceMode: "publish_new" | "existing";
  postCaption: string;
  existingPosts: Partial<Record<Platform, string>>;
  media: CampaignMedia[];
  keywords: string[];
  tone: string;
  maxPerHour: number;
  template: string;
  privateTemplate: string;
  ctaLink: string;
  imageUrl: string;
  threshold: number;
  events: CampaignEventSettings;
  allocation: Record<Platform, number>;
};

const PLATFORM_OPTIONS: { id: Platform; label: string }[] = [
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "tiktok", label: "TikTok" },
  { id: "x", label: "X" },
];
const TONES = ["Warm and friendly", "Professional and authoritative", "Bold and confident", "Empathetic and supportive", "Playful and witty", "Educational and informative"];
const DEFAULT_EVENTS: CampaignEventSettings = { comments: true, likes: true, reposts: true, mentions: true, dms: true };
const DEFAULT_ALLOCATION: Record<Platform, number> = { instagram: 25, facebook: 25, tiktok: 25, x: 25 };

function blankDraft(): CampaignDraft {
  return {
    name: "", platforms: [], sourceMode: "existing", postCaption: "", existingPosts: {}, media: [], keywords: [], tone: "Warm and friendly",
    maxPerHour: 10, template: "Hey {{handle}}, thanks for your comment. We would like to help.", privateTemplate: "Hey {{handle}}, here is the information you requested: {{link}}",
    ctaLink: "", imageUrl: "", threshold: 85, events: DEFAULT_EVENTS, allocation: DEFAULT_ALLOCATION,
  };
}

export function NewCampaignModal({ open, brandId, initial, saving, errorMessage, onClose, onSave }: {
  open: boolean;
  brandId: number | null;
  initial?: CampaignDraft | null;
  saving?: boolean;
  errorMessage?: string | null;
  onClose: () => void;
  onSave: (campaign: CampaignDraft) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<CampaignDraft>(blankDraft);
  const [step, setStep] = useState(1);
  const [keywordInput, setKeywordInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(initial ? { ...blankDraft(), ...initial, events: { ...DEFAULT_EVENTS, ...initial.events }, allocation: { ...DEFAULT_ALLOCATION, ...initial.allocation } } : blankDraft());
    setStep(1); setError(null); setKeywordInput(""); setShowPreview(false);
  }, [open, initial]);

  const allocationTotal = Object.entries(draft.allocation).filter(([platform]) => draft.platforms.includes(platform as Platform)).reduce((sum, [, value]) => sum + value, 0);
  const stepValid = useMemo(() => {
    if (step === 1) return Boolean(draft.name.trim() && draft.platforms.length && (draft.sourceMode === "publish_new" ? draft.postCaption.trim() : draft.platforms.every(platform => draft.existingPosts[platform]?.trim())));
    if (step === 2) return draft.sourceMode === "existing" || draft.media.length > 0 || draft.platforms.length === 1 && draft.platforms[0] === "x";
    if (step === 3) return Boolean(draft.template.trim() && draft.privateTemplate.trim() && draft.maxPerHour > 0);
    return allocationTotal === 100;
  }, [allocationTotal, draft, step]);

  if (!open) return null;
  const update = <K extends keyof CampaignDraft>(key: K, value: CampaignDraft[K]) => setDraft(current => ({ ...current, [key]: value }));
  const togglePlatform = (platform: Platform) => setDraft(current => {
    const selected = current.platforms.includes(platform) ? current.platforms.filter(item => item !== platform) : [...current.platforms, platform];
    const equal = selected.length ? Math.floor(100 / selected.length) : 0;
    const allocation = { ...DEFAULT_ALLOCATION, ...Object.fromEntries(selected.map((item, index) => [item, equal + (index === 0 ? 100 - equal * selected.length : 0)])) } as Record<Platform, number>;
    return { ...current, platforms: selected, allocation };
  });
  const addKeyword = () => {
    const keyword = keywordInput.replace(/^#/, "").trim();
    if (!keyword) return;
    update("keywords", draft.keywords.includes(keyword) ? draft.keywords : [...draft.keywords, keyword]);
    setKeywordInput("");
  };
  const uploadFiles = async (files: File[]) => {
    if (!brandId || !files.length) return;
    const hasVideo = files.some(file => file.type.startsWith("video/"));
    const hasImage = files.some(file => file.type.startsWith("image/"));
    if ((hasVideo && hasImage) || (hasVideo && files.length > 1)) { setError("Upload multiple images or one video. Mixed image/video sets are not supported."); return; }
    setUploading(true); setError(null);
    try {
      const result = await uploadCampaignMedia(brandId, files);
      update("media", result.media);
      update("imageUrl", result.media[0]?.url ?? "");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Media upload failed."); }
    finally { setUploading(false); }
  };
  const sample = draft.template.replace(/\{\{\s*handle\s*\}\}/g, "@customer").replace(/\{\{\s*link\s*\}\}/g, draft.ctaLink || "https://example.com");

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="my-6 w-full max-w-5xl rounded-xl bg-card shadow-xl">
        <header className="flex items-center gap-3 border-b px-6 py-5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-white"><BarChart3 className="size-5" /></span>
          <div className="min-w-0 flex-1"><h2 className="text-xl font-bold">{initial ? "Edit Campaign" : "New Campaign"}</h2><p className="text-xs text-muted-foreground">Create, attach, and activate campaign posts across connected platforms.</p></div>
          <button onClick={onClose} title="Close" className="flex size-9 items-center justify-center rounded-lg hover:bg-muted"><X className="size-5" /></button>
        </header>

        <div className="border-b px-6 py-4"><div className="grid grid-cols-4 gap-2">{["Setup", "Posts & media", "Automation", "Review"].map((label, index) => <div key={label} className={`h-2 rounded-full ${index + 1 <= step ? "bg-primary" : "bg-muted"}`}><span className="sr-only">{label}</span></div>)}</div><p className="mt-2 text-sm font-semibold">Step {step}: {["Setup", "Posts & media", "Automation", "Review"][step - 1]}</p></div>
        {(error || errorMessage) && <div className="mx-6 mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error || errorMessage}</div>}

        <div className="min-h-[480px] px-6 py-6">
          {step === 1 && <div className="space-y-6">
            <Field label="Campaign name"><input value={draft.name} onChange={event => update("name", event.target.value)} className="input" placeholder="Adidas - Refreshing XO" /></Field>
            <Field label="Platforms"><div className="flex flex-wrap gap-2">{PLATFORM_OPTIONS.map(platform => <button key={platform.id} onClick={() => togglePlatform(platform.id)} className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm ${draft.platforms.includes(platform.id) ? "border-primary bg-primary/5 text-primary" : "border-border"}`}><PlatformLogo platform={platform.id} size={18} />{platform.label}</button>)}</div></Field>
            <Field label="Post source"><div className="grid gap-3 sm:grid-cols-2"><ModeButton active={draft.sourceMode === "publish_new"} title="Publish new posts" body="Use shared text and media across selected platforms." onClick={() => update("sourceMode", "publish_new")} /><ModeButton active={draft.sourceMode === "existing"} title="Track existing posts" body="Attach one existing URL per selected platform." onClick={() => update("sourceMode", "existing")} /></div></Field>
            {draft.sourceMode === "publish_new" ? <Field label="Shared post caption"><textarea value={draft.postCaption} onChange={event => update("postCaption", event.target.value)} maxLength={2200} className="textarea" placeholder="Write the campaign post..." /><p className="counter">{draft.postCaption.length}/2200</p></Field> : <div className="grid gap-4 sm:grid-cols-2">{draft.platforms.map(platform => <Field key={platform} label={`${platform === "x" ? "X" : platform[0].toUpperCase() + platform.slice(1)} post URL`}><input value={draft.existingPosts[platform] ?? ""} onChange={event => update("existingPosts", { ...draft.existingPosts, [platform]: event.target.value })} className="input" placeholder="https://..." /></Field>)}</div>}
          </div>}

          {step === 2 && <div className="space-y-5">
            <div onClick={() => fileInput.current?.click()} className="flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed bg-muted/30 p-8 text-center hover:border-primary"><FileUp className="size-9 text-primary" /><p className="mt-3 font-semibold">{uploading ? "Uploading media..." : "Drop files here or browse"}</p><p className="mt-1 text-sm text-muted-foreground">Multiple JPG, PNG or WebP images, or one MP4/MOV video. Max 100MB per file.</p><input ref={fileInput} type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" className="hidden" onChange={event => void uploadFiles(Array.from(event.target.files ?? []))} /></div>
            {draft.media.length > 0 && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{draft.media.map((media, index) => <div key={media.public_id} className="flex items-center gap-3 rounded-lg border p-3"><span className="flex size-10 items-center justify-center rounded-lg bg-muted text-xs font-bold">{media.media_type === "video" ? "VIDEO" : "IMG"}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">Asset {index + 1}</p><p className="text-xs text-muted-foreground">{Math.ceil(media.size_bytes / 1024)} KB</p></div><button title="Remove" onClick={() => update("media", draft.media.filter(item => item.public_id !== media.public_id))}><Trash2 className="size-4 text-destructive" /></button></div>)}</div>}
          </div>}

          {step === 3 && <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-5"><Field label="Trigger keywords"><div className="flex gap-2"><input value={keywordInput} onChange={event => setKeywordInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addKeyword(); } }} className="input" placeholder="price, interested, link" /><button onClick={addKeyword} className="rounded-lg border px-3 text-sm font-semibold">Add</button></div><div className="mt-2 flex flex-wrap gap-2">{draft.keywords.map(keyword => <button key={keyword} onClick={() => update("keywords", draft.keywords.filter(item => item !== keyword))} className="rounded-full bg-muted px-3 py-1 text-xs">#{keyword} ×</button>)}</div></Field><Field label="Engagement events"><div className="grid grid-cols-2 gap-2">{Object.entries(draft.events).map(([event, enabled]) => <label key={event} className="flex items-center gap-2 rounded-lg border p-3 text-sm capitalize"><input type="checkbox" checked={enabled} onChange={() => update("events", { ...draft.events, [event]: !enabled })} />{event}</label>)}</div></Field><Field label="Brand tone"><select value={draft.tone} onChange={event => update("tone", event.target.value)} className="input">{TONES.map(tone => <option key={tone}>{tone}</option>)}</select></Field></div>
            <div className="space-y-5"><Field label="Public reply template"><textarea value={draft.template} onChange={event => update("template", event.target.value)} className="textarea" /></Field><Field label="Private follow-up template"><textarea value={draft.privateTemplate} onChange={event => update("privateTemplate", event.target.value)} className="textarea" /></Field><Field label="Tracked CTA link"><input value={draft.ctaLink} onChange={event => update("ctaLink", event.target.value)} className="input" placeholder="https://..." /></Field><div className="grid grid-cols-2 gap-4"><Field label={`Auto-fire threshold: ${draft.threshold}%`}><input type="range" min={0} max={100} value={draft.threshold} onChange={event => update("threshold", Number(event.target.value))} className="w-full accent-primary" /></Field><Field label="Max sends per hour"><input type="number" min={1} max={500} value={draft.maxPerHour} onChange={event => update("maxPerHour", Number(event.target.value))} className="input" /></Field></div><button onClick={() => setShowPreview(current => !current)} className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm font-semibold text-primary"><Eye className="size-4" />Preview sample reply</button>{showPreview && <p className="rounded-lg border bg-muted/30 p-4 text-sm">{sample}</p>}</div>
          </div>}

          {step === 4 && <div className="space-y-6"><div className="grid gap-3 sm:grid-cols-3"><Summary label="Source" value={draft.sourceMode === "publish_new" ? "Publish new" : "Existing posts"} /><Summary label="Platforms" value={draft.platforms.join(", ") || "None"} /><Summary label="Media" value={`${draft.media.length} asset(s)`} /></div><div className="rounded-xl border bg-muted/20 p-5"><div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">Platform send allocation</h3><span className={allocationTotal === 100 ? "text-emerald-600" : "text-destructive"}>{allocationTotal}% {allocationTotal === 100 ? "✓" : "must equal 100%"}</span></div>{draft.platforms.map(platform => <div key={platform} className="grid grid-cols-[120px_1fr_52px] items-center gap-3 py-2"><span className="flex items-center gap-2 text-sm capitalize"><PlatformLogo platform={platform} size={17} />{platform}</span><input type="range" min={0} max={100} value={draft.allocation[platform]} onChange={event => update("allocation", { ...draft.allocation, [platform]: Number(event.target.value) })} className="accent-primary" /><span className="text-right text-sm font-semibold">{draft.allocation[platform]}%</span></div>)}</div><p className="text-sm text-muted-foreground">Activation will preflight every platform. Supported platforms activate immediately; failures remain visible with retry instructions.</p></div>}
        </div>

        <footer className="flex items-center justify-between border-t px-6 py-5"><button onClick={() => step === 1 ? onClose() : setStep(current => current - 1)} className="flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold"><ArrowLeft className="size-4" />{step === 1 ? "Cancel" : "Back"}</button>{step < 4 ? <button disabled={!stepValid || uploading} onClick={() => setStep(current => current + 1)} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Continue<ArrowRight className="size-4" /></button> : <button disabled={!stepValid || saving} onClick={() => void onSave(draft)} className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"><Check className="size-4" />{saving ? "Activating..." : "Save & Activate"}</button>}</footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-2 block text-sm font-semibold">{label}</span>{children}</label>; }
function ModeButton({ active, title, body, onClick }: { active: boolean; title: string; body: string; onClick: () => void }) { return <button onClick={onClick} className={`rounded-xl border p-4 text-left ${active ? "border-primary bg-primary/5" : "border-border"}`}><span className="block font-semibold">{title}</span><span className="mt-1 block text-sm text-muted-foreground">{body}</span></button>; }
function Summary({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 truncate text-sm font-semibold capitalize">{value}</p></div>; }

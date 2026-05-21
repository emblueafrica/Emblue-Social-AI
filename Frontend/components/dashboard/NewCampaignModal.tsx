import { useEffect, useState } from "react";
import { Eye, BarChart3, X as XIcon } from "lucide-react";
import { PlatformLogo } from "@/components/PlatformLogo";

export type Platform = "instagram" | "facebook" | "tiktok" | "x";

export type CampaignDraft = {
  name: string;
  platforms: Platform[];
  keywords: string[];
  tone: string;
  maxPerHour: number;
  template: string;
  ctaLink: string;
  imageUrl: string;
  threshold: number;
  allocation: { instagram: number; facebook: number; tiktok: number };
};

const PLATFORMS: { id: Platform; label: string; icon: React.ReactNode }[] = [
  { id: "instagram", label: "Instagram", icon: <PlatformLogo platform="instagram" size={16} /> },
  { id: "facebook", label: "Facebook", icon: <PlatformLogo platform="facebook" size={16} /> },
  { id: "tiktok", label: "TikTok", icon: <PlatformLogo platform="tiktok" size={16} /> },
  { id: "x", label: "X/Twitter", icon: <PlatformLogo platform="x" size={16} /> },
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

export function NewCampaignModal({
  open,
  onClose,
  onSave,
  initial,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (c: CampaignDraft) => void;
  initial?: CampaignDraft | null;
  onDelete?: () => void;
}) {
  const isEdit = !!initial;
  const [name, setName] = useState("");
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [kwInput, setKwInput] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [tone, setTone] = useState("");
  const [maxPerHour, setMaxPerHour] = useState(10);
  const [template, setTemplate] = useState("");
  const [ctaLink, setCtaLink] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [threshold, setThreshold] = useState(85);
  const [allocation, setAllocation] = useState({ instagram: 50, facebook: 30, tiktok: 20 });
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name);
      setPlatforms(initial.platforms);
      setKeywords(initial.keywords);
      setTone(initial.tone);
      setMaxPerHour(initial.maxPerHour);
      setTemplate(initial.template);
      setCtaLink(initial.ctaLink);
      setImageUrl(initial.imageUrl);
      setThreshold(initial.threshold);
      setAllocation(initial.allocation);
    }
  }, [open, initial]);

  if (!open) return null;

  const togglePlatform = (p: Platform) =>
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const insertVar = (v: string) => setTemplate((t) => t + v);

  const addKeyword = (raw: string) => {
    const clean = raw.replace(/^#/, "").trim();
    if (!clean) return;
    setKeywords((k) => (k.includes(clean) ? k : [...k, clean]));
    setKwInput("");
  };

  const removeKeyword = (k: string) => setKeywords((arr) => arr.filter((x) => x !== k));

  const total = allocation.instagram + allocation.facebook + allocation.tiktok;
  const allocOk = total === 100;
  const valid = name.trim() && platforms.length && template.trim() && allocOk;

  const reset = () => {
    setName(""); setPlatforms([]); setKeywords([]); setKwInput("");
    setTone(""); setMaxPerHour(10); setTemplate(""); setCtaLink("");
    setImageUrl(""); setThreshold(85); setAllocation({ instagram: 50, facebook: 30, tiktok: 20 });
    setShowPreview(false);
  };

  const handleSave = () => {
    if (!valid) return;
    onSave({ name, platforms, keywords, tone, maxPerHour, template, ctaLink, imageUrl, threshold, allocation });
    reset();
  };

  const handleCancel = () => { reset(); onClose(); };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-card rounded-2xl shadow-xl w-full max-w-5xl my-8 relative">
        {isEdit && (
          <button onClick={handleCancel} className="absolute top-6 right-6 size-8 rounded-full hover:bg-muted flex items-center justify-center">
            <XIcon className="size-5" />
          </button>
        )}
        <div className="flex items-center gap-3 px-8 pt-8 pb-2">
          <div className="size-10 rounded-xl bg-primary text-white flex items-center justify-center">
            <BarChart3 className="size-5" />
          </div>
          <h2 className="text-2xl font-bold">{isEdit ? "Edit Campaign" : "New Campaign"}</h2>
        </div>

        <div className="grid md:grid-cols-2 gap-8 px-8 py-6">
          {/* LEFT */}
          <div className="space-y-5">
            <div>
              <label className="text-sm font-semibold block mb-2">Campaign Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. MTN Super Eagles - November Drop"
                className="w-full h-11 rounded-xl border border-border px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div>
              <label className="text-sm font-semibold block mb-2">Platform</label>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => {
                  const active = platforms.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => togglePlatform(p.id)}
                      className={`flex items-center gap-2 h-10 px-4 rounded-full border text-sm transition ${
                        active ? "border-primary bg-accent text-primary" : "border-border hover:bg-muted"
                      }`}
                    >
                      {p.icon}
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold block mb-2">Trigger Keywords</label>
              <input
                value={kwInput}
                onChange={(e) => setKwInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addKeyword(kwInput);
                  }
                }}
                onBlur={() => kwInput && addKeyword(kwInput)}
                placeholder="link, price, order..."
                className="w-full h-11 rounded-xl border border-border px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              {keywords.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {keywords.map((k) => (
                    <span key={k} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted text-sm">
                      #{k}
                      <button onClick={() => removeKeyword(k)} className="text-muted-foreground hover:text-foreground">×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="text-sm font-semibold block mb-2">Brand Tone</label>
              <div className="flex flex-wrap gap-2">
                {TONES.map((t) => {
                  const active = tone === t;
                  return (
                    <button
                      key={t}
                      onClick={() => setTone(t)}
                      className={`px-3 py-1.5 rounded-full text-xs border transition ${
                        active ? "border-primary bg-accent text-primary" : "border-transparent bg-muted hover:bg-muted/70"
                      }`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold block mb-2">Max Sends Per Hour</label>
              <input
                type="number"
                value={maxPerHour}
                onChange={(e) => setMaxPerHour(Number(e.target.value))}
                className="w-32 h-11 rounded-xl border border-border px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <p className="text-xs text-muted-foreground mt-1.5">Throttle to avoid spam flags.</p>
            </div>
          </div>

          {/* RIGHT */}
          <div className="space-y-5">
            <div>
              <label className="text-sm font-semibold block mb-2">Reply Template</label>
              <div className="flex items-center gap-2 mb-2 text-xs">
                <button onClick={() => insertVar("{{handle}}")} className="px-2.5 py-1 rounded-md bg-accent text-primary font-semibold">
                  {"{{handle}}"}
                </button>
                <button onClick={() => insertVar("{{link}}")} className="px-2.5 py-1 rounded-md bg-accent text-primary font-semibold">
                  {"{{link}}"}
                </button>
                <span className="text-muted-foreground">Click to insert variable</span>
              </div>
              <textarea
                rows={4}
                maxLength={100}
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                placeholder="Hey {{handle}}! Thanks for engaging with our post. Here's something special for you: {{link}}"
                className="w-full rounded-xl border border-border p-4 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <div className="text-right text-xs text-muted-foreground">{template.length} / 100</div>
            </div>

            <div>
              <label className="text-sm font-semibold block mb-2">Tracked CTA Link</label>
              <input
                value={ctaLink}
                onChange={(e) => setCtaLink(e.target.value)}
                placeholder="https://bit.ly/MTNxSUPEREAGLES"
                className="w-full h-11 rounded-xl border border-border px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div>
              <label className="text-sm font-semibold block mb-2">Branded Image URL</label>
              <input
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://cdn.brand.com/lets-go-for-gold.jpg"
                className="w-full h-11 rounded-xl border border-border px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                Attached to every Instagram and Facebook DM automatically.
              </p>
            </div>

            <div>
              <label className="text-sm font-semibold block mb-2">Auto-fire Threshold</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="flex-1 accent-primary"
                />
                <span className="text-primary font-semibold text-sm w-12 text-right">{threshold}%</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                Replies above this confidence auto-fire. Below it → queued for review.
              </p>
            </div>

            <button
              onClick={() => setShowPreview((s) => !s)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-accent text-primary text-sm font-semibold"
            >
              <Eye className="size-4" /> Preview Sample Reply
            </button>

            {showPreview && (
              <div className="rounded-xl bg-accent/40 p-4">
                <p className="text-sm font-semibold mb-1">Sample Reply</p>
                <p className="text-sm">
                  Hey <span className="text-primary font-semibold">@tunde_Lagos</span>! Thanks for engaging with our post. Here's something special for you:{" "}
                  <span className="text-primary underline">{ctaLink || "https://bit.ly/MTNxSUPEREAGLES"}</span>
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  → Sent as Instagram DM with branded image attached
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Allocation full width */}
        <div className="px-8 pb-6">
          <div className={`rounded-2xl p-5 border ${allocOk ? "bg-muted/40 border-transparent" : "bg-red-50 border-red-100"}`}>
            <div className="flex items-center justify-between mb-4">
              <p className="font-semibold">Platform Send Allocation</p>
              {allocOk ? (
                <span className="text-success text-sm font-semibold">100% ✓</span>
              ) : (
                <span className="text-destructive text-sm font-semibold">{total}% ✗ must = 100%</span>
              )}
            </div>
            {(["instagram", "facebook", "tiktok"] as const).map((key) => (
              <div key={key} className="flex items-center gap-3 py-2">
                <div className="w-28 flex items-center gap-2 text-sm font-medium capitalize">
                  <PlatformLogo platform={key} size={16} />
                  {key}
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={allocation[key]}
                  onChange={(e) => setAllocation((a) => ({ ...a, [key]: Number(e.target.value) }))}
                  className="flex-1 accent-primary"
                />
                <span className="w-12 text-right text-sm font-semibold text-primary">{allocation[key]}%</span>
              </div>
            ))}
            <p className="text-xs text-muted-foreground mt-3">
              Controls % of engagers per platform who receive the message.
            </p>
          </div>
        </div>

        <div className="flex gap-4 px-8 pb-8">
          <button
            onClick={handleSave}
            disabled={!valid}
            className={`flex-1 h-12 rounded-xl font-semibold transition ${
              valid ? "bg-primary text-primary-foreground hover:opacity-90" : "bg-primary/40 text-white cursor-not-allowed"
            }`}
          >
            {isEdit ? "Update" : "Save & Activate Campaign"}
          </button>
          {isEdit ? (
            <button
              onClick={onDelete}
              className="flex-1 h-12 rounded-xl border-2 border-destructive text-destructive font-semibold hover:bg-destructive/5"
            >
              Delete Campaign
            </button>
          ) : (
            <button
              onClick={handleCancel}
              className="flex-1 h-12 rounded-xl border-2 border-primary text-primary font-semibold hover:bg-accent"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

import Image from "next/image";

export type PlatformLogoName = "instagram" | "facebook" | "tiktok" | "x" | "linkedin";

const platformLogoSrc: Record<PlatformLogoName, string> = {
  instagram: "/platforms/instagram.png",
  facebook: "/platforms/facebook.png",
  tiktok: "/platforms/tiktok.png",
  x: "/platforms/x.png",
  linkedin: "/platforms/linkedin.png",
};

const platformLogoAlt: Record<PlatformLogoName, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  x: "X",
  linkedin: "LinkedIn",
};

export function PlatformLogo({
  platform,
  size = 16,
  className = "",
}: {
  platform: PlatformLogoName;
  size?: number;
  className?: string;
}) {
  return (
    <Image
      src={platformLogoSrc[platform]}
      alt={platformLogoAlt[platform]}
      width={size}
      height={size}
      className={`inline-block shrink-0 object-contain ${className}`}
    />
  );
}

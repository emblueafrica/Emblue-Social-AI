type Props = { variant?: "light" | "dark"; className?: string };

export function EmblueLogo({ variant = "dark", className = "" }: Props) {
  const color = variant === "light" ? "#ffffff" : "oklch(0.46 0.27 265)";
  return (
    <div className={`flex flex-col leading-none ${className}`}>
      <span
        className="text-3xl font-extrabold tracking-tight lowercase"
        style={{ color }}
      >
        emblue
      </span>
      <span
        className="text-[0.7rem] font-medium tracking-[0.35em] mt-1"
        style={{ color, opacity: 0.95 }}
      >
        SOCIAL AI
      </span>
    </div>
  );
}

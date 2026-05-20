import { EmblueLogo } from "./EmblueLogo";

export function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen relative overflow-hidden"
      style={{ background: "var(--gradient-hero)" }}
    >
      {/* Curved swooshes */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <defs>
          <linearGradient id="swoosh1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="white" stopOpacity="0.08" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M -200 600 Q 400 200 1600 700 L 1600 900 L -200 900 Z"
          fill="url(#swoosh1)"
        />
        <path
          d="M 900 -100 Q 1100 400 1700 600 L 1700 -100 Z"
          fill="url(#swoosh1)"
        />
      </svg>

      <div className="relative z-10 px-8 md:px-16 pt-10">
        <EmblueLogo variant="light" />
      </div>

      <div className="relative z-10 flex flex-col items-center px-4 pb-16">
        <h1 className="text-white text-4xl md:text-5xl font-light mt-6 mb-10">
          Welcome back
        </h1>
        {children}
      </div>
    </div>
  );
}

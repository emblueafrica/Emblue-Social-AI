// src/server.ts
import "dotenv/config";
import express, { Application, Request, Response } from "express";
import cors, { CorsOptions } from "cors";
import { requireAuth } from "./middleware/auth";
import apiRoutes from "./routes/api";
import authRoutes from "./routes/auth";
import realtimeRoutes from "./routes/realtime";
import dashboardRoutes from "./routes/dashboard";
import campaignRoutes from "./routes/campaigns";
import funnelRoutes from "./routes/funnels";
import alertRoutes from "./routes/alerts";
import listeningRoutes from "./routes/listening";
import adminRoutes from "./routes/admin";
import toolsRoutes from "./routes/tools";
import onboardingRoutes from "./routes/onboarding";
import teamRoutes from "./routes/team";
import docsRoutes, { docsJson } from "./routes/docs";
import { bootstrapSuperAdmin } from "./auth/bootstrap";
import { autoStartAll } from "./automation/scheduler";
import { apiRateLimit } from "./middleware/rateLimit";
import { securityHeaders } from "./middleware/securityHeaders";
import { initBullQueue, isBullEnabled } from "./queue/jobs";

const app: Application = express();
const PORT = parseInt(process.env.PORT ?? "3001", 10);
app.disable("x-powered-by");

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

// CORS helpers and allow list
const normalizeOrigin = (value: string): string =>
  value.trim().replace(/\/+$/, "");
const STATIC_ALLOWED = [
  "http://localhost:3000",
  "https://emblue-social-ai.vercel.app",
  "https://marketool.tech",
  "https://www.marketool.tech",
].map(normalizeOrigin);
const envOrigins = (process.env.FRONTEND_URL ?? "")
  .split(",")
  .map(normalizeOrigin)
  .filter(Boolean);
const allowAnyOrigin = envOrigins.includes("*");
const ALLOW_LIST = new Set([
  ...STATIC_ALLOWED,
  ...envOrigins.filter((o) => o !== "*"),
]);
const isProjectVercelDomain = (origin: string): boolean =>
  /^https:\/\/emblue-social-ai[a-z0-9-]*\\.vercel\\.app$/i.test(origin);

function buildCorsOptions(): CorsOptions {
  return {
    origin: (origin, callback) => {
      // Requests without an Origin header (curl, server-to-server, health checks).
      if (!origin) {
        callback(null, true);
        return;
      }
      const normalized = normalizeOrigin(origin);
      // Allow if explicitly listed, allowed by env, or matches Vercel preview pattern.
      if (
        allowAnyOrigin ||
        ALLOW_LIST.has(normalized) ||
        isProjectVercelDomain(normalized) ||
        normalized.endsWith("marketool.tech")
      ) {
        callback(null, true);
        return;
      }
      console.warn(`[CORS] Blocked request from origin: ${origin}`);
      callback(null, false);
    },
    credentials: true,
  };
}

// Ensure CORS headers exist even when later middleware (auth) rejects the request.
// This helps preflight (OPTIONS) and error responses include the necessary CORS headers.
app.use((req, res, next) => {
  const origin =
    typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  if (origin) {
    const normalized = normalizeOrigin(origin);
    if (
      allowAnyOrigin ||
      ALLOW_LIST.has(normalized) ||
      isProjectVercelDomain(normalized) ||
      normalized.endsWith("marketool.tech")
    ) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization,Content-Type",
      );
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      );
    }
  }
  next();
});

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(securityHeaders);
app.use(cors(buildCorsOptions()));
app.options("*", cors(buildCorsOptions()));
app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buffer) => {
      const request = req as Request;
      if (request.originalUrl.startsWith("/api/v1/rt/webhook/"))
        request.rawBody = Buffer.from(buffer);
    },
  }),
);
app.use(express.urlencoded({ extended: true }));
app.use(apiRateLimit);

// ── HEALTH CHECK (public — no auth) ──────────────────────────────────────────
app.get("/", (_req: Request, res: Response) => {
  res.json({
    name: "Social Emblue AI",
    version: "2.0.0",
    lang: "TypeScript",
    status: "running",
    ts: new Date().toISOString(),
  });
});

// ── AUTH MIDDLEWARE — protects all routes below ───────────────────────────────
app.get("/api/v1/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "social-emblue-ai-backend",
    version: "2.0.0",
    queue: {
      campaign_delivery: isBullEnabled(),
    },
    ts: new Date().toISOString(),
  });
});

if (process.env.ENABLE_SWAGGER !== "false") {
  app.get("/api-docs.json", docsJson);
  app.use("/api-docs", docsRoutes);
}

app.use(requireAuth);

// ── API ROUTES ────────────────────────────────────────────────────────────────
app.use("/api/v1", apiRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/rt", realtimeRoutes);
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/campaigns", campaignRoutes);
app.use("/api/v1/funnels", funnelRoutes);
app.use("/api/v1/alerts", alertRoutes);
app.use("/api/v1/listening", listeningRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/tools", toolsRoutes);
app.use("/api/v1/onboarding", onboardingRoutes);
app.use("/api/v1/team", teamRoutes);

// ── GLOBAL ERROR HANDLER ──────────────────────────────────────────────────────
app.use(
  (err: Error, _req: Request, res: Response, _next: express.NextFunction) => {
    console.error("[Server] Unhandled error:", err.message);
    res
      .status(500)
      .json({ error: "Internal server error", message: err.message });
  },
);

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`[Server] Social Emblue AI (TypeScript) running on port ${PORT}`);
  console.log(`[Server] Environment: ${process.env.NODE_ENV ?? "development"}`);

  if (process.env.DISABLE_AUTOMATION_AUTOSTART === "true") {
    console.log("[Server] Automation autostart disabled");
    return;
  }

  // Start automation for all connected brands
  try {
    await initBullQueue();
    await bootstrapSuperAdmin();
    await autoStartAll();
  } catch (err) {
    console.error("[Server] autoStartAll failed:", (err as Error).message);
  }
});

export default app;

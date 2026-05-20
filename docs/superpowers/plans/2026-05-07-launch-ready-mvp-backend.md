# Launch-Ready MVP Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the backend deployable as a launch-ready MVP by hardening security, validation, database compatibility, and core workflow reliability.

**Architecture:** Keep the existing Express/TypeScript module layout. Add small shared middleware/helpers, wire them into existing routes, and avoid broad PRD feature expansion beyond MVP stability.

**Tech Stack:** Node.js 18+, Express, TypeScript, PostgreSQL via `pg`, Anthropic SDK, built-in Node smoke checks.

---

### Task 1: Shared MVP Guards

**Files:**
- Create: `backend/src/middleware/rateLimit.ts`
- Create: `backend/src/utils/validation.ts`
- Modify: `backend/src/server.ts`

- [ ] Add an in-memory API rate limiter that skips health checks and webhooks.
- [ ] Add validation helpers for positive IDs, platform values, arrays, and allocation totals.
- [ ] Mount the limiter before authentication in `server.ts`.
- [ ] Run `cmd /c npm run build`.

### Task 2: Route Security And Ordering

**Files:**
- Modify: `backend/src/routes/api.ts`
- Modify: `backend/src/routes/auth.ts`
- Modify: `backend/src/routes/campaigns.ts`
- Modify: `backend/src/routes/dashboard.ts`
- Modify: `backend/src/routes/realtime.ts`

- [ ] Apply `requireBrandAccess` to brand-scoped route handlers.
- [ ] Apply owner/admin-only role checks to automation start/stop/run-now and campaign mutation routes.
- [ ] Move fixed campaign routes before `/:brand_id` routes so `/post-urls/run` and `/engage-now` cannot be captured by a param route.
- [ ] Add explicit validation before DB calls and agent calls.
- [ ] Run `cmd /c npm run build`.

### Task 3: Database Compatibility Fixes

**Files:**
- Modify: `backend/src/db/queries.ts`
- Modify: `backend/src/agents/agent8_attribution.ts`

- [ ] Insert Postgres arrays as arrays, not JSON strings.
- [ ] Insert JSONB fields as JSON strings only where the schema expects JSONB.
- [ ] Ensure tracked-link creation validates URLs and returns a stable shape when DB insertion fails.
- [ ] Run `cmd /c npm run build`.

### Task 4: Core Workflow Hardening

**Files:**
- Modify: `backend/src/routes/campaigns.ts`
- Modify: `backend/src/stream/engageEngagers.ts`
- Modify: `backend/src/stream/eventQueue.ts`
- Modify: `backend/src/routes/realtime.ts`

- [ ] Validate post URL allocations must total exactly 100 for supplied platforms.
- [ ] Persist submitted post URLs and fetched engagers where possible without blocking the async campaign run.
- [ ] Return clear `manual_copy` or skipped statuses when platform tokens/scopes are missing.
- [ ] Add approval queue validation for approve requests.
- [ ] Run `cmd /c npm run build`.

### Task 5: Smoke Verification

**Files:**
- Create: `backend/scripts/smoke-check.mjs`
- Modify: `backend/package.json`

- [ ] Add a dependency-free smoke script that checks route registration, middleware presence, and schema/query compatibility markers.
- [ ] Add `npm run smoke`.
- [ ] Run `cmd /c npm run build`.
- [ ] Run `cmd /c npm run smoke`.

# Prisma Option A Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Prisma as the backend data access layer over the existing Supabase/PostgreSQL schema, then use Prisma-backed services as the foundation for completing the backend.

**Architecture:** Keep `schema_full.sql` as the source of truth for Supabase-specific features such as RLS, vector columns, and manual indexes. Add `prisma/schema.prisma` to mirror the existing tables and enums, generate Prisma Client, and refactor the central `src/db/queries.ts` first so most callers move to Prisma without broad route rewrites. Direct SQL remains only for advanced PostgreSQL/Supabase cases.

**Tech Stack:** Node.js 18+, TypeScript, Prisma Client, PostgreSQL/Supabase, existing Express route modules.

---

### Task 1: Prisma Foundation

**Files:**
- Modify: `backend/package.json`
- Create: `backend/prisma/schema.prisma`
- Create: `backend/src/db/prisma.ts`
- Modify: `backend/scripts/smoke-check.mjs`

- [ ] Add smoke checks that fail until Prisma dependencies, schema, and client wrapper exist.
- [ ] Install `@prisma/client` and `prisma`.
- [ ] Define Prisma datasource, generator, enums, and models for the current SQL schema.
- [ ] Add a singleton Prisma Client wrapper.
- [ ] Run `npx prisma validate` and `npx prisma generate`.

### Task 2: Central Query Layer Migration

**Files:**
- Modify: `backend/src/db/queries.ts`
- Test: `backend/scripts/smoke-check.mjs`

- [ ] Add smoke checks that fail while `queries.ts` imports `./pool`.
- [ ] Rewrite central query helpers to use Prisma Client for messages, clusters, KPIs, insights, war room snapshots, tracked links, brands, and connected accounts.
- [ ] Use Prisma upsert/CRUD where possible and `$queryRaw` only when table shape or Postgres behavior requires it.
- [ ] Run `npm run build`, `npm run type-check`, and `npm run smoke`.

### Task 3: Direct SQL Reduction

**Files:**
- Modify: `backend/src/agents/agent8_attribution.ts`
- Modify: `backend/src/auth/platformSync.ts`
- Modify: `backend/src/routes/auth.ts`
- Modify: `backend/src/routes/campaigns.ts`
- Modify: `backend/src/routes/dashboard.ts`
- Modify: `backend/src/routes/realtime.ts`
- Modify: `backend/src/stream/engageEngagers.ts`
- Modify: `backend/src/stream/pipeline.ts`
- Modify: `backend/src/stream/publisher.ts`
- Modify: `backend/src/stream/templateManager.ts`

- [ ] Replace direct `pool.query` calls with Prisma Client in one module at a time.
- [ ] Keep each module compiling after each refactor.
- [ ] Preserve existing API response shapes.
- [ ] Run full verification after each module group.

### Task 4: Backend Completion Pass

**Files:**
- Create/Modify focused files under `backend/src/agents`, `backend/src/auth`, `backend/src/routes`, and `backend/src/stream`.

- [ ] Implement missing Agent5/DM funnel service on top of Prisma models.
- [ ] Add TikTok OAuth routes and token persistence.
- [ ] Complete Facebook/TikTok platform sync.
- [ ] Add persisted approval queue operations.
- [ ] Add agent run logging models and helpers.
- [ ] Expand smoke checks to cover the newly completed backend surface.

### Task 5: Final Verification

**Files:**
- Modify: `backend/DEPLOY.md`

- [ ] Document Prisma commands: `prisma validate`, `prisma generate`, and existing SQL schema setup.
- [ ] Run `npx prisma validate`.
- [ ] Run `npx prisma generate`.
- [ ] Run `npm run build`.
- [ ] Run `npm run type-check`.
- [ ] Run `npm run smoke`.

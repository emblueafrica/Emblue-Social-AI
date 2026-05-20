# Listening Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the PRD v3.1 Advanced Social Listening backend module.

**Architecture:** Add dedicated Prisma/SQL tables for keyword groups, search runs, search results, and volume buckets. Implement services for Apify keyword search, result persistence, and volume aggregation, then expose them through `/api/v1/listening` and schedule active groups every 15 minutes.

**Tech Stack:** TypeScript, Express, Prisma 6, Apify Client, existing Agent 1/2/4/10/11 services, existing SSE event queue.

---

### Task 1: Smoke Coverage

**Files:**
- Modify: `backend/scripts/smoke-check.mjs`

- [ ] Add failing checks for Prisma models, SQL tables, listening routes, keyword search functions, volume builder, and scheduler wiring.
- [ ] Run `npm run smoke` and confirm the new checks fail.

### Task 2: Data Model

**Files:**
- Modify: `backend/schema_full.sql`
- Modify: `backend/prisma/schema.prisma`

- [ ] Add `keyword_groups`, `search_runs`, `search_results`, and `search_volume`.
- [ ] Add Prisma models `KeywordGroup`, `SearchRun`, `SearchResult`, and `SearchVolume`.
- [ ] Run `npx prisma validate` and `npx prisma generate`.

### Task 3: Listening Services

**Files:**
- Create: `backend/src/listening/types.ts`
- Create: `backend/src/listening/volume.ts`
- Create: `backend/src/listening/apifyKeywordSearch.ts`
- Create: `backend/src/listening/searchService.ts`

- [ ] Normalize platform search results into one internal shape.
- [ ] Build volume buckets by day/week/month.
- [ ] Persist classified results, run counts, volume rows, and insights summary.
- [ ] Broadcast high-urgency real-time alerts.

### Task 4: Routes

**Files:**
- Create: `backend/src/routes/listening.ts`
- Modify: `backend/src/server.ts`

- [ ] Implement keyword-group create/list/delete/toggle routes.
- [ ] Implement search, runs, results, volume, status, feed, and engage routes.
- [ ] Mount at `/api/v1/listening`.

### Task 5: Scheduler

**Files:**
- Modify: `backend/src/automation/scheduler.ts`

- [ ] Add 15-minute active keyword group monitoring.
- [ ] Reuse the listening service and keep existing automation behavior intact.

### Task 6: Verification

**Files:**
- All touched files

- [ ] Run Prisma validation and generation.
- [ ] Run `npm run build`.
- [ ] Run `npm run type-check`.
- [ ] Run `npm run smoke`.
- [ ] Run `npm audit`.

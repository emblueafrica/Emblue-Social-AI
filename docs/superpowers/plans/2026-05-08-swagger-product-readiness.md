# Swagger Product Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Swagger UI endpoint testing and document every external API/tool needed to operate the platform.

**Architecture:** Use a static OpenAPI 3.0 document exported from TypeScript and served with `swagger-ui-express`. Keep docs public but controlled by `ENABLE_SWAGGER=false` for production shutdown.

**Tech Stack:** Express, TypeScript, Swagger UI Express, OpenAPI 3.0.

---

### Task 1: Smoke Coverage

**Files:**
- Modify: `backend/scripts/smoke-check.mjs`

- [ ] Add failing checks for docs route, OpenAPI spec, bearer auth, route mount, dependencies, and product-readiness guide.
- [ ] Run `npm run smoke` and confirm Swagger checks fail.

### Task 2: Dependencies

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`

- [ ] Install `swagger-ui-express` and `@types/swagger-ui-express`.

### Task 3: OpenAPI And Route

**Files:**
- Create: `backend/src/docs/openapi.ts`
- Create: `backend/src/routes/docs.ts`
- Modify: `backend/src/server.ts`

- [ ] Add OpenAPI document covering every mounted backend route.
- [ ] Add Swagger UI route and JSON route.
- [ ] Mount docs before auth middleware.

### Task 4: Product Readiness Guide

**Files:**
- Create: `docs/Social_Emblue_AI_API_Tools_Product_Readiness_Guide.md`
- Modify: `backend/.env.example`

- [ ] List provider accounts, API keys, OAuth flows, app review needs, and production handling.
- [ ] Add Swagger-related env flags.

### Task 5: Verification

**Files:**
- All touched files

- [ ] Run `npm run build`.
- [ ] Run `npm run type-check`.
- [ ] Run `npm run smoke`.
- [ ] Run `npm audit`.

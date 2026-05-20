# Account Lifecycle RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the RBAC onboarding layer with user status, Supabase Admin account creation, super admin bootstrap, client team invites, and lifecycle emails.

**Architecture:** Keep Supabase Auth as identity only and keep Prisma as the authorization source. Extend the existing `app_users`, `platform_users`, `brand_memberships`, and `client_signup_requests` design with account status and team invitations instead of replacing the membership model with a single `brand_id`.

**Tech Stack:** Express, TypeScript, Prisma, Supabase Auth Admin REST API via Node 18 `fetch`, Resend email utility, existing smoke script.

---

### Task 1: Lifecycle Contract Checks

**Files:**
- Modify: `backend/scripts/smoke-check.mjs`

- [ ] Add smoke checks for `AppUserStatus`, `TeamInvitation`, Supabase Admin service, bootstrap, admin user lifecycle routes, team invitation routes, emails, Swagger docs, and env variables.
- [ ] Run `npm run smoke` and confirm the new checks fail before implementation.

### Task 2: Database Schema

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/schema_full.sql`
- Create: `backend/prisma/migrations/20260509_add_account_lifecycle/migration.sql`
- Modify: `backend/.env.example`
- Modify: `backend/src/types/index.ts`

- [ ] Add `AppUserStatus` and `TeamInvitationStatus`.
- [ ] Add `status` to `AppUser`.
- [ ] Add `client_member` to `BrandRole`.
- [ ] Add `TeamInvitation`.
- [ ] Add env documentation for `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD`.

### Task 3: Supabase Admin And Auth Lifecycle

**Files:**
- Create: `backend/src/auth/supabaseAdmin.ts`
- Create: `backend/src/auth/bootstrap.ts`
- Modify: `backend/src/rbac/service.ts`
- Modify: `backend/src/middleware/auth.ts`
- Modify: `backend/src/server.ts`

- [ ] Implement `createSupabaseUser()` using Supabase Auth Admin REST API.
- [ ] Implement `bootstrapSuperAdmin()` using `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD`.
- [ ] Load and expose `app_users.status` in auth context.
- [ ] Block suspended and rejected accounts except for `/api/v1/auth/me`.
- [ ] Run bootstrap during server startup.

### Task 4: Admin And Team Workflows

**Files:**
- Modify: `backend/src/routes/admin.ts`
- Create: `backend/src/routes/team.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/src/utils/email.ts`

- [ ] Update platform-admin creation to create Supabase Auth accounts when no `user_id` is provided.
- [ ] Add admin suspend and activate routes.
- [ ] Update signup approval/rejection to update user status and send emails.
- [ ] Add client-owner team invitation creation/listing and authenticated invite acceptance.

### Task 5: Docs And Verification

**Files:**
- Modify: `backend/src/docs/openapi.ts`
- Modify: `docs/Social_Emblue_AI_API_Tools_Product_Readiness_Guide.md`

- [ ] Document new lifecycle routes and request/response schemas.
- [ ] Run `npx prisma generate`.
- [ ] Run `npm run build`, `npm run type-check`, `npm run smoke`, `npm run lint`, `npx prisma validate`, and `npm audit --audit-level=moderate`.

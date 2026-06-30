# Editable AI Drafts And Campaign Template Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow operators to edit AI reply drafts and enforce a 150-character campaign reply-template limit.

**Architecture:** Keep editable text as queue-item keyed frontend state and resolve it ahead of generated/backend text. Use small validation helpers for the frontend limit and backend request validation so boundary behavior is testable and consistent.

**Tech Stack:** Next.js 15, React 19, TypeScript, Express, Node test runner.

---

### Task 1: Add testable limits and draft resolution

**Files:**
- Create: `Frontend/lib/reply-drafts.ts`
- Create: `Frontend/lib/campaign-limits.ts`
- Create: `Frontend/tests/reply-drafts.test.ts`
- Create: `backend/src/campaigns/templateValidation.ts`
- Create: `backend/tests/campaignTemplateValidation.test.ts`

- [ ] Write failing tests for edited-draft precedence and 150/151-character validation.
- [ ] Run both tests and confirm they fail because the helpers do not exist.
- [ ] Add the smallest helper implementations.
- [ ] Run both tests and confirm they pass.

### Task 2: Wire production behavior

**Files:**
- Modify: `Frontend/app/ai-reply-engine/page.tsx`
- Modify: `Frontend/components/dashboard/NewCampaignModal.tsx`
- Modify: `backend/src/routes/campaigns.ts`

- [ ] Replace the read-only draft panel with a controlled textarea.
- [ ] Use edited text for copying and approval, and reset it after regeneration or completed queue actions.
- [ ] Apply the 150-character limit and counter to campaign forms.
- [ ] Reject oversized template fields in campaign create/update routes.

### Task 3: Verify

**Files:**
- Verify all modified files.

- [ ] Run focused frontend and backend tests.
- [ ] Run `npm run build` in `backend`.
- [ ] Run `npm run build` in `Frontend`.

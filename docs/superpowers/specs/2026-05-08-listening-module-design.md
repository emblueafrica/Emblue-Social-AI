# Listening Module Design

## Scope

Build the backend pieces required by PRD v3.1 Tool 1: Advanced Social Listening. This is backend-only work. The frontend Search Inbox can consume the new APIs later.

## Architecture

The module adds a separate keyword-listening data stream instead of mixing keyword results into the existing own-post `social_messages` flow. Prisma models mirror the PRD tables: `keyword_groups`, `search_runs`, `search_results`, and `search_volume`.

The service layer owns Apify keyword searches, normalization, Agent 1 classification, result persistence, volume aggregation, Agent 2 clustering, and Agent 10 insights. API routes expose keyword-group CRUD, async search-run creation, run status/results/volume, real-time feed, and result engagement.

## Data Flow

Real-time monitoring reads active keyword groups every 15 minutes, creates a `search_run`, searches configured platforms, classifies results, stores `search_results`, builds `search_volume`, updates run counts, and broadcasts high-urgency alerts through SSE.

Historical search uses the same pipeline with an explicit date range. It returns a `run_id` immediately and processes asynchronously.

## Error Handling

Search runs move through `pending`, `running`, `complete`, or `failed`. Platform scraper errors are collected in the run error message; successful partial results are still persisted when available.

## Testing

The existing smoke-check script becomes the executable PRD coverage guard: it verifies the schema, Prisma models, listening route mount, service functions, scheduler wiring, and route exports. TypeScript build/type-check and Prisma validation remain the integration checks.

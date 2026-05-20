# Swagger And Product Readiness Design

## Scope

Add backend API documentation and testing through Swagger UI, then document all external accounts, API keys, and approval steps needed to operate Social Emblue AI as a hosted product.

## Design

Swagger will be served by the backend at `/api-docs`, with the raw OpenAPI document available at `/api-docs.json` and `/api-docs/json`. The OpenAPI document is maintained as a TypeScript object in `backend/src/docs/openapi.ts`, which keeps documentation close to the backend source and avoids relying on comment parsing.

The docs include Bearer JWT auth so protected endpoints can be tested by pasting a Supabase access token into Swagger's Authorize button. Public endpoints are explicitly marked without auth.

## Product Readiness Document

The product guide lists the provider accounts and API credentials needed for production: Supabase/Postgres, Anthropic, Apify, Meta, X, TikTok, Cloudinary, Resend, Redis, OpenAI, hosting/domain/monitoring, and OAuth app review requirements.

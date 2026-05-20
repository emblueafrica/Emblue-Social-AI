# Social Emblue AI API Tools And Product Readiness Guide

This document explains, in non-technical terms, what Social Emblue AI needs before it can be launched for real companies, how those companies connect their social accounts, and which external tools or API keys the platform owner must prepare.

## What The System Does

Social Emblue AI is a social intelligence and engagement platform. A company uses it to connect its brand social accounts, listen for conversations across public social platforms, understand audience clusters, generate response and campaign ideas, approve engagement, and track campaign performance.

The platform is designed so customers use the product through your hosted application. They do not receive or copy your licensed backend code.

## How A Company Uses It

1. The company signs in to your hosted Social Emblue AI dashboard.
2. They create or select a brand workspace.
3. They connect their Facebook, Instagram, X, TikTok, or other supported social accounts through official OAuth connection screens.
4. The system stores the approved connection for that brand workspace.
5. The company adds keywords, hashtags, competitors, campaign links, or post URLs they want to monitor.
6. Social Emblue AI collects relevant public mentions and connected-account events.
7. The AI agents analyze the data, group audiences, identify risks, suggest replies, score creative ideas, and build campaign recommendations.
8. The company reviews the suggested actions inside the dashboard.
9. Approved replies, campaigns, and engagement actions are sent through the connected social accounts where the platform API allows it.
10. The company views performance, conversions, tracked links, sentiment, reach, risk, and campaign summaries.

## Client Onboarding And Access Approval

Social Emblue AI uses Supabase for login only. A login proves who the person is, but it does not decide what they can access.

Access is owned by the backend:

1. Your internal super admin emails are listed in `SUPERADMIN_EMAILS`.
2. Super admins can create platform admins.
3. A new client signs up in the frontend with Supabase Auth.
4. The client submits a company onboarding request.
5. The request stays pending. The client cannot use brand tools yet.
6. A platform admin reviews the request.
7. On approval, the backend creates the brand workspace, assigns the correct B2B or B2C client role, and grants the selected tools for the chosen plan.
8. The frontend checks `/api/v1/auth/me` after login to decide whether to show onboarding, pending approval, or the main app.

There are three platform access levels:

| Access Level | What They Can Do |
| --- | --- |
| Super admin | External top-level authority. Can access all workspaces, override tool access, create/deactivate admins, suspend or restore accounts, and view audit logs. |
| Admin | Social Emblue worker. Can approve clients, manage workspaces, provision tools, and operate managed-service client accounts. Stored as `platform_admin` in the backend. |
| Client | Customer-side user. Can access only the brand workspaces and actions allowed by their membership role. |

Client roles are scoped to a single brand workspace:

| Client Role | Intended Use |
| --- | --- |
| `client_owner` | B2B licensed account owner. Can manage the workspace, connected accounts, team, and enabled tools. |
| `client_member` | B2B licensed team member. Can use enabled tools without platform/admin powers. |
| `client_viewer` | B2C managed-service client. Can view reports, results, and deliverables. |
| `client_approver` | B2C managed-service client. Can approve posts, replies, campaigns, or deliverables. |

## B2B And B2C Workspace Types

Each brand workspace has an `account_type`.

| Account Type | Meaning |
| --- | --- |
| `b2b_licensed` | The business pays to use selected Social Emblue tools themselves. Their plan controls which tools are unlocked. |
| `b2c_managed` | The client pays Social Emblue to operate the tools for them. The client gets a limited portal for reports, approvals, briefs, assets, and communication. |
| `internal` | Social Emblue-owned internal/testing workspace. Only super admins should create or approve this type. |

B2B licensed flow:

1. Client signs up and requests a `b2b_licensed` workspace.
2. Admin approves the request and assigns `client_owner`.
3. Admin provisions the paid tools through `brand_tool_access`.
4. The client logs into the main dashboard and sees only enabled tools.

B2C managed-service flow:

1. Client signs up or is onboarded as a `b2c_managed` workspace.
2. Admin approves the request and assigns `client_viewer` or `client_approver`.
3. Social Emblue admins operate the full internal dashboard for that client.
4. The client logs into a limited portal for reporting and approval, not the full tool workspace.

Sensitive RBAC and provisioning actions are written to `audit_logs`. Super admins can review audit logs through the admin API.

## Account Lifecycle

The backend now tracks account state in the application database. A user can be `pending`, `active`, `suspended`, or `rejected`.

Super admin bootstrap can be configured with:

| Key | Purpose |
| --- | --- |
| `SUPER_ADMIN_EMAIL` | Creates the first internal super admin login if it does not already exist. |
| `SUPER_ADMIN_PASSWORD` | Temporary password used only for that first Supabase Auth account creation. Rotate it after setup. |
| `OAUTH_STATE_SECRET` | Optional dedicated signing secret for social-account OAuth state values. If omitted, the backend falls back to `SUPABASE_JWT_SECRET`. |

Operational rules:

1. Pending client users can sign in and see their approval state.
2. Active users can use the workspaces and tools their role allows.
3. Suspended users are blocked from normal API use until reactivated.
4. Rejected users are blocked after their registration request is rejected.
5. Super admins can create platform admin accounts and suspend or reactivate users.

## Team Invitations

The first approved client becomes the `client_owner` for the brand workspace. After approval, that client owner can invite team members.

Team member flow:

1. Client owner sends an invitation to an email address.
2. The backend stores a hashed invitation token and emails an invite link.
3. The invited person signs up or signs in through Supabase Auth.
4. The invited person accepts the token.
5. The backend assigns them to the same brand as `client_member`.

Team members do not create new brand workspaces and do not go through the platform approval queue.

## How Customers Connect Social Accounts

Customers should not paste your platform API keys into the product.

They should connect accounts through OAuth. OAuth is the standard permission flow used by Facebook, Instagram, X, TikTok, Google, and similar platforms.

In practice:

1. The customer clicks "Connect Instagram" or "Connect X" inside your dashboard.
2. They are redirected to the official social platform login and permission screen.
3. They approve the requested permissions.
4. The platform sends Social Emblue AI a secure authorization response.
5. Social Emblue AI stores the connection for that customer brand.
6. The customer can disconnect the account later.

This keeps your master platform credentials private while still allowing each customer to authorize their own accounts.

## Platform Owner Accounts To Create

These are accounts your company, as the product owner, needs before launch.

| Area | Tool Or Account | Why It Is Needed |
| --- | --- | --- |
| Hosting | Railway, Render, Fly.io, AWS, Azure, or similar | Runs the backend API online. |
| Database | Supabase Postgres or managed PostgreSQL | Stores brands, accounts, messages, campaigns, links, and results. |
| Authentication | Supabase Auth | Issues user login tokens used by the backend. |
| AI Reasoning | Anthropic | Powers analysis, strategy, reply, insight, and risk agents. |
| Optional AI Support | OpenAI | Useful for embeddings, deduplication, classification, and future AI features. |
| Public Social Listening | Apify | Collects public posts and search results from social platforms where official APIs are limited. |
| Facebook And Instagram | Meta Developer App | Lets customers connect Facebook Pages and Instagram business accounts. |
| X | X Developer App | Lets customers connect X accounts and use approved X API features. |
| TikTok | TikTok Developer App | Lets customers connect TikTok accounts where approved by TikTok. |
| Email | Resend | Sends reports, alerts, onboarding, or notifications. |
| Media Storage | Cloudinary | Stores uploaded or generated images and creative assets. |
| Background Jobs | Redis or Upstash Redis | Runs scheduled monitoring and queue work more reliably at production scale. |
| Link Tracking | Custom short domain | Used for tracked campaign links and attribution. |
| API Testing | Swagger UI | Lets your team test every backend endpoint from a browser. |
| Monitoring | Sentry, Logtail, Datadog, or similar | Tracks errors, performance issues, and production incidents. |

## Required API Keys And Settings

These are the environment values that must be placed in the backend hosting platform. They should never be shared publicly or committed into source code.

### Core Backend

| Key | Purpose |
| --- | --- |
| `PORT` | The port the backend runs on. |
| `NODE_ENV` | Sets development or production behavior. |
| `FRONTEND_URL` | The official web app URL allowed to call the backend. |
| `API_BASE_URL` | The public backend URL shown in Swagger and callbacks. |
| `ENABLE_SWAGGER` | Enables or disables Swagger UI. |
| `DISABLE_AUTOMATION_AUTOSTART` | Optional local-development switch. Keep false in production unless operations intentionally disables scheduled automation. |

### Database And Login

| Key | Purpose |
| --- | --- |
| `DATABASE_URL` | Connects the backend to PostgreSQL or Supabase Postgres. |
| `SUPABASE_URL` | Connects to the Supabase project. |
| `SUPABASE_ANON_KEY` | Used by client-facing Supabase login flows. |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend-only privileged key. Keep private. |
| `SUPABASE_JWT_SECRET` | Lets the backend verify user login tokens. |
| `SUPERADMIN_EMAILS` | Comma-separated internal owner emails that bootstrap super admin access. |
| `SUPER_ADMIN_EMAIL` | Optional first super admin account email created by backend bootstrap. |
| `SUPER_ADMIN_PASSWORD` | Optional first super admin temporary password for Supabase Auth creation. |
| `OAUTH_STATE_SECRET` | Signs social-account connection state values for Meta and X callbacks. |

### AI

| Key | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Required for the MVP AI agents. |
| `OPENAI_API_KEY` | Optional for extra AI workflows such as embeddings and deduplication. |

### Social Listening

| Key | Purpose |
| --- | --- |
| `APIFY_API_TOKEN` | Lets the backend run Apify actors for public social listening. |

Apify actor access should be prepared for Instagram, X, Reddit, YouTube, TikTok, and Facebook public search where legally and commercially allowed.

### Meta: Facebook And Instagram

| Key | Purpose |
| --- | --- |
| `META_APP_ID` | Identifies your Meta developer app. |
| `META_APP_SECRET` | Private app secret from Meta. |
| `META_REDIRECT_URI` | Where Meta sends customers after approval. |
| `META_VERIFY_TOKEN` | Used to verify Meta webhooks. |
| `META_PAGE_ACCESS_TOKEN` | Optional platform token for internal testing or special owned-page workflows. |

Meta will normally require app review before real customer use. Permissions depend on the features you launch, but typically include Facebook Login, Pages access, Instagram business account access, messaging or comment permissions, and webhook subscriptions.

### X

| Key | Purpose |
| --- | --- |
| `X_CLIENT_ID` | Identifies your X developer app. |
| `X_CLIENT_SECRET` | Private app secret from X. |
| `X_REDIRECT_URI` | Where X sends customers after approval. |
| `X_BEARER_TOKEN` | App-level token for allowed X API access. |
| `X_OAUTH_TOKEN` | Optional token for testing or owner-account actions. |

X API access depends on the paid developer tier and approved permissions.

### TikTok

| Key | Purpose |
| --- | --- |
| `TIKTOK_CLIENT_KEY` | Identifies your TikTok developer app. |
| `TIKTOK_CLIENT_SECRET` | Private TikTok app secret. |
| `TIKTOK_REDIRECT_URI` | Where TikTok sends customers after approval. |
| `TIKTOK_ACCESS_TOKEN` | Optional token for testing or owner-account workflows. |

TikTok connection should be completed through OAuth and approved scopes before customer launch.

### Email, Media, Jobs, And Links

| Key | Purpose |
| --- | --- |
| `RESEND_API_KEY` | Sends transactional emails and alerts. |
| `EMAIL_FROM` | Verified sender address for outgoing emails. |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary account name. |
| `CLOUDINARY_API_KEY` | Cloudinary API key. |
| `CLOUDINARY_API_SECRET` | Cloudinary private secret. |
| `REDIS_URL` | Enables production queue and background job processing. |
| `LINK_BASE_URL` | Public domain used for tracked campaign links. |

## Tool Access & Packaging

Social Emblue AI now supports packaging by brand. Each brand can be granted or denied access to each product tool without changing the licensed backend code.

The backend stores this in the `brand_tool_access` table. Each row says which brand has access to which tool, whether that access is active, what plan name it belongs to, when it was activated, and when it expires. Existing brands are backfilled with all tools on the `legacy` plan during migration so current users do not lose access.

Only internal Social Emblue AI users with backend platform roles can provision or upgrade tools for a brand. Super admins are bootstrapped from `SUPERADMIN_EMAILS`, and super admins can create platform admins. Clients can view access for their own brand, but they cannot unlock paid tools for themselves.

Frontend usage:

```text
GET /api/v1/tools/my-access
```

The client owner response is:

```json
{ "enabled": ["tool_1", "tool_3", "tool_7"], "plan": "listen_respond" }
```

Future regular team users can receive the enabled tools without plan details. The frontend should use this list to show enabled navigation items, hide unavailable tools where appropriate, and show locked tools with a padlock icon and upgrade prompt.

Admin provisioning:

```text
POST /api/v1/admin/provision
```

A platform admin sends the brand, tool list, plan name, and optional expiry date. This is used after a customer subscribes, upgrades, downgrades, or renews.

Future Stripe webhook:

1. Stripe fires `subscription.created` or `subscription.updated`.
2. The backend verifies the Stripe signature.
3. The backend maps the paid `plan_name` to `tool_ids`.
4. The backend calls the same provisioning service used by `/api/v1/admin/provision`.
5. The brand receives access immediately.

### Tool Reference

| Tool ID | Tool Name | Route Group |
| --- | --- | --- |
| `tool_1` | Advanced Social Listening | `/api/v1/listening/*`, `/api/v1/ingest` |
| `tool_2` | Search & Clustering | `/api/v1/cluster`, `/api/v1/strategize` |
| `tool_3` | AI Reply Engine | `/api/v1/reply`, `/api/v1/rt/queue/approve` |
| `tool_4` | Comment to DM Funnel | Registered, but no live route yet |
| `tool_5` | Social Response Dashboard | `/api/v1/dashboard/*`, KPI, realtime dashboard routes |
| `tool_6` | Attribution & Links | `/api/v1/attribution/*` |
| `tool_7` | Creative Predictor | `/api/v1/creative/*` |
| `tool_8` | Comment Mining | `/api/v1/insights/*` |
| `tool_9` | Campaign War Room | `/api/v1/warroom/*` |
| `tool_10` | Engage the Engagers | `/api/v1/campaigns/*` |

Dependency rules:

| Tool | Dependency |
| --- | --- |
| `tool_2` | Requires `tool_1` because clustering needs listening data. |
| `tool_10` | Requires `tool_3` because engagement uses the reply engine. |

### Suggested Packages

Pricing guidance should stay in sales and billing systems, not hard-coded in the backend. These are recommended commercial packages:

| Package | Included Tools |
| --- | --- |
| Listen | `tool_1` |
| Listen Plus | `tool_1`, `tool_2`, `tool_5` |
| Respond | `tool_1`, `tool_3`, `tool_5` |
| Campaign Starter | `tool_1`, `tool_3`, `tool_6`, `tool_10` |
| Creative Lab | `tool_7`, `tool_8` |
| Insights Suite | `tool_1`, `tool_2`, `tool_5`, `tool_8`, `tool_9` |
| Growth Suite | `tool_1`, `tool_2`, `tool_3`, `tool_5`, `tool_6`, `tool_10` |
| Full Suite | `tool_1` through `tool_10` |

## Swagger Testing

Swagger UI is included so your team can test endpoints from a browser.

Local development URL:

```text
http://localhost:3001/api-docs
```

Raw OpenAPI JSON:

```text
http://localhost:3001/api-docs.json
```

Most business endpoints require a valid login token. In Swagger, use the Authorize button and paste a Supabase user JWT as a Bearer token.

## Backend Security Controls

The project root includes `CLAUDE.md` as the security policy for generated work in this project.

Current backend controls:

| Area | Backend Control |
| --- | --- |
| Secrets | `.env` files are gitignored and `.env.example` lists required names without values. |
| Rate limiting | General API is limited to 60 requests/minute, auth/onboarding to 5 requests/15 minutes, AI routes to 10 requests/minute, and upload paths to 5 requests/minute. |
| Auth | Supabase verifies identity; backend Prisma tables own roles, status, brand membership, and tool access. |
| CORS | Credentialed wildcard CORS is disabled; production should set explicit `FRONTEND_URL` origins. |
| Headers | CSP, frame denial, MIME sniff prevention, HSTS, referrer policy, and permissions policy are set globally. |
| OAuth | Meta and X connection state is signed and expires before callbacks are accepted. |
| Uploads | Cloudinary image uploads validate extension, image signature, size, and UUID-style public IDs. |
| Errors | Global error handling returns generic server errors instead of stack traces. |
| Dependencies | `npm audit --audit-level=moderate` is part of the verification checklist. |

Public endpoints include:

| Endpoint | Purpose |
| --- | --- |
| `/` | Basic service status. |
| `/api/v1/health` | Health check for hosting and monitoring. |
| `/api-docs` | Swagger UI. |
| `/api-docs.json` | Raw OpenAPI spec. |
| `/api/v1/rt/webhook/meta` | Meta webhook receiver. |
| `/api/v1/rt/events/convert` | Conversion event receiver. |

## Launch Readiness Checklist

Before selling this to companies, complete this checklist.

| Item | Status Needed |
| --- | --- |
| Backend builds successfully | Required |
| Prisma database schema deployed | Required |
| Supabase Auth configured | Required |
| Production PostgreSQL database ready | Required |
| Anthropic API key active | Required |
| Apify token active for social listening | Required for listening MVP |
| Meta developer app reviewed | Required for Facebook and Instagram customer use |
| X developer app approved | Required for X customer use |
| TikTok developer app approved | Required for TikTok customer use |
| Redis queue configured | Strongly recommended for production |
| Email sender verified | Recommended |
| Cloudinary configured | Recommended if creative uploads are used |
| Custom tracking domain configured | Recommended for campaigns |
| Error monitoring configured | Strongly recommended |
| Token storage encryption reviewed | Required before handling real customer tokens at scale |
| Privacy policy and terms published | Required |
| Customer data deletion process documented | Required |

## Important Product Boundary

Companies should access Social Emblue AI as a hosted software product. They should receive logins, account connection screens, dashboards, reports, and API access only if you choose to expose a public partner API.

They should not receive:

| Do Not Share | Reason |
| --- | --- |
| Backend source code | Protects licensed product IP. |
| Master platform API keys | Prevents abuse and account compromise. |
| Database credentials | Protects customer data. |
| Supabase service role key | Gives administrator-level access. |
| Meta, X, TikTok app secrets | These belong only in your secure backend environment. |

The correct customer flow is hosted access plus OAuth account connection.

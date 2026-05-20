# Social Emblue AI — Deployment Guide
## TypeScript + Node.js + Express + Supabase + Railway + Vercel

---

## Prerequisites

- GitHub account
- Railway account (railway.app)
- Supabase account (supabase.com)
- Vercel account (vercel.com)
- Anthropic API key (console.anthropic.com)

---

## Step 1 — Supabase Database Setup

1. Go to supabase.com → New Project
2. Name it `social-emblue-ai` — choose a strong database password — save it
3. Once the project is created, go to **SQL Editor**
4. Open `backend/schema_full.sql` from this repo
5. Paste the entire contents into the SQL Editor
6. Click **Run** — all 25+ tables are created in one shot
7. Go to **Settings → API** and copy:
   - `Project URL` → this is your `SUPABASE_URL`
   - `anon public` key → this is your `SUPABASE_ANON_KEY`
   - `service_role` key → this is your `SUPABASE_SERVICE_ROLE_KEY`
8. Go to **Settings → API → JWT Settings** and copy the `JWT Secret`
9. Go to **Settings → Database** and copy the `Connection string (URI)` → this is your `DATABASE_URL`

---

## Step 2 — Push Code to GitHub

```bash
git init
git add .
git commit -m "Initial commit — Social Emblue AI TypeScript"
git remote add origin https://github.com/YOUR_USERNAME/social-emblue-ai.git
git push -u origin main
```

---

## Step 3 — Deploy Backend to Railway

1. Go to railway.app → New Project → Deploy from GitHub repo
2. Select your `social-emblue-ai` repo
3. Set the Railway service root directory to `backend`
4. Railway detects `backend/railway.toml` automatically
5. The build command runs: `npm install --legacy-peer-deps && npm run build`
6. The start command runs: `npm start`
7. Go to **Variables** tab and add ALL required environment variables:

```
NODE_ENV                  = production
FRONTEND_URL              = https://your-app.vercel.app   (update after Step 4)
ANTHROPIC_API_KEY         = sk-ant-...
DATABASE_URL              = postgresql://...
SUPABASE_URL              = https://xxx.supabase.co
SUPABASE_ANON_KEY         = eyJ...
SUPABASE_SERVICE_ROLE_KEY = eyJ...
SUPABASE_JWT_SECRET       = your-jwt-secret
LINK_BASE_URL             = https://your-railway-url.railway.app
```

7. Railway gives you a URL like `https://social-emblue-api-production.up.railway.app`
8. Test it: open that URL in your browser — you should see:
   ```json
   {"name":"Social Emblue AI","version":"2.0.0","lang":"TypeScript","status":"running"}
   ```

---

## Step 4 — Deploy Frontend to Vercel

1. Go to vercel.com → New Project → Import from GitHub
2. Select your `social-emblue-ai` repo
3. Vercel detects `vercel.json` automatically — no configuration needed
4. Click **Deploy**
5. Vercel gives you a URL like `https://social-emblue-ai.vercel.app`
6. Go back to Railway → Variables → update `FRONTEND_URL` to this Vercel URL
7. Open `frontend/app.html` and update the `API` constant at the top:
   ```javascript
   const API = 'https://social-emblue-api-production.up.railway.app/api/v1';
   ```
8. Commit and push — both Railway and Vercel redeploy automatically

---

## Step 5 — Connect Social Platforms

### Instagram + Facebook (Meta)
1. Go to developers.facebook.com → Create App → Business type
2. Add products: **Instagram Basic Display** and **Messenger**
3. Set OAuth redirect URI: `https://your-railway-url/api/v1/auth/meta/callback`
4. Add to Railway variables: `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`
5. Submit for **App Review** to get: `instagram_manage_comments`, `pages_manage_engagement`
   ⚠️ This takes 4–12 weeks. Start this on Day 1.

### X (Twitter)
1. Go to developer.twitter.com → Create App → Project + App
2. Enable OAuth 2.0 → set callback: `https://your-railway-url/api/v1/auth/x/callback`
3. Add to Railway: `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI`, `X_BEARER_TOKEN`

### TikTok
1. Go to developers.tiktok.com → Create App
2. Add product: **Content Posting API** — request scope: `video.comment`
3. Set redirect: `https://your-railway-url/api/v1/auth/tiktok/callback`
4. Add to Railway: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`

---

## Step 6 — Month 2 Additions

### Activate BullMQ Queue (replaces setInterval scheduler)
1. Go to upstash.com → Create Redis Database → free tier
2. Copy the `REDIS_URL`
3. Add to Railway variables: `REDIS_URL`
4. The server automatically switches from setInterval to BullMQ on next deploy

### Activate Apify Scraper
1. Go to apify.com → Starter plan ($29/mo)
2. Copy your API token
3. Add to Railway: `APIFY_API_TOKEN`

### Activate Email Reports (Resend)
1. Go to resend.com → Create API key → free tier (3,000/mo)
2. Add to Railway: `RESEND_API_KEY`, `EMAIL_FROM`

### Activate Image Uploads (Cloudinary)
1. Go to cloudinary.com → free account
2. Add to Railway: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`

---

## Verify Everything Is Working

```bash
# Health check
curl https://your-railway-url.railway.app/

# Test auth middleware
curl https://your-railway-url.railway.app/api/v1/ingest
# Should return 401 Unauthorized (not 500 — proves auth is working)

# Check logs
railway logs --tail
```

---

## Folder Structure Reference

```
social-emblue-ai/
|-- backend/
|   |-- src/
|   |   |-- server.ts              # Entry point
|   |   |-- types/index.ts         # TypeScript interfaces
|   |   |-- middleware/auth.ts     # JWT protection
|   |   |-- agents/                # AI agents
|   |   |-- auth/                  # OAuth, platform sync, Apify
|   |   |-- automation/            # Scheduler
|   |   |-- db/                    # PostgreSQL pool and queries
|   |   |-- queue/                 # BullMQ jobs
|   |   |-- routes/                # API endpoints
|   |   |-- stream/                # Engage engine, SSE, pipeline
|   |   `-- utils/                 # Email, Cloudinary, embeddings
|   |-- schema_full.sql            # Paste into Supabase SQL Editor
|   |-- railway.toml               # Railway config
|   |-- .env.example               # Copy to .env for local dev
|   |-- tsconfig.json              # TypeScript config
|   `-- package.json               # Backend scripts and dependencies
|-- Frontend/
|-- vercel.json                    # Frontend deployment config
|-- app.html
`-- client-dashboard.html
```

---

## Local Development

```bash
# Clone and install
git clone https://github.com/YOUR_USERNAME/social-emblue-ai.git
cd social-emblue-ai
cd backend
npm install --legacy-peer-deps

# Copy and fill in environment variables
cp .env.example .env
# Edit .env — add ANTHROPIC_API_KEY and DATABASE_URL at minimum

# Run with hot reload
npm run dev

# Type check only (no build)
npm run type-check

# Build for production
npm run build

# Run production build
npm start
```

---

## Common Issues

| Issue | Fix |
|-------|-----|
| `tsc: command not found` | Run `npm install --legacy-peer-deps` first |
| `Cannot find module './routes/api'` | Run `npm run build` — TypeScript must compile before `npm start` |
| `401 Unauthorized` on all routes | Check `SUPABASE_JWT_SECRET` is set correctly in Railway |
| `connection refused` on database | Check `DATABASE_URL` includes the password and points to Supabase |
| Railway build fails | Check build logs — most common cause is missing env variable during build |
| Vercel shows blank page | Update the `API` constant in `app.html` to your Railway URL |
| Meta OAuth fails | Redirect URI in Meta dashboard must exactly match `META_REDIRECT_URI` |

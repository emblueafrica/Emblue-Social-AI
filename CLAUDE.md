# Project Security Rules

Every app generated in this project must follow these rules.

## 1. Secrets And Environment Variables

- Never expose secrets in frontend code.
- API keys, tokens, database URLs, service credentials, and private config must live in environment variables.
- `.env`, `.env.local`, and `.env.*.local` must remain ignored by git.
- Frontend-exposed variables such as `NEXT_PUBLIC_*` or `VITE_*` must never contain secret keys.
- Backend secrets must be read through `process.env` and must not be returned in API responses.
- Keep `.env.example` updated with variable names only.

## 2. Rate Limiting

- Every public-facing endpoint must have rate limiting.
- Auth and onboarding flows should be stricter than normal API routes.
- AI and expensive endpoints must have lower limits than general API routes.
- Rate-limited responses must return `429` and `Retry-After`.

## 3. Input Validation And Sanitization

- Validate all inputs server-side.
- Validate type, length, size, enum values, and required fields.
- Use Prisma or parameterized queries. Never concatenate user input into SQL.
- Sanitize strings before rendering or sending as HTML.

## 4. Authentication And Authorization

- Supabase Auth proves identity only.
- Backend RBAC and tool access must come from Prisma tables.
- Never store plaintext passwords in the backend database.
- Every protected request must verify identity and permission for the requested resource.
- Sensitive/admin routes must use explicit role checks.

## 5. SQL And Database Security

- Prefer Prisma ORM methods.
- Do not use raw SQL string concatenation with user data.
- Do not return raw database errors to clients in production.
- Apply least privilege to production database credentials.

## 6. CORS

- Do not use wildcard CORS in production.
- Whitelist known frontend origins.
- Do not combine wildcard origins with credentialed requests.

## 7. HTTP Security Headers

- Set security headers on all responses.
- Required: CSP, `X-Frame-Options`, `X-Content-Type-Options`, HSTS, and `Referrer-Policy`.
- Remove `X-Powered-By`.

## 8. File Upload Safety

- Validate MIME/signature, extension, and file size server-side.
- Rename uploaded files to UUID-based names.
- Store media in Cloudinary or another controlled bucket, not executable web roots.

## 9. Error Handling And Logging

- Do not return stack traces, internal paths, raw secrets, or raw DB errors to clients.
- Return clear 4xx responses for validation and authorization failures.
- Log server-side errors with useful context.

## 10. Dependency Security

- Run `npm audit --audit-level=moderate` before release.
- Keep lockfiles committed.
- Avoid unmaintained or suspicious security-sensitive packages.

## 11. XSS Prevention

- Do not use `dangerouslySetInnerHTML`, `eval()`, `new Function()`, or dynamic `innerHTML` with user content.
- Escape generated HTML emails and sanitize any LLM-generated output before rendering.

## 12. Deployment Checklist

- `.env` is not committed.
- Secrets are configured in hosting provider environment variables.
- Debug behavior is off in production.
- Database is not publicly exposed beyond required trusted access.
- HTTPS is enforced.
- Rate limiting is active.
- CORS is restricted.
- Unused routes are removed or protected.

## AI/LLM Rules

- Keep AI API keys server-side only.
- Set `max_tokens` or equivalent limits on LLM calls.
- Do not send unsanitized private secrets to LLMs.
- Track AI usage by user or brand before real customer launch.
- Validate and sanitize LLM output before rendering it in a browser.

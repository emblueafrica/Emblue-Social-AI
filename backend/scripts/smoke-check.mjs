import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function readIfExists(path) {
  const fullPath = join(root, path);
  return existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : '';
}

const checks = [];

function check(name, condition) {
  checks.push({ name, passed: Boolean(condition) });
}

const server = read('src/server.ts');
const campaigns = read('src/routes/campaigns.ts');
const queries = read('src/db/queries.ts');
const authMiddleware = read('src/middleware/auth.ts');
const types = read('src/types/index.ts');
const engageEngagers = read('src/stream/engageEngagers.ts');
const rateLimitMiddleware = readIfExists('src/middleware/rateLimit.ts');
const securityHeadersMiddleware = readIfExists('src/middleware/securityHeaders.ts');
const scheduler = read('src/automation/scheduler.ts');
const queueJobs = read('src/queue/jobs.ts');
const streamPipeline = read('src/stream/pipeline.ts');
const schemaSql = read('schema_full.sql');
const platformAuth = readIfExists('src/auth/platformAuth.ts');
const apiRoutes = readIfExists('src/routes/api.ts');
const dashboardRoutes = readIfExists('src/routes/dashboard.ts');
const realtimeRoutes = readIfExists('src/routes/realtime.ts');
const listeningRoutes = readIfExists('src/routes/listening.ts');
const onboardingRoutes = readIfExists('src/routes/onboarding.ts');
const rbacService = readIfExists('src/rbac/service.ts');
const teamRoutes = readIfExists('src/routes/team.ts');
const supabaseAdminService = readIfExists('src/auth/supabaseAdmin.ts');
const bootstrapService = readIfExists('src/auth/bootstrap.ts');
const emailUtil = readIfExists('src/utils/email.ts');
const oauthState = readIfExists('src/auth/oauthState.ts');
const cloudinaryUtil = readIfExists('src/utils/cloudinary.ts');
const listeningSearchService = readIfExists('src/listening/searchService.ts');
const listeningApifySearch = readIfExists('src/listening/apifyKeywordSearch.ts');
const listeningVolume = readIfExists('src/listening/volume.ts');
const adminRoutes = readIfExists('src/routes/admin.ts');
const toolsRoutes = readIfExists('src/routes/tools.ts');
const docsRoutes = readIfExists('src/routes/docs.ts');
const openApiSpec = readIfExists('src/docs/openapi.ts');
const toolRegistry = readIfExists('src/tools/registry.ts');
const toolAccessService = readIfExists('src/tools/access.ts');
const toolAccessMiddleware = readIfExists('src/middleware/toolAccess.ts');
const productReadinessGuide = readIfExists('../docs/Social_Emblue_AI_API_Tools_Product_Readiness_Guide.md');
const projectSecurityRules = readIfExists('../CLAUDE.md');
const rootGitignore = readIfExists('../.gitignore');
const envExample = readIfExists('.env.example');
const packageJson = JSON.parse(read('package.json'));
const sourceFiles = [
  'src/routes/auth.ts',
  'src/routes/campaigns.ts',
  'src/routes/dashboard.ts',
  'src/routes/docs.ts',
  'src/routes/admin.ts',
  'src/routes/onboarding.ts',
  'src/routes/team.ts',
  'src/routes/tools.ts',
  'src/routes/listening.ts',
  'src/routes/realtime.ts',
  'src/tools/access.ts',
  'src/tools/registry.ts',
  'src/middleware/toolAccess.ts',
  'src/listening/searchService.ts',
  'src/listening/apifyKeywordSearch.ts',
  'src/listening/volume.ts',
  'src/stream/engageEngagers.ts',
  'src/stream/pipeline.ts',
  'src/stream/publisher.ts',
  'src/stream/templateManager.ts',
].map(readIfExists).join('\n');
const prismaSchemaExists = existsSync(join(root, 'prisma/schema.prisma'));
const prismaSchema = prismaSchemaExists ? read('prisma/schema.prisma') : '';

check('rate limiter middleware exists', existsSync(join(root, 'src/middleware/rateLimit.ts')));
check('server mounts rate limiter before auth', server.indexOf('app.use(apiRateLimit)') > -1 && server.indexOf('app.use(apiRateLimit)') < server.indexOf('app.use(requireAuth)'));
check('validation helpers exist', existsSync(join(root, 'src/utils/validation.ts')));
check('campaign fixed routes are before brand param route', campaigns.indexOf("router.post('/post-urls/run'") < campaigns.indexOf("router.get('/:brand_id'"));
check('campaign exact allocation validation is present', campaigns.includes('validateAllocationTotal'));
check('cluster top_phrases inserted as pg array', !queries.includes('JSON.stringify(cluster.top_phrases)'));
check('conversion endpoint public path matches mounted route', authMiddleware.includes("'/api/v1/rt/events/convert'"));
check('post URL campaign persists fetched engagers', engageEngagers.includes('campaignPostEngager.create'));
check('post URL campaign handles facebook engagers', engageEngagers.includes('fetchFacebookPostEngagers'));
check('smoke script is registered', packageJson.scripts?.smoke === 'node scripts/smoke-check.mjs');
check('prisma client dependency is installed', Boolean(packageJson.dependencies?.['@prisma/client']));
check('prisma cli dev dependency is installed', Boolean(packageJson.devDependencies?.prisma));
check('prisma schema exists', prismaSchemaExists);
check('prisma schema models core tables', prismaSchema.includes('model Brand') && prismaSchema.includes('model SocialMessage') && prismaSchema.includes('model ConnectedAccount'));
check('prisma client wrapper exists', existsSync(join(root, 'src/db/prisma.ts')));
check('central queries use prisma client', queries.includes("from './prisma'"));
check('app code avoids direct pool queries', !sourceFiles.includes('pool.query') && !sourceFiles.includes("from '../db/pool'") && !sourceFiles.includes('from "../db/pool"'));
check('legacy pg pool dependency removed', !existsSync(join(root, 'src/db/pool.ts')) && !packageJson.dependencies?.pg && !packageJson.devDependencies?.['@types/pg']);
check('listening route exists', existsSync(join(root, 'src/routes/listening.ts')));
check('server mounts listening routes', server.includes("from './routes/listening'") && server.includes("app.use('/api/v1/listening'"));
check('listening SQL tables exist', ['keyword_groups', 'search_runs', 'search_results', 'search_volume'].every(table => schemaSql.includes(`CREATE TABLE IF NOT EXISTS ${table}`)));
check('prisma schema models listening tables', ['model KeywordGroup', 'model SearchRun', 'model SearchResult', 'model SearchVolume'].every(model => prismaSchema.includes(model)));
check('listening keyword search functions exist', ['runKeywordSearch', 'searchInstagramKeyword', 'searchXKeyword', 'searchRedditKeyword', 'searchYouTubeKeyword', 'searchTikTokKeyword'].every(name => listeningApifySearch.includes(name)));
check('listening volume builder exists', listeningVolume.includes('buildVolumeChart'));
check('listening persistence service exists', listeningSearchService.includes('saveSearchResults') && listeningSearchService.includes('runListeningSearch'));
check('listening API exposes PRD routes', [
  "router.post('/keyword-groups'",
  "router.get('/keyword-groups/:brand_id'",
  "router.delete('/keyword-groups/:group_id'",
  "router.post('/keyword-groups/:group_id/toggle'",
  "router.post('/search'",
  "router.get('/runs/:brand_id'",
  "router.get('/runs/:run_id/results'",
  "router.get('/runs/:run_id/volume'",
  "router.get('/runs/:run_id/status'",
  "router.get('/feed/:brand_id'",
  "router.post('/results/:result_id/engage'",
].every(route => listeningRoutes.includes(route)));
check('scheduler runs keyword monitoring every 15 minutes', scheduler.includes('runRealtimeKeywordMonitoring') && scheduler.includes('15 * 60 * 1000'));
check('swagger ui dependency is installed', Boolean(packageJson.dependencies?.['swagger-ui-express']));
check('swagger ui types are installed', Boolean(packageJson.devDependencies?.['@types/swagger-ui-express']));
check('openapi spec exists', existsSync(join(root, 'src/docs/openapi.ts')));
check('openapi spec uses bearer auth', openApiSpec.includes('bearerAuth') && openApiSpec.includes('bearerFormat') && openApiSpec.includes('JWT'));
check('openapi spec documents mounted route groups', ['/api/v1/listening/search', '/api/v1/campaigns/post-urls/run', '/api/v1/auth/meta/connect', '/api/v1/rt/stream/{brand_id}', '/api/v1/dashboard/summary'].every(path => openApiSpec.includes(path)));
check('swagger docs route exists', existsSync(join(root, 'src/routes/docs.ts')) && docsRoutes.includes('swaggerUi.setup') && docsRoutes.includes('docsJson'));
check('server mounts swagger before auth', server.includes("from './routes/docs'") && server.includes("app.use('/api-docs'") && server.indexOf("app.use('/api-docs'") < server.indexOf('app.use(requireAuth)'));
check('server exposes raw openapi json and health', server.includes("app.get('/api-docs.json'") && server.includes("app.get('/api/v1/health'"));
check('api tools product readiness guide exists', productReadinessGuide.includes('API Tools And Product Readiness Guide') && productReadinessGuide.includes('APIFY_API_TOKEN') && productReadinessGuide.includes('OAuth'));
check('prisma schema models brand tool access', prismaSchema.includes('model BrandToolAccess') && prismaSchema.includes('@@map("brand_tool_access")'));
check('sql schema creates brand tool access table', schemaSql.includes('CREATE TABLE IF NOT EXISTS brand_tool_access') && schemaSql.includes('UNIQUE(brand_id, tool_id)'));
check('brand tool access migration exists', existsSync(join(root, 'prisma/migrations/20260508_add_brand_tool_access/migration.sql')));
check('tool registry defines ten tools and dependencies', ['tool_1','tool_2','tool_3','tool_4','tool_5','tool_6','tool_7','tool_8','tool_9','tool_10'].every(tool => toolRegistry.includes(tool)) && toolRegistry.includes("dependencies: ['tool_1']") && toolRegistry.includes("dependencies: ['tool_3']"));
check('tool access middleware uses prisma and no pool', existsSync(join(root, 'src/middleware/toolAccess.ts')) && toolAccessMiddleware.includes('requireToolAccess') && toolAccessMiddleware.includes('getMissingToolIds') && !toolAccessMiddleware.includes('pool.query'));
check('tool access service exposes enabled tools and provisioning', toolAccessService.includes('getEnabledToolIds') && toolAccessService.includes('provisionToolAccess') && toolAccessService.includes('brandToolAccess.upsert'));
check('legacy migration backfills existing brands', read('prisma/migrations/20260508_add_brand_tool_access/migration.sql').includes("'legacy'") && read('prisma/migrations/20260508_add_brand_tool_access/migration.sql').includes('ON CONFLICT (brand_id, tool_id) DO NOTHING'));
check('rbac prisma models exist', ['model AppUser', 'model PlatformUser', 'model BrandMembership', 'model ClientSignupRequest'].every(model => prismaSchema.includes(model)) && ['enum PlatformRole', 'enum BrandRole', 'enum SignupStatus'].every(enumName => prismaSchema.includes(enumName)));
check('rbac sql tables exist', ['CREATE TABLE IF NOT EXISTS app_users', 'CREATE TABLE IF NOT EXISTS platform_users', 'CREATE TABLE IF NOT EXISTS brand_memberships', 'CREATE TABLE IF NOT EXISTS client_signup_requests'].every(table => schemaSql.includes(table)));
check('rbac migration exists and backfills memberships', existsSync(join(root, 'prisma/migrations/20260509_add_rbac_onboarding/migration.sql')) && readIfExists('prisma/migrations/20260509_add_rbac_onboarding/migration.sql').includes('CREATE TABLE IF NOT EXISTS app_users') && readIfExists('prisma/migrations/20260509_add_rbac_onboarding/migration.sql').includes('INSERT INTO brand_memberships') && readIfExists('prisma/migrations/20260509_add_rbac_onboarding/migration.sql').includes('owner_user_id'));
check('superadmin env is documented', envExample.includes('SUPERADMIN_EMAILS=') && types.includes('SUPERADMIN_EMAILS'));
check('auth middleware uses db rbac context and not jwt metadata roles', authMiddleware.includes('loadAuthContext') && authMiddleware.includes('requirePlatformRole') && authMiddleware.includes('requireBrandRole') && authMiddleware.includes('resolveRequestBrandId') && !authMiddleware.includes('decoded.user_metadata?.role') && !authMiddleware.includes('decoded.user_metadata?.brand_id'));
check('rbac service bootstraps superadmins from env', rbacService.includes('SUPERADMIN_EMAILS') && rbacService.includes('super_admin') && rbacService.includes('platformUser.findMany') && rbacService.includes('brandMembership.findMany'));
check('auth me endpoint returns rbac context', readIfExists('src/routes/auth.ts').includes("router.get('/me'") && readIfExists('src/routes/auth.ts').includes('brand_memberships') && readIfExists('src/routes/auth.ts').includes('platform_role') && readIfExists('src/routes/auth.ts').includes('pending_signup_status'));
check('onboarding signup route stores pending request', existsSync(join(root, 'src/routes/onboarding.ts')) && onboardingRoutes.includes("router.post('/client-signup'") && onboardingRoutes.includes('clientSignupRequest') && onboardingRoutes.includes('pending') && onboardingRoutes.includes('No tools or brand access'));
check('server mounts onboarding routes', server.includes("from './routes/onboarding'") && server.includes("app.use('/api/v1/onboarding'"));
check('admin routes use platform rbac', adminRoutes.includes("requirePlatformRole('super_admin', 'platform_admin')") && adminRoutes.includes("requirePlatformRole('super_admin')") && adminRoutes.includes("router.get('/signup-requests'") && adminRoutes.includes("router.post('/signup-requests/:request_id/approve'") && adminRoutes.includes("router.post('/signup-requests/:request_id/reject'") && adminRoutes.includes("router.post('/platform-admins'") && adminRoutes.includes("router.delete('/platform-admins/:user_id'") && !adminRoutes.includes('requireRole('));
check('admin approval creates brand membership and tools', adminRoutes.includes('brand.create') && adminRoutes.includes('brandMembership.upsert') && adminRoutes.includes('provisionToolAccess') && adminRoutes.includes('clientSignupRequest.update'));
check('admin provisioning route uses platform rbac', adminRoutes.includes("router.post('/provision'") && adminRoutes.includes("requirePlatformRole('super_admin', 'platform_admin')") && adminRoutes.includes('provisionToolAccess'));
check('tools access route exists with plan-aware response', toolsRoutes.includes("router.get('/my-access'") && toolsRoutes.includes('getEnabledToolIds') && toolsRoutes.includes('plan'));
check('tool access resolves brand from request or membership', toolAccessMiddleware.includes('resolveRequestBrandId') && !toolAccessMiddleware.includes('req.user?.brand_id') && toolAccessMiddleware.includes('Brand access required'));
check('server mounts admin and tools routes', server.includes("from './routes/admin'") && server.includes("from './routes/tools'") && server.includes("app.use('/api/v1/admin'") && server.includes("app.use('/api/v1/tools'"));
check('core api tool routes are gated', [
  "router.post('/ingest', requireBrandAccess, requireToolAccess('tool_1')",
  "router.post('/cluster', requireBrandAccess, requireToolAccess('tool_2')",
  "router.post('/strategize', requireBrandAccess, requireToolAccess('tool_2')",
  "router.post('/reply', requireBrandAccess, requireToolAccess('tool_3')",
  "router.post('/kpi', requireBrandAccess, requireToolAccess('tool_5')",
  "router.post('/creative/score', requireBrandAccess, requireToolAccess('tool_7')",
  "router.post('/insights/run', requireBrandAccess, requireToolAccess('tool_8')",
  "router.post('/warroom/snapshot', requireBrandAccess, requireToolAccess('tool_9')",
  "router.post('/attribution/links', requireBrandAccess, requireToolAccess('tool_6')",
].every(route => apiRoutes.includes(route)));
check('listening routes are gated with tool 1', listeningRoutes.includes("requireToolAccess('tool_1')") && (listeningRoutes.match(/requireToolAccess\('tool_1'\)/g) ?? []).length >= 11);
check('campaign routes are gated with tool 10', campaigns.includes("requireToolAccess('tool_10')") && (campaigns.match(/requireToolAccess\('tool_10'\)/g) ?? []).length >= 7);
check('dashboard and realtime routes are gated except sse connection', dashboardRoutes.includes("requireToolAccess('tool_5')") && realtimeRoutes.includes("router.get('/stream/:brand_id', requireBrandAccess,") && !realtimeRoutes.includes("router.get('/stream/:brand_id', requireBrandAccess, requireToolAccess") && realtimeRoutes.includes("requireToolAccess('tool_5')") && realtimeRoutes.includes("requireToolAccess('tool_3')"));
check('automation and background jobs check tool access', scheduler.includes('hasToolAccess') && queueJobs.includes('hasToolAccess') && streamPipeline.includes('hasToolAccess'));
check('sse events are filtered by tool access', readIfExists('src/stream/eventQueue.ts').includes('EVENT_TOOL_ACCESS') && readIfExists('src/stream/eventQueue.ts').includes('hasToolAccess') && readIfExists('src/stream/eventQueue.ts').includes('warroom_update'));
check('openapi documents tool access endpoints and 403 shape', openApiSpec.includes('/api/v1/tools/my-access') && openApiSpec.includes('/api/v1/admin/provision') && openApiSpec.includes('ToolAccessResponse') && openApiSpec.includes('ToolNotEnabled') && openApiSpec.includes('owner'));
check('openapi documents rbac onboarding endpoints', ['/api/v1/auth/me', '/api/v1/onboarding/client-signup', '/api/v1/admin/signup-requests', '/api/v1/admin/signup-requests/{request_id}/approve', '/api/v1/admin/signup-requests/{request_id}/reject', '/api/v1/admin/platform-admins', '/api/v1/admin/platform-admins/{user_id}'].every(path => openApiSpec.includes(path)) && ['AuthMeResponse', 'ClientSignupRequest', 'SignupRequest', 'ApproveSignupRequest', 'RejectSignupRequest', 'PlatformAdminRequest'].every(schema => openApiSpec.includes(schema)));
check('product guide documents tool access packaging', productReadinessGuide.includes('Tool Access & Packaging') && productReadinessGuide.includes('brand_tool_access') && productReadinessGuide.includes('legacy') && productReadinessGuide.includes('Stripe webhook'));
check('account lifecycle prisma models exist', prismaSchema.includes('enum AppUserStatus') && prismaSchema.includes('enum TeamInvitationStatus') && prismaSchema.includes('model TeamInvitation') && prismaSchema.includes('status    AppUserStatus') && prismaSchema.includes('client_member'));
check('b2b/b2c rbac schema exists', prismaSchema.includes('enum BrandAccountType') && prismaSchema.includes('b2b_licensed') && prismaSchema.includes('b2c_managed') && prismaSchema.includes('internal') && prismaSchema.includes('client_viewer') && prismaSchema.includes('client_approver') && prismaSchema.includes('model AuditLog') && prismaSchema.includes('accountType') && prismaSchema.includes('requestedAccountType'));
check('b2b/b2c rbac sql and migration exist', schemaSql.includes('CREATE TYPE brand_account_type') && schemaSql.includes('account_type      brand_account_type') && schemaSql.includes('requested_account_type') && schemaSql.includes('CREATE TABLE IF NOT EXISTS audit_logs') && existsSync(join(root, 'prisma/migrations/20260514_add_b2b_b2c_rbac_audit/migration.sql')));
check('auth context exposes account type and expanded client roles', types.includes("BrandRole = 'client_owner' | 'client_member' | 'client_viewer' | 'client_approver'") && types.includes("BrandAccountType = 'b2b_licensed' | 'b2c_managed' | 'internal'") && rbacService.includes('account_type') && rbacService.includes('client_approver'));
check('admin routes support b2b/b2c approval and audit logging', adminRoutes.includes("router.get('/users'") && adminRoutes.includes("router.get('/audit-logs'") && adminRoutes.includes('writeAuditLog') && adminRoutes.includes('accountType') && adminRoutes.includes('membershipRole') && adminRoutes.includes("Only super_admin can approve internal workspaces"));
check('tool access lets platform roles override paid tool gates', toolAccessMiddleware.includes("req.user?.platform_role === 'super_admin'") && toolAccessMiddleware.includes("req.user?.platform_role === 'platform_admin'"));
check('openapi documents b2b/b2c rbac and audit endpoints', ['/api/v1/admin/users', '/api/v1/admin/audit-logs'].every(path => openApiSpec.includes(path)) && ['BrandAccountType', 'BrandRole', 'AuditLogsResponse'].every(schema => openApiSpec.includes(schema)) && openApiSpec.includes('client_approver') && openApiSpec.includes('b2c_managed'));
check('account lifecycle sql and migration exist', schemaSql.includes('CREATE TYPE app_user_status') && schemaSql.includes('CREATE TABLE IF NOT EXISTS team_invitations') && existsSync(join(root, 'prisma/migrations/20260509_add_account_lifecycle/migration.sql')) && readIfExists('prisma/migrations/20260509_add_account_lifecycle/migration.sql').includes('ADD COLUMN IF NOT EXISTS status') && readIfExists('prisma/migrations/20260509_add_account_lifecycle/migration.sql').includes('CREATE TABLE IF NOT EXISTS team_invitations'));
check('super admin bootstrap env is documented', envExample.includes('SUPER_ADMIN_EMAIL=') && envExample.includes('SUPER_ADMIN_PASSWORD=') && types.includes('SUPER_ADMIN_EMAIL') && types.includes('SUPER_ADMIN_PASSWORD'));
check('supabase admin service creates auth users without sdk dependency', supabaseAdminService.includes('createSupabaseUser') && supabaseAdminService.includes('/auth/v1/admin/users') && supabaseAdminService.includes('SUPABASE_SERVICE_ROLE_KEY') && supabaseAdminService.includes('fetch(') && !packageJson.dependencies?.['@supabase/supabase-js']);
check('super admin bootstrap service exists and is wired', bootstrapService.includes('bootstrapSuperAdmin') && bootstrapService.includes('SUPER_ADMIN_EMAIL') && bootstrapService.includes('createSupabaseUser') && bootstrapService.includes('platformUser.upsert') && server.includes('bootstrapSuperAdmin'));
check('auth exposes and enforces app user status', types.includes('AppUserStatus') && rbacService.includes('status: appUser.status') && authMiddleware.includes('Account suspended') && authMiddleware.includes('Account rejected') && readIfExists('src/routes/auth.ts').includes('status: req.user.status'));
check('admin platform user lifecycle routes exist', adminRoutes.includes('createSupabaseUser') && adminRoutes.includes('sendPlatformAdminCreatedEmail') && adminRoutes.includes("router.post('/users/:user_id/suspend'") && adminRoutes.includes("router.post('/users/:user_id/activate'") && adminRoutes.includes("status: 'suspended'") && adminRoutes.includes("status: 'active'"));
check('signup approval rejection updates account status and sends email', adminRoutes.includes("status: 'active'") && adminRoutes.includes("status: 'rejected'") && adminRoutes.includes('sendSignupApprovedEmail') && adminRoutes.includes('sendSignupRejectedEmail'));
check('team invitation routes exist and are mounted', existsSync(join(root, 'src/routes/team.ts')) && teamRoutes.includes("router.post('/invitations'") && teamRoutes.includes("router.post('/invitations/accept'") && teamRoutes.includes('teamInvitation') && teamRoutes.includes('createHash') && teamRoutes.includes('sendTeamInviteEmail') && server.includes("from './routes/team'") && server.includes("app.use('/api/v1/team'"));
check('openapi documents account lifecycle endpoints', ['/api/v1/admin/users/{user_id}/suspend', '/api/v1/admin/users/{user_id}/activate', '/api/v1/team/invitations', '/api/v1/team/invitations/accept'].every(path => openApiSpec.includes(path)) && ['TeamInvitationRequest', 'AcceptTeamInvitationRequest', 'AdminUserLifecycleResponse'].every(schema => openApiSpec.includes(schema)));
check('product guide documents account lifecycle', productReadinessGuide.includes('Account Lifecycle') && productReadinessGuide.includes('SUPER_ADMIN_EMAIL') && productReadinessGuide.includes('Team Invitations'));
check('cors is restricted when credentials are enabled', server.includes('buildCorsOptions') && server.includes('credentials: !allowAnyOrigin') && !server.includes("origin:      process.env.FRONTEND_URL ?? '*'"));
check('oauth state is signed for social account connection', existsSync(join(root, 'src/auth/oauthState.ts')) && oauthState.includes('createOAuthState') && oauthState.includes('verifyOAuthState') && platformAuth.includes('createOAuthState') && platformAuth.includes('verifyOAuthState'));
check('team invitation response does not expose invite token', teamRoutes.includes('sendTeamInviteEmail') && !teamRoutes.includes('invite_url: inviteUrl'));
check('admin lifecycle protects self and super admin accounts', adminRoutes.includes('Cannot suspend your own account') && adminRoutes.includes('Cannot manage super_admin accounts') && adminRoutes.includes('assertCanManageUserLifecycle'));
check('signup approval provisions tools inside approval transaction', adminRoutes.includes('tx.brandToolAccess.upsert') && adminRoutes.includes('tx.clientSignupRequest.update') && adminRoutes.includes("status: 'approved'"));
check('lifecycle emails escape html content', emailUtil.includes('function escapeHtml') && emailUtil.includes('escapeHtml(reason)') && emailUtil.includes('escapeHtml(brandName)') && emailUtil.includes('escapeHtml(inviteUrl)'));
check('project security rules document exists', projectSecurityRules.includes('Project Security Rules') && projectSecurityRules.includes('Secrets And Environment Variables') && projectSecurityRules.includes('AI/LLM Rules'));
check('gitignore protects env files', rootGitignore.includes('.env') && rootGitignore.includes('.env.local') && rootGitignore.includes('.env.*.local'));
check('http security headers middleware exists and is mounted', existsSync(join(root, 'src/middleware/securityHeaders.ts')) && securityHeadersMiddleware.includes('Content-Security-Policy') && securityHeadersMiddleware.includes('X-Frame-Options') && securityHeadersMiddleware.includes('Strict-Transport-Security') && server.includes('app.disable') && server.includes('app.use(securityHeaders)') && server.indexOf('app.use(securityHeaders)') < server.indexOf('app.use(cors'));
check('rate limits match security policy tiers', rateLimitMiddleware.includes('AUTH_LIMIT') && rateLimitMiddleware.includes('limit: 5') && rateLimitMiddleware.includes('FIFTEEN_MINUTES') && rateLimitMiddleware.includes('AI_LIMIT') && rateLimitMiddleware.includes('limit: 10') && rateLimitMiddleware.includes('GENERAL_LIMIT') && rateLimitMiddleware.includes('limit: 60') && rateLimitMiddleware.includes('UPLOAD_LIMIT') && rateLimitMiddleware.includes('Retry-After'));
check('ai rate limit uses bearer identity hash when available', rateLimitMiddleware.includes('createHash') && rateLimitMiddleware.includes('bearer:') && rateLimitMiddleware.includes('sha256'));
check('cloudinary upload utility validates files safely', cloudinaryUtil.includes('MAX_IMAGE_BYTES') && cloudinaryUtil.includes('ALLOWED_EXTENSIONS') && cloudinaryUtil.includes('detectImageMime') && cloudinaryUtil.includes('randomUUID') && cloudinaryUtil.includes('allowed_formats'));
check('frontend scan has no obvious dangerous sinks or secret literals', !readIfExists('../Frontend/src/App.tsx').includes('dangerouslySetInnerHTML') && !readIfExists('../Frontend/src/App.tsx').includes('eval(') && !readIfExists('../Frontend/src/App.tsx').includes('sk-'));

const failed = checks.filter(result => !result.passed);
for (const result of checks) {
  console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}`);
}

if (failed.length) {
  process.exitCode = 1;
}

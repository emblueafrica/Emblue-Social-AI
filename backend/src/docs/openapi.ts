const bearer = [{ bearerAuth: [] }];

const json = (schema: Record<string, unknown>) => ({
  required: true,
  content: { 'application/json': { schema } },
});

const response = (description = 'OK', schema: Record<string, unknown> = { $ref: '#/components/schemas/GenericResponse' }) => ({
  description,
  content: { 'application/json': { schema } },
});

const errorResponses = {
  400: { $ref: '#/components/responses/ValidationError' },
  401: { $ref: '#/components/responses/Unauthorized' },
  403: { $ref: '#/components/responses/Forbidden' },
  500: { $ref: '#/components/responses/ServerError' },
};

const brandIdParam = {
  name: 'brand_id',
  in: 'path',
  required: true,
  schema: { type: 'integer', minimum: 1 },
};

const platformParam = {
  name: 'platform',
  in: 'path',
  required: true,
  schema: { $ref: '#/components/schemas/Platform' },
};

const limitQuery = {
  name: 'limit',
  in: 'query',
  required: false,
  schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
};

const offsetQuery = {
  name: 'offset',
  in: 'query',
  required: false,
  schema: { type: 'integer', minimum: 0, default: 0 },
};

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Social Emblue AI Backend API',
    version: '2.0.0',
    description: 'API documentation for Social Emblue AI social listening, campaign engagement, AI agents, and reporting.',
  },
  servers: [
    { url: process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? '3001'}`, description: 'Configured backend server' },
  ],
  tags: [
    { name: 'System', description: 'Health and documentation endpoints' },
    { name: 'Auth', description: 'OAuth connection and automation controls' },
    { name: 'Admin', description: 'Platform-admin RBAC, onboarding approval, and provisioning endpoints' },
    { name: 'Onboarding', description: 'Client signup and approval workflow endpoints' },
    { name: 'Team', description: 'Client workspace team invitation endpoints' },
    { name: 'Tools', description: 'Brand tool access and packaging endpoints' },
    { name: 'AI Tools', description: 'Core AI agent endpoints' },
    { name: 'Listening', description: 'PRD v3.1 social listening endpoints' },
    { name: 'Realtime', description: 'SSE, webhooks, approval queue, and conversion events' },
    { name: 'Campaigns', description: 'Campaign and Engage the Engagers endpoints' },
    { name: 'Dashboard', description: 'Dashboard summary endpoints' },
  ],
  security: bearer,
  paths: {
    '/': {
      get: {
        tags: ['System'],
        summary: 'Root health check',
        security: [],
        responses: { 200: response('Backend status') },
      },
    },
    '/api/v1/health': {
      get: {
        tags: ['System'],
        summary: 'API health check',
        security: [],
        responses: { 200: response('API health status') },
      },
    },
    '/api/v1/tools/my-access': {
      get: {
        tags: ['Tools'],
        summary: 'List enabled tools for the authenticated brand',
        security: bearer,
        responses: { 200: response('Enabled tool IDs', { $ref: '#/components/schemas/ToolAccessResponse' }), ...errorResponses },
      },
    },
    '/api/v1/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Get authenticated user RBAC context',
        description: 'Returns Supabase identity, backend platform role, brand memberships, active brand, workspace account type, and pending signup status.',
        security: bearer,
        responses: { 200: response('RBAC context', { $ref: '#/components/schemas/AuthMeResponse' }), ...errorResponses },
      },
    },
    '/api/v1/onboarding/client-signup': {
      post: {
        tags: ['Onboarding'],
        summary: 'Submit client onboarding request',
        description: 'Creates or updates a pending signup request. No brand access or tools are granted until a platform admin approves it.',
        security: bearer,
        requestBody: json({ $ref: '#/components/schemas/ClientSignupRequest' }),
        responses: { 202: response('Signup request pending', { $ref: '#/components/schemas/SignupRequest' }), ...errorResponses },
      },
    },
    '/api/v1/admin/signup-requests': {
      get: {
        tags: ['Admin'],
        summary: 'List client signup requests',
        description: 'Requires platform role super_admin or platform_admin.',
        security: bearer,
        parameters: [{ name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['pending', 'approved', 'rejected'] } }],
        responses: { 200: response('Signup requests'), ...errorResponses },
      },
    },
    '/api/v1/admin/users': {
      get: {
        tags: ['Admin'],
        summary: 'List backend users',
        description: 'Requires platform role super_admin or platform_admin.',
        security: bearer,
        responses: { 200: response('Users and their active roles'), ...errorResponses },
      },
    },
    '/api/v1/admin/audit-logs': {
      get: {
        tags: ['Admin'],
        summary: 'List audit logs',
        description: 'Requires platform role super_admin. Audit logs record sensitive RBAC, onboarding, lifecycle, and provisioning actions.',
        security: bearer,
        parameters: [
          { name: 'brand_id', in: 'query', required: false, schema: { type: 'integer', minimum: 1 } },
          { name: 'target_user_id', in: 'query', required: false, schema: { type: 'string', format: 'uuid' } },
          { name: 'action', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 200 } },
        ],
        responses: { 200: response('Audit log rows', { $ref: '#/components/schemas/AuditLogsResponse' }), ...errorResponses },
      },
    },
    '/api/v1/admin/signup-requests/{request_id}/approve': {
      post: {
        tags: ['Admin'],
        summary: 'Approve a client signup request',
        description: 'Creates a B2B licensed or B2C managed brand workspace, creates the approved client membership, provisions selected tools, writes an audit log, and marks the request approved.',
        security: bearer,
        parameters: [{ name: 'request_id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        requestBody: json({ $ref: '#/components/schemas/ApproveSignupRequest' }),
        responses: { 200: response('Signup request approved'), ...errorResponses },
      },
    },
    '/api/v1/admin/signup-requests/{request_id}/reject': {
      post: {
        tags: ['Admin'],
        summary: 'Reject a client signup request',
        description: 'Marks a pending signup request rejected and stores the review reason.',
        security: bearer,
        parameters: [{ name: 'request_id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        requestBody: json({ $ref: '#/components/schemas/RejectSignupRequest' }),
        responses: { 200: response('Signup request rejected'), ...errorResponses },
      },
    },
    '/api/v1/admin/platform-admins': {
      post: {
        tags: ['Admin'],
        summary: 'Grant platform_admin access',
        description: 'Requires platform role super_admin.',
        security: bearer,
        requestBody: json({ $ref: '#/components/schemas/PlatformAdminRequest' }),
        responses: { 200: response('Platform admin granted'), ...errorResponses },
      },
    },
    '/api/v1/admin/platform-admins/{user_id}': {
      delete: {
        tags: ['Admin'],
        summary: 'Deactivate platform_admin access',
        description: 'Requires platform role super_admin.',
        security: bearer,
        parameters: [{ name: 'user_id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: response('Platform admin removed'), ...errorResponses },
      },
    },
    '/api/v1/admin/users/{user_id}/suspend': {
      post: {
        tags: ['Admin'],
        summary: 'Suspend a user account',
        description: 'Requires platform role super_admin or platform_admin.',
        security: bearer,
        parameters: [{ name: 'user_id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: response('User suspended', { $ref: '#/components/schemas/AdminUserLifecycleResponse' }), ...errorResponses },
      },
    },
    '/api/v1/admin/users/{user_id}/activate': {
      post: {
        tags: ['Admin'],
        summary: 'Activate a user account',
        description: 'Requires platform role super_admin or platform_admin.',
        security: bearer,
        parameters: [{ name: 'user_id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: response('User activated', { $ref: '#/components/schemas/AdminUserLifecycleResponse' }), ...errorResponses },
      },
    },
    '/api/v1/team/invitations': {
      post: {
        tags: ['Team'],
        summary: 'Invite a team member to a brand workspace',
        description: 'Requires client_owner access to the brand. The invitation is emailed and stored with a hashed token.',
        security: bearer,
        requestBody: json({ $ref: '#/components/schemas/TeamInvitationRequest' }),
        responses: { 201: response('Team invitation created'), ...errorResponses },
      },
    },
    '/api/v1/team/invitations/accept': {
      post: {
        tags: ['Team'],
        summary: 'Accept a team invitation',
        description: 'Authenticated invited user accepts an invite token and becomes a client_member for that brand.',
        security: bearer,
        requestBody: json({ $ref: '#/components/schemas/AcceptTeamInvitationRequest' }),
        responses: { 200: response('Team invitation accepted'), ...errorResponses },
      },
    },
    '/api/v1/admin/provision': {
      post: {
        tags: ['Admin'],
        summary: 'Provision tool access for a brand',
        description: 'Requires backend platform role super_admin or platform_admin. The super_admin role is reserved for the platform owner.',
        security: bearer,
        requestBody: json({ $ref: '#/components/schemas/ProvisionToolsRequest' }),
        responses: { 200: response('Provisioned tool access'), ...errorResponses },
      },
    },
    '/api/v1/ingest': {
      post: {
        tags: ['AI Tools'],
        summary: 'Classify and persist incoming social messages',
        security: bearer,
        requestBody: json({ $ref: '#/components/schemas/IngestRequest' }),
        responses: { 200: response('Ingest result'), ...errorResponses },
      },
    },
    '/api/v1/cluster': {
      post: {
        tags: ['AI Tools'],
        summary: 'Cluster recent messages for a brand',
        security: bearer,
        requestBody: json({ $ref: '#/components/schemas/BrandIdBody' }),
        responses: { 200: response('Cluster result'), ...errorResponses },
      },
    },
    '/api/v1/strategize': {
      post: {
        tags: ['AI Tools'],
        summary: 'Generate content strategy from top clusters',
        security: bearer,
        requestBody: json({ $ref: '#/components/schemas/BrandIdBody' }),
        responses: { 200: response('Strategy result'), ...errorResponses },
      },
    },
    '/api/v1/reply': {
      post: {
        tags: ['AI Tools'],
        summary: 'Generate AI reply options',
        security: bearer,
        requestBody: json({ $ref: '#/components/schemas/ReplyRequest' }),
        responses: { 200: response('Reply suggestions'), ...errorResponses },
      },
    },
    '/api/v1/kpi': {
      post: {
        tags: ['AI Tools'],
        summary: 'Generate KPI snapshot',
        security: bearer,
        requestBody: json({ $ref: '#/components/schemas/BrandIdBody' }),
        responses: { 200: response('KPI result'), ...errorResponses },
      },
    },
    '/api/v1/creative/score': {
      post: {
        tags: ['AI Tools'],
        summary: 'Score a caption before posting',
        security: bearer,
        requestBody: json({ $ref: '#/components/schemas/CreativeScoreRequest' }),
        responses: { 200: response('Creative score'), ...errorResponses },
      },
    },
    '/api/v1/insights/run': {
      post: {
        tags: ['AI Tools'],
        summary: 'Mine recent comments for FAQs and pain points',
        security: bearer,
        requestBody: json({ $ref: '#/components/schemas/BrandIdBody' }),
        responses: { 200: response('Insights result'), ...errorResponses },
      },
    },
    '/api/v1/warroom/snapshot': {
      post: {
        tags: ['AI Tools'],
        summary: 'Generate War Room health snapshot',
        security: bearer,
        requestBody: json({ $ref: '#/components/schemas/BrandIdBody' }),
        responses: { 200: response('War Room snapshot'), ...errorResponses },
      },
    },
    '/api/v1/attribution/links': {
      post: {
        tags: ['AI Tools'],
        summary: 'Create a tracked link',
        security: bearer,
        requestBody: json({ $ref: '#/components/schemas/TrackedLinkRequest' }),
        responses: { 200: response('Tracked link'), ...errorResponses },
      },
    },
    '/api/v1/auth/meta/connect': {
      get: {
        tags: ['Auth'],
        summary: 'Start Meta OAuth connection',
        security: bearer,
        parameters: [{ name: 'brand_id', in: 'query', required: true, schema: { type: 'integer', minimum: 1 } }],
        responses: { 302: { description: 'Redirects to Meta OAuth' }, ...errorResponses },
      },
    },
    '/api/v1/auth/meta/callback': {
      get: {
        tags: ['Auth'],
        summary: 'Meta OAuth callback',
        security: [],
        parameters: [{ name: 'code', in: 'query', required: true, schema: { type: 'string' } }, { name: 'state', in: 'query', required: true, schema: { type: 'string' } }],
        responses: { 302: { description: 'Redirects back to frontend' } },
      },
    },
    '/api/v1/auth/x/connect': {
      get: {
        tags: ['Auth'],
        summary: 'Start X OAuth connection',
        security: bearer,
        parameters: [{ name: 'brand_id', in: 'query', required: true, schema: { type: 'integer', minimum: 1 } }],
        responses: { 302: { description: 'Redirects to X OAuth' }, ...errorResponses },
      },
    },
    '/api/v1/auth/x/callback': {
      get: {
        tags: ['Auth'],
        summary: 'X OAuth callback',
        security: [],
        parameters: [{ name: 'code', in: 'query', required: true, schema: { type: 'string' } }, { name: 'state', in: 'query', required: true, schema: { type: 'string' } }],
        responses: { 302: { description: 'Redirects back to frontend' } },
      },
    },
    '/api/v1/auth/connections/{brand_id}': {
      get: {
        tags: ['Auth'],
        summary: 'List connected social accounts',
        security: bearer,
        parameters: [brandIdParam],
        responses: { 200: response('Connected accounts'), ...errorResponses },
      },
    },
    '/api/v1/auth/disconnect/{brand_id}/{platform}': {
      delete: {
        tags: ['Auth'],
        summary: 'Deactivate a connected social account',
        security: bearer,
        parameters: [brandIdParam, platformParam],
        responses: { 200: response('Disconnected'), ...errorResponses },
      },
    },
    '/api/v1/auth/automation/start': {
      post: {
        tags: ['Auth'],
        summary: 'Start automation for a brand',
        security: bearer,
        requestBody: json({ $ref: '#/components/schemas/BrandIdBody' }),
        responses: { 200: response('Automation started'), ...errorResponses },
      },
    },
    '/api/v1/auth/automation/stop': {
      post: {
        tags: ['Auth'],
        summary: 'Stop automation for a brand',
        security: bearer,
        requestBody: json({ $ref: '#/components/schemas/BrandIdBody' }),
        responses: { 200: response('Automation stopped'), ...errorResponses },
      },
    },
    '/api/v1/auth/automation/status/{brand_id}': {
      get: {
        tags: ['Auth'],
        summary: 'Get automation status',
        security: bearer,
        parameters: [brandIdParam],
        responses: { 200: response('Automation status'), ...errorResponses },
      },
    },
    '/api/v1/auth/automation/run-now': {
      post: {
        tags: ['Auth'],
        summary: 'Run platform sync immediately',
        security: bearer,
        requestBody: json({ $ref: '#/components/schemas/AutomationRunNowRequest' }),
        responses: { 200: response('Run result'), ...errorResponses },
      },
    },
    '/api/v1/listening/keyword-groups': {
      post: {
        tags: ['Listening'],
        summary: 'Create or update a keyword group',
        security: bearer,
        requestBody: json({ $ref: '#/components/schemas/KeywordGroupRequest' }),
        responses: { 200: response('Keyword group'), ...errorResponses },
      },
    },
    '/api/v1/listening/keyword-groups/{brand_id}': {
      get: {
        tags: ['Listening'],
        summary: 'List keyword groups for a brand',
        security: bearer,
        parameters: [brandIdParam],
        responses: { 200: response('Keyword groups'), ...errorResponses },
      },
    },
    '/api/v1/listening/keyword-groups/{group_id}': {
      delete: {
        tags: ['Listening'],
        summary: 'Delete a keyword group',
        security: bearer,
        parameters: [{ name: 'group_id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        responses: { 200: response('Deleted'), ...errorResponses },
      },
    },
    '/api/v1/listening/keyword-groups/{group_id}/toggle': {
      post: {
        tags: ['Listening'],
        summary: 'Pause or resume a keyword group',
        security: bearer,
        parameters: [{ name: 'group_id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        responses: { 200: response('Toggled'), ...errorResponses },
      },
    },
    '/api/v1/listening/search': {
      post: {
        tags: ['Listening'],
        summary: 'Run a real-time or historical keyword search',
        security: bearer,
        requestBody: json({ $ref: '#/components/schemas/ListeningSearchRequest' }),
        responses: { 202: response('Search accepted'), ...errorResponses },
      },
    },
    '/api/v1/listening/runs/{brand_id}': {
      get: {
        tags: ['Listening'],
        summary: 'List search runs for a brand',
        security: bearer,
        parameters: [brandIdParam],
        responses: { 200: response('Search runs'), ...errorResponses },
      },
    },
    '/api/v1/listening/runs/{run_id}/results': {
      get: {
        tags: ['Listening'],
        summary: 'Get paginated search results for a run',
        security: bearer,
        parameters: [{ name: 'run_id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }, limitQuery, offsetQuery],
        responses: { 200: response('Search results'), ...errorResponses },
      },
    },
    '/api/v1/listening/runs/{run_id}/volume': {
      get: {
        tags: ['Listening'],
        summary: 'Get volume chart data for a run',
        security: bearer,
        parameters: [{ name: 'run_id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        responses: { 200: response('Volume buckets'), ...errorResponses },
      },
    },
    '/api/v1/listening/runs/{run_id}/status': {
      get: {
        tags: ['Listening'],
        summary: 'Check search run status',
        security: bearer,
        parameters: [{ name: 'run_id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        responses: { 200: response('Search status'), ...errorResponses },
      },
    },
    '/api/v1/listening/feed/{brand_id}': {
      get: {
        tags: ['Listening'],
        summary: 'Get combined real-time listening feed',
        security: bearer,
        parameters: [brandIdParam, limitQuery],
        responses: { 200: response('Listening feed'), ...errorResponses },
      },
    },
    '/api/v1/listening/results/{result_id}/engage': {
      post: {
        tags: ['Listening'],
        summary: 'Mark a search result engaged and generate replies',
        security: bearer,
        parameters: [{ name: 'result_id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        responses: { 200: response('Engagement reply result'), ...errorResponses },
      },
    },
    '/api/v1/rt/stream/{brand_id}': {
      get: {
        tags: ['Realtime'],
        summary: 'Open Server-Sent Events stream',
        security: bearer,
        parameters: [brandIdParam],
        responses: { 200: { description: 'SSE stream', content: { 'text/event-stream': { schema: { type: 'string' } } } }, ...errorResponses },
      },
    },
    '/api/v1/rt/webhook/meta': {
      get: {
        tags: ['Realtime'],
        summary: 'Meta webhook verification',
        security: [],
        parameters: [
          { name: 'hub.mode', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'hub.verify_token', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'hub.challenge', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Challenge response' }, 403: { description: 'Invalid verify token' } },
      },
      post: {
        tags: ['Realtime'],
        summary: 'Meta webhook event receiver',
        security: [],
        requestBody: json({ type: 'object', additionalProperties: true }),
        responses: { 200: response('Webhook accepted') },
      },
    },
    '/api/v1/rt/queue/{brand_id}': {
      get: {
        tags: ['Realtime'],
        summary: 'Get in-memory approval queue',
        security: bearer,
        parameters: [brandIdParam],
        responses: { 200: response('Approval queue'), ...errorResponses },
      },
    },
    '/api/v1/rt/queue/approve': {
      post: {
        tags: ['Realtime'],
        summary: 'Approve and remove an item from the approval queue',
        security: bearer,
        requestBody: json({ $ref: '#/components/schemas/QueueApproveRequest' }),
        responses: { 200: response('Approved'), ...errorResponses },
      },
    },
    '/api/v1/rt/events/convert': {
      post: {
        tags: ['Realtime'],
        summary: 'Record a conversion for a tracked link',
        security: [],
        requestBody: json({ $ref: '#/components/schemas/ConversionRequest' }),
        responses: { 200: response('Conversion recorded'), ...errorResponses },
      },
    },
    '/api/v1/dashboard/summary': {
      get: {
        tags: ['Dashboard'],
        summary: 'Get dashboard summary for a brand',
        security: bearer,
        parameters: [{ name: 'brand_id', in: 'query', required: true, schema: { type: 'integer', minimum: 1 } }],
        responses: { 200: response('Dashboard summary'), ...errorResponses },
      },
    },
    '/api/v1/campaigns': {
      post: {
        tags: ['Campaigns'],
        summary: 'Create or update an engagement campaign',
        security: bearer,
        requestBody: json({ $ref: '#/components/schemas/CampaignRequest' }),
        responses: { 200: response('Campaign'), ...errorResponses },
      },
    },
    '/api/v1/campaigns/{campaign_id}/toggle': {
      post: {
        tags: ['Campaigns'],
        summary: 'Toggle campaign active state',
        security: bearer,
        parameters: [{ name: 'campaign_id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        responses: { 200: response('Campaign toggled'), ...errorResponses },
      },
    },
    '/api/v1/campaigns/{campaign_id}/preview': {
      post: {
        tags: ['Campaigns'],
        summary: 'Preview campaign reply template',
        security: bearer,
        parameters: [{ name: 'campaign_id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        requestBody: json({ $ref: '#/components/schemas/CampaignPreviewRequest' }),
        responses: { 200: response('Preview'), ...errorResponses },
      },
    },
    '/api/v1/campaigns/engage-now': {
      post: {
        tags: ['Campaigns'],
        summary: 'Manually trigger engagement for one person',
        security: bearer,
        requestBody: json({ $ref: '#/components/schemas/EngageNowRequest' }),
        responses: { 200: response('Engagement result'), ...errorResponses },
      },
    },
    '/api/v1/campaigns/post-urls/run': {
      post: {
        tags: ['Campaigns'],
        summary: 'Run a post URL campaign',
        security: bearer,
        requestBody: json({ $ref: '#/components/schemas/PostUrlCampaignRequest' }),
        responses: { 200: response('Post URL campaign accepted'), ...errorResponses },
      },
    },
    '/api/v1/campaigns/{brand_id}': {
      get: {
        tags: ['Campaigns'],
        summary: 'List campaigns for a brand',
        security: bearer,
        parameters: [brandIdParam],
        responses: { 200: response('Campaigns'), ...errorResponses },
      },
    },
    '/api/v1/campaigns/{brand_id}/stats': {
      get: {
        tags: ['Campaigns'],
        summary: 'Get 30-day campaign engagement stats',
        security: bearer,
        parameters: [brandIdParam],
        responses: { 200: response('Campaign stats'), ...errorResponses },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Paste a Supabase access token. Format: Bearer <token>.',
      },
    },
    responses: {
      ValidationError: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      Unauthorized: { description: 'Missing or invalid Bearer token', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      Forbidden: {
        description: 'Authenticated user cannot access this brand/resource or tool',
        content: {
          'application/json': {
            schema: {
              oneOf: [
                { $ref: '#/components/schemas/ErrorResponse' },
                { $ref: '#/components/schemas/ToolNotEnabled' },
              ],
            },
          },
        },
      },
      ServerError: { description: 'Server error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
    schemas: {
      Platform: { type: 'string', enum: ['instagram', 'facebook', 'x', 'tiktok', 'youtube', 'reddit', 'whatsapp'] },
      ToolId: { type: 'string', enum: ['tool_1', 'tool_2', 'tool_3', 'tool_4', 'tool_5', 'tool_6', 'tool_7', 'tool_8', 'tool_9', 'tool_10'] },
      BrandAccountType: { type: 'string', enum: ['b2b_licensed', 'b2c_managed', 'internal'] },
      BrandRole: { type: 'string', enum: ['client_owner', 'client_member', 'client_viewer', 'client_approver'] },
      GenericResponse: { type: 'object', additionalProperties: true },
      ErrorResponse: {
        type: 'object',
        properties: { error: { type: 'string' }, message: { type: 'string' } },
      },
      AuthMeResponse: {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              email: { type: 'string', format: 'email' },
              app_role: { type: 'string', example: 'authenticated' },
              status: { type: 'string', enum: ['pending', 'active', 'suspended', 'rejected'] },
            },
          },
          platform_role: { type: 'string', nullable: true, enum: ['super_admin', 'platform_admin'] },
          brand_memberships: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                brand_id: { type: 'integer', minimum: 1 },
                role: { $ref: '#/components/schemas/BrandRole' },
                account_type: { $ref: '#/components/schemas/BrandAccountType' },
                brand_name: { type: 'string' },
                brand_slug: { type: 'string' },
              },
            },
          },
          active_brand: {
            type: 'object',
            nullable: true,
            properties: {
              brand_id: { type: 'integer', minimum: 1 },
              account_type: { $ref: '#/components/schemas/BrandAccountType' },
              name: { type: 'string' },
              slug: { type: 'string' },
              role: { $ref: '#/components/schemas/BrandRole' },
            },
          },
          pending_signup_status: { type: 'string', nullable: true, enum: ['pending', 'approved', 'rejected'] },
        },
      },
      ClientSignupRequest: {
        type: 'object',
        required: ['contact_name', 'company_name'],
        properties: {
          contact_name: { type: 'string', example: 'Ada Johnson' },
          company_name: { type: 'string', example: 'Blue Finch Agency' },
          website: { type: 'string', format: 'uri' },
          industry: { type: 'string', example: 'Retail banking' },
          team_size: { type: 'string', example: '11-50' },
          social_handles: { type: 'object', additionalProperties: true },
          goals: { type: 'array', items: { type: 'string' }, example: ['listen to complaints', 'reply faster'] },
          requested_plan: { type: 'string', example: 'growth_suite' },
          requested_account_type: { type: 'string', enum: ['b2b_licensed', 'b2c_managed'], default: 'b2b_licensed' },
          requested_platforms: { type: 'array', items: { type: 'string' }, example: ['instagram', 'x'] },
          billing_notes: { type: 'string' },
        },
      },
      SignupRequest: {
        type: 'object',
        properties: {
          request_id: { type: 'integer', minimum: 1 },
          user_id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          contact_name: { type: 'string' },
          company_name: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
          requested_account_type: { $ref: '#/components/schemas/BrandAccountType' },
          brand_id: { type: 'integer', nullable: true },
        },
      },
      ApproveSignupRequest: {
        type: 'object',
        required: ['tool_ids', 'plan_name'],
        properties: {
          tool_ids: { type: 'array', minItems: 1, items: { $ref: '#/components/schemas/ToolId' } },
          plan_name: { type: 'string', example: 'growth_suite' },
          expires_at: { type: 'string', format: 'date-time', nullable: true },
          account_type: { $ref: '#/components/schemas/BrandAccountType' },
          membership_role: { $ref: '#/components/schemas/BrandRole' },
          brand_slug: { type: 'string', example: 'blue-finch-agency' },
          campaign_objective: { type: 'string', example: 'increase qualified social engagement' },
          tone: { type: 'string', example: 'professional and friendly' },
          watchlist_keywords: { type: 'array', items: { type: 'string' } },
        },
      },
      RejectSignupRequest: {
        type: 'object',
        properties: {
          reason: { type: 'string', example: 'Incomplete company details' },
          rejection_reason: { type: 'string' },
        },
      },
      PlatformAdminRequest: {
        type: 'object',
        required: ['email'],
        properties: {
          user_id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          full_name: { type: 'string' },
          password: { type: 'string', format: 'password', description: 'Required when user_id is not provided.' },
        },
      },
      AdminUserLifecycleResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          user_id: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['active', 'suspended'] },
        },
      },
      AuditLogsResponse: {
        type: 'object',
        properties: {
          audit_logs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                audit_id: { type: 'integer' },
                actor_user_id: { type: 'string', format: 'uuid', nullable: true },
                actor_platform_role: { type: 'string', enum: ['super_admin', 'platform_admin'], nullable: true },
                action: { type: 'string', example: 'brand_tools.provisioned' },
                resource_type: { type: 'string', example: 'brand' },
                resource_id: { type: 'string', nullable: true },
                brand_id: { type: 'integer', nullable: true },
                target_user_id: { type: 'string', format: 'uuid', nullable: true },
                metadata: { type: 'object', additionalProperties: true },
                ip_address: { type: 'string', nullable: true },
                user_agent: { type: 'string', nullable: true },
                created_at: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      },
      TeamInvitationRequest: {
        type: 'object',
        required: ['brand_id', 'email'],
        properties: {
          brand_id: { type: 'integer', minimum: 1 },
          email: { type: 'string', format: 'email' },
          full_name: { type: 'string' },
        },
      },
      AcceptTeamInvitationRequest: {
        type: 'object',
        required: ['token'],
        properties: {
          token: { type: 'string' },
        },
      },
      ToolNotEnabled: {
        type: 'object',
        required: ['error', 'message', 'tool_id', 'upgrade_url'],
        properties: {
          error: { type: 'string', example: 'Tool not enabled' },
          message: { type: 'string', example: 'Your current plan does not include Advanced Social Listening.' },
          tool_id: { $ref: '#/components/schemas/ToolId' },
          missing_tool_ids: { type: 'array', items: { $ref: '#/components/schemas/ToolId' } },
          upgrade_url: { type: 'string', example: '/settings/upgrade' },
        },
      },
      ToolAccessResponse: {
        type: 'object',
        required: ['enabled'],
        properties: {
          enabled: { type: 'array', items: { $ref: '#/components/schemas/ToolId' }, example: ['tool_1', 'tool_3', 'tool_7'] },
          plan: { type: 'string', nullable: true, example: 'legacy', description: 'Returned for owner/admin users; omitted for regular members.' },
          account_type: { $ref: '#/components/schemas/BrandAccountType' },
          brand: {
            type: 'object',
            properties: {
              brand_id: { type: 'integer', minimum: 1 },
              name: { type: 'string' },
              slug: { type: 'string' },
            },
          },
        },
      },
      ProvisionToolsRequest: {
        type: 'object',
        required: ['brand_id', 'tool_ids', 'plan_name'],
        properties: {
          brand_id: { type: 'integer', minimum: 1 },
          tool_ids: { type: 'array', minItems: 1, items: { $ref: '#/components/schemas/ToolId' } },
          plan_name: { type: 'string', example: 'listen_respond' },
          expires_at: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      BrandIdBody: {
        type: 'object',
        required: ['brand_id'],
        properties: { brand_id: { type: 'integer', minimum: 1 } },
      },
      IngestRequest: {
        type: 'object',
        required: ['brand_id', 'platform', 'payload_type', 'source_name', 'items'],
        properties: {
          brand_id: { type: 'integer', minimum: 1 },
          platform: { $ref: '#/components/schemas/Platform' },
          payload_type: { type: 'string', enum: ['csv', 'api_items'] },
          source_name: { type: 'string', example: 'manual_upload' },
          items: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: true } },
        },
      },
      ReplyRequest: {
        type: 'object',
        required: ['brand_id', 'message', 'platform', 'tone', 'campaign_context', 'ruleset'],
        properties: {
          brand_id: { type: 'integer', minimum: 1 },
          message: { type: 'string' },
          platform: { $ref: '#/components/schemas/Platform' },
          tone: { type: 'string', example: 'professional and friendly' },
          campaign_context: { type: 'object', additionalProperties: true },
          ruleset: { type: 'object', additionalProperties: true },
          author_handle: { type: 'string' },
        },
      },
      CreativeScoreRequest: {
        type: 'object',
        required: ['brand_id', 'platform', 'caption'],
        properties: {
          brand_id: { type: 'integer', minimum: 1 },
          platform: { $ref: '#/components/schemas/Platform' },
          caption: { type: 'string' },
          objective: { type: 'string' },
        },
      },
      TrackedLinkRequest: {
        type: 'object',
        required: ['brand_id', 'dest_url'],
        properties: {
          brand_id: { type: 'integer', minimum: 1 },
          dest_url: { type: 'string', format: 'uri', example: 'https://example.com/landing' },
          campaign: { type: 'string' },
          platform: { $ref: '#/components/schemas/Platform' },
          content_type: { type: 'string' },
        },
      },
      AutomationRunNowRequest: {
        type: 'object',
        required: ['brand_id'],
        properties: { brand_id: { type: 'integer', minimum: 1 }, job: { type: 'string', example: 'platform_sync' } },
      },
      KeywordGroupRequest: {
        type: 'object',
        required: ['brand_id', 'name', 'keywords', 'platforms'],
        properties: {
          group_id: { type: 'integer', minimum: 1 },
          brand_id: { type: 'integer', minimum: 1 },
          name: { type: 'string', example: 'Competitor complaints' },
          keywords: { type: 'array', minItems: 1, items: { type: 'string' }, example: ['GTBank complaint', 'failed transaction'] },
          platforms: { type: 'array', minItems: 1, items: { $ref: '#/components/schemas/Platform' }, example: ['x', 'reddit', 'youtube'] },
          mode: { type: 'string', enum: ['realtime', 'historical', 'both'], default: 'realtime' },
          date_from: { type: 'string', format: 'date' },
          date_to: { type: 'string', format: 'date' },
          alert_urgency_threshold: { type: 'integer', minimum: 1, maximum: 5, default: 4 },
          alert_intents: { type: 'array', items: { type: 'string' }, example: ['purchase_intent', 'complaint'] },
          is_active: { type: 'boolean', default: true },
        },
      },
      ListeningSearchRequest: {
        type: 'object',
        required: ['brand_id'],
        properties: {
          brand_id: { type: 'integer', minimum: 1 },
          group_id: { type: 'integer', minimum: 1 },
          keywords: { type: 'array', items: { type: 'string' } },
          platforms: { type: 'array', items: { $ref: '#/components/schemas/Platform' } },
          mode: { type: 'string', enum: ['realtime', 'historical'] },
          date_from: { type: 'string', format: 'date' },
          date_to: { type: 'string', format: 'date' },
        },
      },
      QueueApproveRequest: {
        type: 'object',
        required: ['brand_id', 'index'],
        properties: { brand_id: { type: 'integer', minimum: 1 }, index: { type: 'integer', minimum: 0 } },
      },
      ConversionRequest: {
        type: 'object',
        required: ['brand_id', 'short_code'],
        properties: { brand_id: { type: 'integer', minimum: 1 }, short_code: { type: 'string' } },
      },
      CampaignRequest: {
        type: 'object',
        required: ['brand_id', 'name', 'platform'],
        properties: {
          campaign_id: { type: 'integer', minimum: 1 },
          brand_id: { type: 'integer', minimum: 1 },
          name: { type: 'string' },
          platform: { $ref: '#/components/schemas/Platform' },
          keywords: { type: 'array', items: { type: 'string' } },
          engage_all: { type: 'boolean' },
          engage_negative: { type: 'boolean' },
          tone: { type: 'string' },
          reply_template: { type: 'string' },
          fallback_template: { type: 'string' },
          cta_link: { type: 'string', format: 'uri' },
          image_url: { type: 'string', format: 'uri' },
          auto_fire_threshold: { type: 'integer', minimum: 0, maximum: 100 },
          max_per_hour: { type: 'integer', minimum: 1 },
          is_active: { type: 'boolean' },
          platform_allocation: { type: 'object', additionalProperties: { type: 'number' }, example: { instagram: 34, facebook: 33, tiktok: 33 } },
        },
      },
      CampaignPreviewRequest: {
        type: 'object',
        properties: {
          sample_comment: { type: 'string', example: 'Great post!' },
          sample_handle: { type: 'string', example: 'testuser' },
        },
      },
      EngageNowRequest: {
        type: 'object',
        required: ['brand_id', 'platform', 'author_handle', 'text'],
        properties: {
          brand_id: { type: 'integer', minimum: 1 },
          campaign_id: { type: 'integer', minimum: 1 },
          platform: { $ref: '#/components/schemas/Platform' },
          author_handle: { type: 'string' },
          author_id: { type: 'string' },
          comment_id: { type: 'string' },
          tweet_id: { type: 'string' },
          post_id: { type: 'string' },
          text: { type: 'string' },
        },
      },
      PostUrlCampaignRequest: {
        type: 'object',
        required: ['brand_id', 'post_urls'],
        properties: {
          brand_id: { type: 'integer', minimum: 1 },
          campaign_id: { type: 'string' },
          post_urls: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['platform', 'url'],
              properties: {
                platform: { $ref: '#/components/schemas/Platform' },
                url: { type: 'string', format: 'uri' },
                include_commenters: { type: 'boolean', default: true },
                include_likers: { type: 'boolean', default: true },
              },
            },
          },
          platform_allocation: { type: 'object', additionalProperties: { type: 'number' }, example: { instagram: 34, facebook: 33, tiktok: 33 } },
          tone: { type: 'string' },
          reply_template: { type: 'string' },
          cta_link: { type: 'string', format: 'uri' },
          image_url: { type: 'string', format: 'uri' },
          auto_fire_threshold: { type: 'integer', minimum: 0, maximum: 100 },
          max_per_hour: { type: 'integer', minimum: 1 },
        },
      },
    },
  },
};

export default openApiSpec;

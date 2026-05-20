export const TOOL_REGISTRY = {
  tool_1: {
    id: 'tool_1',
    name: 'Advanced Social Listening',
    routeGroup: '/api/v1/listening/*',
    dependencies: [],
  },
  tool_2: {
    id: 'tool_2',
    name: 'Search & Clustering',
    routeGroup: '/api/v1/cluster, /api/v1/strategize',
    dependencies: ['tool_1'],
  },
  tool_3: {
    id: 'tool_3',
    name: 'AI Reply Engine',
    routeGroup: '/api/v1/reply',
    dependencies: [],
  },
  tool_4: {
    id: 'tool_4',
    name: 'Comment to DM Funnel',
    routeGroup: '/api/v1/funnel/*',
    dependencies: [],
  },
  tool_5: {
    id: 'tool_5',
    name: 'Social Response Dashboard',
    routeGroup: '/api/v1/dashboard/*',
    dependencies: [],
  },
  tool_6: {
    id: 'tool_6',
    name: 'Attribution & Links',
    routeGroup: '/api/v1/attribution/*',
    dependencies: [],
  },
  tool_7: {
    id: 'tool_7',
    name: 'Creative Predictor',
    routeGroup: '/api/v1/creative/*',
    dependencies: [],
  },
  tool_8: {
    id: 'tool_8',
    name: 'Comment Mining',
    routeGroup: '/api/v1/insights/*',
    dependencies: [],
  },
  tool_9: {
    id: 'tool_9',
    name: 'Campaign War Room',
    routeGroup: '/api/v1/warroom/*',
    dependencies: [],
  },
  tool_10: {
    id: 'tool_10',
    name: 'Engage the Engagers',
    routeGroup: '/api/v1/campaigns/*',
    dependencies: ['tool_3'],
  },
} as const;

export type ToolId = keyof typeof TOOL_REGISTRY;

export const ALL_TOOL_IDS = Object.keys(TOOL_REGISTRY) as ToolId[];

export function isToolId(value: unknown): value is ToolId {
  return typeof value === 'string' && value in TOOL_REGISTRY;
}

export function getRequiredToolIds(toolId: ToolId): ToolId[] {
  const dependencies = TOOL_REGISTRY[toolId].dependencies as readonly ToolId[];
  return [...dependencies, toolId];
}


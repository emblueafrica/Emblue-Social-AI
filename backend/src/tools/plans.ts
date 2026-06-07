import { BrandAccountType } from '../types';
import { ALL_TOOL_IDS, ToolId, getRequiredToolIds, isToolId } from './registry';

export type B2BPlanId = 'starter' | 'growth' | 'enterprise';

export type ToolPlanDefinition = {
  id: B2BPlanId;
  name: string;
  description: string;
  toolIds: ToolId[];
};

export const B2B_PLAN_IDS: B2BPlanId[] = ['starter', 'growth', 'enterprise'];

export const B2B_TOOL_PLANS: Record<B2BPlanId, ToolPlanDefinition> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    description: 'Core dashboard and AI reply workflow.',
    toolIds: ['tool_3', 'tool_5'],
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    description: 'Listening, search, reply, dashboard, comment mining, and engagement.',
    toolIds: ['tool_1', 'tool_2', 'tool_3', 'tool_5', 'tool_8', 'tool_10'],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Complete Social Emblue AI tool suite.',
    toolIds: ALL_TOOL_IDS,
  },
};

export function isB2BPlanId(value: unknown): value is B2BPlanId {
  return typeof value === 'string' && value in B2B_TOOL_PLANS;
}

export function getPlanDefinition(value: unknown): ToolPlanDefinition | null {
  return isB2BPlanId(value) ? B2B_TOOL_PLANS[value] : null;
}

function uniqueToolIds(toolIds: ToolId[]): ToolId[] {
  return Array.from(new Set(toolIds));
}

function sortByRegistryOrder(toolIds: ToolId[]): ToolId[] {
  return [...toolIds].sort((a, b) => ALL_TOOL_IDS.indexOf(a) - ALL_TOOL_IDS.indexOf(b));
}

export function resolveProvisioningToolIds(planId: B2BPlanId, extraToolIds: ToolId[] = []): ToolId[] {
  const plan = B2B_TOOL_PLANS[planId];
  const required = [...plan.toolIds, ...extraToolIds].flatMap(toolId => getRequiredToolIds(toolId));
  return sortByRegistryOrder(uniqueToolIds(required));
}

export function parseToolIdList(value: unknown): ToolId[] | null {
  if (!Array.isArray(value)) return null;

  const toolIds: ToolId[] = [];
  for (const toolId of value) {
    if (!isToolId(toolId)) return null;
    toolIds.push(toolId);
  }
  return uniqueToolIds(toolIds);
}

export function getDefaultToolIdsForAccountType(
  accountType: BrandAccountType,
  planId: B2BPlanId,
  extraToolIds: ToolId[] = []
): ToolId[] {
  if (accountType === 'b2c_managed') return [];
  if (accountType === 'internal') return ALL_TOOL_IDS;
  return resolveProvisioningToolIds(planId, extraToolIds);
}

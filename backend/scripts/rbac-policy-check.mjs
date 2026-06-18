import assert from 'node:assert/strict';

const plans = await import('../dist/tools/plans.js');
const registry = await import('../dist/tools/registry.js');

const allTools = registry.ALL_TOOL_IDS;

const b2cTools = plans.getDefaultToolIdsForAccountType('b2c_managed', 'enterprise');
assert.deepEqual(b2cTools, [], 'B2C managed brands must not receive B2B tools');

const starterTools = plans.getDefaultToolIdsForAccountType('b2b_licensed', 'starter');
assert(starterTools.includes('tool_3'), 'Starter plan should include AI Reply Engine');
assert(starterTools.includes('tool_5'), 'Starter plan should include Social Response Dashboard');
assert(!starterTools.includes('tool_10'), 'Starter plan should not include Engage the Engagers');

const growthTools = plans.getDefaultToolIdsForAccountType('b2b_licensed', 'growth');
assert(growthTools.includes('tool_10'), 'Growth plan should include Engage the Engagers');
assert(growthTools.includes('tool_3'), 'Growth tool dependencies should include AI Reply Engine');
assert(!growthTools.includes('tool_4'), 'Growth plan should not include Comment to DM Funnel unless explicitly provisioned');

const enterpriseTools = plans.getDefaultToolIdsForAccountType('b2b_licensed', 'enterprise');
assert.deepEqual([...enterpriseTools].sort(), [...allTools].sort(), 'Enterprise should include every registered tool');

const internalTools = plans.getDefaultToolIdsForAccountType('internal', 'starter');
assert.deepEqual([...internalTools].sort(), [...allTools].sort(), 'Internal workspaces should include every registered tool');

for (const toolId of [...starterTools, ...growthTools, ...enterpriseTools, ...internalTools]) {
  assert(registry.isToolId(toolId), `Unknown tool ID provisioned: ${toolId}`);
}

console.log('RBAC policy check passed');

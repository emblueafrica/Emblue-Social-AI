import assert from 'node:assert/strict';
import {
  B2B_PLAN_IDS,
  getDefaultToolIdsForAccountType,
  getPlanDefinition,
  resolveProvisioningToolIds,
} from '../src/tools/plans';

assert.deepEqual(B2B_PLAN_IDS, ['starter', 'growth', 'enterprise']);

assert.deepEqual(resolveProvisioningToolIds('starter'), ['tool_3', 'tool_5']);
assert.deepEqual(resolveProvisioningToolIds('growth'), ['tool_1', 'tool_2', 'tool_3', 'tool_5', 'tool_8', 'tool_10']);
assert.deepEqual(resolveProvisioningToolIds('enterprise'), [
  'tool_1',
  'tool_2',
  'tool_3',
  'tool_4',
  'tool_5',
  'tool_6',
  'tool_7',
  'tool_8',
  'tool_9',
  'tool_10',
]);

assert.equal(getPlanDefinition('unknown'), null);
assert.equal(getPlanDefinition('starter')?.name, 'Starter');

assert.deepEqual(getDefaultToolIdsForAccountType('b2c_managed', 'enterprise'), []);
assert.deepEqual(getDefaultToolIdsForAccountType('b2b_licensed', 'starter'), ['tool_3', 'tool_5']);
assert.deepEqual(getDefaultToolIdsForAccountType('internal', 'enterprise'), [
  'tool_1',
  'tool_2',
  'tool_3',
  'tool_4',
  'tool_5',
  'tool_6',
  'tool_7',
  'tool_8',
  'tool_9',
  'tool_10',
]);

console.log('tool plan tests passed');

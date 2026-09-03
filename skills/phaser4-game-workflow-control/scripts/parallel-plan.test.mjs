/** 实施单元全局顺序与宿主显示层绑定的定向测试。 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { validateExecutionPlan } from './parallel-plan.mjs';

/** 构造覆盖全部全局阶段的最小合法实施包。 */
function makeOrderedPackage() {
  const unit = (unitId, unitType, ownedPath, overrides = {}) => ({
    unitId, unitType, scopeId: unitId.toLowerCase(), moduleId: 'core', sceneId: null, displayLayerId: null, hostSceneId: null,
    owner: 'worker', parallelMode: 'SERIAL', parallelGroup: null, ownedPaths: [ownedPath], stateOwnership: [unitId.toLowerCase()],
    acceptanceCommands: ['node --test'], serializationReason: '按全局阶段顺序串行', highFidelityPrerequisite: unitType === 'SCENE'
      ? { workItemId: 'WI-1', status: 'COMPLETE', stage: 'V2', frozen: true, sceneId: 'play', displayLayerId: null, hostSceneId: null, targetSha256: 'sha256:' + 'a'.repeat(64), candidateSha256: 'sha256:' + 'b'.repeat(64), diffFingerprint: 'sha256:scene-v2-diff', evidenceFile: 'docs/scene-v2-plan.json', evidenceSha256: 'sha256:' + 'c'.repeat(64) }
      : unitType === 'DISPLAY_LAYER'
        ? { workItemId: 'WI-1', status: 'COMPLETE', stage: 'V2', frozen: true, sceneId: 'play', displayLayerId: 'pause', hostSceneId: 'play', targetSha256: 'sha256:' + 'a'.repeat(64), candidateSha256: 'sha256:' + 'b'.repeat(64), diffFingerprint: 'sha256:scene-v2-diff', evidenceFile: 'docs/scene-v2-plan.json', evidenceSha256: 'sha256:' + 'c'.repeat(64) }
        : null, ...overrides,
  });
  const executionUnits = [
    unit('SHARED-1', 'SHARED', 'src/shared'),
    unit('MODULE-1', 'MODULE', 'src/module'),
    unit('SCENE-1', 'SCENE', 'src/scene', { sceneId: 'play' }),
    unit('DISPLAY-1', 'DISPLAY_LAYER', 'src/display', { displayLayerId: 'pause', hostSceneId: 'play' }),
    unit('INTEGRATION-1', 'INTEGRATION', 'src/integration'),
  ];
  return {
    allowedPaths: executionUnits.map((item) => item.ownedPaths[0]), forbiddenPaths: [], expectedAddedFiles: [], expectedDeletedFiles: [],
    fileOwnership: Object.fromEntries(executionUnits.map((item) => [item.ownedPaths[0], item.owner])), executionUnits,
  };
}

/** 使用与控制面一致的精确测试路径匹配器执行计划校验。 */
function validate(pkg) {
  return validateExecutionPlan(pkg, (value, pattern) => value === pattern, (message) => { throw new Error(message); });
}

test('DISPLAY_LAYER 必须绑定并紧邻同包宿主 SCENE', () => {
  const pkg = makeOrderedPackage();
  assert.doesNotThrow(() => validate(pkg));
  const missing = structuredClone(pkg); delete missing.executionUnits[3].displayLayerId;
  assert.throws(() => validate(missing), /字段不严格|displayLayerId/);
  const isolated = structuredClone(pkg); isolated.executionUnits.splice(2, 1);
  assert.throws(() => validate(isolated), /紧邻同包中.*宿主 SCENE/);
  const mismatched = structuredClone(pkg); mismatched.executionUnits[3].hostSceneId = 'menu'; mismatched.executionUnits[3].highFidelityPrerequisite.sceneId = 'menu'; mismatched.executionUnits[3].highFidelityPrerequisite.hostSceneId = 'menu';
  assert.throws(() => validate(mismatched), /紧邻同包中.*宿主 SCENE/);
});

test('executionUnits 只允许 SHARED→MODULE→场景块→INTEGRATION', () => {
  const pkg = makeOrderedPackage();
  pkg.executionUnits = [pkg.executionUnits[0], pkg.executionUnits[2], pkg.executionUnits[1], ...pkg.executionUnits.slice(3)];
  assert.throws(() => validate(pkg), /类型顺序非法/);
});

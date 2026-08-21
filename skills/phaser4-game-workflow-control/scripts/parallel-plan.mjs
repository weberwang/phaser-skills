/** Implementation Package 中实施单元的必填字段。数组位置就是计划制定者冻结的执行顺序。 */
const UNIT_FIELDS = ['unitId', 'unitType', 'scopeId', 'moduleId', 'sceneId', 'owner', 'parallelMode', 'parallelGroup', 'ownedPaths', 'stateOwnership', 'acceptanceCommands', 'serializationReason'];

/** 判断两个路径范围是否相交。 */
function rangesOverlap(left, right, pathMatches) {
  if (pathMatches(left, right) || pathMatches(right, left)) return true;
  // 两侧均含通配符时无法直接互相匹配，保守比较首个通配符前的目录前缀。
  const leftPrefix = String(left).replaceAll('\\', '/').split('*', 1)[0].replace(/\/$/, '');
  const rightPrefix = String(right).replaceAll('\\', '/').split('*', 1)[0].replace(/\/$/, '');
  return Boolean(leftPrefix && rightPrefix && (leftPrefix === rightPrefix || leftPrefix.startsWith(`${rightPrefix}/`) || rightPrefix.startsWith(`${leftPrefix}/`)));
}

/** 判断两个状态命名空间是否相交。 */
function statesOverlap(left, right) {
  return left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`) || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

/** 校验实施单元结构、预设顺序、并行组和文件/状态所有权。 */
export function validateExecutionPlan(pkg, pathMatches, fail) {
  if (!Array.isArray(pkg.executionUnits) || !pkg.executionUnits.length) fail('Implementation Package.executionUnits 必须为非空数组');
  const unitsById = new Map();
  for (const unit of pkg.executionUnits) {
    if (!unit || typeof unit !== 'object' || Array.isArray(unit)) fail('execution unit 必须为对象');
    const missing = UNIT_FIELDS.filter((field) => unit[field] === undefined);
    const extra = Object.keys(unit).filter((field) => !UNIT_FIELDS.includes(field));
    if (missing.length || extra.length) fail(`execution unit 字段不严格：缺少 ${missing.join('、') || '无'}；多余 ${extra.join('、') || '无'}`);
    if (!unit.unitId || unitsById.has(unit.unitId)) fail(`execution unit ID 为空或重复：${unit.unitId ?? '<empty>'}`);
    if (!['MODULE', 'SCENE', 'SHARED', 'INTEGRATION'].includes(unit.unitType) || !unit.scopeId || !unit.moduleId || !unit.owner) fail(`execution unit ${unit.unitId} 的类型、范围、模块或负责人无效`);
    if ((unit.unitType === 'SCENE' && (typeof unit.sceneId !== 'string' || !unit.sceneId)) || (unit.unitType !== 'SCENE' && unit.sceneId !== null)) fail(`execution unit ${unit.unitId}.sceneId 与类型不一致`);
    for (const field of ['ownedPaths', 'stateOwnership', 'acceptanceCommands']) {
      if (!Array.isArray(unit[field]) || unit[field].some((item) => typeof item !== 'string' || !item.trim())) fail(`execution unit ${unit.unitId}.${field} 必须为非空字符串数组`);
      if (new Set(unit[field]).size !== unit[field].length) fail(`execution unit ${unit.unitId}.${field} 不得重复`);
    }
    if (!unit.ownedPaths.length || !unit.stateOwnership.length || !unit.acceptanceCommands.length) fail(`execution unit ${unit.unitId} 的写范围、状态所有权和验收命令不能为空`);
    if (unit.parallelMode === 'PARALLEL') {
      if (!unit.parallelGroup || unit.serializationReason !== null) fail(`并行单元 ${unit.unitId} 必须绑定并行组且 serializationReason 为 null`);
    } else if (unit.parallelMode === 'SERIAL') {
      if (unit.parallelGroup !== null || typeof unit.serializationReason !== 'string' || !unit.serializationReason.trim()) fail(`串行单元 ${unit.unitId} 必须记录串行原因且 parallelGroup 为 null`);
    } else fail(`execution unit ${unit.unitId}.parallelMode 只能为 PARALLEL/SERIAL`);
    if (['SHARED', 'INTEGRATION'].includes(unit.unitType) && unit.parallelMode !== 'SERIAL') fail(`${unit.unitType} execution unit 只能 SERIAL：${unit.unitId}`);
    unitsById.set(unit.unitId, unit);
  }

  for (const unit of pkg.executionUnits) {
    for (const ownedPath of unit.ownedPaths) {
      if (!pkg.allowedPaths.some((pattern) => pathMatches(ownedPath, pattern)) || pkg.forbiddenPaths.some((pattern) => pathMatches(ownedPath, pattern))) fail(`execution unit ${unit.unitId} 写范围超出 Implementation Package：${ownedPath}`);
      const ownership = Object.entries(pkg.fileOwnership).filter(([pattern]) => rangesOverlap(ownedPath, pattern, pathMatches));
      if (ownership.length !== 1 || ownership[0][1] !== unit.owner) fail(`execution unit ${unit.unitId} 写范围未唯一映射到同一 owner：${ownedPath}`);
    }
  }

  for (const [ownedPattern, owner] of Object.entries(pkg.fileOwnership)) {
    const units = pkg.executionUnits.filter((unit) => unit.ownedPaths.some((path) => rangesOverlap(ownedPattern, path, pathMatches)));
    if (units.length !== 1 || units[0].owner !== owner) fail(`Implementation Package.fileOwnership 未唯一反向绑定 execution unit：${ownedPattern}`);
  }
  for (const expectedPath of [...pkg.expectedAddedFiles, ...pkg.expectedDeletedFiles]) {
    const units = pkg.executionUnits.filter((unit) => unit.ownedPaths.some((pattern) => pathMatches(expectedPath, pattern)));
    if (units.length !== 1) fail(`Implementation Package 预期增删文件未唯一绑定 execution unit：${expectedPath}`);
  }

  // 数组是计划制定者冻结的唯一执行顺序；同组并行单元必须占据连续位置，避免控制面重新推导阶段。
  const groups = Map.groupBy(pkg.executionUnits.filter((unit) => unit.parallelMode === 'PARALLEL'), (unit) => unit.parallelGroup);
  for (const [group, units] of groups) {
    if (units.length < 2) fail(`并行组至少需要两个实施单元：${group}`);
    const indexes = units.map((unit) => pkg.executionUnits.indexOf(unit)).sort((left, right) => left - right);
    if (indexes[indexes.length - 1] - indexes[0] + 1 !== indexes.length) fail(`并行组 ${group} 必须在 executionUnits 中连续出现`);
    for (let leftIndex = 0; leftIndex < units.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < units.length; rightIndex += 1) {
        const left = units[leftIndex]; const right = units[rightIndex];
        if (left.ownedPaths.some((path) => right.ownedPaths.some((peer) => rangesOverlap(path, peer, pathMatches)))) fail(`并行组 ${group} 写范围冲突：${left.unitId}/${right.unitId}`);
        if (left.stateOwnership.some((state) => right.stateOwnership.some((peer) => statesOverlap(state, peer)))) fail(`并行组 ${group} 状态所有权冲突：${left.unitId}/${right.unitId}`);
      }
    }
  }
  return unitsById;
}

/** 校验委派绑定的实施单元、代理、并行组和独占写范围。 */
export function validateDelegationBinding(delegation, pkg, pathMatches, fail) {
  const unitsById = validateExecutionPlan(pkg, pathMatches, fail);
  const units = delegation.executionUnitIds.map((unitId) => unitsById.get(unitId));
  if (units.some((unit) => !unit)) fail('委派引用了不存在的 execution unit');
  if (units.some((unit) => unit.owner !== delegation.assignedAgent)) fail('委派代理与 execution unit.owner 不一致');
  const expectedGroup = units[0].parallelMode === 'PARALLEL' ? units[0].parallelGroup : null;
  if (units.some((unit) => (unit.parallelMode === 'PARALLEL' ? unit.parallelGroup : null) !== expectedGroup) || delegation.parallelGroup !== expectedGroup) fail('委派 parallelGroup 与 execution unit 不一致');
  const expectedPaths = [...new Set(units.flatMap((unit) => unit.ownedPaths))].sort();
  const actualPaths = [...new Set(delegation.ownership)].sort();
  if (JSON.stringify(expectedPaths) !== JSON.stringify(actualPaths)) fail('委派 ownership 与 execution unit.ownedPaths 不一致');
  const expectedCommands = [...new Set(units.flatMap((unit) => unit.acceptanceCommands))].sort();
  const actualCommands = [...new Set(delegation.acceptanceCommands)].sort();
  if (JSON.stringify(expectedCommands) !== JSON.stringify(actualCommands)) fail('委派 acceptanceCommands 与 execution unit 不一致');
  return { units, unitsById };
}

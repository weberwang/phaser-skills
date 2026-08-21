import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DPR,
  DPR_POLICY,
  MAX_DPR,
  isDeviceDprInput,
  isMaxDpr,
  isWorkflowDpr,
  parseDeviceDpr,
  validateMaxDpr,
  validateWorkflowDpr,
} from "./workflow-dpr-contract.mjs";

test("统一真源声明动态封顶策略和生产上限", () => {
  assert.equal(MAX_DPR, 1.5);
  assert.equal(DEFAULT_DPR, 1);
  assert.equal(DPR_POLICY, "dynamic-capped-1.5");
  assert.equal(isMaxDpr(1.5), true);
  assert.equal(isMaxDpr(2), false);
});

test("运行时设备 DPR 动态解析并封顶", () => {
  for (const [input, expected] of [[undefined, 1], [null, 1], [0.5, 0.5], [1, 1], [1.5, 1.5], [2, 1.5], [3, 1.5]]) {
    assert.equal(parseDeviceDpr(input), expected, `deviceDpr=${String(input)}`);
  }
  for (const input of [0, -1, NaN, Infinity, "2", "1.5"]) assert.equal(parseDeviceDpr(input), DEFAULT_DPR, `deviceDpr=${String(input)}`);
});

test("有效 DPR 声明只允许正有限数且不超过 1.5", () => {
  for (const value of [0.5, 1, 1.25, 1.5]) {
    assert.equal(isWorkflowDpr(value), true);
    assert.equal(validateWorkflowDpr(value), null);
  }
  for (const value of [0, -1, 1.5001, 2, 3, NaN, Infinity, "1.5", undefined]) {
    assert.equal(isWorkflowDpr(value), false);
    assert.match(validateWorkflowDpr(value), /正有限数字且不超过 1\.5/);
  }
});

test("原始设备值与生产上限校验职责分离", () => {
  assert.equal(isDeviceDprInput(3), true);
  assert.equal(isDeviceDprInput(0), false);
  assert.equal(validateMaxDpr(1.5), null);
  assert.match(validateMaxDpr(2), /生产上限 1\.5/);
});

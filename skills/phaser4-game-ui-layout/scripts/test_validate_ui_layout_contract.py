#!/usr/bin/env python3
"""布局合同验证器的最小确定性测试夹具。"""

from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from validate_ui_layout_contract import main, validate_contract  # noqa: E402


class LayoutContractValidatorTests(unittest.TestCase):
    """覆盖合同必填关系、失败门禁和专项审查标记。"""

    @classmethod
    def setUpClass(cls) -> None:
        """从模板载入基准合同，避免测试夹具重复维护整份声明。"""
        template = SCRIPT_DIR.parent / "assets" / "ui-layout-contract-template.yaml"
        with template.open("r", encoding="utf-8") as handle:
            cls.base = json.load(handle)

    def assert_failed(self, document: dict, expected: str) -> None:
        """断言指定缺陷稳定地产生失败，并包含可定位诊断。"""
        result = validate_contract(document)
        self.assertEqual(result["status"], "failed")
        self.assertTrue(any(expected in item for item in result["errors"]), result)

    def test_complete_contract_passes(self) -> None:
        """完整合同应通过，同时保留绝对/固定/停靠专项标记。"""
        result = validate_contract(copy.deepcopy(self.base))
        self.assertEqual(result["status"], "passed", result)
        self.assertIn("primary-action:docked-overlay", result["specialized_review"])

    def test_missing_coordinate_space_fails(self) -> None:
        """缺少坐标空间时区域不能建立父级边界。"""
        document = copy.deepcopy(self.base)
        document["coordinate_spaces"] = []
        self.assert_failed(document, "coordinate_spaces 必须是非空数组")

    def test_coordinate_space_cycle_fails(self) -> None:
        """坐标空间父级循环会使所有局部坐标失去确定根。"""
        document = copy.deepcopy(self.base)
        document["coordinate_spaces"][0]["parent"] = "ui-space"
        document["coordinate_spaces"][1]["parent"] = "screen-space"
        self.assert_failed(document, "坐标空间存在循环")

    def test_scope_region_ids_must_match(self) -> None:
        """范围 ID 漏声明或多声明都会造成审核覆盖范围漂移。"""
        document = copy.deepcopy(self.base)
        document["scope"]["ui_ids"].remove("title")
        self.assert_failed(document, "scope.ui_ids 缺少 regions ID")

    def test_missing_horizontal_anchor_fails(self) -> None:
        """缺少水平锚点时不得退化为孤立 x 坐标。"""
        document = copy.deepcopy(self.base)
        del document["regions"][0]["anchors"]["horizontal"]
        self.assert_failed(document, "anchors.horizontal 缺失")

    def test_missing_vertical_anchor_fails(self) -> None:
        """缺少垂直锚点时不得退化为孤立 y 坐标。"""
        document = copy.deepcopy(self.base)
        del document["regions"][0]["anchors"]["vertical"]
        self.assert_failed(document, "anchors.vertical 缺失")

    def test_missing_reference_fails(self) -> None:
        """不存在的参照物必须退回。"""
        document = copy.deepcopy(self.base)
        document["regions"][1]["reference_id"] = "not-found"
        self.assert_failed(document, "不存在的 reference_id")

    def test_reference_cycle_fails(self) -> None:
        """区域参照环会让几何求解不确定，必须失败。"""
        document = copy.deepcopy(self.base)
        document["regions"][2]["reference_id"] = "content-panel"
        document["regions"][3]["reference_id"] = "title"
        self.assert_failed(document, "区域参照存在循环")

    def test_missing_scroll_owner_fails(self) -> None:
        """缺少滚动轴所有权不能让输入归属靠运行时猜测。"""
        document = copy.deepcopy(self.base)
        document["scrolling"].pop("axes")
        self.assert_failed(document, "scrolling.axes 必须声明至少一个滚动轴所有者")

    def test_duplicate_scroll_owner_fails(self) -> None:
        """同一轴出现两个所有者时必须失败。"""
        document = copy.deepcopy(self.base)
        document["scrolling"]["axes"].append(copy.deepcopy(document["scrolling"]["axes"][0]))
        self.assert_failed(document, "滚动轴存在多个所有者")

    def test_key_action_truncation_fails(self) -> None:
        """关键动作允许省略会造成不可恢复的可达性问题。"""
        document = copy.deepcopy(self.base)
        document["dynamic_content"]["key_actions"][0]["text_truncation"] = "allow"
        self.assert_failed(document, "关键动作禁止文本截断")

    def test_overlay_without_fallback_fails(self) -> None:
        """悬浮/停靠元素缺少遮挡回退必须退回。"""
        document = copy.deepcopy(self.base)
        document["overlay_rules"][0].pop("fallback")
        self.assert_failed(document, "fallback 必须声明回退规则")

    def test_fixed_overlay_without_rule_fails(self) -> None:
        """固定覆盖层没有对应规则时不能隐式遮挡内容。"""
        document = copy.deepcopy(self.base)
        document["regions"][5]["layout_participation"] = "fixed-overlay"
        self.assert_failed(document, "fixed-overlay 缺少对应 overlay_rules")

    def test_invariant_without_evidence_fails(self) -> None:
        """不变量没有自动化与视觉证据不能进入 F3。"""
        document = copy.deepcopy(self.base)
        document["invariants"][0]["evidence"]["visual"] = []
        self.assert_failed(document, "evidence.visual 必须是非空数组")

    def test_duplicate_ui_id_fails(self) -> None:
        """稳定 ID 重复会破坏运行时定位和证据绑定。"""
        document = copy.deepcopy(self.base)
        document["scope"]["ui_ids"].append("title")
        self.assert_failed(document, "重复 UI ID")

    def test_evidence_matrix_missing_required_axis_fails(self) -> None:
        """缺少任一最小轴时不能声称覆盖响应式证据。"""
        document = copy.deepcopy(self.base)
        document["evidence_matrix"]["required_axes"].remove("dpr")
        self.assert_failed(document, "required_axes 缺少必需轴")

    def test_invalid_breakpoint_condition_fails(self) -> None:
        """断点条件空值会让结构切换边界不可复现。"""
        document = copy.deepcopy(self.base)
        document["breakpoints"][0]["when"] = {"width_lt": None}
        self.assert_failed(document, "when 必须包含非空键和有效值")

    def test_absolute_and_fixed_with_evidence_are_specialized(self) -> None:
        """有完整合同依据的绝对/固定定位通过，但必须触发专项审查。"""
        document = copy.deepcopy(self.base)
        document["regions"][2]["positioning"] = "absolute"
        document["regions"][2]["size"]["strategy"] = "fixed"
        result = validate_contract(document)
        self.assertEqual(result["status"], "passed", result)
        self.assertIn("title:absolute-positioning", result["specialized_review"])
        self.assertIn("title:fixed-size", result["specialized_review"])

    def test_cli_returns_non_zero_for_invalid_contract(self) -> None:
        """命令行失败合同必须返回非零退出码，供 F0 使用。"""
        document = copy.deepcopy(self.base)
        document["regions"][0]["anchors"].pop("horizontal")
        with tempfile.NamedTemporaryFile("w", suffix=".yaml", encoding="utf-8", delete=False) as handle:
            json.dump(document, handle, ensure_ascii=False)
            path = Path(handle.name)
        try:
            self.assertNotEqual(main([str(path)]), 0)
        finally:
            path.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)

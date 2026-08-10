#!/usr/bin/env python3
"""确定性验证 Phaser 4 UI 布局合同（仅支持 JSON-compatible YAML）。"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


ROOT_REQUIRED = (
    "schema_version",
    "contract_id",
    "contract_version",
    "scope",
    "targets",
    "coordinate_spaces",
    "regions",
    "content",
    "platform_insets",
    "scrolling",
    "dynamic_content",
    "overlay_rules",
    "breakpoints",
    "invariants",
    "evidence_matrix",
)

REQUIRED_EVIDENCE_AXES = frozenset(
    {
        "breakpoint-neighbors",
        "width",
        "height",
        "orientation",
        "text-scale",
        "localization",
        "safe-area",
        "action-state",
        "dpr",
        "dynamic-values",
        "scene-lifecycle",
        "overlay-keyboard-scroll",
    }
)


def _is_mapping(value: Any) -> bool:
    """判断值是否为合同允许的对象类型，避免 bool 被误判为数字。"""
    return isinstance(value, dict)


def _is_non_empty_string(value: Any) -> bool:
    """判断字符串是否包含实际内容。"""
    return isinstance(value, str) and bool(value.strip())


def _is_number(value: Any) -> bool:
    """判断数值字段类型，布尔值不能作为尺寸或容差。"""
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _is_dimension(value: Any) -> bool:
    """判断尺寸是正数或有意义的表达式，拒绝零值和空占位。"""
    return (_is_number(value) and value > 0) or _is_non_empty_string(value)


def _is_condition_value(value: Any) -> bool:
    """判断断点条件值是否为有效数字或表达式，而不是空值/布尔占位。"""
    return (_is_number(value) and value >= 0) or _is_non_empty_string(value)


def _append_unique(items: list[str], value: str) -> None:
    """只追加一次诊断，保证命令输出顺序和内容稳定。"""
    if value not in items:
        items.append(value)


def _validate_root(document: Any, errors: list[str]) -> None:
    """验证根对象和根字段，先阻止后续检查读取错误类型。"""
    if not _is_mapping(document):
        errors.append("根对象必须是 JSON 对象")
        return
    for field in ROOT_REQUIRED:
        if field not in document:
            errors.append(f"缺少根字段：{field}")
    for field in ("schema_version", "contract_id", "contract_version"):
        if field in document and not _is_non_empty_string(document[field]):
            errors.append(f"字段 {field} 必须是非空字符串")
    list_fields = ("coordinate_spaces", "regions", "overlay_rules", "breakpoints", "invariants")
    for field in list_fields:
        if field in document and not isinstance(document[field], list):
            errors.append(f"字段 {field} 必须是数组")
    for field in ("scope", "targets", "content", "platform_insets", "scrolling", "dynamic_content", "evidence_matrix"):
        if field in document and not _is_mapping(document[field]):
            errors.append(f"字段 {field} 必须是对象")


def _validate_scope(scope: Any, errors: list[str]) -> None:
    """验证候选绑定和稳定 UI ID，确保合同可追踪且声明唯一。"""
    if not _is_mapping(scope):
        return
    for field in ("scenes", "states", "ui_ids"):
        value = scope.get(field)
        if not isinstance(value, list) or not value:
            errors.append(f"scope.{field} 必须是非空数组")
    ui_ids = scope.get("ui_ids")
    if isinstance(ui_ids, list):
        seen: set[str] = set()
        for item in ui_ids:
            if not _is_non_empty_string(item):
                errors.append("scope.ui_ids 只能包含非空字符串")
                continue
            if item in seen:
                errors.append(f"重复 UI ID：{item}")
            seen.add(item)
    for field in ("owner", "reviewer"):
        if not _is_non_empty_string(scope.get(field)):
            errors.append(f"scope.{field} 必须是非空字符串")
    bindings = scope.get("bindings")
    if not _is_mapping(bindings) or not bindings:
        errors.append("scope.bindings 必须是非空对象")
    else:
        for field in ("gdd", "tdd", "low_fidelity_candidate", "visual_baseline", "code_candidate"):
            if not _is_non_empty_string(bindings.get(field)):
                errors.append(f"scope.bindings.{field} 必须是非空字符串")


def _validate_scope_region_ids(scope: Any, region_ids: set[str], errors: list[str]) -> None:
    """确保合同范围声明与实际区域集合完全一致，避免漏审或伪造 UI ID。"""
    if not _is_mapping(scope) or not isinstance(scope.get("ui_ids"), list):
        return
    declared = {item for item in scope["ui_ids"] if _is_non_empty_string(item)}
    missing = sorted(region_ids - declared)
    extra = sorted(declared - region_ids)
    if missing:
        errors.append(f"scope.ui_ids 缺少 regions ID：{', '.join(missing)}")
    if extra:
        errors.append(f"scope.ui_ids 包含未声明 regions ID：{', '.join(extra)}")


def _validate_targets(targets: Any, errors: list[str]) -> None:
    """验证最小、首选、最大目标视口和方向策略。"""
    if not _is_mapping(targets):
        return
    for name in ("min", "preferred", "max"):
        target = targets.get(name)
        if not _is_mapping(target):
            errors.append(f"targets.{name} 必须是对象")
            continue
        for dimension in ("width", "height"):
            if not _is_number(target.get(dimension)) or target[dimension] <= 0:
                errors.append(f"targets.{name}.{dimension} 必须是正数")
        if not _is_non_empty_string(target.get("orientation")):
            errors.append(f"targets.{name}.orientation 必须是非空字符串")
    orientations = targets.get("orientations")
    if not isinstance(orientations, list) or not orientations:
        errors.append("targets.orientations 必须是非空数组")
    aspect_ratio = targets.get("aspect_ratio")
    if not _is_mapping(aspect_ratio):
        errors.append("targets.aspect_ratio 必须是对象")
    else:
        minimum = aspect_ratio.get("min")
        maximum = aspect_ratio.get("max")
        if not _is_number(minimum) or minimum <= 0:
            errors.append("targets.aspect_ratio.min 必须是正数")
        if not _is_number(maximum) or maximum <= 0:
            errors.append("targets.aspect_ratio.max 必须是正数")
        if _is_number(minimum) and _is_number(maximum) and minimum > maximum:
            errors.append("targets.aspect_ratio.min 不能大于 max")
    scale = targets.get("scale")
    if not _is_mapping(scale):
        errors.append("targets.scale 必须是对象")
    else:
        for field in ("mode", "canvas", "css_size", "render_resolution", "dpr_policy"):
            if not _is_non_empty_string(scale.get(field)):
                errors.append(f"targets.scale.{field} 必须是非空字符串")


def _validate_coordinate_spaces(spaces: Any, errors: list[str]) -> set[str]:
    """验证坐标空间唯一性及父级引用，并返回可用于区域检查的 ID 集合。"""
    known: set[str] = set()
    if not isinstance(spaces, list) or not spaces:
        errors.append("coordinate_spaces 必须是非空数组")
        return known
    for index, space in enumerate(spaces):
        if not _is_mapping(space):
            errors.append(f"coordinate_spaces[{index}] 必须是对象")
            continue
        space_id = space.get("id")
        if not _is_non_empty_string(space_id):
            errors.append(f"coordinate_spaces[{index}].id 必须是非空字符串")
            continue
        if space_id in known:
            errors.append(f"重复坐标空间 ID：{space_id}")
        known.add(space_id)
    for index, space in enumerate(spaces):
        if not _is_mapping(space):
            continue
        parent = space.get("parent")
        space_id = space.get("id")
        if parent == space_id:
            errors.append(f"coordinate_spaces[{index}] 不能将自身作为 parent：{space_id}")
        elif parent is not None and parent not in known:
            errors.append(f"coordinate_spaces[{index}] 引用不存在的 parent：{parent}")
    graph = {
        space.get("id"): space.get("parent")
        for space in spaces
        if _is_mapping(space) and _is_non_empty_string(space.get("id")) and space.get("parent") in known
    }
    states: dict[str, int] = {}

    def visit(node: str, trail: list[str]) -> None:
        """深度优先检查坐标空间父级，阻止循环继承导致坐标无法求解。"""
        state = states.get(node, 0)
        if state == 1:
            errors.append(f"坐标空间存在循环：{' -> '.join(trail + [node])}")
            return
        if state == 2:
            return
        states[node] = 1
        parent = graph.get(node)
        if parent in graph:
            visit(parent, trail + [node])
        states[node] = 2

    for node in sorted(graph):
        visit(node, [])
    return known


def _validate_anchors(anchors: Any, label: str, errors: list[str]) -> None:
    """验证水平和纵向双方停靠点，避免只有单边坐标的伪关系。"""
    if not _is_mapping(anchors):
        errors.append(f"{label}.anchors 必须是对象")
        return
    for axis in ("horizontal", "vertical"):
        item = anchors.get(axis)
        if not _is_mapping(item):
            errors.append(f"{label}.anchors.{axis} 缺失")
            continue
        for side in ("self", "reference"):
            if not _is_non_empty_string(item.get(side)):
                errors.append(f"{label}.anchors.{axis}.{side} 必须是非空字符串")
        if "offset" not in item or not (_is_number(item["offset"]) or _is_non_empty_string(item["offset"])):
            errors.append(f"{label}.anchors.{axis}.offset 必须声明")


def _validate_size(size: Any, label: str, errors: list[str]) -> None:
    """验证最小、首选、最大尺寸和策略，保证尺寸不会退化为孤立常量。"""
    if not _is_mapping(size):
        errors.append(f"{label}.size 必须是对象")
        return
    values: dict[str, dict[str, Any]] = {}
    for bound in ("min", "preferred", "max"):
        value = size.get(bound)
        if not _is_mapping(value) or "width" not in value or "height" not in value:
            errors.append(f"{label}.size.{bound} 必须包含 width 和 height")
            continue
        values[bound] = value
        for dimension in ("width", "height"):
            if not _is_dimension(value[dimension]):
                errors.append(f"{label}.size.{bound}.{dimension} 必须是正数或非空表达式")
    for dimension in ("width", "height"):
        minimum = values.get("min", {}).get(dimension)
        maximum = values.get("max", {}).get(dimension)
        if _is_number(minimum) and _is_number(maximum) and minimum > maximum:
            errors.append(f"{label}.size.{dimension} 的 min 不能大于 max")
    if not _is_non_empty_string(size.get("strategy")):
        errors.append(f"{label}.size.strategy 必须是非空字符串")


def _validate_regions(document: dict[str, Any], spaces: set[str], errors: list[str], specialized: list[str]) -> set[str]:
    """验证区域字段、参照物和专项审查标记，并返回区域 ID 集合。"""
    regions = document.get("regions")
    if not isinstance(regions, list) or not regions:
        errors.append("regions 必须是非空数组")
        return set()
    region_ids: set[str] = set()
    for index, region in enumerate(regions):
        label = f"regions[{index}]"
        if not _is_mapping(region):
            errors.append(f"{label} 必须是对象")
            continue
        region_id = region.get("id")
        if not _is_non_empty_string(region_id):
            errors.append(f"{label}.id 必须是非空字符串")
            continue
        if region_id in region_ids:
            errors.append(f"重复区域/UI ID：{region_id}")
        region_ids.add(region_id)
        for field in ("semantic_role", "parent_space", "reference_id", "positioning", "layout_group", "layout_participation", "scroll", "input", "clip", "origin", "layout_anchor"):
            if not _is_non_empty_string(region.get(field)):
                errors.append(f"{label}.{field} 必须是非空字符串")
        animation_offset = region.get("animation_offset")
        if not _is_mapping(animation_offset) or "x" not in animation_offset or "y" not in animation_offset:
            errors.append(f"{label}.animation_offset 必须包含 x 和 y")
        elif not all(_is_number(animation_offset[axis]) or _is_non_empty_string(animation_offset[axis]) for axis in ("x", "y")):
            errors.append(f"{label}.animation_offset.x/y 必须是数值或非空表达式")
        if region.get("parent_space") not in spaces:
            errors.append(f"{label} 引用不存在的 parent_space：{region.get('parent_space')}")
        _validate_anchors(region.get("anchors"), label, errors)
        _validate_size(region.get("size"), label, errors)
        if region.get("positioning") == "absolute":
            _append_unique(specialized, f"{region_id}:absolute-positioning")
        size = region.get("size")
        if _is_mapping(size) and size.get("strategy") == "fixed":
            _append_unique(specialized, f"{region_id}:fixed-size")
    return region_ids


def _validate_reference_graph(document: dict[str, Any], region_ids: set[str], errors: list[str]) -> None:
    """验证参照物存在并检测区域参照环，保留 viewport/safe-area 作为边界锚点。"""
    regions = document.get("regions")
    if not isinstance(regions, list):
        return
    allowed = region_ids | {"viewport"}
    graph: dict[str, str] = {}
    for index, region in enumerate(regions):
        if not _is_mapping(region) or region.get("id") not in region_ids:
            continue
        reference = region.get("reference_id")
        if reference not in allowed:
            errors.append(f"regions[{index}] 引用不存在的 reference_id：{reference}")
        elif reference in region_ids:
            graph[region["id"]] = reference
    states: dict[str, int] = {}

    def visit(node: str, trail: list[str]) -> None:
        """深度优先遍历参照图，发现环后只报告一次稳定路径。"""
        state = states.get(node, 0)
        if state == 1:
            cycle = " -> ".join(trail + [node])
            errors.append(f"区域参照存在循环：{cycle}")
            return
        if state == 2:
            return
        states[node] = 1
        if node in graph:
            visit(graph[node], trail + [node])
        states[node] = 2

    for node in sorted(graph):
        visit(node, [])


def _validate_content(content: Any, errors: list[str]) -> None:
    """验证最大内容宽度、列、间距和边距等全局几何字段。"""
    if not _is_mapping(content):
        return
    for field in ("max_width", "columns", "gaps", "margins"):
        if field not in content:
            errors.append(f"content 缺少字段：{field}")
    for field in ("gaps", "margins"):
        value = content.get(field)
        if not _is_mapping(value) or "horizontal" not in value or "vertical" not in value:
            errors.append(f"content.{field} 必须包含 horizontal 和 vertical")


def _validate_breakpoints(breakpoints: Any, errors: list[str]) -> None:
    """验证断点触发条件和结构变化，防止手写坐标补丁冒充响应式策略。"""
    if not isinstance(breakpoints, list) or not breakpoints:
        errors.append("breakpoints 必须是非空数组")
        return
    seen: set[str] = set()
    for index, breakpoint in enumerate(breakpoints):
        label = f"breakpoints[{index}]"
        if not _is_mapping(breakpoint):
            errors.append(f"{label} 必须是对象")
            continue
        identifier = breakpoint.get("id")
        if not _is_non_empty_string(identifier):
            errors.append(f"{label}.id 必须是非空字符串")
        elif identifier in seen:
            errors.append(f"重复断点 ID：{identifier}")
        else:
            seen.add(identifier)
        condition = breakpoint.get("when")
        if not _is_mapping(condition) or not condition:
            errors.append(f"{label}.when 必须是非空对象")
        elif any(not _is_non_empty_string(key) or not _is_condition_value(value) for key, value in condition.items()):
            errors.append(f"{label}.when 必须包含非空键和有效值")
        changes = breakpoint.get("structure_changes")
        if not isinstance(changes, list) or not changes:
            errors.append(f"{label}.structure_changes 必须是非空数组")
        elif any(not _is_non_empty_string(change) and not _is_condition_value(change) for change in changes):
            errors.append(f"{label}.structure_changes 必须包含非空字符串或有效值")


def _validate_platform_and_scrolling(document: dict[str, Any], region_ids: set[str], errors: list[str]) -> None:
    """验证安全区、键盘/折叠输入以及每个滚动轴的唯一所有者。"""
    insets = document.get("platform_insets")
    if not _is_mapping(insets):
        return
    for field in ("safe_area", "system_bars", "keyboard", "folding", "split_screen"):
        if field not in insets:
            errors.append(f"platform_insets 缺少字段：{field}")
    safe_area = insets.get("safe_area")
    if _is_mapping(safe_area):
        for side in ("top", "right", "bottom", "left", "zero_case"):
            if side not in safe_area:
                errors.append(f"platform_insets.safe_area 缺少字段：{side}")
    scrolling = document.get("scrolling")
    if not _is_mapping(scrolling):
        return
    axes = scrolling.get("axes")
    if not isinstance(axes, list) or not axes:
        errors.append("scrolling.axes 必须声明至少一个滚动轴所有者")
    else:
        seen_axes: set[str] = set()
        for index, axis in enumerate(axes):
            label = f"scrolling.axes[{index}]"
            if not _is_mapping(axis):
                errors.append(f"{label} 必须是对象")
                continue
            axis_name = axis.get("axis")
            if axis_name in seen_axes:
                errors.append(f"滚动轴存在多个所有者或重复声明：{axis_name}")
            elif _is_non_empty_string(axis_name):
                seen_axes.add(axis_name)
            for field in ("axis", "owner_id", "content_region_id", "gesture_priority", "bounds"):
                if not _is_non_empty_string(axis.get(field)):
                    errors.append(f"{label}.{field} 必须是非空字符串")
            if axis.get("owner_id") not in region_ids:
                errors.append(f"{label}.owner_id 引用不存在的区域：{axis.get('owner_id')}")
            if axis.get("content_region_id") not in region_ids:
                errors.append(f"{label}.content_region_id 引用不存在的区域：{axis.get('content_region_id')}")
    degradation = scrolling.get("narrow_height_degradation")
    if not _is_mapping(degradation):
        errors.append("scrolling.narrow_height_degradation 必须是对象")
    else:
        for field in ("trigger", "strategy", "fallback"):
            if not _is_non_empty_string(degradation.get(field)):
                errors.append(f"scrolling.narrow_height_degradation.{field} 必须是非空字符串")


def _validate_dynamic_content(dynamic: Any, region_ids: set[str], errors: list[str]) -> None:
    """验证本地化、文字缩放、关键动作和动态重排事件。"""
    if not _is_mapping(dynamic):
        return
    localization = dynamic.get("localization")
    if not _is_mapping(localization):
        errors.append("dynamic_content.localization 必须是对象")
    else:
        for field in ("default_language", "longest_copy", "wrap", "growth", "truncate_policy"):
            if field not in localization:
                errors.append(f"dynamic_content.localization 缺少字段：{field}")
    text_scaling = dynamic.get("text_scaling")
    if not _is_mapping(text_scaling) or "default" not in text_scaling or "maximum" not in text_scaling:
        errors.append("dynamic_content.text_scaling 必须声明 default 和 maximum")
    elif not _is_non_empty_string(text_scaling.get("strategy")):
        errors.append("dynamic_content.text_scaling.strategy 必须是非空字符串")
    actions = dynamic.get("key_actions")
    if not isinstance(actions, list) or not actions:
        errors.append("dynamic_content.key_actions 必须是非空数组")
    else:
        for index, action in enumerate(actions):
            if not _is_mapping(action):
                errors.append(f"dynamic_content.key_actions[{index}] 必须是对象")
                continue
            if not _is_non_empty_string(action.get("id")):
                errors.append(f"dynamic_content.key_actions[{index}].id 必须是非空字符串")
            elif action["id"] not in region_ids:
                errors.append(f"dynamic_content.key_actions[{index}].id 引用不存在的区域：{action['id']}")
            states = action.get("states")
            required_states = {"default", "disabled", "submitting", "completed"}
            if not isinstance(states, list) or not states or any(not _is_non_empty_string(state) for state in states):
                errors.append(f"dynamic_content.key_actions[{index}].states 必须是非空字符串数组")
            elif not required_states.issubset(states):
                errors.append(f"dynamic_content.key_actions[{index}].states 缺少必需状态：{', '.join(sorted(required_states - set(states)))}")
            policy = action.get("text_truncation")
            if policy not in ("forbid", "forbid-critical"):
                errors.append(f"关键动作禁止文本截断：dynamic_content.key_actions[{index}]")
    if not isinstance(dynamic.get("reflow_events"), list) or not dynamic["reflow_events"]:
        errors.append("dynamic_content.reflow_events 必须是非空数组")
    else:
        required_events = {"text-change", "state-change", "resize", "safe-area-change"}
        events = set(dynamic["reflow_events"])
        if any(not _is_non_empty_string(event) for event in dynamic["reflow_events"]):
            errors.append("dynamic_content.reflow_events 必须只包含非空字符串")
        missing = sorted(required_events - events)
        if missing:
            errors.append(f"dynamic_content.reflow_events 缺少必需事件：{', '.join(missing)}")


def _validate_overlays(overlays: Any, region_ids: set[str], errors: list[str], specialized: list[str]) -> None:
    """验证固定/悬浮/停靠元素的遮挡回退，并标记专项审查。"""
    if not isinstance(overlays, list):
        errors.append("overlay_rules 必须是数组")
        return
    for index, rule in enumerate(overlays):
        label = f"overlay_rules[{index}]"
        if not _is_mapping(rule):
            errors.append(f"{label} 必须是对象")
            continue
        mode = rule.get("mode")
        if mode in ("fixed", "floating", "docked"):
            _append_unique(specialized, f"{rule.get('element_id', label)}:{mode}-overlay")
            if not _is_non_empty_string(rule.get("id")):
                errors.append(f"{label}.id 必须是非空字符串")
            if not _is_non_empty_string(rule.get("element_id")) or rule.get("element_id") not in region_ids:
                errors.append(f"{label}.element_id 引用不存在的区域：{rule.get('element_id')}")
            if not _is_non_empty_string(rule.get("occlusion")):
                errors.append(f"{label}.occlusion 必须声明遮挡规则")
            if not _is_non_empty_string(rule.get("fallback")):
                errors.append(f"{label}.fallback 必须声明回退规则")
        else:
            errors.append(f"{label}.mode 必须是 fixed、floating 或 docked")


def _validate_overlay_coverage(document: dict[str, Any], region_ids: set[str], errors: list[str]) -> None:
    """确保固定/悬浮/停靠布局参与方式都有对应遮挡合同。"""
    regions = document.get("regions")
    overlays = document.get("overlay_rules")
    if not isinstance(regions, list) or not isinstance(overlays, list):
        return
    declared = {
        (rule.get("element_id"), rule.get("mode"))
        for rule in overlays
        if _is_mapping(rule)
    }
    required_modes = {
        "fixed-overlay": "fixed",
        "floating-overlay": "floating",
        "docked-overlay": "docked",
    }
    for region in regions:
        if not _is_mapping(region) or region.get("id") not in region_ids:
            continue
        participation = region.get("layout_participation")
        mode = required_modes.get(participation)
        if mode and (region["id"], mode) not in declared:
            errors.append(f"区域 {region['id']} 的 {participation} 缺少对应 overlay_rules")


def _validate_invariants(invariants: Any, region_ids: set[str], errors: list[str]) -> None:
    """验证布局不变量及自动化/视觉证据映射。"""
    if not isinstance(invariants, list) or not invariants:
        errors.append("invariants 必须是非空数组")
        return
    seen: set[str] = set()
    for index, invariant in enumerate(invariants):
        label = f"invariants[{index}]"
        if not _is_mapping(invariant):
            errors.append(f"{label} 必须是对象")
            continue
        identifier = invariant.get("id")
        if not _is_non_empty_string(identifier):
            errors.append(f"{label}.id 必须是非空字符串")
        elif identifier in seen:
            errors.append(f"重复不变量 ID：{identifier}")
        else:
            seen.add(identifier)
        for field in ("description", "expression"):
            if not _is_non_empty_string(invariant.get(field)):
                errors.append(f"{label}.{field} 必须是非空字符串")
        applies_to = invariant.get("applies_to")
        if not isinstance(applies_to, list) or not applies_to:
            errors.append(f"{label}.applies_to 必须是非空数组")
        else:
            for target in applies_to:
                if not _is_non_empty_string(target) or target not in region_ids:
                    errors.append(f"{label}.applies_to 引用不存在的区域：{target}")
        tolerance = invariant.get("tolerance")
        if not _is_number(tolerance) or tolerance < 0:
            errors.append(f"{label}.tolerance 必须是非负数")
        evidence = invariant.get("evidence")
        if not _is_mapping(evidence):
            errors.append(f"{label}.evidence 必须是对象")
            continue
        for kind in ("automation", "visual"):
            items = evidence.get(kind)
            if not isinstance(items, list) or not items or any(not _is_non_empty_string(item) for item in items):
                errors.append(f"{label}.evidence.{kind} 必须是非空数组且仅含非空字符串")


def _validate_evidence_matrix(matrix: Any, errors: list[str]) -> None:
    """验证证据矩阵绑定、必需轴和冻结 Golden 规则。"""
    if not _is_mapping(matrix):
        return
    for field in ("candidate_binding", "golden_policy", "snapshot_stability"):
        if not _is_non_empty_string(matrix.get(field)):
            errors.append(f"evidence_matrix.{field} 必须是非空字符串")
    axes = matrix.get("required_axes")
    if not isinstance(axes, list) or not axes or any(not _is_non_empty_string(axis) for axis in axes):
        errors.append("evidence_matrix.required_axes 必须是非空数组")
    else:
        missing = sorted(REQUIRED_EVIDENCE_AXES - set(axes))
        if missing:
            errors.append(f"evidence_matrix.required_axes 缺少必需轴：{', '.join(missing)}")


def validate_contract(document: Any) -> dict[str, Any]:
    """验证布局合同并返回稳定的 error/warning/specialized_review 结果。"""
    errors: list[str] = []
    warnings: list[str] = []
    specialized: list[str] = []
    _validate_root(document, errors)
    if not _is_mapping(document):
        return {"status": "failed", "errors": errors, "warnings": warnings, "specialized_review": specialized}
    _validate_scope(document.get("scope"), errors)
    _validate_targets(document.get("targets"), errors)
    spaces = _validate_coordinate_spaces(document.get("coordinate_spaces"), errors)
    region_ids = _validate_regions(document, spaces, errors, specialized)
    _validate_scope_region_ids(document.get("scope"), region_ids, errors)
    _validate_reference_graph(document, region_ids, errors)
    _validate_content(document.get("content"), errors)
    _validate_breakpoints(document.get("breakpoints"), errors)
    _validate_platform_and_scrolling(document, region_ids, errors)
    _validate_dynamic_content(document.get("dynamic_content"), region_ids, errors)
    _validate_overlays(document.get("overlay_rules"), region_ids, errors, specialized)
    _validate_overlay_coverage(document, region_ids, errors)
    _validate_invariants(document.get("invariants"), region_ids, errors)
    _validate_evidence_matrix(document.get("evidence_matrix"), errors)
    if isinstance(document.get("dynamic_content"), dict):
        localization = document["dynamic_content"].get("localization")
        if isinstance(localization, dict) and localization.get("truncate_policy") not in ("forbid-critical", "forbid"):
            warnings.append("本地化截断策略未明确禁止关键文本")
    return {"status": "passed" if not errors else "failed", "errors": errors, "warnings": warnings, "specialized_review": specialized}


def load_contract(path: Path) -> Any:
    """读取严格 JSON-compatible YAML 合同；解析失败由命令行统一报告。"""
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def main(argv: list[str] | None = None) -> int:
    """解析命令行、验证合同并以确定性文本或 JSON 返回退出码。"""
    parser = argparse.ArgumentParser(description="验证 Phaser 4 UI 布局合同（JSON-compatible YAML）")
    parser.add_argument("contract", type=Path, help="合同文件路径")
    parser.add_argument("--json", action="store_true", dest="as_json", help="输出机器可读 JSON")
    args = parser.parse_args(argv)
    try:
        result = validate_contract(load_contract(args.contract))
    except (OSError, json.JSONDecodeError) as error:
        result = {"status": "failed", "errors": [f"无法解析合同：{error}"], "warnings": [], "specialized_review": []}
    if args.as_json:
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    else:
        print(f"status: {result['status']}")
        for error in result["errors"]:
            print(f"error: {error}")
        for warning in result["warnings"]:
            print(f"warning: {warning}")
        for item in result["specialized_review"]:
            print(f"specialized_review: {item}")
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())

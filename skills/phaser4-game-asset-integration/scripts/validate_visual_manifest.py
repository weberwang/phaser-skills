#!/usr/bin/env python3
"""验证 visual-assets.json 的结构、唯一性和正式资源证据。"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


ALLOWED_ROUTES = {
    "ui-icon-font",
    "pixel-art",
    "frame-animation",
    "skeletal-animation",
    "scene-tilemap",
    "vfx-particle-shader",
    "decorative-full-bleed",
    "gameplay-environment",
    "ai-composite-raster",
}
ALLOWED_STATUSES = {"planned", "producing", "review", "accepted", "rejected", "replaced"}
REQUIRED_BUDGETS = {
    "max_texture_size",
    "texture_memory_mb",
    "package_size_mb",
    "max_atlases",
    "max_frames",
    "animation_sample_fps",
    "max_overdraw",
    "max_draw_calls",
}


class ManifestValidationError(ValueError):
    """表示清单无法解析或不满足最低结构约束。"""


def _non_empty_string(value: Any) -> bool:
    """判断值是否为去除空白后仍有内容的字符串。"""
    return isinstance(value, str) and bool(value.strip())


def _validate_budget_block(budgets: Any, errors: list[str]) -> None:
    """验证预算字段齐全且为正数。"""
    if not isinstance(budgets, dict):
        errors.append("budgets 必须是对象")
        return
    missing = sorted(REQUIRED_BUDGETS - budgets.keys())
    if missing:
        errors.append(f"budgets 缺少字段：{', '.join(missing)}")
    for name in REQUIRED_BUDGETS & budgets.keys():
        value = budgets[name]
        if not isinstance(value, (int, float)) or isinstance(value, bool) or value <= 0:
            errors.append(f"budgets.{name} 必须是正数")


def _validate_accepted_asset(asset: dict[str, Any], label: str, errors: list[str]) -> None:
    """验证已验收资源具备来源、授权、输出及运行证据。"""
    source_file = asset.get("source_file")
    generation_record = asset.get("generation_record")
    if not _non_empty_string(source_file) and not isinstance(generation_record, dict):
        errors.append(f"{label} accepted 必须提供 source_file 或 generation_record")
    if isinstance(generation_record, dict) and not generation_record:
        errors.append(f"{label}.generation_record 不能为空对象")
    for field in ("license_record", "phaser_evidence", "gameplay_visual_evidence"):
        if not _non_empty_string(asset.get(field)):
            errors.append(f"{label} accepted 缺少 {field}")
    outputs = asset.get("runtime_outputs")
    if not isinstance(outputs, list) or not outputs or not all(_non_empty_string(item) for item in outputs):
        errors.append(f"{label} accepted 的 runtime_outputs 必须是非空路径列表")


def validate_manifest(data: Any) -> list[str]:
    """返回清单中的全部结构与业务校验错误。"""
    errors: list[str] = []
    if not isinstance(data, dict):
        return ["清单根节点必须是对象"]
    if data.get("schema_version") != "1.0":
        errors.append("schema_version 必须为 1.0")
    _validate_budget_block(data.get("budgets"), errors)

    assets = data.get("assets")
    if not isinstance(assets, list):
        errors.append("assets 必须是数组")
        return errors

    seen: dict[str, set[str]] = {"id": set(), "texture_key": set(), "output": set()}
    for index, asset in enumerate(assets):
        label = f"assets[{index}]"
        if not isinstance(asset, dict):
            errors.append(f"{label} 必须是对象")
            continue
        for field in ("id", "texture_key", "route", "status"):
            if not _non_empty_string(asset.get(field)):
                errors.append(f"{label}.{field} 必须是非空字符串")
        route = asset.get("route")
        status = asset.get("status")
        if _non_empty_string(route) and route not in ALLOWED_ROUTES:
            errors.append(f"{label}.route 不在允许列表中：{route}")
        if _non_empty_string(status) and status not in ALLOWED_STATUSES:
            errors.append(f"{label}.status 不在允许列表中：{status}")

        for field in ("id", "texture_key"):
            value = asset.get(field)
            if _non_empty_string(value):
                if value in seen[field]:
                    errors.append(f"{label}.{field} 重复：{value}")
                seen[field].add(value)

        outputs = asset.get("runtime_outputs", [])
        if isinstance(outputs, list):
            for output in outputs:
                if not _non_empty_string(output):
                    continue
                if output in seen["output"]:
                    errors.append(f"{label}.runtime_outputs 路径重复：{output}")
                seen["output"].add(output)

        if status == "accepted":
            _validate_accepted_asset(asset, label, errors)
    return errors


def _project_path(project_root: Path, relative_path: str) -> Path:
    """解析项目内路径，并拒绝逃逸出项目根目录。"""
    candidate = (project_root / relative_path).resolve()
    try:
        candidate.relative_to(project_root)
    except ValueError as error:
        raise ManifestValidationError(f"路径逃逸项目根目录：{relative_path}") from error
    return candidate


def check_manifest_files(data: dict[str, Any], project_root: Path) -> list[str]:
    """检查已验收资源声明的本地文件是否存在。"""
    errors: list[str] = []
    root = project_root.resolve()
    assets = data.get("assets")
    # 结构校验负责报告容器类型；文件检查在结构错误时应安全跳过，避免遮蔽可读错误。
    if not isinstance(assets, list):
        return errors
    for index, asset in enumerate(assets):
        if not isinstance(asset, dict) or asset.get("status") != "accepted":
            continue
        paths: list[tuple[str, str]] = []
        source_file = asset.get("source_file")
        if _non_empty_string(source_file):
            paths.append(("source_file", source_file))
        for field in ("license_record", "phaser_evidence", "gameplay_visual_evidence"):
            value = asset.get(field)
            if _non_empty_string(value):
                paths.append((field, value))
        runtime_outputs = asset.get("runtime_outputs")
        if isinstance(runtime_outputs, list):
            for output in runtime_outputs:
                if _non_empty_string(output):
                    paths.append(("runtime_outputs", output))

        for field, relative_path in paths:
            try:
                target = _project_path(root, relative_path)
            except ManifestValidationError as error:
                errors.append(f"assets[{index}].{field}：{error}")
                continue
            if not target.is_file():
                errors.append(f"assets[{index}].{field} 文件不存在：{relative_path}")
    return errors


def load_manifest(path: Path) -> dict[str, Any]:
    """读取 JSON 清单，并将解析错误转换为可读异常。"""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ManifestValidationError(f"无法读取清单 {path}：{error}") from error
    if not isinstance(data, dict):
        raise ManifestValidationError("清单根节点必须是对象")
    return data


def parse_args() -> argparse.Namespace:
    """解析清单路径、项目根目录和文件检查开关。"""
    parser = argparse.ArgumentParser(description="验证 Phaser 视觉资源机器清单")
    parser.add_argument("manifest", type=Path, help="visual-assets.json 路径")
    parser.add_argument("--project-root", type=Path, help="资源路径解析根目录；默认清单上级的上级")
    parser.add_argument("--check-files", action="store_true", help="检查 accepted 资源引用的文件")
    return parser.parse_args()


def main() -> int:
    """执行清单验证并以退出码表达结果。"""
    args = parse_args()
    try:
        data = load_manifest(args.manifest)
        errors = validate_manifest(data)
        if args.check_files:
            root = args.project_root or args.manifest.resolve().parent.parent
            errors.extend(check_manifest_files(data, root))
    except ManifestValidationError as error:
        print(f"视觉资源清单无效：{error}", file=sys.stderr)
        return 1

    if errors:
        print("视觉资源清单无效：", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("视觉资源清单验证通过。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

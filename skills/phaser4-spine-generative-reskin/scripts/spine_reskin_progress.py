#!/usr/bin/env python3
"""确定性管理 Spine Atlas 生成式换皮的解析、进度和空白页重建。"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


SCHEMA_VERSION = 1
STATUSES = (
    "pending",
    "generating",
    "generated",
    "validating",
    "packing",
    "completed",
    "failed",
)
PAGE_MARKERS = {
    "format",
    "filter",
    "repeat",
    "pma",
    "scale",
    "minfilter",
    "magfilter",
    "anisotropic",
}
REGION_MARKERS = {
    "rotate",
    "xy",
    "bounds",
    "orig",
    "offset",
    "offsets",
    "index",
    "split",
    "pad",
}
ALLOWED_TRANSITIONS = {
    "pending": {"pending", "generating", "generated", "failed"},
    "generating": {"pending", "generating", "generated", "failed"},
    "generated": {"generated", "validating", "failed"},
    "validating": {"pending", "validating", "generated", "packing", "failed"},
    "packing": {"pending", "packing", "completed", "failed"},
    "completed": {"completed"},
    "failed": {"failed", "pending", "generating", "generated"},
}


class ReskinError(Exception):
    """表示清单、Atlas 或候选产物不满足换皮约束的可读错误。"""


def _now() -> str:
    """返回带 UTC 时区的稳定 ISO 时间戳，便于跨机器审计历史。"""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _sha256(path: Path) -> str:
    """以固定分块读取文件并计算 SHA-256，避免大图一次性占用内存。"""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json_atomic(path: Path, document: dict[str, Any]) -> None:
    """先写同目录临时文件再替换，避免中断留下半个进度清单。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    payload = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
    try:
        temporary.write_text(payload, encoding="utf-8", newline="\n")
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def _read_manifest(path: Path) -> dict[str, Any]:
    """读取并检查清单根结构，尽早阻止对错误文件进行破坏性操作。"""
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ReskinError(f"找不到进度清单：{path}") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise ReskinError(f"无法读取进度清单 {path}：{exc}") from exc
    if not isinstance(document, dict) or document.get("schema_version") != SCHEMA_VERSION:
        raise ReskinError(f"进度清单必须使用 schema_version={SCHEMA_VERSION}")
    if not isinstance(document.get("cells"), list) or not isinstance(document.get("atlas"), dict):
        raise ReskinError("进度清单缺少 atlas 或 cells")
    return document


def _field_parts(line: str) -> tuple[str, str] | None:
    """解析 Atlas 的键值行，同时保留原始大小写以便重新输出。"""
    if ":" not in line:
        return None
    key, value = line.strip().split(":", 1)
    key = key.strip()
    if not key:
        return None
    return key, value.strip()


def _field(fields: dict[str, str], name: str, default: str | None = None) -> str | None:
    """按不区分大小写查找字段，兼容不同 Spine 导出器的命名大小写。"""
    target = name.lower()
    for key, value in fields.items():
        if key.lower() == target:
            return value
    return default


def _numbers(value: str | None, count: int, label: str) -> list[int]:
    """把逗号或空格分隔的整数转换为坐标数组并检查数量。"""
    if value is None:
        raise ReskinError(f"Atlas 字段 {label} 缺失")
    tokens = [item for item in re.split(r"[,\s]+", value.strip()) if item]
    if len(tokens) != count:
        raise ReskinError(f"Atlas 字段 {label} 需要 {count} 个整数：{value}")
    try:
        return [int(token) for token in tokens]
    except ValueError as exc:
        raise ReskinError(f"Atlas 字段 {label} 含非整数值：{value}") from exc


def _rotate_degrees(value: str | None) -> int:
    """将 Spine 的布尔或数字 rotate 字段标准化为 0/90/180/270 度。"""
    if value is None or value.strip().lower() in {"false", "0", "none"}:
        return 0
    if value.strip().lower() in {"true", "yes"}:
        return 90
    try:
        degrees = int(value)
    except ValueError as exc:
        raise ReskinError(f"不支持的 rotate 值：{value}") from exc
    if degrees % 90 != 0:
        raise ReskinError(f"rotate 必须是 90 度倍数：{value}")
    return degrees % 360


def _split_atlas_blocks(text: str) -> list[list[str]]:
    """按空行或下一个无冒号名称分割 Atlas 块，兼容省略空行的导出器。"""
    blocks: list[list[str]] = []
    current: list[str] = []
    has_fields = False
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    for raw_line in normalized.split("\n"):
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            if current:
                blocks.append(current)
                current = []
                has_fields = False
            continue
        # 某些导出器不写 Page/Region 之间的空行；字段块后的无冒号行就是新名称。
        if current and has_fields and ":" not in stripped:
            blocks.append(current)
            current = []
            has_fields = False
        current.append(raw_line.rstrip())
        has_fields = has_fields or ":" in stripped
    if current:
        blocks.append(current)
    return blocks


def _block_fields(lines: list[str]) -> tuple[dict[str, str], list[str]]:
    """解析块的字段映射和顺序，未知字段原样保留以支持未来 Atlas 版本。"""
    fields: dict[str, str] = {}
    order: list[str] = []
    for line in lines[1:]:
        parts = _field_parts(line)
        if parts is None:
            continue
        key, value = parts
        fields[key] = value
        order.append(key)
    return fields, order


def _looks_like_page(fields: dict[str, str], first_block: bool = False) -> bool:
    """根据 Page 专有字段区分多 Page 块与 Region 块。"""
    lowered = {key.lower() for key in fields}
    if first_block:
        return True
    if lowered & PAGE_MARKERS:
        return True
    return "size" in lowered and not (lowered & REGION_MARKERS)


def parse_atlas(path: Path) -> dict[str, Any]:
    """解析所有 Atlas Page 与 Region，并输出可序列化的结构参考。"""
    try:
        text = path.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeError) as exc:
        raise ReskinError(f"无法读取 Atlas {path}（需要 UTF-8）：{exc}") from exc
    blocks = _split_atlas_blocks(text)
    if not blocks:
        raise ReskinError("Atlas 为空")
    pages: list[dict[str, Any]] = []
    cells: list[dict[str, Any]] = []
    current_page = -1
    seen_ids: dict[str, int] = {}
    for block_index, lines in enumerate(blocks):
        fields, order = _block_fields(lines)
        is_page = _looks_like_page(fields, first_block=block_index == 0)
        if is_page:
            page_size = _numbers(_field(fields, "size", "0, 0"), 2, "size")
            page = {
                "index": len(pages),
                "name": lines[0].strip(),
                "width": page_size[0],
                "height": page_size[1],
                "fields": fields,
                "field_order": order,
            }
            pages.append(page)
            current_page = page["index"]
            continue
        if current_page < 0:
            raise ReskinError(f"Region {lines[0]} 没有所属 Page")
        xy: list[int]
        size: list[int]
        bounds = _field(fields, "bounds")
        if bounds is not None:
            bound_values = _numbers(bounds, 4, "bounds")
            xy, size = bound_values[:2], bound_values[2:]
        else:
            xy = _numbers(_field(fields, "xy"), 2, "xy")
            size = _numbers(_field(fields, "size"), 2, "size")
        offsets = _field(fields, "offsets")
        if offsets is not None:
            offset_values = _numbers(offsets, 4, "offsets")
            offset, orig = offset_values[:2], offset_values[2:]
        else:
            orig = _numbers(_field(fields, "orig", ",".join(map(str, size))), 2, "orig")
            offset = _numbers(_field(fields, "offset", "0, 0"), 2, "offset")
        index_value = _field(fields, "index", "-1")
        try:
            index = int(index_value or "-1")
        except ValueError as exc:
            raise ReskinError(f"Region {lines[0]} 的 index 不是整数：{index_value}") from exc
        base_id = f"p{current_page}:{lines[0].strip()}"
        seen_ids[base_id] = seen_ids.get(base_id, 0) + 1
        cell_id = base_id if seen_ids[base_id] == 1 else f"{base_id}#{seen_ids[base_id]}"
        cells.append(
            {
                "id": cell_id,
                "name": lines[0].strip(),
                "page_index": current_page,
                "page": pages[current_page]["name"],
                "xy": xy,
                "size": size,
                "orig": orig,
                "offset": offset,
                "rotate": _field(fields, "rotate", "false"),
                "rotate_degrees": _rotate_degrees(_field(fields, "rotate")),
                "index": index,
                "fields": fields,
                "field_order": order,
            }
        )
    if not pages:
        raise ReskinError("Atlas 没有 Page")
    return {"pages": pages, "cells": cells}


def _relative_path(path: Path, base: Path) -> str:
    """优先保存相对候选目录的路径，跨目录文件才保存绝对路径。"""
    try:
        return path.resolve().relative_to(base.resolve()).as_posix()
    except ValueError:
        return str(path.resolve())


def _require_pillow() -> Any:
    """加载 Pillow 并在缺失时给出安装外部依赖的明确提示。"""
    try:
        from PIL import Image
    except ImportError as exc:
        raise ReskinError("该操作需要 Pillow；请在项目环境中安装 Pillow 后重试，工具不会自动安装依赖") from exc
    return Image


def _source_page_size(page: dict[str, Any], atlas_path: Path) -> tuple[int, int]:
    """在 Atlas 未写 Page size 时从源图片读取尺寸，仍不读取像素用于输出。"""
    if page["width"] > 0 and page["height"] > 0:
        return page["width"], page["height"]
    image_path = atlas_path.parent / page["name"]
    Image = _require_pillow()
    try:
        with Image.open(image_path) as image:
            return image.width, image.height
    except OSError as exc:
        raise ReskinError(f"Page {page['name']} 缺少尺寸且无法读取源图片：{exc}") from exc


def _upright_size(cell: dict[str, Any]) -> tuple[int, int]:
    """返回正向 Cell 尺寸；Atlas 中 90/270 度矩形的宽高需要交换。"""
    width, height = cell["size"]
    if cell["rotate_degrees"] in {90, 270}:
        return height, width
    return width, height


def _transpose(image: Any, degrees: int) -> Any:
    """按顺时针角度旋转 Pillow 图像，兼容新旧 Pillow 的枚举名称。"""
    transpose = getattr(image, "transpose")
    # Pillow 的 ROTATE_270 是顺时针 90 度，正好对应 Spine 的存放方向。
    try:
        from PIL import Image as PillowImage

        enum = getattr(PillowImage, "Transpose", PillowImage)
        operations = {90: enum.ROTATE_270, 180: enum.ROTATE_180, 270: enum.ROTATE_90}
        return transpose(operations[degrees % 360]) if degrees % 360 else image
    except (ImportError, AttributeError) as exc:
        raise ReskinError("当前 Pillow 不支持所需的旋转操作") from exc


def _extract_references(manifest: dict[str, Any], manifest_path: Path, reference_dir: Path) -> None:
    """只从源 Page 生成结构参考裁剪，并明确不把它们接入最终打包路径。"""
    Image = _require_pillow()
    atlas_path = Path(manifest["atlas"]["path"])
    reference_dir.mkdir(parents=True, exist_ok=True)
    page_images: dict[int, Any] = {}
    try:
        for cell in manifest["cells"]:
            page_index = cell["page_index"]
            if page_index not in page_images:
                page = manifest["atlas"]["pages"][page_index]
                page_path = atlas_path.parent / page["name"]
                try:
                    page_images[page_index] = Image.open(page_path).convert("RGBA")
                except OSError as exc:
                    raise ReskinError(f"无法打开源 Page {page_path}：{exc}") from exc
            source = page_images[page_index]
            x, y = cell["xy"]
            width, height = cell["size"]
            crop = source.crop((x, y, x + width, y + height))
            if cell["rotate_degrees"]:
                crop = _transpose(crop, (-cell["rotate_degrees"]) % 360)
            safe_name = re.sub(r"[^0-9A-Za-z_.-]+", "_", cell["id"])
            output = reference_dir / f"{safe_name}.png"
            crop.save(output, format="PNG")
            cell["source_reference"] = _relative_path(output, manifest_path.parent)
    finally:
        for image in page_images.values():
            image.close()


def build_manifest(atlas_path: Path, output_path: Path, style_references: Iterable[str]) -> dict[str, Any]:
    """从 Atlas 建立包含全部 Cell、源哈希和空白打包参数的初始清单。"""
    parsed = parse_atlas(atlas_path)
    pages: list[dict[str, Any]] = []
    for page in parsed["pages"]:
        width, height = _source_page_size(page, atlas_path)
        if width <= 0 or height <= 0:
            raise ReskinError(f"Page {page['name']} 尺寸必须为正数：{width}, {height}")
        source_page_path = (atlas_path.parent / page["name"]).resolve()
        if not source_page_path.is_file():
            raise ReskinError(f"Atlas Page 文件不存在：{source_page_path}")
        pages.append(
            {
                **page,
                "width": width,
                "height": height,
                "source_path": str(source_page_path),
                "sha256": _sha256(source_page_path),
            }
        )
    cells: list[dict[str, Any]] = []
    for cell in parsed["cells"]:
        cells.append(
            {
                **cell,
                "status": "pending",
                "generated_image": None,
                "result_sha256": None,
                "attempts": 0,
                "history": [],
                "last_error": None,
                "source_reference": None,
            }
        )
    return {
        "schema_version": SCHEMA_VERSION,
        "created_at": _now(),
        "updated_at": _now(),
        "atlas": {
            "path": str(atlas_path.resolve()),
            "sha256": _sha256(atlas_path),
            "pages": pages,
        },
        "style_references": [str(item) for item in style_references],
        "packing": {"padding": 0, "extrusion": 0},
        "build": None,
        "cells": cells,
    }


def _touch(document: dict[str, Any]) -> None:
    """更新清单根时间，便于判断长期未同步的候选。"""
    document["updated_at"] = _now()


def _cell(document: dict[str, Any], cell_id: str) -> dict[str, Any]:
    """按稳定 ID 查找 Cell，重复或缺失均作为可读错误处理。"""
    matches = [item for item in document["cells"] if item.get("id") == cell_id]
    if not matches:
        raise ReskinError(f"找不到 Cell：{cell_id}")
    return matches[0]


def _record(document: dict[str, Any], cell: dict[str, Any], event: str, **extra: Any) -> None:
    """追加不可变状态事件，给重试和恢复提供审计证据。"""
    entry = {"event": event, "at": _now()}
    entry.update(extra)
    cell.setdefault("history", []).append(entry)
    _touch(document)


def _transition(document: dict[str, Any], cell: dict[str, Any], status: str, error: str | None = None) -> None:
    """执行状态机转移并记录尝试、错误和时间，拒绝跳过失败门。"""
    if status not in STATUSES:
        raise ReskinError(f"未知状态：{status}")
    old = cell.get("status", "pending")
    if status not in ALLOWED_TRANSITIONS.get(old, set()):
        raise ReskinError(f"Cell {cell['id']} 不允许从 {old} 转为 {status}")
    if status == "generating" and old != "generating":
        cell["attempts"] = int(cell.get("attempts", 0)) + 1
    elif status == "generated" and old == "pending":
        # 允许重启后直接登记已落盘的结果，同时仍留下可审计的一次尝试。
        cell["attempts"] = max(1, int(cell.get("attempts", 0)))
    cell["status"] = status
    cell["last_error"] = error
    _record(document, cell, "status", status=status, error=error)


def _resolve_artifact(manifest_path: Path, value: str | None) -> Path | None:
    """将清单内相对路径解析到清单目录，绝不把参考图当生成结果。"""
    if not value:
        return None
    candidate = Path(value)
    return candidate if candidate.is_absolute() else (manifest_path.parent / candidate)


def command_init(args: argparse.Namespace) -> int:
    """初始化清单并可选地导出只读源 Cell 参考图。"""
    atlas_path = Path(args.atlas).resolve()
    output_path = Path(args.output).resolve()
    if not atlas_path.is_file():
        raise ReskinError(f"找不到 Atlas：{atlas_path}")
    if output_path.exists() and not args.force:
        raise ReskinError(f"进度清单已存在，默认不覆盖：{output_path}（需要 --force）")
    manifest = build_manifest(atlas_path, output_path, args.style_reference or [])
    if args.reference_dir:
        _extract_references(manifest, output_path, Path(args.reference_dir).resolve())
    _write_json_atomic(output_path, manifest)
    print(f"已初始化 {len(manifest['cells'])} 个 Cell、{len(manifest['atlas']['pages'])} 个 Page：{output_path}")
    return 0


def command_status(args: argparse.Namespace) -> int:
    """汇总各状态数量，输出 JSON 方便 CI 或人工审阅。"""
    manifest_path = Path(args.manifest).resolve()
    document = _read_manifest(manifest_path)
    counts = {status: 0 for status in STATUSES}
    for cell in document["cells"]:
        status = cell.get("status", "pending")
        counts[status] = counts.get(status, 0) + 1
    print(json.dumps({"total": len(document["cells"]), "by_status": counts}, ensure_ascii=False, indent=2))
    return 0


def command_read(args: argparse.Namespace) -> int:
    """读取并原样打印进度清单，便于脚本或人工审计全部 Cell 元数据。"""
    document = _read_manifest(Path(args.manifest).resolve())
    print(json.dumps(document, ensure_ascii=False, indent=2))
    return 0


def command_recover(args: argparse.Namespace) -> int:
    """把崩溃遗留的处理中状态退回 pending，保留原历史而不复用旧图。"""
    manifest_path = Path(args.manifest).resolve()
    document = _read_manifest(manifest_path)
    recovered = 0
    for cell in document["cells"]:
        if cell.get("status") in {"generating", "validating", "packing"}:
            old = cell["status"]
            _transition(document, cell, "pending", error=f"从 {old} 恢复")
            _record(document, cell, "recovered", from_status=old)
            recovered += 1
    _write_json_atomic(manifest_path, document)
    print(f"已恢复 {recovered} 个处理中 Cell")
    return 0


def command_mark(args: argparse.Namespace) -> int:
    """记录单个 Cell 的状态和生成文件哈希，生成状态必须先确认文件存在。"""
    manifest_path = Path(args.manifest).resolve()
    document = _read_manifest(manifest_path)
    cell = _cell(document, args.cell)
    image_path = Path(args.image).resolve() if args.image else None
    if args.status == "generated":
        if image_path is None or not image_path.is_file():
            raise ReskinError("标记 generated 必须传入存在的 --image")
        cell["generated_image"] = _relative_path(image_path, manifest_path.parent)
        cell["result_sha256"] = _sha256(image_path)
    elif args.image:
        raise ReskinError("只有 generated 状态可以传入 --image")
    if args.status == "failed" and not args.error:
        raise ReskinError("failed 状态必须提供 --error")
    _transition(document, cell, args.status, error=args.error)
    if args.status in {"generating", "failed", "pending"} and args.status != "generated":
        # 重试时不删除历史图，但由于状态不是 generated，打包器永远不会把它当新结果。
        if args.status in {"pending", "generating"}:
            cell["last_error"] = None
    _write_json_atomic(manifest_path, document)
    print(f"{cell['id']} -> {cell['status']}")
    return 0


def _verify_document(document: dict[str, Any], manifest_path: Path) -> list[str]:
    """逐 Cell 检查终态、产物存在性和哈希一致性，返回全部诊断。"""
    errors: list[str] = []
    if not document["cells"]:
        errors.append("Atlas 没有可验证的 Cell")
    for cell in document["cells"]:
        if cell.get("status") != "completed":
            errors.append(f"{cell.get('id')} 状态为 {cell.get('status')}，未完成")
            continue
        image_path = _resolve_artifact(manifest_path, cell.get("generated_image"))
        if image_path is None or not image_path.is_file():
            errors.append(f"{cell.get('id')} 缺少生成图")
            continue
        expected = cell.get("result_sha256")
        actual = _sha256(image_path)
        if not expected or expected != actual:
            errors.append(f"{cell.get('id')} 生成图哈希不匹配")
        if cell.get("last_error"):
            errors.append(f"{cell.get('id')} 保留错误：{cell['last_error']}")
    build = document.get("build")
    if not isinstance(build, dict):
        errors.append("缺少 build，未记录可验证的重建工件")
        return errors
    output_atlas_value = build.get("output_atlas")
    expected_atlas_hash = build.get("atlas_sha256")
    atlas_output = _resolve_artifact(manifest_path, output_atlas_value) if isinstance(output_atlas_value, str) else None
    if atlas_output is None or not atlas_output.is_file():
        errors.append("已记录的重建 Atlas 不存在")
    elif not isinstance(expected_atlas_hash, str) or _sha256(atlas_output) != expected_atlas_hash:
        errors.append("重建 Atlas SHA-256 不匹配")

    output_dir_value = build.get("output_dir")
    output_dir = _resolve_artifact(manifest_path, output_dir_value) if isinstance(output_dir_value, str) else None
    page_hashes = build.get("page_sha256")
    if not isinstance(page_hashes, dict):
        errors.append("build.page_sha256 缺失或不是对象")
    else:
        for page in document["atlas"].get("pages", []):
            page_name = page.get("output_name") or _output_page_name(page)
            expected_page_hash = page_hashes.get(page_name)
            if not isinstance(expected_page_hash, str):
                errors.append(f"缺少 Page 哈希：{page_name}")
                continue
            page_output = (output_dir / Path(page_name)) if output_dir is not None else None
            if page_output is None or not page_output.is_file():
                errors.append(f"重建 Page 不存在：{page_name}")
            elif _sha256(page_output) != expected_page_hash:
                errors.append(f"重建 Page SHA-256 不匹配：{page_name}")
    return errors


def command_verify(args: argparse.Namespace) -> int:
    """验证所有 Cell 和已记录重建工件，未完成时返回非零。"""
    manifest_path = Path(args.manifest).resolve()
    document = _read_manifest(manifest_path)
    errors = _verify_document(document, manifest_path)
    if errors:
        for error in errors:
            print(f"错误：{error}", file=sys.stderr)
        return 1
    print(f"验证通过：{len(document['cells'])} 个 Cell")
    return 0


def _pma(page: dict[str, Any]) -> bool:
    """读取 Page PMA 标记，兼容 true/false、1/0 和大小写变体。"""
    value = _field(page.get("fields", {}), "pma", "false")
    return str(value).strip().lower() in {"true", "1", "yes"}


def _premultiply(image: Any) -> Any:
    """复制图像并按 alpha 预乘 RGB，避免修改生成源文件。"""
    output = image.copy().convert("RGBA")
    pixels = output.load()
    for y in range(output.height):
        for x in range(output.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0:
                pixels[x, y] = (0, 0, 0, 0)
            else:
                pixels[x, y] = (
                    red * alpha // 255,
                    green * alpha // 255,
                    blue * alpha // 255,
                    alpha,
                )
    return output


def _extruded_canvas(Image: Any, image: Any, full_size: tuple[int, int], padding: int, extrusion: int) -> Any:
    """把生成内容放入原 Region 矩形，并只用生成边缘扩展 padding。"""
    full_width, full_height = full_size
    if image.size == full_size:
        return image.copy().convert("RGBA")
    core_size = (full_width - padding * 2, full_height - padding * 2)
    if padding <= 0 or image.size != core_size:
        raise ReskinError(
            f"生成图尺寸 {image.size} 不符合目标 {full_size} 或 padding 后尺寸 {core_size}"
        )
    if extrusion < 0 or extrusion > padding:
        raise ReskinError("extrusion 必须在 0 与 padding 之间")
    output = Image.new("RGBA", full_size, (0, 0, 0, 0))
    output.paste(image.convert("RGBA"), (padding, padding))
    if extrusion == 0:
        return output
    source = image.convert("RGBA")
    source_pixels = source.load()
    pixels = output.load()
    for y in range(source.height):
        for distance in range(1, extrusion + 1):
            pixels[padding - distance, padding + y] = source_pixels[0, y]
            pixels[padding + source.width - 1 + distance, padding + y] = source_pixels[source.width - 1, y]
    for x in range(source.width):
        for distance in range(1, extrusion + 1):
            pixels[padding + x, padding - distance] = source_pixels[x, 0]
            pixels[padding + x, padding + source.height - 1 + distance] = source_pixels[x, source.height - 1]
    for distance_y in range(1, extrusion + 1):
        for distance_x in range(1, extrusion + 1):
            pixels[padding - distance_x, padding - distance_y] = source_pixels[0, 0]
            pixels[padding + source.width - 1 + distance_x, padding - distance_y] = source_pixels[source.width - 1, 0]
            pixels[padding - distance_x, padding + source.height - 1 + distance_y] = source_pixels[0, source.height - 1]
            pixels[padding + source.width - 1 + distance_x, padding + source.height - 1 + distance_y] = source_pixels[source.width - 1, source.height - 1]
    return output


def _prepare_cell_image(Image: Any, cell: dict[str, Any], source: Any, padding: int, extrusion: int) -> Any:
    """按 orig/offset/trim/padding/rotate 约束得到可粘贴到 Atlas 的新像素。"""
    upright_width, upright_height = _upright_size(cell)
    degrees = cell["rotate_degrees"]
    if source.size == tuple(cell["orig"]):
        original_width, original_height = cell["orig"]
        offset_x, offset_y = cell["offset"]
        crop_y = original_height - offset_y - upright_height
        if offset_x < 0 or crop_y < 0 or offset_x + upright_width > original_width or crop_y + upright_height > original_height:
            raise ReskinError(f"Cell {cell['id']} 的 orig/offset 超出生成图范围")
        source = source.crop((offset_x, crop_y, offset_x + upright_width, crop_y + upright_height))
    elif source.size not in {
        (upright_width, upright_height),
        (upright_width - padding * 2, upright_height - padding * 2),
    }:
        raise ReskinError(
            f"Cell {cell['id']} 生成图尺寸 {source.size} 不匹配 orig {tuple(cell['orig'])} 或正向 size {(upright_width, upright_height)}"
        )
    output = _extruded_canvas(Image, source, (upright_width, upright_height), padding, extrusion)
    if _pma(cell.get("page_spec", {})):
        output = _premultiply(output)
    return _transpose(output, degrees)


def _safe_output_page(stage: Path, name: str) -> Path:
    """解析 Page 输出路径并拒绝通过 ../ 写出候选目录。"""
    candidate = (stage / name).resolve()
    try:
        candidate.relative_to(stage.resolve())
    except ValueError as exc:
        raise ReskinError(f"Page 名称越出候选目录：{name}") from exc
    candidate.parent.mkdir(parents=True, exist_ok=True)
    return candidate


def _output_page_name(page: dict[str, Any]) -> str:
    """将不可表达透明度的旧 JPG Page 改为 PNG 名称，其他名称保持不变。"""
    suffix = Path(page["name"]).suffix.lower()
    output = Path(page["name"]).with_suffix(".png") if suffix in {".jpg", ".jpeg"} else Path(page["name"])
    return output.as_posix()


def _pair(values: list[int] | tuple[int, int]) -> str:
    """以 Spine 常用的逗号空格格式输出二元坐标。"""
    return f"{values[0]}, {values[1]}"


def _quad(values: list[int]) -> str:
    """以 Spine 常用格式输出四元 bounds/offsets。"""
    return ", ".join(str(item) for item in values)


def _atlas_text(document: dict[str, Any]) -> str:
    """仅由清单元数据写出新 Atlas，绝不复制源 Page 的任何像素。"""
    pages = document["atlas"]["pages"]
    lines: list[str] = []
    for page in pages:
        lines.append(page.get("output_name", page["name"]))
        fields = page.get("fields", {})
        order = list(page.get("field_order", []))
        if not any(key.lower() == "size" for key in order):
            order.insert(0, "size")
        for key in order:
            value = _field(fields, key, "") or ""
            if key.lower() == "size":
                value = _pair([page["width"], page["height"]])
            lines.append(f"{key}: {value}")
        lines.append("")
        for cell in [item for item in document["cells"] if item["page_index"] == page["index"]]:
            lines.append(cell["name"])
            cell_fields = cell.get("fields", {})
            order = list(cell.get("field_order", []))
            lower_order = {key.lower() for key in order}
            if "rotate" not in lower_order:
                order.append("rotate")
            if "xy" not in lower_order and "bounds" not in lower_order:
                order.append("xy")
            if "size" not in lower_order:
                order.append("size")
            if "orig" not in lower_order and "offsets" not in lower_order:
                order.extend(["orig", "offset"])
            if "index" not in lower_order:
                order.append("index")
            for key in order:
                lower = key.lower()
                value = _field(cell_fields, key, "") or ""
                if lower == "rotate":
                    value = cell.get("rotate", "false")
                elif lower == "xy":
                    value = _pair(cell["xy"])
                elif lower == "bounds":
                    value = _quad([*cell["xy"], *cell["size"]])
                elif lower == "size":
                    value = _pair(cell["size"])
                elif lower == "orig":
                    value = _pair(cell["orig"])
                elif lower == "offset":
                    value = _pair(cell["offset"])
                elif lower == "offsets":
                    value = _quad([*cell["offset"], *cell["orig"]])
                elif lower == "index":
                    value = str(cell["index"])
                lines.append(f"  {key}: {value}")
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _commit_stage(stage: Path, target: Path, force: bool, protected: set[Path]) -> None:
    """以目录重命名提交候选，--force 也禁止覆盖源 Atlas 所在目录。"""
    target = target.resolve()
    if target in {item.resolve() for item in protected}:
        raise ReskinError("输出目录不能是源 Atlas 或其 Page 所在目录")
    backup: Path | None = None
    try:
        if target.exists():
            if not force:
                raise ReskinError(f"输出目录已存在，默认不覆盖：{target}（需要 --force）")
            backup = target.with_name(f".{target.name}.backup-{os.getpid()}")
            target.rename(backup)
        stage.rename(target)
    except Exception:
        if backup is not None and backup.exists() and not target.exists():
            backup.rename(target)
        raise
    if backup is not None and backup.exists():
        shutil.rmtree(backup)


def command_pack(args: argparse.Namespace) -> int:
    """从透明空白 Page 重建全部新纹理并在提交后写入 completed。"""
    manifest_path = Path(args.manifest).resolve()
    document = _read_manifest(manifest_path)
    output_dir = Path(args.output_dir).resolve()
    source_atlas = Path(document["atlas"]["path"]).resolve()
    protected = {source_atlas.parent, source_atlas, manifest_path}
    if output_dir in {item.resolve() for item in protected}:
        raise ReskinError("候选输出目录不能覆盖源文件目录")
    for cell in document["cells"]:
        if cell.get("status") != "validating":
            raise ReskinError(f"Cell {cell.get('id')} 必须先进入 validating，不能直接从 {cell.get('status')} 打包")
        image_path = _resolve_artifact(manifest_path, cell.get("generated_image"))
        if image_path is None or not image_path.is_file():
            raise ReskinError(f"Cell {cell.get('id')} 缺少生成图")
        if cell.get("result_sha256") != _sha256(image_path):
            raise ReskinError(f"Cell {cell.get('id')} 生成图哈希不匹配")
    Image = _require_pillow()
    padding = args.padding if args.padding is not None else int(document.get("packing", {}).get("padding", 0))
    extrusion = args.extrusion if args.extrusion is not None else int(document.get("packing", {}).get("extrusion", 0))
    if padding < 0 or extrusion < 0:
        raise ReskinError("padding 与 extrusion 不能为负数")
    document["packing"] = {"padding": padding, "extrusion": extrusion}
    for cell in document["cells"]:
        _transition(document, cell, "packing")
    _write_json_atomic(manifest_path, document)
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=f".{output_dir.name}.", dir=str(output_dir.parent)))
    page_hashes: dict[str, str] = {}
    try:
        for page in document["atlas"]["pages"]:
            page_image = Image.new("RGBA", (page["width"], page["height"]), (0, 0, 0, 0))
            for cell in [item for item in document["cells"] if item["page_index"] == page["index"]]:
                cell["page_spec"] = page
                x, y = cell["xy"]
                width, height = cell["size"]
                if x < 0 or y < 0 or x + width > page["width"] or y + height > page["height"]:
                    raise ReskinError(f"Cell {cell['id']} 超出 Page {page['name']} 边界")
                image_path = _resolve_artifact(manifest_path, cell["generated_image"])
                with Image.open(image_path) as generated:
                    packed = _prepare_cell_image(Image, cell, generated.convert("RGBA"), padding, extrusion)
                if packed.size != (width, height):
                    raise ReskinError(f"Cell {cell['id']} 旋转后尺寸 {packed.size} 不等于原 size {(width, height)}")
                # 直接复制 RGBA，避免 Pillow 的 alpha_composite 再次对 PMA RGB 预乘。
                page_image.paste(packed, (x, y))
            output_name = _output_page_name(page)
            page["output_name"] = output_name
            output_path = _safe_output_page(stage, output_name)
            page_image.save(output_path, format="PNG")
            page_image.close()
            page_hashes[output_name] = _sha256(output_path)
        atlas_name = args.atlas_name or (Path(source_atlas.name).stem + ".atlas")
        atlas_path = stage / atlas_name
        atlas_path.parent.mkdir(parents=True, exist_ok=True)
        atlas_path.write_text(_atlas_text(document), encoding="utf-8", newline="\n")
        output_atlas_relative = Path(atlas_name)
        _commit_stage(stage, output_dir, args.force, protected)
        stage = Path()  # 提交后不再清理已重命名目录。
        final_atlas = output_dir / output_atlas_relative
        document["build"] = {
            "output_dir": _relative_path(output_dir, manifest_path.parent),
            "output_atlas": _relative_path(final_atlas, manifest_path.parent),
            "atlas_sha256": _sha256(final_atlas),
            "page_sha256": page_hashes,
            "completed_at": _now(),
        }
        for cell in document["cells"]:
            _transition(document, cell, "completed")
        # 运行时只需要 page_spec 临时引用，清单不应写入重复的 Page 对象。
        for cell in document["cells"]:
            cell.pop("page_spec", None)
        _write_json_atomic(manifest_path, document)
        print(f"已重建 {len(document['atlas']['pages'])} 个 Page：{final_atlas}")
        return 0
    except Exception as exc:
        if stage and stage.exists():
            shutil.rmtree(stage, ignore_errors=True)
        for cell in document["cells"]:
            if cell.get("status") == "packing":
                _transition(document, cell, "failed", error=str(exc))
        for cell in document["cells"]:
            cell.pop("page_spec", None)
        _write_json_atomic(manifest_path, document)
        if isinstance(exc, ReskinError):
            raise
        raise ReskinError(f"重建失败：{exc}") from exc


def _parser() -> argparse.ArgumentParser:
    """构造统一 CLI，所有子命令都能在无额外依赖时显示 --help。"""
    parser = argparse.ArgumentParser(description="管理 Phaser 4 Spine Atlas 逐 Cell 生成式换皮进度与重建")
    subparsers = parser.add_subparsers(dest="command", required=True)

    init = subparsers.add_parser("init", help="解析 Atlas 并初始化进度清单")
    init.add_argument("--atlas", required=True, help="源 .atlas 文件")
    init.add_argument("--output", required=True, help="候选进度 JSON")
    init.add_argument("--reference-dir", help="可选的只读源 Cell 参考图目录")
    init.add_argument("--style-reference", action="append", help="全局风格/角色参考路径，可重复")
    init.add_argument("--force", action="store_true", help="允许覆盖已有进度清单")
    init.set_defaults(handler=command_init)

    status = subparsers.add_parser("status", help="汇总各状态 Cell 数量")
    status.add_argument("--manifest", required=True, help="进度 JSON")
    status.set_defaults(handler=command_status)

    read = subparsers.add_parser("read", help="读取完整进度清单")
    read.add_argument("--manifest", required=True, help="进度 JSON")
    read.set_defaults(handler=command_read)

    recover = subparsers.add_parser("recover", help="恢复中断时的处理中状态")
    recover.add_argument("--manifest", required=True, help="进度 JSON")
    recover.set_defaults(handler=command_recover)

    mark = subparsers.add_parser("mark", help="标记单个 Cell 的状态或生成结果")
    mark.add_argument("--manifest", required=True, help="进度 JSON")
    mark.add_argument("--cell", required=True, help="Cell 稳定 ID")
    mark.add_argument("--status", required=True, choices=STATUSES, help="目标状态")
    mark.add_argument("--image", help="generated 状态对应的候选图片")
    mark.add_argument("--error", help="failed 状态的可读原因")
    mark.set_defaults(handler=command_mark)

    verify = subparsers.add_parser("verify", help="验证所有 Cell 已完成且哈希一致")
    verify.add_argument("--manifest", required=True, help="进度 JSON")
    verify.set_defaults(handler=command_verify)

    pack = subparsers.add_parser("pack", help="从透明空白 Page 重建新 Atlas")
    pack.add_argument("--manifest", required=True, help="进度 JSON")
    pack.add_argument("--output-dir", required=True, help="全新 Atlas/Page 候选目录")
    pack.add_argument("--atlas-name", help="候选 Atlas 文件名，默认沿用源文件主名")
    pack.add_argument("--padding", type=int, help="Region 矩形内 padding，默认使用清单值")
    pack.add_argument("--extrusion", type=int, help="padding 内的边缘扩展像素数")
    pack.add_argument("--force", action="store_true", help="允许替换已有候选目录，不可替换源目录")
    pack.set_defaults(handler=command_pack)
    return parser


def main(argv: list[str] | None = None) -> int:
    """运行 CLI 并把预期失败转换为非零返回码，不吞掉诊断。"""
    parser = _parser()
    args = parser.parse_args(argv)
    try:
        return int(args.handler(args))
    except ReskinError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"错误：文件操作失败：{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

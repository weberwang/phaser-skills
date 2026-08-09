"""测试视觉资源机器清单验证器。"""

from __future__ import annotations

import importlib.util
import io
import tempfile
import unittest
from argparse import Namespace
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("validate_visual_manifest.py")
SPEC = importlib.util.spec_from_file_location("validate_visual_manifest", MODULE_PATH)
assert SPEC and SPEC.loader
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)


def valid_manifest() -> dict:
    """构造包含一个已验收资源的有效清单。"""
    return {
        "schema_version": "1.0",
        "budgets": {
            "max_texture_size": 4096,
            "texture_memory_mb": 64,
            "package_size_mb": 50,
            "max_atlases": 8,
            "max_frames": 512,
            "animation_sample_fps": 24,
            "max_overdraw": 3,
            "max_draw_calls": 100,
        },
        "assets": [
            {
                "id": "hero-idle",
                "texture_key": "hero-idle",
                "route": "frame-animation",
                "status": "accepted",
                "source_file": "art/hero.aseprite",
                "license_record": "docs/license.md",
                "runtime_outputs": ["public/assets/hero.png"],
                "phaser_evidence": "evidence/phaser.png",
                "gameplay_visual_evidence": "evidence/gameplay.mp4",
            }
        ],
    }


class ValidateVisualManifestTests(unittest.TestCase):
    """覆盖结构、唯一性、证据和文件存在性规则。"""

    def test_valid_manifest(self) -> None:
        """有效清单不应产生错误。"""
        self.assertEqual(VALIDATOR.validate_manifest(valid_manifest()), [])

    def test_duplicate_keys_and_outputs(self) -> None:
        """重复纹理键和输出路径必须同时被报告。"""
        manifest = valid_manifest()
        duplicate = dict(manifest["assets"][0])
        duplicate["id"] = "hero-run"
        manifest["assets"].append(duplicate)
        errors = VALIDATOR.validate_manifest(manifest)
        self.assertTrue(any("texture_key 重复" in error for error in errors))
        self.assertTrue(any("路径重复" in error for error in errors))

    def test_accepted_asset_requires_evidence(self) -> None:
        """已验收资源缺少关键证据时必须失败。"""
        manifest = valid_manifest()
        manifest["assets"][0].pop("phaser_evidence")
        errors = VALIDATOR.validate_manifest(manifest)
        self.assertTrue(any("phaser_evidence" in error for error in errors))

    def test_pending_budget_must_be_filled(self) -> None:
        """初始化清单中的待定义预算不得通过正式校验。"""
        manifest = valid_manifest()
        manifest["budgets"]["max_texture_size"] = None
        errors = VALIDATOR.validate_manifest(manifest)
        self.assertTrue(any("max_texture_size 必须是正数" in error for error in errors))

    def test_check_files(self) -> None:
        """文件检查应报告缺失路径，并接受实际存在的全部文件。"""
        manifest = valid_manifest()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            errors = VALIDATOR.check_manifest_files(manifest, root)
            self.assertTrue(any("文件不存在" in error for error in errors))
            for relative_path in (
                "art/hero.aseprite",
                "docs/license.md",
                "public/assets/hero.png",
                "evidence/phaser.png",
                "evidence/gameplay.mp4",
            ):
                target = root / relative_path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.touch()
            self.assertEqual(VALIDATOR.check_manifest_files(manifest, root), [])

    def test_check_files_skips_invalid_assets_container(self) -> None:
        """assets 类型错误时文件检查应安全跳过并保留结构错误。"""
        manifest = valid_manifest()
        manifest["assets"] = 42
        self.assertIn("assets 必须是数组", VALIDATOR.validate_manifest(manifest))
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(
                VALIDATOR.check_manifest_files(manifest, Path(directory)), []
            )

    def test_check_files_skips_invalid_runtime_outputs(self) -> None:
        """已验收资源的 runtime_outputs 非列表时不得触发未捕获异常。"""
        manifest = valid_manifest()
        manifest["assets"][0]["runtime_outputs"] = 7
        errors = VALIDATOR.validate_manifest(manifest)
        self.assertTrue(any("runtime_outputs 必须是非空路径列表" in error for error in errors))
        with tempfile.TemporaryDirectory() as directory:
            file_errors = VALIDATOR.check_manifest_files(manifest, Path(directory))
        self.assertTrue(any("source_file 文件不存在" in error for error in file_errors))

    def test_main_reports_structure_error_with_file_check(self) -> None:
        """结构错误与文件检查并存时 main 应稳定返回可读错误。"""
        manifest = valid_manifest()
        manifest["assets"] = 42
        args = Namespace(
            manifest=Path("docs/visual-assets.json"),
            project_root=Path.cwd(),
            check_files=True,
        )
        stderr = io.StringIO()
        with (
            patch.object(VALIDATOR, "parse_args", return_value=args),
            patch.object(VALIDATOR, "load_manifest", return_value=manifest),
            redirect_stderr(stderr),
        ):
            result = VALIDATOR.main()
        self.assertEqual(result, 1)
        self.assertIn("assets 必须是数组", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()

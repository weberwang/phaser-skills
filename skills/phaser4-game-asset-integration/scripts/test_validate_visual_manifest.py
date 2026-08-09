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
EMPTY_DOCUMENT_FINGERPRINT = (
    "sha256:e3b0c44298fc1c149afbf4c8996fb924"
    "27ae41e4649b934ca495991b7852b855"
)


def valid_manifest() -> dict:
    """构造包含一个已验收资源的有效清单。"""
    return {
        "schema_version": "1.1",
        "visual_baseline": {
            "id": "fox-world",
            "version": "1.0.0",
            "style_fingerprint": EMPTY_DOCUMENT_FINGERPRINT,
            "document": "docs/visual-design.md",
            "status": "frozen",
            "anchor_evidence": ["evidence/visual/main-anchor.png"],
        },
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
                "visual_baseline_id": "fox-world",
                "visual_baseline_version": "1.0.0",
                "style_fingerprint": EMPTY_DOCUMENT_FINGERPRINT,
                "source_file": "art/hero.aseprite",
                "license_record": "docs/license.md",
                "runtime_outputs": ["public/assets/hero.png"],
                "phaser_evidence": "evidence/phaser.png",
                "gameplay_visual_evidence": "evidence/gameplay.mp4",
                "consistency_evidence": ["evidence/visual/hero-consistency.png"],
            }
        ],
    }


def valid_ai_manifest() -> dict:
    """构造包含完整生成包的 AI 合成栅格清单。"""
    manifest = valid_manifest()
    asset = manifest["assets"][0]
    asset["route"] = "ai-composite-raster"
    asset["generation_record"] = {
        "global_prompt_prefix": "冻结的狐狸世界全局前缀",
        "asset_prompt": "主角待机透明立绘",
        "state_prompt": "默认待机状态",
        "negative_prompt": "禁止写实材质与异向光源",
        "model": "example-image-model",
        "model_version": "2026-08-01",
        "seed": 42,
        "reference_inputs": ["evidence/visual/ai-reference.png"],
        "postprocess": ["清理透明边缘", "统一描边粗细"],
    }
    return manifest


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

    def test_visual_baseline_is_required_and_frozen(self) -> None:
        """根基线缺失或未冻结时必须失败。"""
        manifest = valid_manifest()
        manifest.pop("visual_baseline")
        self.assertTrue(
            any(
                "visual_baseline 必须是对象" in error
                for error in VALIDATOR.validate_manifest(manifest)
            )
        )

        manifest = valid_manifest()
        manifest["visual_baseline"]["status"] = "draft"
        self.assertTrue(
            any(
                "status 必须为 frozen" in error
                for error in VALIDATOR.validate_manifest(manifest)
            )
        )

    def test_style_fingerprint_requires_sha256_format(self) -> None:
        """风格指纹必须使用固定的小写 SHA-256 格式。"""
        manifest = valid_manifest()
        manifest["visual_baseline"]["style_fingerprint"] = "sha256:ABC"
        errors = VALIDATOR.validate_manifest(manifest)
        self.assertTrue(any("64 位小写十六进制" in error for error in errors))

    def test_asset_baseline_version_and_fingerprint_must_match(self) -> None:
        """生产资源的基线版本和风格指纹必须与根基线一致。"""
        for field, value in (
            ("visual_baseline_version", "2.0.0"),
            ("style_fingerprint", "sha256:drifted"),
        ):
            with self.subTest(field=field):
                manifest = valid_manifest()
                manifest["assets"][0][field] = value
                errors = VALIDATOR.validate_manifest(manifest)
                self.assertTrue(any(f"{field} 与" in error for error in errors))

    def test_accepted_asset_requires_consistency_evidence(self) -> None:
        """已验收资源必须提供跨资源一致性证据。"""
        manifest = valid_manifest()
        manifest["assets"][0]["consistency_evidence"] = []
        errors = VALIDATOR.validate_manifest(manifest)
        self.assertTrue(any("consistency_evidence" in error for error in errors))

    def test_valid_ai_manifest_and_required_generation_fields(self) -> None:
        """AI 合成栅格资源必须具备完整生成包。"""
        self.assertEqual(VALIDATOR.validate_manifest(valid_ai_manifest()), [])

        manifest = valid_ai_manifest()
        manifest["assets"][0]["generation_record"].pop("global_prompt_prefix")
        errors = VALIDATOR.validate_manifest(manifest)
        self.assertTrue(any("global_prompt_prefix" in error for error in errors))

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
            self.assertTrue(any("visual_baseline.document" in error for error in errors))
            self.assertTrue(any("anchor_evidence" in error for error in errors))
            self.assertTrue(any("consistency_evidence" in error for error in errors))
            for relative_path in (
                "docs/visual-design.md",
                "evidence/visual/main-anchor.png",
                "art/hero.aseprite",
                "docs/license.md",
                "public/assets/hero.png",
                "evidence/phaser.png",
                "evidence/gameplay.mp4",
                "evidence/visual/hero-consistency.png",
            ):
                target = root / relative_path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.touch()
            self.assertEqual(VALIDATOR.check_manifest_files(manifest, root), [])
            (root / "docs/visual-design.md").write_text("已被静默修改", encoding="utf-8")
            errors = VALIDATOR.check_manifest_files(manifest, root)
            self.assertTrue(any("文件 SHA-256 不一致" in error for error in errors))

    def test_check_files_validates_ai_reference_inputs(self) -> None:
        """文件检查必须覆盖 AI 生成包的参考输入。"""
        manifest = valid_ai_manifest()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative_path in (
                "docs/visual-design.md",
                "evidence/visual/main-anchor.png",
                "art/hero.aseprite",
                "docs/license.md",
                "public/assets/hero.png",
                "evidence/phaser.png",
                "evidence/gameplay.mp4",
                "evidence/visual/hero-consistency.png",
            ):
                target = root / relative_path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.touch()
            errors = VALIDATOR.check_manifest_files(manifest, root)
            self.assertTrue(any("reference_inputs 文件不存在" in error for error in errors))

            reference = root / "evidence/visual/ai-reference.png"
            reference.touch()
            self.assertEqual(VALIDATOR.check_manifest_files(manifest, root), [])

    def test_check_files_skips_invalid_assets_container(self) -> None:
        """assets 类型错误时文件检查应安全跳过并保留结构错误。"""
        manifest = valid_manifest()
        manifest["assets"] = 42
        self.assertIn("assets 必须是数组", VALIDATOR.validate_manifest(manifest))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative_path in (
                "docs/visual-design.md",
                "evidence/visual/main-anchor.png",
            ):
                target = root / relative_path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.touch()
            self.assertEqual(
                VALIDATOR.check_manifest_files(manifest, root), []
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
